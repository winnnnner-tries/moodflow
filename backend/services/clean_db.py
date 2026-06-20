import os
import sys
import re
from datetime import datetime

# Reconfigure stdout to use UTF-8 encoding
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

# Ensure backend directory is in python search path
backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.append(backend_dir)

# Load environment variables
from dotenv import load_dotenv
load_dotenv(dotenv_path=os.path.join(backend_dir, '.env'))

from services.supabase_client import supabase, execute_with_retry

def find_existing_track(track_name, artist, youtube_id=None):
    # 1. Check by youtube_id
    if youtube_id:
        res = execute_with_retry(supabase.table('tracks').select('*').eq('youtube_id', youtube_id))
        if res.data:
            return res.data[0]
            
    # 2. Check by exact name & artist
    res = execute_with_retry(supabase.table('tracks').select('*').eq('track_name', track_name).eq('artist', artist))
    if res.data:
        return res.data[0]
        
    # 3. Check by normalized name & artist overlap
    clean_name = normalize_string(track_name)
    if clean_name:
        words = clean_name.split()
        if words:
            search_query = words[0]
            res = execute_with_retry(supabase.table('tracks').select('*').ilike('track_name', f'%{search_query}%'))
            for cand in (res.data or []):
                if normalize_string(cand['track_name']) == clean_name:
                    artists1 = get_artist_set(cand.get('artist', ''))
                    artists2 = get_artist_set(artist)
                    if artists1.intersection(artists2):
                        return cand
    return None

def normalize_string(s):
    if not s:
        return ""
    # Lowercase
    s = s.lower()
    # Remove contents of parentheses and brackets (e.g. (From "Youth"), [From "Youth"])
    s = re.sub(r'[\(\[\{].*?[\)\]\}]', '', s)
    # Remove punctuation & non-alphanumeric except spaces
    s = re.sub(r'[^a-z0-9\s]', '', s)
    # Normalize whitespace
    s = " ".join(s.split())
    return s

def get_artist_set(artist_str):
    if not artist_str:
        return set()
    # Split by comma, "and", "&"
    parts = re.split(r',|&|\band\b', artist_str.lower())
    artists = []
    for p in parts:
        # Clean artist name
        cleaned = re.sub(r'[^a-z0-9]', '', p)
        if cleaned:
            artists.append(cleaned)
    return set(artists)

def is_duplicate(track1, track2):
    # Check if they have the same non-null youtube_id
    yt1 = track1.get('youtube_id')
    yt2 = track2.get('youtube_id')
    if yt1 and yt2 and yt1 == yt2:
        return True
        
    # Check clean names
    name1 = normalize_string(track1['track_name'])
    name2 = normalize_string(track2['track_name'])
    
    if not name1 or not name2:
        return False
        
    if name1 == name2:
        # Check artists
        artists1 = get_artist_set(track1.get('artist', ''))
        artists2 = get_artist_set(track2.get('artist', ''))
        
        if not artists1 or not artists2:
            return True # If one doesn't have artist info, assume duplicate
            
        # Overlap check: if they share at least one artist, or have high intersection
        intersection = artists1.intersection(artists2)
        if len(intersection) > 0:
            return True
            
    return False

def is_dummy_features(t):
    # Check if parameters match the default dummy parameters:
    # energy=0.5, danceability=0.5, valence=0.5, tempo=0.5, acousticness=0.5
    return (
        t.get('energy') == 0.5 and 
        t.get('danceability') == 0.5 and 
        t.get('valence') == 0.5 and
        t.get('tempo') == 0.5 and
        t.get('acousticness') == 0.5
    )

def clean_database():
    print("Fetching all tracks from database...")
    tracks = []
    limit = 1000
    offset = 0
    while True:
        res = supabase.table('tracks').select('*').range(offset, offset + limit - 1).execute()
        data = res.data if res.data else []
        tracks.extend(data)
        if len(data) < limit:
            break
        offset += limit
    print(f"Loaded {len(tracks)} tracks.")
    
    # Group tracks by normalized track name to avoid O(N^2) search
    from collections import defaultdict
    by_name = defaultdict(list)
    for t in tracks:
        clean_name = normalize_string(t['track_name'])
        by_name[clean_name].append(t)
        
    print(f"Grouped into {len(by_name)} unique track names. Finding duplicates within groups...")
    
    clusters = []
    for clean_name, group in by_name.items():
        if len(group) < 2:
            continue
            
        # Within the group, cluster duplicates
        visited = set()
        for i in range(len(group)):
            if group[i]['id'] in visited:
                continue
            cluster = [group[i]]
            visited.add(group[i]['id'])
            
            for j in range(i + 1, len(group)):
                if group[j]['id'] in visited:
                    continue
                if is_duplicate(group[i], group[j]):
                    cluster.append(group[j])
                    visited.add(group[j]['id'])
                    
            if len(cluster) > 1:
                clusters.append(cluster)
            
    print(f"Found {len(clusters)} groups of duplicate tracks.")
    
    deleted_count = 0
    merged_count = 0
    
    for cluster in clusters:
        # Determine the best track to keep
        # 1. Prefer track with non-dummy features
        # 2. Prefer track with source 'kaggle' or 'user_added' over 'ytmusic_trending'
        # 3. Prefer track with more filled fields
        
        sorted_cluster = sorted(
            cluster,
            key=lambda t: (
                0 if is_dummy_features(t) else 1,
                0 if t.get('source') in ('ytmusic_trending', 'ytmusic_playlist') else 1,
                1 if t.get('youtube_id') else 0,
                t.get('popularity') or 0.0,
                t.get('created_at', '')
            ),
            reverse=True
        )
        
        keep_track = sorted_cluster[0]
        duplicate_tracks = sorted_cluster[1:]
        
        # Merge missing metadata fields into keep_track
        updated_fields = {}
        for field in ['youtube_id', 'thumbnail_url', 'album', 'genre', 'language', 'explicit', 'duration_ms']:
            if not keep_track.get(field):
                for dup in duplicate_tracks:
                    if dup.get(field):
                        keep_track[field] = dup[field]
                        updated_fields[field] = dup[field]
                        break
                        
        if updated_fields:
            supabase.table('tracks').update(updated_fields).eq('id', keep_track['id']).execute()
            
        for dup in duplicate_tracks:
            # 1. Update play_history references
            history_res = supabase.table('play_history').select('id').eq('track_id', dup['id']).execute()
            history_rows = history_res.data if history_res.data else []
            if history_rows:
                supabase.table('play_history').update({'track_id': keep_track['id']}).eq('track_id', dup['id']).execute()
                
            # 2. Delete the duplicate track
            supabase.table('tracks').delete().eq('id', dup['id']).execute()
            deleted_count += 1
            
        merged_count += 1
        if merged_count % 50 == 0:
            print(f"Processed {merged_count} groups...")
        
    print(f"\nCleanup finished! Merged {merged_count} groups, deleted {deleted_count} duplicate tracks.")

if __name__ == '__main__':
    clean_database()
