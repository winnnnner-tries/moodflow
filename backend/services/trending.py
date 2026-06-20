import asyncio
from datetime import datetime, timezone
from services.innertube import innertube_service
from services.supabase_client import supabase
from services.clean_db import find_existing_track

async def sync_trending_tracks():
    """Sync trending tracks from YouTube Music charts to the database."""
    print(f"[{datetime.now(timezone.utc).isoformat()}] Starting automated daily trending sync...")
    try:
        # Fetch charts from YT Music
        charts = innertube_service.yt.get_charts(country='ZZ')
        if not charts or "videos" not in charts:
            print("No videos found in charts.")
            return
        
        videos_list = charts.get("videos", [])
        if not isinstance(videos_list, list) or not videos_list:
            print("Videos list is empty or invalid.")
            return
            
        # Get the first charts playlist (usually Daily Top Music Videos)
        charts_playlist = videos_list[0]
        playlist_id = charts_playlist.get("playlistId")
        if not playlist_id:
            print("No playlistId found for charts playlist.")
            return
            
        print(f"Fetching charts playlist tracks for: {playlist_id}")
        playlist_res = innertube_service.get_playlist_tracks(playlist_id)
        video_items = playlist_res.get("tracks", [])
        print(f"Found {len(video_items)} trending videos/songs in charts playlist.")
        
        inserted_count = 0
        updated_count = 0

        for item in video_items:
            youtube_id = item.get("youtube_id")
            if not youtube_id:
                continue
            
            track_name = item.get("track_name")
            artist = item.get("artist", "Unknown Artist")
            
            if not track_name:
                continue
            
            # Check if track already exists (fuzzy or exact)
            existing = find_existing_track(track_name, artist, youtube_id)
            if existing:
                # Merge metadata fields if they are missing in the existing DB track
                update_fields = {}
                for field in ["youtube_id", "thumbnail_url", "album", "explicit", "duration_ms"]:
                    if not existing.get(field) and item.get(field):
                        update_fields[field] = item.get(field)
                
                # If we need to update the existing track in the DB
                if update_fields:
                    supabase.table("tracks").update(update_fields).eq("id", existing["id"]).execute()
                    updated_count += 1
                continue

            # Map into database track schema fields with neutral parameters
            db_row = {
                "track_name": track_name.strip(),
                "artist": artist.strip(),
                "album": item.get("album"),
                "language": "en",  # Default global
                "youtube_id": youtube_id,
                "thumbnail_url": item.get("thumbnail_url"),
                "energy": 0.5,
                "danceability": 0.5,
                "valence": 0.5,
                "tempo": 0.5,
                "acousticness": 0.5,
                "instrumentalness": 0.1,
                "speechiness": 0.1,
                "liveness": 0.1,
                "loudness": 0.7,
                "popularity": 0.8,
                "explicit": item.get("explicit", False),
                "duration_ms": item.get("duration_ms", 180000),
                "source": "ytmusic_trending",
                "created_at": datetime.now(timezone.utc).isoformat()
            }
            supabase.table("tracks").insert(db_row).execute()
            inserted_count += 1

        print(f"Daily sync completed: Inserted {inserted_count} new tracks, updated metadata for {updated_count} existing tracks.")
            
    except Exception as e:
        print(f"Error in automated daily trending sync: {e}")

async def daily_trending_sync_task():
    """Background task to run sync_trending_tracks every 24 hours, skipping if run recently."""
    # Wait 10 seconds after startup before running the first check to let the server initialize
    await asyncio.sleep(10)
    while True:
        try:
            # Check when the last trending track was added to avoid duplicate syncs on restart
            res = supabase.table("tracks").select("created_at").eq("source", "ytmusic_trending").order("created_at", desc=True).limit(1).execute()
            data = res.data if res.data else []
            
            run_sync = True
            sleep_duration = 24 * 3600
            
            if data:
                from datetime import datetime, timezone
                last_created_str = data[0].get("created_at")
                if last_created_str:
                    # Parse ISO timestamp
                    last_created_str = last_created_str.replace("Z", "+00:00")
                    last_created = datetime.fromisoformat(last_created_str)
                    now = datetime.now(timezone.utc)
                    elapsed = (now - last_created).total_seconds()
                    
                    if elapsed < 24 * 3600:
                        run_sync = False
                        sleep_duration = (24 * 3600) - elapsed
                        print(f"[Daily Sync] Latest trending tracks were updated {elapsed/3600:.2f} hours ago. Skipping sync on startup. Next sync in {sleep_duration/3600:.2f} hours.")
            
            if run_sync:
                await sync_trending_tracks()
                sleep_duration = 24 * 3600
                
            await asyncio.sleep(max(10, sleep_duration))
        except Exception as e:
            print(f"Error in daily_trending_sync_task loop: {e}")
            await asyncio.sleep(3600) # Sleep for 1 hour on error before retrying

