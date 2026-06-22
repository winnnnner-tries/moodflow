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

import time

# In-memory stream cache
stream_cache = {}

def get_cached_url(youtube_id: str) -> str:
    now = time.time()
    if youtube_id in stream_cache:
        cached = stream_cache[youtube_id]
        if cached["expires_at"] > now:
            print(f"[Cache] Hit for {youtube_id}! Expires in {int(cached['expires_at'] - now)}s.")
            return cached["url"]
        else:
            print(f"[Cache] Expired entry removed for {youtube_id}.")
            del stream_cache[youtube_id]
    return None

def set_cached_url(youtube_id: str, url: str, ttl: int = 1800):
    expires_at = time.time() + ttl
    import urllib.parse
    try:
        parsed = urllib.parse.urlparse(url)
        params = urllib.parse.parse_qs(parsed.query)
        exp_list = params.get("exp") or params.get("expire") or params.get("expire_at")
        if exp_list:
            exp_val = int(exp_list[0])
            if exp_val > 10000000000: # millisecond timestamp
                expires_at = exp_val / 1000.0 - 60
            else: # second timestamp
                expires_at = exp_val - 60
            print(f"[Cache] Parsed URL expiration: {int(expires_at - time.time())}s from query param.")
    except Exception as e:
        print(f"[Cache] Failed to parse expiration parameter: {e}")
        
    stream_cache[youtube_id] = {
        "url": url,
        "expires_at": expires_at
    }

