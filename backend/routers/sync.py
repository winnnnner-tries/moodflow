from fastapi import APIRouter, BackgroundTasks, HTTPException, Body, Query
from services.kaggle_sync import sync_local_csv
from services.innertube import innertube_service
from services.supabase_client import supabase, execute_with_retry
from services.clean_db import find_existing_track
from services.musicbrainz_sync import sync_musicbrainz_tracks
from datetime import datetime, timezone

router = APIRouter()

@router.post("/sync/kaggle")
def trigger_sync(background_tasks: BackgroundTasks):
    try:
        # Start import task in background since it has ~60k records and takes time
        background_tasks.add_task(sync_local_csv)
        return {
            "status": "sync_triggered",
            "message": "Local CSV import has been triggered in the background. Check backend console logs for progress."
        }
    except Exception as e:
        print(f"Error triggering sync: {e}")
        raise HTTPException(status_code=500, detail=str(e))

def sync_playlist_tracks_in_background(tracks: list, lang: str):
    """Background task to sync playlist tracks to Supabase without blocking the client."""
    print(f"[Sync Background] Starting background sync for {len(tracks)} tracks (Lang: {lang})...")
    for t in tracks:
        try:
            youtube_id = t.get("youtube_id")
            track_name = t["track_name"]
            artist = t["artist"]
            
            existing = find_existing_track(track_name, artist, youtube_id)
            if existing:
                # Update youtube_id and thumbnail_url if missing, merge other fields
                update_fields = {}
                if t.get("youtube_id") and not existing.get("youtube_id"):
                    update_fields["youtube_id"] = t.get("youtube_id")
                if t.get("thumbnail_url") and not existing.get("thumbnail_url"):
                    update_fields["thumbnail_url"] = t.get("thumbnail_url")
                
                for field in ["album", "explicit", "duration_ms"]:
                    if not existing.get(field) and t.get(field):
                        update_fields[field] = t.get(field)
                if update_fields:
                    execute_with_retry(supabase.table("tracks").update(update_fields).eq("id", existing["id"]))
            else:
                db_row = {
                    "track_name": track_name.strip(),
                    "artist": artist.strip(),
                    "album": t.get("album"),
                    "language": lang,
                    "youtube_id": youtube_id,
                    "thumbnail_url": t.get("thumbnail_url"),
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
                    "explicit": t.get("explicit", False),
                    "duration_ms": t.get("duration_ms", 180000),
                    "source": "ytmusic_playlist",
                    "created_at": datetime.now(timezone.utc).isoformat()
                }
                execute_with_retry(supabase.table("tracks").insert(db_row))
        except Exception as e:
            print(f"[Sync Background] Error syncing track '{t.get('track_name')}': {e}")
    print("[Sync Background] Background sync completed.")

@router.get("/sync/playlist/{playlist_id}")
def sync_playlist_endpoint(playlist_id: str, background_tasks: BackgroundTasks, lang: str = "en"):
    try:
        res = innertube_service.get_playlist_tracks(playlist_id)
        tracks = res.get("tracks", [])
        if not tracks:
            return {
                "title": res.get("title", "Unknown Playlist"),
                "description": res.get("description", ""),
                "thumbnail_url": res.get("thumbnail_url"),
                "tracks": []
            }
        
        # Check already registered tracks in bulk to fetch database IDs
        youtube_ids = [t["youtube_id"] for t in tracks if t.get("youtube_id")]
        db_tracks_map = {}
        if youtube_ids:
            try:
                db_tracks_response = execute_with_retry(supabase.table("tracks").select("*").in_("youtube_id", youtube_ids))
                if db_tracks_response.data:
                    db_tracks_map = {t["youtube_id"]: t for t in db_tracks_response.data}
            except Exception as db_err:
                print(f"Error querying Supabase in bulk: {db_err}")

        ordered_db_tracks = []
        for t in tracks:
            yt_id = t["youtube_id"]
            if yt_id in db_tracks_map:
                db_track = db_tracks_map[yt_id]
                db_track["language"] = lang
                ordered_db_tracks.append(db_track)
            else:
                t["id"] = None
                t["language"] = lang
                ordered_db_tracks.append(t)

        # Trigger detailed deduplication and save task in background
        background_tasks.add_task(sync_playlist_tracks_in_background, tracks=tracks, lang=lang)

        playlist_thumb = res.get("thumbnail_url")
        if not playlist_thumb or "yt3.googleusercontent.com" in playlist_thumb:
            if ordered_db_tracks:
                playlist_thumb = ordered_db_tracks[0].get("thumbnail_url")
            elif tracks:
                playlist_thumb = tracks[0].get("thumbnail_url")

        return {
            "title": res.get("title", "Unknown Playlist"),
            "description": res.get("description", ""),
            "thumbnail_url": playlist_thumb,
            "tracks": ordered_db_tracks
        }
    except Exception as e:
        print(f"Error syncing playlist {playlist_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/sync/playlists")
