import sys
import os
import re

# Resolve environment variables
backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.append(backend_dir)

from dotenv import load_dotenv
load_dotenv(dotenv_path=os.path.join(backend_dir, ".env"))

from services.supabase_client import supabase, execute_with_retry

def has_script(text, start, end):
    return any(start <= ord(char) <= end for char in text)

def is_compilation_album(album_name):
    if not album_name:
        return False
    album_lower = album_name.lower()
    compilation_words = [
        "workout", "party", "hits", "best of", "ultimate", "compilation", 
        "various", "style", "non stop", "non-stop", "mix", "collection", 
        "blockbusters", "world music day", "tribute"
    ]
    return any(w in album_lower for w in compilation_words)

def is_distributor_or_channel(artist_name):
    if not artist_name:
        return False
    artist_lower = artist_name.lower()
    channel_words = [
        "music", "tv", "movies", "entertainment", "records", "label", 
        "distribution", "series", "channel", "cinema", "production", "studio"
    ]
    return any(w in artist_lower for w in channel_words)

def clean_all_mismatches():
    print("Starting global language mismatch cleanup...")
    print("Scanning database in paginated batches of 1000...")
    
    limit = 1000
    offset = 0
    total_analyzed = 0
    updated_count = 0
    transitions = {}
    
    # Keyword sets
    te_keywords = ["telugu", "telegu", "telgu", "tollywood", "andhra", "telangana"]
    ml_keywords = ["malayalam", "mollywood"]
    kn_keywords = ["kannada", "sandalwood"]
    hi_keywords = ["hindi", "bollywood"]
    bn_keywords = ["bengali"]
    ko_keywords = ["korean", "kpop", "k-pop"]
    
    while True:
        try:
            res = execute_with_retry(
                supabase.table("tracks")
                .select("id, track_name, artist, album, language")
                .range(offset, offset + limit - 1)
            )
            data = res.data if res.data else []
            if not data:
                break
            
            total_analyzed += len(data)
            
            for t in data:
                track_id = t["id"]
                title = t["track_name"] or ""
                artist = t["artist"] or ""
                album = t["album"] or ""
                lang = t["language"]
                
                title_lower = title.lower()
                artist_lower = artist.lower()
                album_lower = album.lower()
                
                corrected_lang = None
                
                # 1. Script checks (Global: if track name or album contains script, it must be that language)
                if has_script(title, 0x0900, 0x097f) or has_script(album, 0x0900, 0x097f): # Devanagari
                    if lang != "hi":
                        corrected_lang = "hi"
                elif has_script(title, 0x0c00, 0x0c7f) or has_script(album, 0x0c00, 0x0c7f): # Telugu
                    if lang != "te":
                        corrected_lang = "te"
                elif has_script(title, 0x0d00, 0x0d7f) or has_script(album, 0x0d00, 0x0d7f): # Malayalam
                    if lang != "ml":
                        corrected_lang = "ml"
                elif has_script(title, 0x0b80, 0x0bff) or has_script(album, 0x0b80, 0x0bff): # Tamil
                    if lang != "ta":
                        corrected_lang = "ta"
                elif has_script(title, 0x0c80, 0x0cff) or has_script(album, 0x0c80, 0x0cff): # Kannada
                    if lang != "kn":
                        corrected_lang = "kn"
                elif has_script(title, 0x0980, 0x09ff) or has_script(album, 0x0980, 0x09ff): # Bengali
                    if lang != "bn":
                        corrected_lang = "bn"
                elif any(0xac00 <= ord(char) <= 0xd7a3 or 0x1100 <= ord(char) <= 0x11ff for char in title): # Korean Hangul
                    if lang != "ko":
                        corrected_lang = "ko"
                
                # 2. Strict keyword rule for rows currently tagged as Tamil ('ta')
                elif lang == "ta":
                    is_comp = is_compilation_album(album)
                    is_chan = is_distributor_or_channel(artist)
                    
                    # We build check text by including parts only if they aren't compilation/channel
                    parts = [title_lower]
                    if not is_chan:
                        parts.append(artist_lower)
                    if not is_comp:
                        parts.append(album_lower)
                    
                    check_text = " ".join(parts)
                    
                    def has_word(kw_list, text):
                        for kw in kw_list:
                            if re.search(r'\b' + re.escape(kw) + r'\b', text):
                                return True
                        return False
                    
                    if has_word(te_keywords, check_text):
                        corrected_lang = "te"
                    elif has_word(ml_keywords, check_text):
                        corrected_lang = "ml"
                    elif has_word(kn_keywords, check_text):
                        corrected_lang = "kn"
                    elif has_word(hi_keywords, check_text):
                        corrected_lang = "hi"
                    elif has_word(bn_keywords, check_text):
                        corrected_lang = "bn"
                    elif has_word(ko_keywords, check_text):
                        corrected_lang = "ko"
                    # If we filtered out album/artist but the title contains parenthetical keywords
                    else:
                        title_check = title_lower
                        if has_word(te_keywords, title_check):
                            corrected_lang = "te"
                        elif has_word(ml_keywords, title_check):
                            corrected_lang = "ml"
                        elif has_word(kn_keywords, title_check):
                            corrected_lang = "kn"
                        elif has_word(hi_keywords, title_check):
                            corrected_lang = "hi"
                        elif has_word(bn_keywords, title_check):
                            corrected_lang = "bn"
                        elif has_word(ko_keywords, title_check):
                            corrected_lang = "ko"
                
                if corrected_lang:
                    # Update database row
                    try:
                        execute_with_retry(
                            supabase.table("tracks")
                            .update({"language": corrected_lang})
                            .eq("id", track_id)
                        )
                        updated_count += 1
                        
                        transition = f"{lang} -> {corrected_lang}"
                        transitions[transition] = transitions.get(transition, 0) + 1
                        
                        safe_title = title.encode("ascii", "ignore").decode("ascii")
                        print(f"[{updated_count}] Updated: '{safe_title}' ({lang.upper()} -> {corrected_lang.upper()})")
                    except Exception as update_err:
                        print(f"Error updating track {track_id} ({title}): {update_err}")
            
            offset += limit
            if offset % 5000 == 0:
                print(f"Processed {offset} tracks...")
        except Exception as e:
            print(f"Error fetching range {offset}-{offset+limit}: {e}")
            break
            
    print("\n" + "="*50)
    print(f"Cleanup Completed!")
    print(f"Total tracks analyzed: {total_analyzed}")
    print(f"Total tracks corrected: {updated_count}")
    print("\nTransition statistics:")
    for trans, count in sorted(transitions.items(), key=lambda x: x[1], reverse=True):
        print(f"  {trans}: {count} tracks")
    print("="*50)

if __name__ == "__main__":
    # Safe output encoding for Windows consoles
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    clean_all_mismatches()
