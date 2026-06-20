import urllib.request
import urllib.parse
import json
import time
from datetime import datetime, timezone
from services.supabase_client import supabase, execute_with_retry
from services.clean_db import find_existing_track
from services.innertube import innertube_service

def get_artist_name_from_credits(credits):
    if not credits:
        return "Unknown Artist"
    artist_name = ""
    for ac in credits:
        name = ac.get("name") or ac.get("artist", {}).get("name", "")
        join_phrase = ac.get("joinphrase", "")
        artist_name += name + join_phrase
    return artist_name.strip() if artist_name else "Unknown Artist"

def sync_musicbrainz_tracks(query: str, lang: str, limit: int = 20):
    """
    Sync new releases from MusicBrainz by querying its recording search,
    resolving track details on YouTube Music, and saving them to the database.
    """
    print(f"[{datetime.now(timezone.utc).isoformat()}] Starting MusicBrainz sync...")
    print(f"Query: {query} | Language: {lang} | Limit: {limit}")
    
    # 1. Query MusicBrainz Recording Search API
    # Max limit in one request is 100
    safe_limit = min(max(1, limit), 100)
    url = f"https://musicbrainz.org/ws/2/recording/?query={urllib.parse.quote(query)}&fmt=json&limit={safe_limit}"
    
    # MusicBrainz requires a meaningful User-Agent
    headers = {
        'User-Agent': 'MoodFlowSync/1.0.0 ( contact@moodflow.app )'
    }
    
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req) as response:
            res_data = json.loads(response.read().decode())
    except Exception as e:
        print(f"Error querying MusicBrainz API: {e}")
        return {"status": "error", "message": f"MusicBrainz API error: {str(e)}"}
        
    recordings = res_data.get("recordings", [])
    print(f"Found {len(recordings)} recordings in MusicBrainz search results.")
    
    inserted_count = 0
    skipped_count = 0
    error_count = 0
    
    # 2. Iterate through each recording and search on YouTube Music
    for idx, recording in enumerate(recordings):
        # Respect the rate limits (1 req/sec average for MusicBrainz)
        time.sleep(1.0)
        
        track_name = recording.get("title")
        if not track_name:
            continue
            
        artist_credits = recording.get("artist-credit", [])
        artist_name = get_artist_name_from_credits(artist_credits)
        
        album_name = None
        releases = recording.get("releases", [])
        if releases:
            album_name = releases[0].get("title")
            
        duration_ms = recording.get("length") or 180000 # default to 3 mins if missing
        
        print(f"\n[{idx+1}/{len(recordings)}] Processing Recording: '{track_name}' by '{artist_name}'")
        
        try:
            # 3. Search YouTube Music using Innertube
            search_query = f"{track_name} {artist_name}"
            yt_track = innertube_service.search_track(search_query)
            
            if not yt_track:
                print(f"  -> No matching track found on YouTube Music for query '{search_query}'. Skipping.")
                skipped_count += 1
                continue
                
            # 4. Check if duplicate or already exists in database
            youtube_id = yt_track.get("youtube_id")
            existing = find_existing_track(yt_track["track_name"], yt_track["artist"], youtube_id)
            
            if existing:
                print(f"  -> Track already exists in DB (ID: {existing['id']}). Skipping.")
                skipped_count += 1
                continue
                
            # 5. Insert new record with dummy parameters (0.5)
            db_row = {
                "track_name": yt_track["track_name"].strip(),
                "artist": yt_track["artist"].strip(),
                "album": yt_track.get("album") or album_name,
                "language": lang,
                "youtube_id": youtube_id,
                "thumbnail_url": yt_track.get("thumbnail_url"),
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
                "explicit": yt_track.get("explicit", False),
                "duration_ms": yt_track.get("duration_ms") or duration_ms,
                "source": "musicbrainz_sync",
                "created_at": datetime.now(timezone.utc).isoformat()
            }
            
            execute_with_retry(supabase.table("tracks").insert(db_row))
            print(f"  -> Successfully inserted new track: '{db_row['track_name']}' - '{db_row['artist']}' (YT: {youtube_id})")
            inserted_count += 1
            
        except Exception as e:
            print(f"  -> Error processing recording: {e}")
            error_count += 1
            
    print(f"\n[{datetime.now(timezone.utc).isoformat()}] MusicBrainz sync finished.")
    print(f"Summary: Inserted: {inserted_count} | Skipped: {skipped_count} | Errors: {error_count}")
    return {
        "status": "success",
        "inserted": inserted_count,
        "skipped": skipped_count,
        "errors": error_count
    }
