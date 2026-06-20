# MoodFlow — Complete Project Workflow

## What this app is

A web-based music player that generates a personalised, parametric feed of songs based on audio features (energy, danceability, valence, tempo, etc.). Audio plays via YouTube Music's internal API (Innertube). No Spotify Premium required. No iFrame. Full audio effects (reverb, pitch, EQ) via Web Audio API.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React (Vite) |
| Backend | Python (FastAPI) |
| Database | Supabase (Postgres) |
| Audio analysis | Essentia.js (WebAssembly, runs in browser) |
| Music data | YouTube Music via Innertube (unofficial, no API key) |
| Seed data | Kaggle multilingual Spotify datasets |
| Audio playback | HTML5 `<audio>` tag + Web Audio API |

---

## Database Schema (Supabase)

### Table: `tracks`

```sql
CREATE TABLE tracks (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  track_name        TEXT NOT NULL,
  artist            TEXT NOT NULL,
  album             TEXT,
  language          TEXT,         -- 'hi', 'en', 'ta', 'te', 'ml', 'kn', 'bn', 'ko'
  genre             TEXT,
  youtube_id        TEXT,         -- null until first play
  thumbnail_url     TEXT,         -- https://i.ytimg.com/vi/{youtube_id}/mqdefault.jpg

  -- All audio parameters stored normalised 0.0–1.0
  energy            FLOAT,
  danceability      FLOAT,        -- Essentia raw 0–3, divide by 3 before storing
  valence           FLOAT,
  tempo             FLOAT,        -- raw BPM / 250 before storing
  acousticness      FLOAT,
  instrumentalness  FLOAT,
  speechiness       FLOAT,
  liveness          FLOAT,
  loudness          FLOAT,        -- (raw_dB + 60) / 60 before storing
  popularity        FLOAT,        -- Kaggle: /100. YouTube: log10(views)/8 capped at 1.0

  explicit          BOOLEAN DEFAULT false,
  duration_ms       INTEGER,
  source            TEXT DEFAULT 'kaggle',  -- 'kaggle' | 'user_added'
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for fast parametric queries
CREATE INDEX idx_tracks_language ON tracks (language);
CREATE INDEX idx_tracks_params ON tracks (energy, danceability, valence, tempo);
CREATE UNIQUE INDEX idx_tracks_identity ON tracks (track_name, artist);
```

### Table: `user_profiles`

```sql
CREATE TABLE user_profiles (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         TEXT UNIQUE NOT NULL,   -- anonymous local ID stored in browser
  language_pref   TEXT DEFAULT 'en',
  -- taste profile: rolling average of played song parameters
  avg_energy            FLOAT DEFAULT 0.5,
  avg_danceability      FLOAT DEFAULT 0.5,
  avg_valence           FLOAT DEFAULT 0.5,
  avg_tempo             FLOAT DEFAULT 0.5,
  avg_acousticness      FLOAT DEFAULT 0.5,
  avg_instrumentalness  FLOAT DEFAULT 0.1,
  avg_speechiness       FLOAT DEFAULT 0.1,
  avg_liveness          FLOAT DEFAULT 0.1,
  avg_loudness          FLOAT DEFAULT 0.7,
  play_count      INTEGER DEFAULT 0,
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
```

### Table: `play_history`

```sql
CREATE TABLE play_history (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     TEXT NOT NULL,
  track_id    UUID REFERENCES tracks(id),
  played_at   TIMESTAMPTZ DEFAULT NOW(),
  completed   BOOLEAN DEFAULT false    -- true if listened >80% of duration
);
```

---

## Parameter Normalisation Contract

Every value stored in the database must follow this scale. Apply before every INSERT regardless of source.

```python
import math

def normalise(raw: dict, source: str) -> dict:
    return {
        **raw,
        "danceability":  raw["danceability"] / 3.0,          # Essentia: 0–3 → 0–1
        "tempo":         raw["tempo"] / 250.0,               # BPM → 0–1
        "loudness":      (raw["loudness"] + 60.0) / 60.0,    # dB → 0–1
        "popularity":    raw["popularity"] / 100.0            # Kaggle 0–100 → 0–1
                         if source == "kaggle"
                         else min(math.log10(max(raw.get("view_count", 1), 1)) / 8.0, 1.0),
    }
```

