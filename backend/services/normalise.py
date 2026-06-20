import math

def normalise_row(raw: dict, source: str = "kaggle") -> dict:
    result = dict(raw)
    try:
        if source == "kaggle":
            if raw.get("danceability") is not None:
                result["danceability"] = min(float(raw["danceability"]) / 3.0, 1.0)
            if raw.get("tempo") is not None:
                result["tempo"] = min(float(raw["tempo"]) / 250.0, 1.0)
            if raw.get("loudness") is not None:
                result["loudness"] = min((float(raw["loudness"]) + 60.0) / 60.0, 1.0)
            if raw.get("popularity") is not None:
                result["popularity"] = float(raw["popularity"]) / 100.0
        elif source == "user_added":
            if raw.get("view_count") is not None:
                result["popularity"] = min(math.log10(max(int(raw["view_count"]), 1)) / 8.0, 1.0)
    except (ValueError, TypeError) as e:
        # Gracefully handle conversion errors, fallback to default value or log
        pass
    return result
