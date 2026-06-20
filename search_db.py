import sys
import os

# Reconfigure stdout to use UTF-8 encoding (prevents Windows console UnicodeEncodeErrors)
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

# Ensure backend directory is in python search path
sys.path.append(os.path.join(os.path.dirname(__file__), 'backend'))

# Load environment variables
from dotenv import load_dotenv
backend_dir = os.path.join(os.path.dirname(__file__), 'backend')
load_dotenv(dotenv_path=os.path.join(backend_dir, '.env'))

try:
    from services.supabase_client import supabase
except ImportError as e:
    print(f"Error: Missing dependencies. Make sure requirements.txt packages are installed: {e}")
    sys.exit(1)

if len(sys.argv) < 2:
    print("Usage: python search_db.py \"<song name>\"")
    sys.exit(1)

query = sys.argv[1]
print(f"Searching database for tracks matching: '{query}'...")

try:
    res = supabase.table('tracks').select('id,track_name,artist,source,energy,danceability,valence,tempo,acousticness,instrumentalness,speechiness,liveness,loudness').ilike('track_name', f'%{query}%').execute()
    data = res.data if res.data else []
    if not data:
         print("No matching tracks found in database.")
    else:
         print(f"\nFound {len(data)} matching track(s):")
         for i, track in enumerate(data, 1):
             print(f"{i}. [{track.get('source', 'unknown')}] {track['track_name']} - {track['artist']} (ID: {track['id']})")
             print(f"   Parametric Features ->")
             print(f"     Energy:       {track.get('energy')}")
             print(f"     Danceability: {track.get('danceability')}")
             print(f"     Valence:      {track.get('valence')}")
             print(f"     Tempo:        {track.get('tempo')}")
             print(f"     Acousticness: {track.get('acousticness')}")
             print(f"     Instrumental: {track.get('instrumentalness')}")
             print(f"     Speechiness:  {track.get('speechiness')}")
             print(f"     Liveness:     {track.get('liveness')}")
             print(f"     Loudness:     {track.get('loudness')}\n")
except Exception as e:
    print(f"Database query failed: {e}")