---

## Feed Query Logic

```sql
-- Parametric feed: find 20 closest songs to user's taste profile
-- excluding songs already in their play history
SELECT
  id, track_name, artist, thumbnail_url, youtube_id, language,
  ABS(energy - $1)            * 2.0 +
  ABS(danceability - $2)      * 2.0 +
  ABS(valence - $3)           * 1.8 +
  ABS(tempo - $4)             * 1.5 +
  ABS(acousticness - $5)      * 1.2 +
  ABS(instrumentalness - $6)  * 1.0 +
  ABS(loudness - $7)          * 0.8
  AS distance
FROM tracks
WHERE language = $8
AND id NOT IN (
  SELECT track_id FROM play_history WHERE user_id = $9
)
AND energy IS NOT NULL
ORDER BY distance ASC
LIMIT 20;
```

---

## Project Structure

```
moodflow/
├── frontend/                   # React (Vite)
│   ├── src/
│   │   ├── components/
│   │   │   ├── FeedScreen.jsx          # Screen 1: song cards grid
│   │   │   ├── PlayerScreen.jsx        # Screen 3: now playing
│   │   │   ├── SongCard.jsx            # Feed card: thumbnail + name + artist
│   │   │   ├── ParameterSliders.jsx    # 9 sliders for advanced mode
│   │   │   ├── PresetButtons.jsx       # Workout / Chill / Sad / Focus / Hype
│   │   │   ├── AudioEffects.jsx        # Reverb / Pitch / EQ controls
│   │   │   ├── UpNextQueue.jsx         # Slide-up queue panel
│   │   │   └── SleepTimer.jsx
│   │   ├── hooks/
│   │   │   ├── useAudioPlayer.js       # HTML5 audio + Web Audio API
│   │   │   ├── useInnertube.js         # Innertube search + stream URL
│   │   │   ├── useEssentia.js          # Background audio analysis
│   │   │   └── useTasteProfile.js      # Read/write user profile to Supabase
│   │   ├── lib/
│   │   │   ├── supabase.js             # Supabase client
│   │   │   ├── normalise.js            # Parameter normalisation functions
│   │   │   ├── presets.js              # Preset parameter values
│   │   │   └── userId.js              # Generate/retrieve anonymous user ID
│   │   ├── App.jsx
│   │   └── main.jsx
│   ├── public/
│   └── package.json
│
├── backend/                    # Python FastAPI
│   ├── main.py                 # FastAPI app entry point
│   ├── routers/
│   │   ├── feed.py             # GET /feed — parametric query
│   │   ├── tracks.py           # POST /tracks — insert new track
│   │   ├── profile.py          # GET/PUT /profile/{user_id}
│   │   └── sync.py             # POST /sync/kaggle — trigger weekly sync
│   ├── services/
│   │   ├── supabase_client.py  # Supabase Python client
│   │   ├── innertube.py        # Innertube search wrapper
│   │   ├── normalise.py        # Normalisation functions
│   │   └── kaggle_sync.py      # Download + upsert Kaggle dataset
│   ├── requirements.txt
│   └── .env
│
└── README.md
```

---

## Preset Parameter Values