def resolve_stream_cobalt(youtube_id: str) -> str:
    import urllib.request
    import json
    import ssl
    
    cobalt_instances = [
        "https://rue-cobalt.xenon.zone",
        "https://api.cobalt.blackcat.sweeux.org"
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
        "audioFormat": "mp3",
        "isAudioOnly": True,
        "aFormat": "mp3"
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
            with urllib.request.urlopen(req, context=ssl_context, timeout=4) as response:
                res_data = json.loads(response.read().decode())
                stream_url = res_data.get("url")
                if stream_url:
                    if "googlevideo.com" in stream_url or "youtube.com" in stream_url or "youtu.be" in stream_url:
                        print(f"[Cobalt] Resolved URL contains direct YouTube link: {stream_url[:80]}..., discarding.")
                        continue
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
                        if "googlevideo.com" in stream_url or "youtube.com" in stream_url or "youtu.be" in stream_url:
                            print(f"[Invidious] Resolved URL contains direct YouTube link: {stream_url[:80]}..., discarding.")
                            continue
                        print(f"[Invidious] Stream resolved successfully via {instance}!")
                        return stream_url
        except Exception as e:
            print(f"[Invidious] Failed to resolve via {instance}: {e}")
            
    raise Exception("All Invidious instances failed to resolve stream")

@router.get("/stream/{youtube_id}")
async def get_stream_url(youtube_id: str, request: Request):
    try:
        # Check cache first
        url = get_cached_url(youtube_id)
        if url:
            print(f"[Stream] Serving cached stream URL for youtube_id: {youtube_id}")
        
        if not url:
            cobalt_err = None
            invidious_err = None
            innertube_err = None
            yt_err = None

            # 1. Try Cobalt first (tunneled and bypasses IP blocking)
            try:
                url = resolve_stream_cobalt(youtube_id)
            except Exception as e:
                cobalt_err = e
                print(f"Cobalt resolution failed for {youtube_id}: {e}")

            # 2. Try Invidious next (if Cobalt fails)
            if not url:
                try:
                    url = resolve_stream_invidious(youtube_id)
                except Exception as e:
                    invidious_err = e
                    print(f"Invidious resolution failed for {youtube_id}: {e}")

            # 3. Try Innertube direct (fallback)
            if not url:
                try:
                    url = innertube_service.get_stream_url(youtube_id)
                    print(f"[Stream] InnerTube resolved direct URL: {url[:80]}...")
                except Exception as e:
                    innertube_err = e
                    print(f"InnerTube resolution failed for {youtube_id}: {e}")

            # 4. Try yt-dlp direct (fallback)
            if not url:
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
                    print(f"[Stream] yt-dlp resolved direct URL: {url[:80]}...")
                except Exception as e:
                    yt_err = e
                    print(f"yt-dlp resolution failed for {youtube_id}: {e}")

            if not url:
                raise Exception(f"All stream resolvers failed. Cobalt: {cobalt_err} | Invidious: {invidious_err} | InnerTube: {innertube_err} | yt-dlp: {yt_err}")
            
            # Cache the successfully resolved URL
            set_cached_url(youtube_id, url)

        base_headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }

        # --- HEAD request to learn Content-Length & Content-Type -----------
        content_type = "audio/mpeg"
        total_size = 0
        is_direct = "googlevideo.com" in url or "youtube.com" in url or "youtu.be" in url

        if is_direct:
            # We only do HEAD request for direct YouTube streams to learn Content-Length & Content-Type for ranges.
            try:
                with httpx.Client(timeout=10.0) as client:
                    head_resp = client.head(url, headers=base_headers, follow_redirects=True)
                    if head_resp.status_code < 400:
                        content_type = head_resp.headers.get("content-type")
                        if not content_type:
                            disp = head_resp.headers.get("content-disposition", "")
                            if ".mp3" in disp:
                                content_type = "audio/mpeg"
                            elif ".m4a" in disp:
                                content_type = "audio/mp4"
                            elif ".webm" in disp:
                                content_type = "audio/webm"
                            else:
                                content_type = "audio/mpeg"
                        total_size = int(head_resp.headers.get("content-length") or 0)
            except Exception as head_err:
                print(f"[Stream] HEAD request failed for direct URL: {head_err}. Using fallback headers.")
        else:
            # For Cobalt/Invidious tunneled URLs, skip the HEAD request entirely to make playback start instantly!
            # Cobalt defaults to MP3 (audio/mpeg).
            content_type = "audio/mpeg"

        # --- Determine if this is a Range request ------------------------
        range_header = request.headers.get("range")
        
        # Bypass range requests for Cobalt/Invidious tunneled URLs since they do not support ranges
        # and returning a range response causes mismatch between Content-Range and actual bytes.
        if not is_direct:
            range_header = None

        if range_header and total_size:
            # Parse "bytes=START-END" (END is optional)
            range_spec = range_header.replace("bytes=", "")
            parts = range_spec.split("-")
            start = int(parts[0])
            end = int(parts[1]) if parts[1] else total_size - 1
            content_length = end - start + 1

            client = httpx.AsyncClient(timeout=30.0)
            req_headers = {**base_headers, "Range": f"bytes={start}-{end}"}
            
            try:
                req_obj = client.build_request("GET", url, headers=req_headers)
                response = await client.send(req_obj, stream=True)
                print(f"[Stream] Upstream range response status: {response.status_code}")
                if response.status_code >= 400:
                    await response.aclose()
                    await client.aclose()
                    raise HTTPException(status_code=response.status_code, detail=f"Upstream returned error: {response.status_code}")
            except HTTPException:
                raise
            except Exception as e:
                await client.aclose()
                raise HTTPException(status_code=500, detail=f"Failed to connect to upstream: {str(e)}")

            async def stream_range():
                try:
                    async for chunk in response.aiter_bytes(chunk_size=65536):
                        yield chunk
                finally:
                    await response.aclose()
                    await client.aclose()

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
        client = httpx.AsyncClient(timeout=30.0)
        try:
            req_obj = client.build_request("GET", url, headers=base_headers)
            response = await client.send(req_obj, stream=True)
            print(f"[Stream] Upstream full response status: {response.status_code}")
            if response.status_code >= 400:
                await response.aclose()
                await client.aclose()
                raise HTTPException(status_code=response.status_code, detail=f"Upstream returned error: {response.status_code}")
        except HTTPException:
            raise
        except Exception as e:
            await client.aclose()
            raise HTTPException(status_code=500, detail=f"Failed to connect to upstream: {str(e)}")

        async def stream_full():
            try:
                async for chunk in response.aiter_bytes(chunk_size=65536):
                    yield chunk
            finally:
                await response.aclose()
                await client.aclose()

        resp_headers = {
            "Accept-Ranges": "none",
        }

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

