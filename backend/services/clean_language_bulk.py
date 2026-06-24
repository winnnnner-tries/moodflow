import sys
import os
import re

# Safe output encoding for Windows consoles
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

# Resolve environment variables
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
env_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env")
load_dotenv(dotenv_path=env_path)

from services.supabase_client import supabase, execute_with_retry

# Compiled film lists for border-crossing artists
THAMAN_TAMIL_FILMS = [
    "sabdham", "idhayam murali", "ivan than uthaman", "rasavathi", "varisu", 
    "annapoorani", "enemy", "aruvam", "magamuni", "kannaadi", "bhaagamathie", 
    "sivalinga", "vaigai express", "saagasam", "thillullu mullu", "settai", 
    "gouravam", "kadhalil sodhappuvadhu yeppadi", "thadaiyara thaakka", 
    "kanna laddu thinna aasaiya", "mambattiyan", "kanchana", "osthe", 
    "mouna guru", "mundhinam paartheney", "thillalangadi", "nagaram marupakkam", 
    "sindhanai sei", "eeram", "saroja"
]

DSP_TAMIL_FILMS = [
    "aaru", "alex pandian", "badri", "bramman", "kanthaswamy", "kutty", 
    "maayavi", "manmadan ambu", "mazhai", "puli", "pushpa", "sachein", 
    "saamy 2", "saamy", "santhosh subramaniam", "singam", "singam ii", 
    "singam 2", "the warriorr", "the warrior", "thirupaachi", "veeram", 
    "vengai", "villu", "rathnam", "good luck sakhi"
]

ANIRUDH_TELUGU_FILMS = [
    "jersey", "gang leader", "devara", "agnerthavaasi", "agnathavaasi"
]

def classify_track(title: str, artist: str, album: str = None, current_lang: str = "en") -> str:
    title_lower = title.lower()
    artist_lower = artist.lower()
    album_lower = album.lower() if album else ""
    check_text = f"{title_lower} {album_lower}"
    
    # 1. Check explicit language markers in title
    if "tamil" in title_lower or "(tamil)" in title_lower:
        return "ta"
    if "telugu" in title_lower or "(telugu)" in title_lower:
        return "te"
    if "hindi" in title_lower or "(hindi)" in title_lower:
        return "hi"
    if "malayalam" in title_lower or "(malayalam)" in title_lower:
        return "ml"
    if "kannada" in title_lower or "(kannada)" in title_lower:
        return "kn"
        
    # 2. Check character sets
    if any('\u0b80' <= char <= '\u0bff' for char in title):
        return "ta"
    if any('\u0c00' <= char <= '\u0c7f' for char in title):
        return "te"
    if any('\u0900' <= char <= '\u097f' for char in title):
        return "hi"

    # 3. Cross-border artist classification
    # Thaman S
    if "thaman" in artist_lower:
        for film in THAMAN_TAMIL_FILMS:
            if re.search(r'\b' + re.escape(film) + r'\b', check_text):
                return "ta"
        if current_lang == "en":
            return "te"
            
    # Devi Sri Prasad
    if "devi sri prasad" in artist_lower or "dsp" in artist_lower:
        for film in DSP_TAMIL_FILMS:
            if re.search(r'\b' + re.escape(film) + r'\b', check_text):
                return "ta"
        if current_lang == "en":
            return "te"
            
    # Anirudh Ravichander
    if "anirudh" in artist_lower:
        for film in ANIRUDH_TELUGU_FILMS:
            if re.search(r'\b' + re.escape(film) + r'\b', check_text):
                return "te"
        if current_lang == "en":
            return "ta"

    # Exclusively Tamil artists (default to Tamil if no other language indicators are found)
    ta_artists = [
        "santhosh narayanan", "vijay antony", "d. imman", "sean roldan", 
        "kidakuzhi mariyammal", "yuvan shankar raja", "harris jayaraj", 
        "g.v. prakash", "g. v. prakash", "gv prakash", "ilaiyaraaja", "ilayaraja", 
        "pradeep kumar", "hiphop tamizha", "leon james"
    ]
    # Exclusively Hindi/Punjabi artists
    hi_artists = [
        "anuv jain", "raftaar", "badshah", "yo yo honey singh", 
        "prateek kuhad", "karan aujla", "diljit dosanjh", "arijit singh",
        "pritam", "neha kakkar", "jubin nautiyal", "vishal-shekhar", 
        "shankar ehsaan loy", "amit trivedi"
    ]
    # Exclusively Telugu artists
    te_artists = [
        "ramajogayya sastry", "m. m. keeravani", "keeravaani", 
        "mickey j. meyer", "mickey j meyer"
    ]
    # Exclusively Malayalam artists
    ml_artists = [
        "sushin shyam", "vineeth sreenivasan", "shaan rahman"
    ]
    # Exclusively Kannada artists
    kn_artists = [
        "arjun janya"
    ]

    is_ta_artist = any(a in artist_lower for a in ta_artists)
    is_hi_artist = any(a in artist_lower for a in hi_artists)
    is_te_artist = any(a in artist_lower for a in te_artists)
    is_ml_artist = any(a in artist_lower for a in ml_artists)
    is_kn_artist = any(a in artist_lower for a in kn_artists)

    # 4. Refined vocabulary list for transliterated title detection
    ta_words = [
        "kadhal", "kadhali", "nee", "naan", "ennodu", "unnodu", "pogathey", 
        "singam", "ther", "thiruvizha", "rangi", "anbalane", "ayalaa", 
        "thimiri", "sago", "yosichi", "keeche", "sarpatta", "meyaadha", 
        "karuppi", "manjanathi", "oli", "ennadi", "maayavi", "vaa", 
        "velmayil", "karnan", "oru", "evano", "pottakaatil", "kandaa", 
        "sollunga", "uttradheenga", "yeppov", "vambula", "thumbula", 
        "anbe", "adiye", "thaai", "pondatti", "kannan", "parambarai", 
        "bodhai", "thalli", "macho", "kadel", "kadal", "irundhaal", 
        "kaattrae", "kaatrae", "kaatru", "kolame", "pilla", "poovasam", 
        "oru", "naane", "varuvean", "arasiyalla", "idhellam", "saadharnamappa",
        "kondattam", "manithan", "gulu", "chitta", "aalolam", "andhagan",
        "thirandhen", "vendraan", "vandhaan", "yamme", "yamma", "azhagu", 
        "raja", "thirandhen", "thirandhein", "bodhai"
    ]
    
    te_words = [
        "nuvvunte", "jathagaa", "yepudu", "nenena", "chuttu", "oka", 
        "premante", "raa", "neeli", "neele", "telusa", "cheliya", 
        "kalisey", "kanulu", "oopiri", "pranam", "gunde", "manasu", 
        "ranga", "chanti", "aradhya", "nuvve", "bhaga", "skanda", 
        "veera", "namage", "custody", "solo brathuke", "aadujeevitham", 
        "srivalli", "samayama", "oodha", "dhruva", "urimey", "oo antava",
        "jalapaatham", "nuvvu", "aunanaa", "kaadana", "aunanaa kaadanaa",
        "naalo", "neeku"
    ]
    
    hi_words = [
        "tum", "hum", "dil", "mera", "tere", "meri", "kya", "hai", 
        "kuch", "arz", "kiya", "yeh", "ghar", "chala", "zindagi", 
        "pyar", "bhoomi", "jaan", "naina", "prem", "dhadkan", "sajan", 
        "tujhe", "kaise", "chahun", "dhoom", "dhaam", "team india", 
        "hain", "maidaan", "coke studio", "bol mohabbat", "tattoo waaliye",
        "magic mamoni", "chhod", "diya", "lut", "gaye", "bekhayali", 
        "kabir singh", "humsafar", "thode", "karam", "zara", "sun", 
        "sun zara"
    ]

    # Count matched words in title (with word boundary checking)
    ta_count = sum(1 for w in ta_words if f" {w} " in f" {title_lower} " or title_lower.startswith(f"{w} ") or title_lower.endswith(f" {w}"))
    te_count = sum(1 for w in te_words if f" {w} " in f" {title_lower} " or title_lower.startswith(f"{w} ") or title_lower.endswith(f" {w}"))
    hi_count = sum(1 for w in hi_words if f" {w} " in f" {title_lower} " or title_lower.startswith(f"{w} ") or title_lower.endswith(f" {w}"))
    
    # Combine counts and artist information
    if is_ta_artist:
        if te_count > ta_count:
            return "te"
        if hi_count > ta_count:
            return "hi"
        return "ta"
        
    if is_hi_artist:
        if ta_count > hi_count:
            return "ta"
        if te_count > hi_count:
            return "te"
        return "hi"
        
    if is_te_artist:
        if ta_count > te_count:
            return "ta"
        if hi_count > te_count:
            return "hi"
        return "te"

    if is_ml_artist:
        return "ml"

    if is_kn_artist:
        return "kn"
        
    # Check general words without artist clue
    if ta_count > 0 or te_count > 0 or hi_count > 0:
        max_val = max(ta_count, te_count, hi_count)
        if max_val == ta_count:
            return "ta"
        elif max_val == te_count:
            return "te"
        else:
            return "hi"
            
    # Default: keep as original
    return current_lang