```python
PRESETS = {
    "workout": {
        "energy": 0.85, "danceability": 0.75, "valence": 0.65,
        "tempo": 0.56,  # ~140 BPM
        "acousticness": 0.05, "instrumentalness": 0.1,
        "speechiness": 0.1, "liveness": 0.15, "loudness": 0.88
    },
    "chill": {
        "energy": 0.30, "danceability": 0.45, "valence": 0.55,
        "tempo": 0.36,  # ~90 BPM
        "acousticness": 0.60, "instrumentalness": 0.3,
        "speechiness": 0.05, "liveness": 0.1, "loudness": 0.55
    },
    "sad": {
        "energy": 0.25, "danceability": 0.30, "valence": 0.15,
        "tempo": 0.32,  # ~80 BPM
        "acousticness": 0.70, "instrumentalness": 0.2,
        "speechiness": 0.05, "liveness": 0.1, "loudness": 0.45
    },
    "feel_good": {
        "energy": 0.70, "danceability": 0.80, "valence": 0.85,
        "tempo": 0.48,  # ~120 BPM
        "acousticness": 0.15, "instrumentalness": 0.05,
        "speechiness": 0.1, "liveness": 0.1, "loudness": 0.82
    },
    "focus": {
        "energy": 0.40, "danceability": 0.35, "valence": 0.45,
        "tempo": 0.44,  # ~110 BPM
        "acousticness": 0.40, "instrumentalness": 0.70,
        "speechiness": 0.03, "liveness": 0.08, "loudness": 0.60
    },
    "hype": {
        "energy": 0.95, "danceability": 0.88, "valence": 0.75,
        "tempo": 0.60,  # ~150 BPM
        "acousticness": 0.02, "instrumentalness": 0.05,
        "speechiness": 0.25, "liveness": 0.2, "loudness": 0.95
    },
    "romance": {
        "energy": 0.40, "danceability": 0.55, "valence": 0.65,
        "tempo": 0.38,  # ~95 BPM
        "acousticness": 0.50, "instrumentalness": 0.1,
        "speechiness": 0.05, "liveness": 0.1, "loudness": 0.62
    },
    "sleep": {
        "energy": 0.10, "danceability": 0.15, "valence": 0.35,
        "tempo": 0.24,  # ~60 BPM
        "acousticness": 0.85, "instrumentalness": 0.80,
        "speechiness": 0.03, "liveness": 0.05, "loudness": 0.30
    }
}
```

---

## Data Flow — New Song (not in DB)

```
1. User searches "APT - Rose"
2. Frontend calls backend: GET /search?q=APT+Rose
3. Backend calls Innertube → returns { youtube_id, track_name, artist,
   thumbnail_url, duration_ms, language, explicit }
4. Backend checks Supabase: SELECT * FROM tracks WHERE track_name='APT' AND artist='Rose'
5. Not found → insert partial row (identity + youtube fields, parameters NULL)
6. Return track to frontend immediately
7. Frontend starts playing via HTML5 audio (stream URL from Innertube)
8. Essentia.js runs in Web Worker — analyses audio stream in background
9. After ~4s, Essentia.js posts parameters to main thread
10. Frontend calls backend: PATCH /tracks/{id} with normalised parameters
11. Backend upserts full row into Supabase
12. Row is now fully populated — available for future feed queries
```

---

## Data Flow — Feed Generation

```
1. User opens app / changes preset or sliders
2. Frontend reads user's taste profile from Supabase (or uses preset values)
3. Frontend calls backend: GET /feed?lang=hi&energy=0.85&dance=0.75&...
4. Backend runs parametric SQL query against Supabase
5. Returns 20 tracks: { track_name, artist, thumbnail_url, youtube_id }
6. Frontend renders song cards with thumbnail images
   — thumbnails load directly from YouTube CDN (i.ytimg.com)
   — zero additional API calls
7. User taps a song card
8. Frontend calls backend: GET /stream?youtube_id=abc123
9. Backend calls Innertube → returns stream URL
10. Frontend sets audio.src = streamURL, audio.play()
11. Web Audio API chain: source → pitch → reverb → EQ → speakers
12. play_history row inserted, user profile updated
```

---

## Taste Profile Update Logic

Every time a user completes a song (>80% listened), update their profile:

```python
def update_taste_profile(profile: dict, track_params: dict, play_count: int) -> dict:
    # Weighted rolling average — recent plays count more
    # Weight decreases as play_count grows (converges to stable preference)
    weight = max(1.0 / play_count, 0.05)  # minimum 5% weight per new song
    params = ["energy","danceability","valence","tempo",
              "acousticness","instrumentalness","speechiness","liveness","loudness"]
    for p in params:
        current = profile.get(f"avg_{p}", 0.5)
        new_val  = track_params.get(p, 0.5)
        profile[f"avg_{p}"] = current * (1 - weight) + new_val * weight
    profile["play_count"] = play_count + 1
    return profile
```

---

## Kaggle Sync Service

