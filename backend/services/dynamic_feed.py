import time
from threading import Lock
from services.supabase_client import supabase, execute_with_retry
from services.innertube import innertube_service

# In-memory cache for live YouTube Music tracks lookup
# Structure: { (lang, closest_preset): { "tracks": [...], "expires_at": float } }
_yt_cache = {}
_yt_cache_lock = Lock()

def get_cached_yt_tracks(lang: str, preset: str) -> list | None:
    now = time.time()
    key = (lang, preset)
    with _yt_cache_lock:
        entry = _yt_cache.get(key)
        if entry and entry["expires_at"] > now:
            return entry["tracks"]
        if entry:
            del _yt_cache[key]
    return None

def set_cached_yt_tracks(lang: str, preset: str, tracks: list, ttl: float = 600.0):
    now = time.time()
    key = (lang, preset)
    with _yt_cache_lock:
        _yt_cache[key] = {
            "tracks": tracks,
            "expires_at": now + ttl
        }


LANG_NAMES = {
    "en": "English",
    "hi": "Hindi",
    "ta": "Tamil",
    "te": "Telugu",
    "ml": "Malayalam",
    "kn": "Kannada",
    "bn": "Bengali",
    "ko": "Korean"
}

LANG_EXCLUSION_TERMS = {
    "english": ["english"],
    "hindi": ["hindi", "bollywood", "punjabi", "bhojpuri", "haryanvi", "marathi", "gujarati", "urdu", "rajasthani"],
    "tamil": ["tamil", "kollywood"],
    "telugu": ["telugu", "telegu", "telgu", "tollywood", "andhra", "telangana"],
    "malayalam": ["malayalam", "mollywood", "kerala", "mallu"],
    "kannada": ["kannada", "sandalwood", "karnataka"],
    "bengali": ["bengali", "bangla"],
    "korean": ["korean", "kpop", "k-pop"]
}

LANG_CODE_TO_KEY = {
    "en": "english",
    "hi": "hindi",
    "ta": "tamil",
    "te": "telugu",
    "ml": "malayalam",
    "kn": "kannada",
    "bn": "bengali",
    "ko": "korean"
}

def get_mismatch_terms(lang: str) -> list[str]:
    if not lang:
        return []
    target_key = LANG_CODE_TO_KEY.get(lang.lower().strip())
    if not target_key:
        return []
    mismatch_terms = []
    for key, terms in LANG_EXCLUSION_TERMS.items():
        if key != target_key:
            mismatch_terms.extend(terms)
    return mismatch_terms

PRESETS = {
    "workout": {"energy": 0.85, "danceability": 0.75, "valence": 0.65, "tempo": 0.56, "acousticness": 0.05, "instrumentalness": 0.1, "loudness": 0.88},
    "chill": {"energy": 0.30, "danceability": 0.45, "valence": 0.55, "tempo": 0.36, "acousticness": 0.60, "instrumentalness": 0.3, "loudness": 0.55},
    "sad": {"energy": 0.25, "danceability": 0.30, "valence": 0.15, "tempo": 0.32, "acousticness": 0.70, "instrumentalness": 0.2, "loudness": 0.45},
    "feel_good": {"energy": 0.70, "danceability": 0.80, "valence": 0.85, "tempo": 0.48, "acousticness": 0.15, "instrumentalness": 0.05, "loudness": 0.82},
    "focus": {"energy": 0.40, "danceability": 0.35, "valence": 0.45, "tempo": 0.44, "acousticness": 0.40, "instrumentalness": 0.70, "loudness": 0.60},
    "hype": {"energy": 0.95, "danceability": 0.88, "valence": 0.75, "tempo": 0.60, "acousticness": 0.02, "instrumentalness": 0.05, "loudness": 0.95},
    "romance": {"energy": 0.40, "danceability": 0.55, "valence": 0.65, "tempo": 0.38, "acousticness": 0.50, "instrumentalness": 0.1, "loudness": 0.62},
    "sleep": {"energy": 0.10, "danceability": 0.15, "valence": 0.35, "tempo": 0.24, "acousticness": 0.85, "instrumentalness": 0.80, "loudness": 0.30}
}

PRESET_QUERIES = {
    "workout": "Workout",
    "chill": "Chill",
    "sad": "Sad",
    "feel_good": "Feel Good",
    "focus": "Focus",
    "hype": "Hype",
    "romance": "Romance",
    "sleep": "Sleep"
}

def get_closest_preset_name(targets):
    min_dist = float('inf')
    closest = "chill"
    for name, p_vals in PRESETS.items():
        # Calculate Manhattan distance across all 7 parameters
        dist = sum(abs(targets[k] - p_vals.get(k, 0.5)) for k in targets.keys() if k in p_vals)
        if dist < min_dist:
            min_dist = dist
            closest = name
    return closest

