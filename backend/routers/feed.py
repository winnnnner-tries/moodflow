from fastapi import APIRouter, HTTPException, Query
from services.dynamic_feed import get_hybrid_feed
from services.feed_sections import assemble_feed_sections
from services.dynamic_feed import get_closest_preset_name

router = APIRouter()

@router.get("/feed")
def get_feed(
    lang: str = Query(..., description="Language preference (e.g. 'en', 'hi', 'ta')"),
    energy: float = Query(0.5, description="Target energy (0.0-1.0)"),
    danceability: float = Query(0.5, description="Target danceability (0.0-1.0)"),
    valence: float = Query(0.5, description="Target valence (0.0-1.0)"),
    tempo: float = Query(0.5, description="Target tempo (0.0-1.0)"),
    acousticness: float = Query(0.5, description="Target acousticness (0.0-1.0)"),
    instrumentalness: float = Query(0.5, description="Target instrumentalness (0.0-1.0)"),
    loudness: float = Query(0.7, description="Target loudness (0.0-1.0)"),
    user_id: str = Query(..., description="Anonymous user ID"),
    preset: str = Query(None, description="Preset key (e.g. 'chill', 'workout'). Auto-detected if omitted."),
    discovery: float = Query(0.3, description="Discovery factor (0.0-1.0)")
):
    try:
        # Call the hybrid dynamic feed service
        tracks = get_hybrid_feed(
            lang=lang,
            energy=energy,
            danceability=danceability,
            valence=valence,
            tempo=tempo,
            acousticness=acousticness,
            instrumentalness=instrumentalness,
            loudness=loudness,
            user_id=user_id,
            preset_key=preset,
            discovery=discovery,
        )
        return tracks
    except Exception as e:
        print(f"Error fetching feed: {e}")
        raise HTTPException(status_code=500, detail=f"Feed generation error: {str(e)}")


@router.get("/feed/sections")
def get_feed_sections(
    lang: str = Query(..., description="Language preference (e.g. 'en', 'hi', 'ta')"),
    preset: str = Query("chill", description="Preset key (e.g. 'chill', 'workout')"),
    energy: float = Query(0.5, description="Target energy (0.0-1.0)"),
    danceability: float = Query(0.5, description="Target danceability (0.0-1.0)"),
    valence: float = Query(0.5, description="Target valence (0.0-1.0)"),
    tempo: float = Query(0.5, description="Target tempo (0.0-1.0)"),
    acousticness: float = Query(0.5, description="Target acousticness (0.0-1.0)"),
    instrumentalness: float = Query(0.1, description="Target instrumentalness (0.0-1.0)"),
    loudness: float = Query(0.7, description="Target loudness (0.0-1.0)"),
    user_id: str = Query(..., description="Anonymous user ID"),
    discovery: float = Query(0.3, description="Discovery factor (0.0-1.0)"),
    play_count: int = Query(0, description="Total user play count (unlocks Hidden Gems at 10+)")
):
    try:
        targets = {
            "energy": energy,
            "danceability": danceability,
            "valence": valence,
            "tempo": tempo,
            "acousticness": acousticness,
            "instrumentalness": instrumentalness,
            "loudness": loudness,
        }

        # Resolve preset_key: use provided preset, or auto-detect from targets
        preset_key = preset if preset else get_closest_preset_name(targets)

        sections = assemble_feed_sections(
            lang=lang,
            preset_key=preset_key,
            targets=targets,
            user_id=user_id,
            discovery=discovery,
            play_count=play_count,
        )
        return {"sections": sections}
    except Exception as e:
        print(f"Error fetching feed sections: {e}")
        raise HTTPException(status_code=500, detail=f"Feed sections error: {str(e)}")
