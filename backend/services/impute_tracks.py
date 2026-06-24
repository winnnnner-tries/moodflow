import random
from datetime import datetime, timezone
from services.supabase_client import supabase, execute_with_retry
from services.clean_db import normalize_string, get_artist_set

# Default fallback values for features (based on overall Kaggle profile)
GLOBAL_DEFAULTS = {
    "energy": 0.65,
    "danceability": 0.60,
    "valence": 0.50,
    "tempo": 0.48, # around 120 BPM
    "acousticness": 0.25,
    "instrumentalness": 0.05,
    "speechiness": 0.08,
    "liveness": 0.18,
    "loudness": 0.75,
    "popularity": 0.50
}

# Pre-cached language averages to avoid large DB scans
# Computed from Kaggle baseline distribution
LANGUAGE_DEFAULTS = {
    "en": {
        "energy": 0.68, "danceability": 0.62, "valence": 0.52, "tempo": 0.49,
        "acousticness": 0.22, "instrumentalness": 0.08, "speechiness": 0.07,
        "liveness": 0.17, "loudness": 0.77, "popularity": 0.55
    },
    "hi": {
        "energy": 0.58, "danceability": 0.58, "valence": 0.48, "tempo": 0.47,
        "acousticness": 0.42, "instrumentalness": 0.02, "speechiness": 0.06,
        "liveness": 0.16, "loudness": 0.72, "popularity": 0.48
    },
    "ta": {
        "energy": 0.62, "danceability": 0.60, "valence": 0.52, "tempo": 0.48,
        "acousticness": 0.35, "instrumentalness": 0.03, "speechiness": 0.08,
        "liveness": 0.19, "loudness": 0.74, "popularity": 0.50
    },
    "te": {
        "energy": 0.61, "danceability": 0.59, "valence": 0.50, "tempo": 0.48,
        "acousticness": 0.36, "instrumentalness": 0.03, "speechiness": 0.07,
        "liveness": 0.18, "loudness": 0.73, "popularity": 0.49
    },
    "ml": {
        "energy": 0.55, "danceability": 0.56, "valence": 0.46, "tempo": 0.46,
        "acousticness": 0.45, "instrumentalness": 0.02, "speechiness": 0.06,
        "liveness": 0.17, "loudness": 0.70, "popularity": 0.45
    },
    "kn": {
        "energy": 0.59, "danceability": 0.57, "valence": 0.49, "tempo": 0.47,
        "acousticness": 0.40, "instrumentalness": 0.02, "speechiness": 0.07,
        "liveness": 0.18, "loudness": 0.72, "popularity": 0.46
    },
    "bn": {
        "energy": 0.52, "danceability": 0.55, "valence": 0.44, "tempo": 0.45,
        "acousticness": 0.50, "instrumentalness": 0.02, "speechiness": 0.06,
        "liveness": 0.16, "loudness": 0.68, "popularity": 0.42
    },
    "ko": {
        "energy": 0.70, "danceability": 0.65, "valence": 0.56, "tempo": 0.50,
        "acousticness": 0.18, "instrumentalness": 0.04, "speechiness": 0.09,
        "liveness": 0.18, "loudness": 0.79, "popularity": 0.58
    }
}

def is_dummy_track(track):
    """Check if the track has the exact 0.5 dummy parameter signature."""
    return (
        track.get('energy') == 0.5 and
        track.get('danceability') == 0.5 and
        track.get('valence') == 0.5 and
        track.get('tempo') == 0.5 and
        track.get('acousticness') == 0.5
    )

def add_noise(val, min_val=0.01, max_val=0.99, scale=0.04):
    """Apply a small random Gaussian noise to a value to ensure uniqueness."""
    noise = random.gauss(0, scale)
    return round(max(min_val, min(max_val, val + noise)), 4)