def calculate_distance(t, targets):
    energy = t.get("energy") if t.get("energy") is not None else 0.5
    danceability = t.get("danceability") if t.get("danceability") is not None else 0.5
    valence = t.get("valence") if t.get("valence") is not None else 0.5
    tempo = t.get("tempo") if t.get("tempo") is not None else 0.5
    acousticness = t.get("acousticness") if t.get("acousticness") is not None else 0.5
    instrumentalness = t.get("instrumentalness") if t.get("instrumentalness") is not None else 0.1
    loudness = t.get("loudness") if t.get("loudness") is not None else 0.7
    
    return (
        abs(energy - targets["energy"]) * 2.0 +
        abs(danceability - targets["danceability"]) * 2.0 +
        abs(valence - targets["valence"]) * 1.8 +
        abs(tempo - targets["tempo"]) * 1.5 +
        abs(acousticness - targets["acousticness"]) * 1.2 +
        abs(instrumentalness - targets["instrumentalness"]) * 1.0 +
        abs(loudness - targets["loudness"]) * 0.8
    )


def calculate_feed_score(track, targets, current_year=2026):
    """
    Composite scoring formula.  Lower score = better ranking.
    Components:
      - param_distance  (weighted parametric distance — higher is worse)
      - recency         (0-1, higher for newer tracks — subtracted so newer is better)
      - popularity      (0-1 — subtracted so more popular is better)
      - source_bonus    (penalty offset by source reliability)
    """
    param_distance = calculate_distance(track, targets)

    # Recency score (0.0 = ancient, 1.0 = this year)
    release_year = track.get("release_year")
    if release_year and release_year > 1980:
        recency = max(0.0, min(1.0, (release_year - 1980) / (current_year - 1980)))
    else:
        recency = 0.3  # Unknown year

    popularity = track.get("popularity") or 0.3

    source = track.get("source", "kaggle")
    source_bonus = {
        "ytmusic_curated": 0.0,
        "ytmusic_playlist": 0.05,
        "ytmusic_trending": 0.05,
        "user_added": 0.1,
        "musicbrainz": 0.2,
        "kaggle": 0.4,
    }.get(source, 0.3)
    
    # Check if the track is completely uncalibrated (using exact placeholder values or failed indicator 0.5001)
    energy = track.get("energy")
    danceability = track.get("danceability")
    if energy in (0.5, 0.5001) and danceability in (0.5, 0.5001):
        # Massive penalty for uncalibrated tracks so they don't dominate curated playlists
        param_distance += 5.0

    import random
    score = (
        param_distance * 1.0
        - recency * 0.8
        - popularity * 0.6
        + source_bonus
        + random.uniform(0, 0.4) # Add discovery noise
    )

    return score


