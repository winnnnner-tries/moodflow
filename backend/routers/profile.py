from fastapi import APIRouter, HTTPException, Body
from services.supabase_client import supabase, execute_with_retry
from datetime import datetime

router = APIRouter()

@router.get("/profile/{user_id}")
def get_or_create_profile(user_id: str):
    try:
        resp = execute_with_retry(
            supabase.table("user_profiles")\
            .select("*")\
            .eq("user_id", user_id)
        )
            
        if resp.data:
            return resp.data[0]
            
        # Create a new profile with defaults
        new_profile = {
            "user_id": user_id,
            "language_pref": "en",
            "avg_energy": 0.5,
            "avg_danceability": 0.5,
            "avg_valence": 0.5,
            "avg_tempo": 0.5,
            "avg_acousticness": 0.5,
            "avg_instrumentalness": 0.1,
            "avg_speechiness": 0.1,
            "avg_liveness": 0.1,
            "avg_loudness": 0.7,
            "play_count": 0
        }
        
        insert_resp = execute_with_retry(supabase.table("user_profiles").insert(new_profile))
        if insert_resp.data:
            return insert_resp.data[0]
            
        raise HTTPException(status_code=500, detail="Failed to create user profile.")
    except Exception as e:
        print(f"Error in get_or_create_profile: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.put("/profile/{user_id}")
def update_profile(user_id: str, track_params: dict = Body(..., description="Track parameters to update profile with")):
    try:
        # 1. Fetch current profile
        resp = execute_with_retry(
            supabase.table("user_profiles")\
            .select("*")\
            .eq("user_id", user_id)
        )
            
        if not resp.data:
            # Create first if not exists
            profile = get_or_create_profile(user_id)
        else:
            profile = resp.data[0]
            
        update_data = {}
        
        # Check if we are updating language preference
        if "language_pref" in track_params:
            update_data["language_pref"] = track_params["language_pref"]
            
        # Check if we are updating taste profile (we check if any of the track params are in track_params)
        params = ["energy", "danceability", "valence", "tempo", "acousticness",
                  "instrumentalness", "speechiness", "liveness", "loudness"]
                  
        has_track_params = any(param in track_params for param in params)
        
        if has_track_params:
            play_count = profile.get("play_count", 0)
            weight = max(1.0 / (play_count + 1), 0.05)
            
            for param in params:
                current = profile.get(f"avg_{param}")
                if current is None:
                    current = 0.5
                    
                new_val = track_params.get(param)
                if new_val is None:
                    new_val = current
                else:
                    new_val = float(new_val)
                    
                update_data[f"avg_{param}"] = current * (1.0 - weight) + new_val * weight
                
            update_data["play_count"] = play_count + 1
            
        # If we have anything to update, update it
        if update_data:
            update_data["updated_at"] = datetime.utcnow().isoformat()
            save_resp = execute_with_retry(
                supabase.table("user_profiles")\
                .update(update_data)\
                .eq("user_id", user_id)
            )
                
            if not save_resp.data:
                raise HTTPException(status_code=500, detail="Failed to update user profile.")
            return save_resp.data[0]
            
        return profile
    except Exception as e:
        print(f"Error in update_profile: {e}")
        raise HTTPException(status_code=500, detail=str(e))