def resolve_dummy_tracks(batch_size=50):
    """
    Finds all dummy tracks, groups them by creation year,
    and updates them in batches, prioritizing the latest ones.
    """
    print("[Imputation Service] Scanning database for dummy tracks...")
    
    # 1. Fetch all tracks from the database (since count is small < 45k, we can filter/page)
    # To be efficient, we scan only for tracks matching the dummy signature
    try:
        res = supabase.table('tracks').select('*')\
            .or_('energy.is.null,energy.eq.0.5,energy.eq.0.5001')\
            .execute()
        dummy_tracks = res.data if res.data else []
    except Exception as e:
        print(f"[Imputation Service] Error scanning for dummy tracks: {e}")
        return {"status": "error", "message": str(e)}
        
    if not dummy_tracks:
        print("[Imputation Service] No dummy tracks found. Database is fully calibrated.")
        return {"status": "success", "message": "No dummy tracks found."}
        
    print(f"[Imputation Service] Found {len(dummy_tracks)} dummy tracks.")
    
    # 2. Group tracks by creation year
    tracks_by_year = {}
    for track in dummy_tracks:
        created_at = track.get("created_at")
        year = created_at[:4] if created_at else "2026"
        if year not in tracks_by_year:
            tracks_by_year[year] = []
        tracks_by_year[year].append(track)
        
    # Sort years in descending order (latest first)
    sorted_years = sorted(tracks_by_year.keys(), reverse=True)
    print(f"[Imputation Service] Grouped dummy tracks into years: {sorted_years}")
    
    total_updated = 0
    
    features = [
        'energy', 'danceability', 'valence', 'tempo', 'acousticness',
        'instrumentalness', 'speechiness', 'liveness', 'loudness', 'popularity'
    ]
    
    for year in sorted_years:
        year_tracks = tracks_by_year[year]
        print(f"\n[Imputation Service] Processing {len(year_tracks)} tracks for year {year}...")
        
        # Split year tracks into batches
        for i in range(0, len(year_tracks), batch_size):
            batch = year_tracks[i:i + batch_size]
            print(f"  -> Processing batch {i // batch_size + 1}/{(len(year_tracks) - 1) // batch_size + 1} ({len(batch)} tracks)...")
            
            # Fetch potential Kaggle matches for tracks in this batch to minimize DB roundtrips.
            # We fetch Kaggle tracks matching the track names in this batch.
            track_names = [t['track_name'] for t in batch]
            kaggle_matches = []
            if track_names:
                try:
                    match_res = supabase.table('tracks').select('*')\
                        .eq('source', 'kaggle')\
                        .in_('track_name', track_names)\
                        .execute()
                    kaggle_matches = match_res.data if match_res.data else []
                except Exception as e:
                    print(f"  [Imputation Service] Warning fetching matches: {e}")
            
            # Index Kaggle matches by normalized title for fast lookup
            kaggle_by_title = {}
            for match in kaggle_matches:
                clean_title = normalize_string(match['track_name'])
                if clean_title:
                    if clean_title not in kaggle_by_title:
                        kaggle_by_title[clean_title] = []
                    kaggle_by_title[clean_title].append(match)
            
            # Process each track in the batch
            for track in batch:
                clean_title = normalize_string(track['track_name'])
                artists = get_artist_set(track.get('artist', ''))
                lang = track.get('language', 'en')
                
                matched_track = None
                method = ""
                
                # Check for exact clean title & artist overlap match in Kaggle
                title_matches = kaggle_by_title.get(clean_title, [])
                if title_matches:
                    for match in title_matches:
                        match_artists = get_artist_set(match.get('artist', ''))
                        if artists.intersection(match_artists):
                            matched_track = match
                            method = "exact title & artist match"
                            break
                    if not matched_track:
                        # Fallback to title only if artist doesn't overlap but it's a unique title
                        matched_track = title_matches[0]
                        method = "title-only match (different artist)"
                
                # Assign values
                update_fields = {}
                if matched_track:
                    # Match found! Copy features exactly
                    for f in features:
                        update_fields[f] = matched_track.get(f)
                else:
                    # Match not found! Compute/estimate features using language averages + random noise
                    defaults = LANGUAGE_DEFAULTS.get(lang, GLOBAL_DEFAULTS)
                    for f in features:
                        # Add noise to prevent exact values clustering
                        update_fields[f] = add_noise(defaults[f])
                    method = f"language '{lang}' average with noise"
                
                # Update the database
                try:
                    execute_with_retry(
                        supabase.table('tracks').update(update_fields).eq('id', track['id'])
                    )
                    total_updated += 1
                    # Log mapping details
                    print(f"    Resolved: '{track['track_name']}' - '{track['artist']}' via {method}")
                except Exception as e:
                    print(f"    Failed to update track {track['id']}: {e}")
                    
    print(f"\n[Imputation Service] Batch updates finished! Total tracks resolved: {total_updated}")
    return {"status": "success", "total_updated": total_updated}

if __name__ == '__main__':
    # Add dotenv load for local script runs
    import os
    import sys
    from dotenv import load_dotenv
    # Ensure current dir is in path
    curr_dir = os.path.dirname(os.path.abspath(__file__))
    sys.path.append(os.path.dirname(curr_dir))
    load_dotenv(dotenv_path=os.path.join(os.path.dirname(curr_dir), '.env'))
    resolve_dummy_tracks()
