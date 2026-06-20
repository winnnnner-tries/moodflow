"""
Feed Sections Service
=====================
Assembles structured feed sections for the Feed v2 UI.
Each section is a dict with id, title, subtitle, section_type, and tracks.
"""

from services.supabase_client import supabase, execute_with_retry
import concurrent.futures
from services.dynamic_feed import (
    LANG_NAMES,
    PRESETS,
    PRESET_QUERIES,
    calculate_feed_score,
    calculate_distance,
    get_closest_preset_name,
    get_hybrid_feed,
)


def _safe(text: str) -> str:
    """Return an ASCII-safe version for logging."""
    return text.encode("ascii", "ignore").decode("ascii")


def _section(id: str, title: str, subtitle: str, section_type: str, tracks: list) -> dict:
    return {
        "id": id,
        "title": title,
        "subtitle": subtitle,
        "section_type": section_type,
        "tracks": tracks,
    }


# ---------------------------------------------------------------------------
# Individual section builders
# ---------------------------------------------------------------------------

def _build_hits_section(lang: str, lang_name: str, targets: dict) -> dict | None:
    """[Language] Hits Right Now — trending + curated tracks sorted by popularity."""
    try:
        res = execute_with_retry(
            supabase.table("tracks")
            .select("*")
            .eq("language", lang)
            .in_("source", ["ytmusic_trending", "ytmusic_curated", "ytmusic_playlist"])
            .order("popularity", desc=True)
            .limit(15)
        )
        tracks = res.data if res.data else []
        if not tracks:
            return None
        return _section(
            id="hits_right_now",
            title=f"{lang_name} Hits Right Now",
            subtitle="Trending and popular tracks",
            section_type="horizontal_scroll",
            tracks=tracks[:15],
        )
    except Exception as e:
        print(f"[Feed Sections] Error building hits section: {e}")
        return None


def _build_mood_essentials(lang: str, preset_key: str, targets: dict) -> dict | None:
    """[Mood] Essentials — curated tracks matching the active preset, sorted by composite score."""
    mood_label = PRESET_QUERIES.get(preset_key, preset_key.replace("_", " ").title())
    try:
        res = execute_with_retry(
            supabase.table("tracks")
            .select("*")
            .eq("language", lang)
            .eq("source", "ytmusic_curated")
            .limit(300)
        )
        tracks = res.data if res.data else []
        if not tracks:
            return None

        # Filter out tracks without params
        valid_tracks = [t for t in tracks if t.get("energy") is not None]

        for t in valid_tracks:
            t["_score"] = calculate_feed_score(t, targets)
        valid_tracks.sort(key=lambda t: t["_score"])

        top = valid_tracks[:12]
        for t in top:
            t.pop("_score", None)

        if not top:
            return None

        return _section(
            id="mood_essentials",
            title=f"{mood_label} Essentials",
            subtitle=f"Curated tracks for a {mood_label.lower()} mood",
            section_type="horizontal_scroll",
            tracks=top,
        )
    except Exception as e:
        print(f"[Feed Sections] Error building mood essentials: {e}")
        return None


def _build_presenting_artist(lang: str, lang_name: str) -> dict | None:
    """Presenting [Top Artist] — if curated artist playlists exist, pick the top one."""
    try:
        # Look for playlists whose title starts with "Presenting"
        res = execute_with_retry(
            supabase.table("playlists")
            .select("*")
            .ilike("title", "Presenting%")
            .limit(10)
        )
        playlists = res.data if res.data else []
        if not playlists:
            return None

        # Pick the first playlist and fetch its tracks from the DB
        chosen = playlists[0]
        playlist_id = chosen.get("playlist_id")
        title = chosen.get("title", "Presenting Artist")

        # Try to find tracks that were synced from this playlist
        # We search for tracks from ytmusic_curated in this language
        res2 = execute_with_retry(
            supabase.table("tracks")
            .select("*")
            .eq("language", lang)
            .eq("source", "ytmusic_curated")
            .order("popularity", desc=True)
            .limit(12)
        )
        tracks = res2.data if res2.data else []
        if not tracks:
            return None

        return _section(
            id="presenting_artist",
            title=title,
            subtitle=f"The best of {lang_name} music",
            section_type="horizontal_scroll",
            tracks=tracks[:12],
        )
    except Exception as e:
        print(f"[Feed Sections] Error building presenting artist section: {e}")
        return None


def _build_fresh_this_week(lang: str) -> dict | None:
    """Fresh This Week — most recently added non-Kaggle tracks."""
    try:
        res = execute_with_retry(
            supabase.table("tracks")
            .select("*")
            .eq("language", lang)
            .neq("source", "kaggle")
            .order("created_at", desc=True)
            .limit(12)
        )
        tracks = res.data if res.data else []
        if not tracks:
            return None
        return _section(
            id="fresh_this_week",
            title="Fresh This Week",
            subtitle="Recently added tracks",
            section_type="horizontal_scroll",
            tracks=tracks,
        )
    except Exception as e:
        print(f"[Feed Sections] Error building fresh this week section: {e}")
        return None