def save_playlist(playlist_id: str = Body(..., embed=True)):
    try:
        # Extract playlist metadata dynamically from YT Music (limit 1 track for speed)
        res = innertube_service.get_playlist_tracks(playlist_id, limit=1)
        
        playlist_thumb = res.get("thumbnail_url")
        tracks = res.get("tracks", [])
        if not playlist_thumb or "yt3.googleusercontent.com" in playlist_thumb:
            if tracks:
                playlist_thumb = tracks[0].get("thumbnail_url")

        db_row = {
            "playlist_id": playlist_id.strip(),
            "title": res.get("title", "Unknown Playlist").strip(),
            "description": res.get("description", ""),
            "thumbnail_url": playlist_thumb
        }
        
        # Save or update the playlist in the table
        upsert_res = execute_with_retry(
            supabase.table("playlists").upsert(db_row, on_conflict="playlist_id")
        )
        if not upsert_res.data:
            raise HTTPException(status_code=500, detail="Failed to save playlist.")
            
        return upsert_res.data[0]
    except Exception as e:
        print(f"Error saving playlist {playlist_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/sync/playlists")
def get_saved_playlists():
    try:
        res = execute_with_retry(
            supabase.table("playlists").select("*").order("created_at", desc=True)
        )
        return res.data if res.data else []
    except Exception as e:
        print(f"Error fetching playlists: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/sync/playlists/{playlist_id}")
def delete_saved_playlist(playlist_id: str):
    try:
        res = execute_with_retry(
            supabase.table("playlists").delete().eq("playlist_id", playlist_id)
        )
        return {"status": "success", "message": "Playlist removed from library"}
    except Exception as e:
        print(f"Error deleting playlist {playlist_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/sync/musicbrainz")
def trigger_musicbrainz_sync(
    background_tasks: BackgroundTasks,
    query: str = Query("reldate:2026 AND country:IN", description="MusicBrainz Lucene search query"),
    lang: str = Query("ta", description="Two-letter language code to assign to these songs (e.g. 'ta', 'hi', 'en')"),
    limit: int = Query(20, description="Max recordings to fetch from MusicBrainz (max 100)"),
):
    try:
        background_tasks.add_task(sync_musicbrainz_tracks, query=query, lang=lang, limit=limit)
        return {
            "status": "sync_triggered",
            "message": f"MusicBrainz sync triggered in the background for query '{query}' (lang: '{lang}'). Check backend logs for progress."
        }
    except Exception as e:
        print(f"Error triggering MusicBrainz sync: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/sync/playlists/featured")
def get_featured_playlists(
    lang: str = Query("en", description="Language preference code"),
    preset: str = Query("chill", description="Current mood preset")
):
    from services.dynamic_feed import LANG_NAMES, PRESET_QUERIES
    try:
        lang_name = LANG_NAMES.get(lang, "English")
        mood_label = PRESET_QUERIES.get(preset, preset.replace("_", " ").title())
        
        # Base query on language + mood to ensure relevant playlists
        if preset in ["workout", "hype", "feel_good"]:
            query = f"{lang_name} {mood_label} 2024"
        else:
            query = f"{lang_name} {mood_label}"
        
        # Search for playlists in YT Music
        results = innertube_service.yt.search(query, filter="playlists")
        
        featured = []
        for p in results[:5]:
            playlist_id = p.get("browseId") or p.get("playlistId")
            if not playlist_id:
                continue
            
            thumbnails = p.get("thumbnails", [])
            thumbnail_url = thumbnails[-1].get("url") if thumbnails else None
            
            featured.append({
                "id": playlist_id,
                "title": p.get("title", "Curated Playlist"),
                "description": p.get("description", f"Curated {lang_name} hits and popular songs."),
                "thumbnail_url": thumbnail_url,
                "gradient": "linear-gradient(135deg, #6366f1 0%, #a855f7 100%)",
                "icon": "🎶"
            })
        return featured
    except Exception as e:
        print(f"Error fetching featured playlists: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/sync/seed-playlists")
def trigger_seed_playlist_sync(
    background_tasks: BackgroundTasks,
    lang: str = Query(None, description="Two-letter language code (e.g. 'ta', 'hi'). If omitted, syncs ALL languages.")
):
    """Trigger import of curated 'Presenting [Artist]' and mood playlists from YouTube Music."""
    from services.seed_playlists import run_seed_playlist_sync
    try:
        background_tasks.add_task(run_seed_playlist_sync, lang=lang)
        scope = f"language '{lang}'" if lang else "ALL languages"
        return {
            "status": "sync_triggered",
            "message": f"Seed playlist sync triggered in background for {scope}. Check backend logs for progress."
        }
    except Exception as e:
        print(f"Error triggering seed playlist sync: {e}")
        raise HTTPException(status_code=500, detail=str(e))
