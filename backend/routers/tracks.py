from fastapi import APIRouter, HTTPException, Query, Body, Request
from fastapi.responses import StreamingResponse
import httpx
from datetime import datetime, timezone
from services.supabase_client import supabase, execute_with_retry
from services.innertube import innertube_service
from services.normalise import normalise_row

router = APIRouter()

@router.get("/search")
def search_tracks(q: str = Query(..., description="Search query")):
    try:
        # 1. Call Innertube to get list of search results
        results = innertube_service.search_tracks_list(q)
        return results
    except Exception as e:
        print(f"Error in search_tracks: {e}")
        raise HTTPException(status_code=500, detail=str(e))

def resolve_stream_cobalt(youtube_id: str) -> str:
    import urllib.request
    import json
    import ssl
    
    cobalt_instances = [
        "https://api.cobalt.blackcat.sweeux.org",
        "https://rue-cobalt.xenon.zone"
    ]
    
    video_url = f"https://www.youtube.com/watch?v={youtube_id}"
    
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    
    body = {
        "url": video_url,
        "downloadMode": "audio",
        "audioFormat": "mp3"
    }
    
    ssl_context = ssl._create_unverified_context()
    
    for instance in cobalt_instances:
        try:
            print(f"[Cobalt] Attempting to resolve stream for {youtube_id} via {instance}...")
            req = urllib.request.Request(
                instance, 
                data=json.dumps(body).encode('utf-8'), 
                headers=headers,
                method="POST"
            )
            with urllib.request.urlopen(req, context=ssl_context, timeout=8) as response:
                res_data = json.loads(response.read().decode())
                stream_url = res_data.get("url")
                if stream_url:
                    print(f"[Cobalt] Stream resolved successfully via {instance}!")
                    return stream_url
        except Exception as e:
            print(f"[Cobalt] Failed to resolve via {instance}: {e}")
            
    raise Exception("All Cobalt instances failed to resolve stream")

cached_invidious_instances = []

def resolve_stream_invidious(youtube_id: str) -> str:
    global cached_invidious_instances
    import urllib.request
    import json
    import ssl
    
    # Try fetching instances list if cache is empty
    if not cached_invidious_instances:
        try:
            print("[Invidious] Fetching public instances list...")
            ssl_context = ssl._create_unverified_context()
            req = urllib.request.Request("https://api.invidious.io/instances.json", headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, context=ssl_context, timeout=5) as response:
                instances_data = json.loads(response.read().decode())
                # Extract URIs of healthy instances
                for item in instances_data:
                    uri = item[1].get("uri")
                    # filter type = "https" and has uri
                    if uri and item[1].get("type") == "https":
                        cached_invidious_instances.append(uri)
        except Exception as e:
            print(f"[Invidious] Failed to fetch instances list: {e}")
            
    # Fallback to hardcoded list if fetching failed
    fallback_list = [
        "https://inv.thepixora.com",
        "https://invidious.tiekoetter.com",
        "https://inv.nadeko.net",
        "https://invidious.nerdvpn.de",
        "https://invidious.f5.si",
        "https://yt.chocolatemoo53.com",
        "https://invidious.no-logs.com",
        "https://invidious.projectsegfau.lt"
    ]
    
    primary_instances = [
        "https://inv.thepixora.com"
    ]
    
    search_list = cached_invidious_instances if cached_invidious_instances else fallback_list
    
    # Prioritize working instances and remove duplicates/Tor/I2P domains
    clean_list = []
    for inst in primary_instances + search_list + fallback_list:
        if inst and inst not in clean_list:
            if not any(x in inst for x in [".onion", ".i2p", ".ygg"]):
                clean_list.append(inst)
    
    # Try up to 12 instances to resolve the stream
    for idx, instance in enumerate(clean_list[:12]):
        try:
            print(f"[Invidious] Attempting to resolve stream for {youtube_id} via {instance}...")
            url = f"{instance}/api/v1/videos/{youtube_id}"
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            ssl_context = ssl._create_unverified_context()
            with urllib.request.urlopen(req, context=ssl_context, timeout=5) as response:
                data = json.loads(response.read().decode())
                formats = data.get("adaptiveFormats", [])
                # Extract audio-only formats
                audio_formats = [f for f in formats if f.get("type", "").startswith("audio/")]
                if audio_formats:
                    # Sort to get highest quality / mp4 if preferred
                    audio_formats.sort(key=lambda x: int(x.get("bitrate", 0)), reverse=True)
                    stream_url = audio_formats[0].get("url")
                    if stream_url:
                        print(f"[Invidious] Stream resolved successfully via {instance}!")
                        return stream_url
        except Exception as e:
            print(f"[Invidious] Failed to resolve via {instance}: {e}")
            
    raise Exception("All Invidious instances failed to resolve stream")