```python
# backend/services/kaggle_sync.py
import kagglehub
import pandas as pd
from services.supabase_client import supabase
from services.normalise import normalise_row

DATASETS = [
    "gauthamvijayaraj/spotify-tracks-dataset-updated-every-week",
    "gayathripullakhandam/spotify-indian-languages-datasets"
]

def sync():
    for dataset_id in DATASETS:
        path = kagglehub.dataset_download(dataset_id)
        df = pd.read_csv(f"{path}/tracks.csv")
        rows = []
        for _, row in df.iterrows():
            normalised = normalise_row(row.to_dict(), source="kaggle")
            rows.append(normalised)
        # Upsert — insert new, skip existing
        supabase.table("tracks").upsert(
            rows,
            on_conflict="track_name,artist",
            ignore_duplicates=True
        ).execute()
    print(f"Sync complete")
```

---

## Audio Effects Chain (Web Audio API)

```javascript
// frontend/src/hooks/useAudioPlayer.js

const audioCtx = new AudioContext();
const audio = new Audio();
audio.crossOrigin = "anonymous";

const source    = audioCtx.createMediaElementSource(audio);
const gainNode  = audioCtx.createGain();
const reverb    = audioCtx.createConvolver();      // reverb
const biquad    = audioCtx.createBiquadFilter();   // EQ / bass boost
const panner    = audioCtx.createStereoPanner();   // 8D audio

// Chain: source → biquad → reverb → panner → gain → output
source.connect(biquad);
biquad.connect(reverb);
reverb.connect(panner);
panner.connect(gainNode);
gainNode.connect(audioCtx.destination);

// Pitch shifting requires a library: soundtouch-js or pitchshifter.js
// installed via npm, inserted between source and biquad
```

---

## Backend API Endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/feed` | Parametric feed query from Supabase |
| GET | `/search` | Search Innertube, check/insert DB |
| GET | `/stream/{youtube_id}` | Get stream URL from Innertube |
| POST | `/tracks` | Insert new track (partial — identity only) |
| PATCH | `/tracks/{id}` | Update track with Essentia parameters |
| GET | `/profile/{user_id}` | Get user taste profile |
| PUT | `/profile/{user_id}` | Update taste profile after play |
| POST | `/history` | Log play event |
| POST | `/sync/kaggle` | Trigger manual Kaggle sync |

---

## Frontend Screens

### Screen 1 — Feed
- Language selector (top)
- Preset buttons row: Workout / Chill / Sad / Focus / Hype / Romance / Sleep
- Toggle: "Advanced" — reveals 9 parameter sliders
- Song card grid (2 columns): thumbnail + track name + artist
- Tap card → triggers Screen 3

### Screen 3 — Player
- Back button
- Album art / thumbnail (large)
- Track name + artist
- Progress bar + current time + duration
- Play / Pause / Previous / Next
- Three-dot menu → Audio Effects drawer
  - Pitch slider (−6 to +6 semitones)
  - Reverb intensity slider (0–100%)
  - Bass boost toggle
  - 8D audio toggle
  - Playback speed (0.75 / 1.0 / 1.25 / 1.5)
  - Sleep timer (15 / 30 / 45 / 60 min)
- Slide-up panel → Up Next queue

---

## Environment Variables

### Frontend (.env)
```
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
VITE_API_BASE_URL=http://localhost:8000
```

### Backend (.env)
```
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_KEY=your_supabase_service_key
KAGGLE_USERNAME=your_kaggle_username
KAGGLE_KEY=your_kaggle_api_key
```

---

## Phase Build Order

| Phase | What to build | Done when |
|---|---|---|
| 1 | Supabase schema + Kaggle import script | DB has 80k+ songs queryable |
| 2 | FastAPI backend — /feed and /stream endpoints | Feed query returns 20 tracks, Innertube returns stream URL |
| 3 | React feed screen — presets + song cards | App shows thumbnails, tapping a card plays audio |
| 4 | HTML5 audio player screen | Full playback controls working |
| 5 | Web Audio API effects chain | Reverb, pitch, EQ working in player |
| 6 | Essentia.js integration | New songs get parameters computed and stored |
| 7 | Taste profile + For You feed | Personalised feed based on play history |
| 8 | Weekly Kaggle sync | Automated via cron or GitHub Actions |
