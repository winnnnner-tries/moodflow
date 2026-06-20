import os
import time
from dotenv import load_dotenv
from supabase import create_client, Client

# Resolve the absolute path of the backend directory to load .env correctly
backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
env_path = os.path.join(backend_dir, ".env")
load_dotenv(dotenv_path=env_path)

supabase_url = os.getenv("SUPABASE_URL")
supabase_key = os.getenv("SUPABASE_SERVICE_KEY")

if not supabase_url or not supabase_key:
    print("WARNING: SUPABASE_URL or SUPABASE_SERVICE_KEY is missing from environment variables.")

# Fallback to dummy values to prevent crash on import, but queries will fail if keys are invalid
supabase: Client = create_client(
    supabase_url if supabase_url else "https://placeholder.supabase.co",
    supabase_key if supabase_key else "placeholder"
)

def execute_with_retry(query_builder, retries=3, delay=0.5):
    """Executes a Supabase query builder command with retry logic for transient connection errors."""
    for attempt in range(retries):
        try:
            return query_builder.execute()
        except Exception as e:
            err_str = str(e)
            if "ConnectionTerminated" in err_str or "RemoteProtocolError" in err_str or "http2" in err_str or "Connection reset" in err_str or "last_stream_id" in err_str:
                if attempt < retries - 1:
                    print(f"Warning: Supabase query transient error: {err_str}. Retrying ({attempt + 1}/{retries})...")
                    time.sleep(delay * (2 ** attempt))
                    continue
            raise e

