"""
Seed Playlists Service
======================
Auto-imports curated "Presenting [Artist]" and mood-specific playlists from
YouTube Music into the tracks / playlists tables.  Designed to be triggered
once per language (or all at once) via background task.
"""

import asyncio
import time
from datetime import datetime, timezone
from services.innertube import innertube_service
from services.supabase_client import supabase, execute_with_retry
from services.clean_db import find_existing_track

# ---------------------------------------------------------------------------
# Per-language artist lists
# ---------------------------------------------------------------------------
SEED_ARTISTS = {
    "ta": [
        "Anirudh Ravichander", "AR Rahman", "Yuvan Shankar Raja", "Sid Sriram",
        "Santhosh Narayanan", "Ilaiyaraaja", "GV Prakash", "Harris Jayaraj",
        "Vijay Antony", "Hiphop Tamizha", "D. Imman",
    ],
    "hi": [
        "Arijit Singh", "Pritam", "AP Dhillon", "Diljit Dosanjh",
        "Vishal-Shekhar", "Shankar Ehsaan Loy", "Neha Kakkar",
        "Tanishk Bagchi", "Sachet-Parampara", "Badshah", "Raftaar",
    ],
    "en": [
        "The Weeknd", "Taylor Swift", "Drake", "Dua Lipa", "Billie Eilish",
        "Bruno Mars", "Post Malone", "Ed Sheeran", "Kendrick Lamar",
        "SZA", "Olivia Rodrigo",
    ],
    "te": [
        "Thaman S", "Devi Sri Prasad", "Mickey J Meyer", "Sid Sriram",
    ],
    "ko": [
        "BTS", "BLACKPINK", "NewJeans", "IU", "Stray Kids", "TWICE", "aespa",
    ],
    "ml": [
        "Sushin Shyam", "Vineeth Sreenivasan", "Prithviraj Sukumaran",
    ],
    "kn": [
        "D. Imman", "Arjun Janya",
    ],
    "bn": [
        "Arijit Singh", "Anupam Roy",
    ],
}

LANG_NAMES = {
    "en": "English",
    "hi": "Hindi",
    "ta": "Tamil",
    "te": "Telugu",
    "ml": "Malayalam",
    "kn": "Kannada",
    "bn": "Bengali",
    "ko": "Korean",
}

# ---------------------------------------------------------------------------
# Per-language mood query templates
# ---------------------------------------------------------------------------
def _mood_queries(lang_code: str) -> list[str]:
    """Return mood-based playlist search queries for a given language."""
    name = LANG_NAMES.get(lang_code, "English")
    return [
        f"{name} Workout Songs",
        f"{name} Chill Songs",
        f"{name} Sad Songs",
        f"{name} Party Songs",
        f"{name} Hits 2024",
        f"{name} Hits 2025",
        f"New {name} Songs This Week",
        f"{name} Love Songs",
    ]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _extract_release_year(item: dict) -> int | None:
    """Try to pull a release year from the ytmusicapi track item."""
    album_data = item.get("album")
    if isinstance(album_data, dict):
        year = album_data.get("year")
        if year:
            try:
                return int(year)
            except (ValueError, TypeError):
                pass
    # Some items have a top-level year field
    year = item.get("year")
    if year:
        try:
            return int(year)
        except (ValueError, TypeError):
            pass
    return None