def run_update():
    print("Fetching tracks to correct in database...")
    target_artists = [
        "Santhosh Narayanan", "Anirudh Ravichander", "A.R. Rahman", 
        "Sid Sriram", "Arijit Singh", "Neha Kakkar", "Karan Aujla", 
        "Anuv Jain", "Shreya Ghoshal", "Yuvan Shankar Raja", 
        "Harris Jayaraj", "Vijay Antony", "D. Imman", "Sean Roldan", 
        "Thaman S", "Devi Sri Prasad", "Pradeep Kumar", "Hiphop Tamizha",
        "Leon James", "G.V. Prakash", "Sushin Shyam"
    ]
    
    all_tracks = []
    for artist in target_artists:
        resp = execute_with_retry(
            supabase.table("tracks")
            .select("id, track_name, artist, album, language")
            .eq("language", "en")
            .ilike("artist", f"%{artist}%")
            .limit(300) # grab up to 300 tracks per artist
        )
        if resp and resp.data:
            all_tracks.extend(resp.data)
            
    print(f"Found {len(all_tracks)} candidates in the English-tagged list.")
    
    updated_count = 0
    for track in all_tracks:
        title = track["track_name"]
        artist = track["artist"]
        album = track.get("album")
        track_id = track["id"]
        old_lang = track["language"]
        new_lang = classify_track(title, artist, album, old_lang)
        
        if new_lang != old_lang:
            try:
                execute_with_retry(
                    supabase.table("tracks")
                    .update({"language": new_lang})
                    .eq("id", track_id)
                )
                updated_count += 1
                info = f"[{updated_count}] Updated: {old_lang} -> {new_lang.upper()} | Artist: {artist} | Title: {title}"
                print(info.encode('ascii', 'backslashreplace').decode('ascii'))
            except Exception as update_err:
                print(f"Error updating track {track_id}: {update_err}")
                
    print(f"\nCompleted! Total tracks updated: {updated_count}")

if __name__ == "__main__":
    run_update()