@router.get("/stream/{youtube_id}")
def get_stream_url(youtube_id: str, request: Request):
    try:
        # Resolve the signed stream URL using yt-dlp
        url = None
        yt_err = None
        try:
            import yt_dlp
            ydl_opts = {
                'format': 'bestaudio[ext=m4a]/best',
                'quiet': True,
                'no_warnings': True,
            }
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(f"https://www.youtube.com/watch?v={youtube_id}", download=False)
                url = info.get('url')
        except Exception as err:
            yt_err = err
            print(f"yt-dlp resolution failed for {youtube_id}: {err}. Falling back to innertube.")

        if not url:
            # Fetch the stream URL from YouTube Music
            try:
                url = innertube_service.get_stream_url(youtube_id)
            except Exception as innertube_err:
                try:
                    url = resolve_stream_cobalt(youtube_id)
                except Exception as cobalt_err:
                    try:
                        url = resolve_stream_invidious(youtube_id)
                    except Exception as invidious_err:
                        raise Exception(f"yt-dlp resolution failed: {yt_err} | innertube resolution failed: {innertube_err} | cobalt fallback failed: {cobalt_err} | invidious fallback failed: {invidious_err}")

        base_headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }

        # --- HEAD request to learn Content-Length & Content-Type -----------
        with httpx.Client(timeout=15.0) as client:
            head_resp = client.head(url, headers=base_headers, follow_redirects=True)

        content_type = head_resp.headers.get("content-type", "audio/webm")
        total_size = int(head_resp.headers.get("content-length", 0))

        # --- Determine if this is a Range request ------------------------
        range_header = request.headers.get("range")

        if range_header and total_size:
            # Parse "bytes=START-END" (END is optional)
            range_spec = range_header.replace("bytes=", "")
            parts = range_spec.split("-")
            start = int(parts[0])
            end = int(parts[1]) if parts[1] else total_size - 1
            content_length = end - start + 1

            async def stream_range():
                print(f"[Stream] Starting range request bytes={start}-{end} for URL: {url[:100]}...")
                try:
                    req_headers = {**base_headers, "Range": f"bytes={start}-{end}"}
                    async with httpx.AsyncClient(timeout=30.0) as client:
                        async with client.stream("GET", url, headers=req_headers, follow_redirects=True) as response:
                            print(f"[Stream] YouTube response status: {response.status_code}")
                            async for chunk in response.aiter_bytes(chunk_size=65536):
                                yield chunk
                    print("[Stream] Range stream generator finished successfully.")
                except Exception as stream_err:
                    print(f"[Stream] Exception in stream_range generator: {stream_err}")
                    import traceback
                    traceback.print_exc()

            return StreamingResponse(
                stream_range(),
                status_code=206,
                media_type=content_type,
                headers={
                    "Content-Length": str(content_length),
                    "Content-Range": f"bytes {start}-{end}/{total_size}",
                    "Accept-Ranges": "bytes",
                }
            )

        # --- Full (non-range) request ------------------------------------
        async def stream_full():
            print(f"[Stream] Starting full stream request for URL: {url[:100]}...")
            try:
                async with httpx.AsyncClient(timeout=30.0) as client:
                    async with client.stream("GET", url, headers=base_headers, follow_redirects=True) as response:
                        print(f"[Stream] YouTube response status: {response.status_code}")
                        async for chunk in response.aiter_bytes(chunk_size=65536):
                            yield chunk
                print("[Stream] Full stream generator finished successfully.")
            except Exception as stream_err:
                print(f"[Stream] Exception in stream_full generator: {stream_err}")
                import traceback
                traceback.print_exc()

        resp_headers = {
            "Accept-Ranges": "bytes",
        }
        # Omit Content-Length header for full streaming responses to prevent
        # h11 LocalProtocolError when the stream length differs or is closed early.

        return StreamingResponse(
            stream_full(),
            media_type=content_type,
            headers=resp_headers
        )
    except Exception as e:
        print(f"Error getting stream URL: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to stream audio: {str(e)}")

@router.post("/tracks")
def create_track(
    track_name: str = Body(..., embed=True),
    artist: str = Body(..., embed=True),
    album: str = Body(None, embed=True),
    youtube_id: str = Body(None, embed=True),
    thumbnail_url: str = Body(None, embed=True),
    duration_ms: int = Body(None, embed=True),
    language: str = Body("en", embed=True),
    explicit: bool = Body(False, embed=True)
):
    try:
        # Check uniqueness constraint
        exist_check = execute_with_retry(
            supabase.table("tracks")
            .select("*")
            .eq("track_name", track_name)
            .eq("artist", artist)
        )
            
        if exist_check.data:
            return exist_check.data[0]

        new_track = {
            "track_name": track_name,
            "artist": artist,
            "album": album,
            "youtube_id": youtube_id,
            "thumbnail_url": thumbnail_url,
            "duration_ms": duration_ms,
            "language": language,
            "explicit": explicit,
            "source": "user_added",
            "created_at": datetime.now(timezone.utc).isoformat()
        }
        
        insert_resp = execute_with_retry(supabase.table("tracks").insert(new_track))
        if not insert_resp.data:
            raise HTTPException(status_code=500, detail="Failed to insert track.")
        return insert_resp.data[0]
    except Exception as e:
        print(f"Error creating track: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.patch("/tracks/{id}")
def update_track_parameters(id: str, params: dict = Body(...)):
    try:
        # Apply normalization rules
        normalized_params = normalise_row(params, source="user_added")
        
        # Filter only track parameter fields we want to update
        allowed_keys = [
            "energy", "danceability", "valence", "tempo", 
            "acousticness", "instrumentalness", "speechiness", 
            "liveness", "loudness", "popularity"
        ]
        
        update_data = {k: v for k, v in normalized_params.items() if k in allowed_keys}
        
        update_resp = execute_with_retry(
            supabase.table("tracks")
            .update(update_data)
            .eq("id", id)
        )
            
        if not update_resp.data:
            raise HTTPException(status_code=404, detail="Track not found.")
            
        return update_resp.data[0]
    except Exception as e:
        print(f"Error updating track {id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/history")
def log_play_history(
    user_id: str = Body(..., embed=True),
    track_id: str = Body(..., embed=True),
    completed: bool = Body(False, embed=True)
):
    try:
        new_history = {
            "user_id": user_id,
            "track_id": track_id,
            "completed": completed
        }
        insert_resp = execute_with_retry(supabase.table("play_history").insert(new_history))
        if not insert_resp.data:
            raise HTTPException(status_code=500, detail="Failed to log play history.")
        return insert_resp.data[0]
    except Exception as e:
        print(f"Error logging play history: {e}")
        raise HTTPException(status_code=500, detail=str(e))

