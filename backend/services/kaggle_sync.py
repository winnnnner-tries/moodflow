import os
import pandas as pd
from services.supabase_client import supabase
from services.normalise import normalise_row

LANG_MAP = {
    "english": "en",
    "hindi": "hi",
    "tamil": "ta",
    "telugu": "te",
    "malayalam": "ml",
    "kannada": "kn",
    "bengali": "bn",
    "korean": "ko"
}

def sync_local_csv():
    # Resolve CSV path relative to the root project directory
    base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    csv_path = os.path.join(base_dir, "spotify_tracks.csv")
    
    if not os.path.exists(csv_path):
        error_msg = f"CSV file not found at {csv_path}"
        print(error_msg)
        return {"status": "error", "message": error_msg}
        
    print(f"Starting sync from {csv_path}")
    
    try:
        # Load CSV using pandas
        df = pd.read_csv(csv_path)
    except Exception as e:
        error_msg = f"Error reading CSV: {e}"
        print(error_msg)
        return {"status": "error", "message": error_msg}
        
    total_rows = len(df)
    print(f"Loaded {total_rows} rows from CSV")
    
    rows_to_insert = []
    
    for idx, row in df.iterrows():
        raw_dict = row.to_dict()
        
        # Map language strings to two-letter codes
        lang_str = str(raw_dict.get("language", "")).strip().lower()
        language = LANG_MAP.get(lang_str, "en")
        
        # Apply normalization logic
        normalized = normalise_row({
            "danceability": raw_dict.get("danceability"),
            "tempo": raw_dict.get("tempo"),
            "loudness": raw_dict.get("loudness"),
            "popularity": raw_dict.get("popularity")
        }, source="kaggle")
        
        # Map to Supabase tracks schema fields
        db_row = {
            "track_name": str(raw_dict.get("track_name", "")).strip(),
            "artist": str(raw_dict.get("artist_name", "")).strip(),
            "album": str(raw_dict.get("album_name", "")).strip() if pd.notna(raw_dict.get("album_name")) else None,
            "language": language,
            "genre": str(raw_dict.get("genre", "")).strip() if pd.notna(raw_dict.get("genre")) else None,
            "youtube_id": None,  # Resolved dynamically during play
            "thumbnail_url": str(raw_dict.get("artwork_url", "")).strip() if pd.notna(raw_dict.get("artwork_url")) else None,
            "energy": float(raw_dict.get("energy")) if pd.notna(raw_dict.get("energy")) else None,
            "danceability": normalized.get("danceability"),
            "valence": float(raw_dict.get("valence")) if pd.notna(raw_dict.get("valence")) else None,
            "tempo": normalized.get("tempo"),
            "acousticness": float(raw_dict.get("acousticness")) if pd.notna(raw_dict.get("acousticness")) else None,
            "instrumentalness": float(raw_dict.get("instrumentalness")) if pd.notna(raw_dict.get("instrumentalness")) else None,
            "speechiness": float(raw_dict.get("speechiness")) if pd.notna(raw_dict.get("speechiness")) else None,
            "liveness": float(raw_dict.get("liveness")) if pd.notna(raw_dict.get("liveness")) else None,
            "loudness": normalized.get("loudness"),
            "popularity": normalized.get("popularity"),
            "explicit": bool(raw_dict.get("explicit")) if pd.notna(raw_dict.get("explicit")) else False,
            "duration_ms": int(float(raw_dict.get("duration_ms"))) if pd.notna(raw_dict.get("duration_ms")) else 0,
            "source": "kaggle"
        }
        
        # Skip if missing required track identity fields
        if not db_row["track_name"] or not db_row["artist"]:
            continue
            
        rows_to_insert.append(db_row)
        
    # Batch upsert to Supabase in chunks of 1000
    chunk_size = 1000
    upserted_count = 0
    
    for i in range(0, len(rows_to_insert), chunk_size):
        chunk = rows_to_insert[i:i + chunk_size]
        try:
            # Perform upsert; ignore duplicates for existing track_name + artist combos
            supabase.table("tracks").upsert(
                chunk,
                on_conflict="track_name,artist",
                ignore_duplicates=True
            ).execute()
            upserted_count += len(chunk)
            print(f"Upserted {upserted_count}/{len(rows_to_insert)} tracks...")
        except Exception as e:
            print(f"Error upserting chunk {i} to {i+chunk_size}: {e}")
            
    print("Sync complete.")
    return {"status": "success", "total_records": len(rows_to_insert), "upserted": upserted_count}