def get_hybrid_feed(
    lang: str,
    energy: float,
    danceability: float,
    valence: float,
    tempo: float,
    acousticness: float,
    instrumentalness: float,
    loudness: float,
    user_id: str,
    preset_key: str = None,
    discovery: float = 0.3,
):
    targets = {
        "energy": energy,
        "danceability": danceability,
        "valence": valence,
        "tempo": tempo,
        "acousticness": acousticness,
        "instrumentalness": instrumentalness,
        "loudness": loudness
    }
    
    lang_name = LANG_NAMES.get(lang, "English")
    closest_preset = preset_key if preset_key and preset_key in PRESETS else get_closest_preset_name(targets)
    mood_query = PRESET_QUERIES.get(closest_preset, "Chill")
    
    # Check cache first
    cached_tracks = get_cached_yt_tracks(lang, closest_preset)
    if cached_tracks is not None:
        print(f"[Dynamic Feed Cache] Hit for YTM tracks: ({lang}, {closest_preset}). Fetched {len(cached_tracks)} tracks.")
        yt_tracks = cached_tracks
    else:
        yt_tracks = []
        
        # 1. Try to fetch from a Mood-specific Playlist on YouTube Music
        try:
            # E.g. "Tamil Workout" or "Hindi Chill" or "English Hype"
            query = f"{lang_name} {mood_query}"
            print(f"[Dynamic Feed] Searching YTM playlists for mood: '{query}'")
            results = innertube_service.yt.search(query, filter="playlists")
            
            # Fallback to Hotlist or general Hits if mood search returned nothing
            if not results:
                fallback_query = f"{lang_name} Hotlist"
                print(f"[Dynamic Feed] Mood query '{query}' empty. Falling back to: '{fallback_query}'")
                results = innertube_service.yt.search(fallback_query, filter="playlists")
                
            if not results:
                fallback_query = f"{lang_name} Hits"
                print(f"[Dynamic Feed] Hotlist empty. Falling back to: '{fallback_query}'")
                results = innertube_service.yt.search(fallback_query, filter="playlists")
                
            if results:
                mismatch_terms = get_mismatch_terms(lang)
                chosen_playlist = None
                for p in results:
                    title = p.get("title", "Curated Playlist")
                    title_lower = title.lower()
                    
                    has_mismatch = False
                    for term in mismatch_terms:
                        if term in title_lower:
                            has_mismatch = True
                            break
                    if not has_mismatch:
                        chosen_playlist = p
                        break
                    else:
                        safe_skipped_title = title.encode('ascii', 'ignore').decode('ascii')
                        print(f"[Dynamic Feed] Skipping playlist '{safe_skipped_title}' due to language mismatch for lang '{lang}'")
                
                if chosen_playlist:
                    playlist_id = chosen_playlist.get("browseId") or chosen_playlist.get("playlistId")
                    playlist_res = innertube_service.get_playlist_tracks(playlist_id, limit=40)
                    yt_tracks = playlist_res.get("tracks", [])
                    safe_title = chosen_playlist.get('title', 'Unknown Title').encode('ascii', 'ignore').decode('ascii')
                    print(f"[Dynamic Feed] Fetched {len(yt_tracks)} tracks from live playlist '{safe_title}'")
        except Exception as e:
            print(f"[Dynamic Feed] Error fetching mood playlists for {lang_name}: {e}")
            
        # 2. Fallback: Search songs directly if playlist failed or returned empty
        if not yt_tracks:
            try:
                fallback_search = f"{lang_name} {mood_query} Songs"
                print(f"[Dynamic Feed] Playlist fallback empty. Searching songs directly for: '{fallback_search}'")
                yt_tracks = innertube_service.search_tracks_list(fallback_search, limit=30)
                for t in yt_tracks:
                    t["language"] = lang
            except Exception as e:
                print(f"[Dynamic Feed] Error searching songs directly: {e}")
        
        # Cache results if we found tracks
        if yt_tracks:
            set_cached_yt_tracks(lang, closest_preset, yt_tracks, ttl=600.0)

    # 3. Fetch already calibrated tracks in that language from Supabase DB to mix in
    db_calibrated = []
    try:
        db_res = execute_with_retry(
            supabase.table("tracks")
            .select("*")
            .eq("language", lang)
            .not_.in_("energy", [0.5, 0.5001])
            .limit(20)
        )
        if db_res.data:
            # Exclude Kaggle unless they are popular (raised floor to 0.45)
            db_calibrated = [
                t for t in db_res.data 
                if t.get("source") != "kaggle" or (t.get("popularity") or 0) > 0.45
            ]
            print(f"[Dynamic Feed] Found {len(db_calibrated)} calibrated tracks in DB.")
    except Exception as e:
        print(f"[Dynamic Feed] Error fetching calibrated DB tracks: {e}")

    # 4. Map YouTube Music tracks against the database to check if they exist
    matched_tracks = []
    youtube_ids = [t["youtube_id"] for t in yt_tracks if t.get("youtube_id")]
    
    db_map = {}
    if youtube_ids:
        try:
            db_res = execute_with_retry(supabase.table("tracks").select("*").in_("youtube_id", youtube_ids))
            if db_res.data:
                db_map = {t["youtube_id"]: t for t in db_res.data}
        except Exception as e:
            print(f"[Dynamic Feed] Error checking DB matches in bulk: {e}")
            
    for t in yt_tracks:
        yt_id = t.get("youtube_id")
        if yt_id in db_map:
            db_track = db_map[yt_id]
            db_track["language"] = lang
            matched_tracks.append(db_track)
        else:
            t["id"] = None
            t["language"] = lang
            matched_tracks.append(t)

    # 5. Merge matched live tracks and calibrated DB tracks (deduplicate by youtube_id)
    seen_ids = set()
    merged_tracks = []
    
    for t in (matched_tracks + db_calibrated):
        yt_id = t.get("youtube_id")
        if not yt_id or yt_id in seen_ids:
            continue
        seen_ids.add(yt_id)
        merged_tracks.append(t)
        
    # 6. Calculate composite feed score for all merged tracks and sort
    for t in merged_tracks:
        t["distance"] = calculate_distance(t, targets)
        t["feed_score"] = calculate_feed_score(t, targets)
        
    merged_tracks.sort(key=lambda t: t["feed_score"])
    
    # 7. Return the top 40 tracks
    final_feed = merged_tracks[:40]
    print(f"[Dynamic Feed] Generated hybrid feed with {len(final_feed)} tracks (Closest preset: {closest_preset})")
    return final_feed