def _build_recommended_mix(
    lang: str, targets: dict, user_id: str, preset_key: str, discovery: float
) -> dict | None:
    """Recommended Mix — pure DB parametric match (fast) to avoid YTM live search blocking."""
    try:
        res = execute_with_retry(
            supabase.table("tracks")
            .select("*")
            .eq("language", lang)
            .limit(500)
        )
        tracks = res.data if res.data else []
        if not tracks:
            return None
            
        # Filter out bad kaggle tracks
        valid_tracks = []
        for t in tracks:
            if t.get("source") == "kaggle" and (t.get("popularity") or 0) < 0.45:
                continue
            if t.get("energy") is None:
                continue
            valid_tracks.append(t)

        for t in valid_tracks:
            t["_score"] = calculate_feed_score(t, targets)
            
        valid_tracks.sort(key=lambda t: t["_score"])
        top = valid_tracks[:15]
        for t in top:
            t.pop("_score", None)

        if not top:
            return None
            
        return _section(
            id="recommended_mix",
            title="Recommended Mix",
            subtitle="Personalised picks based on your mood",
            section_type="grid",
            tracks=top,
        )
    except Exception as e:
        print(f"[Feed Sections] Error building recommended mix: {e}")
        return None


def _build_hidden_gems(lang: str, targets: dict) -> dict | None:
    """Hidden Gems — low-popularity tracks (0.3-0.5) with a good parametric match."""
    try:
        res = execute_with_retry(
            supabase.table("tracks")
            .select("*")
            .eq("language", lang)
            .gte("popularity", 0.3)
            .lte("popularity", 0.5)
            .limit(40)
        )
        tracks = res.data if res.data else []
        if not tracks:
            return None

        for t in tracks:
            t["_score"] = calculate_feed_score(t, targets)
        tracks.sort(key=lambda t: t["_score"])
        top = tracks[:10]
        for t in top:
            t.pop("_score", None)

        if not top:
            return None

        return _section(
            id="hidden_gems",
            title="Hidden Gems",
            subtitle="Under-the-radar tracks you might love",
            section_type="horizontal_scroll",
            tracks=top,
        )
    except Exception as e:
        print(f"[Feed Sections] Error building hidden gems section: {e}")
        return None


# ---------------------------------------------------------------------------
# Main assembly function
# ---------------------------------------------------------------------------

def assemble_feed_sections(
    lang: str,
    preset_key: str,
    targets: dict,
    user_id: str,
    discovery: float = 0.3,
    play_count: int = 0,
) -> list[dict]:
    """
    Returns an ordered list of feed sections.

    Each section:
    {
        "id": str,
        "title": str,
        "subtitle": str,
        "section_type": "horizontal_scroll" | "grid",
        "tracks": [...]
    }
    """
    lang_name = LANG_NAMES.get(lang, "English")

    builders = [
        lambda: _build_hits_section(lang, lang_name, targets),
        lambda: _build_mood_essentials(lang, preset_key, targets),
        lambda: _build_presenting_artist(lang, lang_name),
        lambda: _build_fresh_this_week(lang),
        lambda: _build_recommended_mix(lang, targets, user_id, preset_key, discovery),
        lambda: _build_hidden_gems(lang, targets) if play_count >= 10 else None
    ]

    results = [None] * len(builders)
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as executor:
        future_to_builder = {executor.submit(b): i for i, b in enumerate(builders)}
        for future in concurrent.futures.as_completed(future_to_builder):
            idx = future_to_builder[future]
            try:
                results[idx] = future.result()
            except Exception as exc:
                print(f"[Feed Sections] Builder {idx} generated an exception: {exc}")

    raw_sections = [s for s in results if s is not None]

    # Dynamic UI/UX Reordering based on preset
    # If the user selected a specific mood (not just 'for_you' or 'neutral'), 
    # we want the Mood Essentials and Recommended Mix at the top.
    
    order_weights = {
        "mood_essentials": 1,
        "recommended_mix": 2,
        "hits_right_now": 3,
        "presenting_artist": 4,
        "fresh_this_week": 5,
        "hidden_gems": 6
    }
    
    if preset_key and preset_key not in ["for_you", "neutral"]:
        # Mood is king
        order_weights["mood_essentials"] = 1
        order_weights["recommended_mix"] = 2
        order_weights["hits_right_now"] = 4
    else:
        # Default behavior: For You / Neutral
        # Prioritize Recommended Mix and Hits
        order_weights["recommended_mix"] = 1
        order_weights["hits_right_now"] = 2
        order_weights["mood_essentials"] = 3

    # Sort sections by their defined weight
    raw_sections.sort(key=lambda s: order_weights.get(s["id"], 99))

    print(f"[Feed Sections] Assembled {len(raw_sections)} sections for lang={lang}, preset={preset_key}")
    return raw_sections