def _upsert_track(track_info: dict, lang: str, source: str = "ytmusic_curated"):
    """
    Insert or update a single track into the database.
    Returns the database row dict (existing or newly created).
    """
    youtube_id = track_info.get("youtube_id")
    track_name = track_info.get("track_name", "").strip()
    artist = track_info.get("artist", "").strip()

    if not track_name or not artist:
        return None

    existing = find_existing_track(track_name, artist, youtube_id)

    if existing:
        # Merge any missing metadata
        update_fields = {}
        if youtube_id and not existing.get("youtube_id"):
            update_fields["youtube_id"] = youtube_id
        if track_info.get("thumbnail_url") and not existing.get("thumbnail_url"):
            update_fields["thumbnail_url"] = track_info["thumbnail_url"]
        for field in ["album", "explicit", "duration_ms"]:
            if not existing.get(field) and track_info.get(field):
                update_fields[field] = track_info[field]
        # Always update release_year if we have it and the DB doesn't
        release_year = track_info.get("release_year")
        if release_year and not existing.get("release_year"):
            update_fields["release_year"] = release_year
        if update_fields:
            execute_with_retry(
                supabase.table("tracks").update(update_fields).eq("id", existing["id"])
            )
        return existing

    # New track
    db_row = {
        "track_name": track_name,
        "artist": artist,
        "album": track_info.get("album"),
        "language": lang,
        "youtube_id": youtube_id,
        "thumbnail_url": track_info.get("thumbnail_url"),
        "energy": 0.5,
        "danceability": 0.5,
        "valence": 0.5,
        "tempo": 0.5,
        "acousticness": 0.5,
        "instrumentalness": 0.1,
        "speechiness": 0.1,
        "liveness": 0.1,
        "loudness": 0.7,
        "popularity": 0.6,
        "explicit": track_info.get("explicit", False),
        "duration_ms": track_info.get("duration_ms", 180000),
        "source": source,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    release_year = track_info.get("release_year")
    if release_year:
        db_row["release_year"] = release_year

    res = execute_with_retry(supabase.table("tracks").insert(db_row))
    return res.data[0] if res.data else None


def _save_playlist_ref(playlist_id: str, title: str, thumbnail_url: str | None, description: str = ""):
    """Save/update a playlist reference in the playlists table."""
    try:
        db_row = {
            "playlist_id": playlist_id.strip(),
            "title": title.strip(),
            "description": description,
            "thumbnail_url": thumbnail_url,
        }
        execute_with_retry(
            supabase.table("playlists").upsert(db_row, on_conflict="playlist_id")
        )
    except Exception as e:
        print(f"[Seed Playlists] Warning: could not save playlist ref '{title}': {e}")


def _parse_playlist_track(item: dict) -> dict | None:
    """Convert a raw ytmusicapi playlist track item into our track dict."""
    youtube_id = item.get("videoId")
    if not youtube_id:
        return None

    track_name = item.get("title", "")
    artists = item.get("artists", [])
    artist_names = [a.get("name", "") for a in artists]
    artist = ", ".join(artist_names) if artist_names else "Unknown Artist"

    album_data = item.get("album")
    album = None
    if isinstance(album_data, dict):
        album = album_data.get("name")
    elif isinstance(album_data, str):
        album = album_data

    thumbnails = item.get("thumbnails", [])
    thumbnail_url = (
        thumbnails[-1].get("url") if thumbnails
        else f"https://i.ytimg.com/vi/{youtube_id}/mqdefault.jpg"
    )

    duration_ms = 0
    if "duration_seconds" in item:
        duration_ms = int(item["duration_seconds"]) * 1000
    elif "duration" in item:
        duration_ms = innertube_service.parse_duration(item["duration"])

    explicit = item.get("isExplicit", False)
    release_year = _extract_release_year(item)

    return {
        "youtube_id": youtube_id,
        "track_name": track_name,
        "artist": artist,
        "album": album,
        "thumbnail_url": thumbnail_url,
        "duration_ms": duration_ms,
        "explicit": explicit,
        "release_year": release_year,
    }


# ---------------------------------------------------------------------------
# Core sync logic for a single query
# ---------------------------------------------------------------------------

def _sync_single_query(query: str, lang: str, source: str = "ytmusic_curated"):
    """
    Search YTM for playlists matching *query*, take the top result,
    fetch its tracks, and upsert them into the DB.
    """
    try:
        safe_query = query.encode("ascii", "ignore").decode("ascii")
        print(f"[Seed Playlists] Searching: '{safe_query}' ...")
        results = innertube_service.yt.search(query, filter="playlists")
        if not results:
            print(f"[Seed Playlists]   -> No playlists found for '{safe_query}'")
            return 0

        playlist = results[0]
        playlist_id = playlist.get("browseId") or playlist.get("playlistId")
        if not playlist_id:
            print(f"[Seed Playlists]   -> No playlist ID for '{safe_query}'")
            return 0

        # Fetch tracks (up to 60)
        playlist_res = innertube_service.get_playlist_tracks(playlist_id, limit=60)
        raw_tracks = playlist_res.get("tracks", [])

        # Also save playlist reference
        thumbnails = playlist.get("thumbnails", [])
        thumb = thumbnails[-1].get("url") if thumbnails else None
        _save_playlist_ref(
            playlist_id,
            playlist.get("title", query),
            thumb or playlist_res.get("thumbnail_url"),
            description=f"Auto-imported: {query}",
        )

        count = 0
        # We need the raw playlist data for release_year extraction
        # Re-fetch using raw get_playlist to keep album/year data
        try:
            raw_playlist = innertube_service.yt.get_playlist(playlistId=playlist_id, limit=60)
            raw_items = raw_playlist.get("tracks", []) if raw_playlist else []
        except Exception:
            raw_items = []

        # Use raw_items for richer metadata, fall back to playlist_res tracks
        items_to_process = raw_items if raw_items else []

        for item in items_to_process:
            parsed = _parse_playlist_track(item)
            if not parsed:
                continue
            try:
                _upsert_track(parsed, lang, source=source)
                count += 1
            except Exception as te:
                safe_name = parsed.get("track_name", "?").encode("ascii", "ignore").decode("ascii")
                print(f"[Seed Playlists]   Track error '{safe_name}': {te}")

        safe_title = playlist.get("title", "?").encode("ascii", "ignore").decode("ascii")
        print(f"[Seed Playlists]   -> Synced {count} tracks from '{safe_title}'")
        return count

    except Exception as e:
        safe_query = query.encode("ascii", "ignore").decode("ascii")
        print(f"[Seed Playlists]   ERROR for '{safe_query}': {e}")
        return 0


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

async def run_seed_playlist_sync(lang: str = None):
    """
    Main entry point.  If *lang* is provided sync only that language,
    otherwise sync all languages.
    """
    languages = [lang] if lang else list(SEED_ARTISTS.keys())
    total_tracks = 0
    start_time = time.time()

    for lc in languages:
        lang_name = LANG_NAMES.get(lc, lc)
        print(f"\n{'='*60}")
        print(f"[Seed Playlists] Syncing language: {lang_name} ({lc})")
        print(f"{'='*60}")

        # --- Artist playlists ---
        artists = SEED_ARTISTS.get(lc, [])
        for artist in artists:
            query = f"Presenting {artist}"
            count = _sync_single_query(query, lc, source="ytmusic_curated")
            total_tracks += count
            # Rate limit: 1.5 s between API call batches
            await asyncio.sleep(1.5)

        # --- Mood / category playlists ---
        mood_queries = _mood_queries(lc)
        for mq in mood_queries:
            count = _sync_single_query(mq, lc, source="ytmusic_curated")
            total_tracks += count
            await asyncio.sleep(1.5)

    elapsed = time.time() - start_time
    print(f"\n[Seed Playlists] === DONE === Synced {total_tracks} total tracks in {elapsed:.1f}s")
