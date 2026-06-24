-- Supabase DB Schema & RPC function for MoodFlow

-- 1. Create Tracks Table
CREATE TABLE IF NOT EXISTS tracks (
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
  source            TEXT DEFAULT 'kaggle',  -- 'kaggle' | 'user_added' | 'ytmusic_curated' | 'ytmusic_trending'
  release_year      INTEGER,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- Create Indexes for fast parametric queries
CREATE INDEX IF NOT EXISTS idx_tracks_language ON tracks (language);
CREATE INDEX IF NOT EXISTS idx_tracks_params ON tracks (energy, danceability, valence, tempo);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tracks_identity ON tracks (track_name, artist);
CREATE INDEX IF NOT EXISTS idx_tracks_lang_popularity ON tracks (language, popularity DESC);
CREATE INDEX IF NOT EXISTS idx_tracks_source ON tracks (source);
CREATE INDEX IF NOT EXISTS idx_tracks_lang_created_at ON tracks (language, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tracks_lang_source ON tracks (language, source);

-- 2. Create User Profiles Table
CREATE TABLE IF NOT EXISTS user_profiles (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               TEXT UNIQUE NOT NULL,   -- anonymous local ID stored in browser
  language_pref         TEXT DEFAULT 'en',
  
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
  
  play_count            INTEGER DEFAULT 0,
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Create Play History Table
CREATE TABLE IF NOT EXISTS play_history (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     TEXT NOT NULL,
  track_id    UUID REFERENCES tracks(id),
  played_at   TIMESTAMPTZ DEFAULT NOW(),
  completed   BOOLEAN DEFAULT false    -- true if listened >80% of duration
);

-- 4. Create Custom RPC function for distance calculation
CREATE OR REPLACE FUNCTION get_parametric_feed(
  p_lang TEXT,
  p_energy FLOAT,
  p_danceability FLOAT,
  p_valence FLOAT,
  p_tempo FLOAT,
  p_acousticness FLOAT,
  p_instrumentalness FLOAT,
  p_loudness FLOAT,
  p_user_id TEXT
)
RETURNS TABLE (
  id UUID,
  track_name TEXT,
  artist TEXT,
  album TEXT,
  language TEXT,
  genre TEXT,
  youtube_id TEXT,
  thumbnail_url TEXT,
  energy FLOAT,
  danceability FLOAT,
  valence FLOAT,
  tempo FLOAT,
  acousticness FLOAT,
  instrumentalness FLOAT,
  speechiness FLOAT,
  liveness FLOAT,
  loudness FLOAT,
  popularity FLOAT,
  explicit BOOLEAN,
  duration_ms INTEGER,
  source TEXT,
  created_at TIMESTAMPTZ,
  distance FLOAT
) AS $$
BEGIN
  RETURN QUERY
  SELECT *
  FROM (
    SELECT
      t.id, 
      t.track_name, 
      t.artist, 
      t.album, 
      t.language, 
      t.genre, 
      t.youtube_id, 
      t.thumbnail_url,
      t.energy, 
      t.danceability, 
      t.valence, 
      t.tempo, 
      t.acousticness, 
      t.instrumentalness,
      t.speechiness, 
      t.liveness, 
      t.loudness, 
      t.popularity, 
      t.explicit, 
      t.duration_ms, 
      t.source, 
      t.created_at,
      (
        ABS(t.energy - p_energy) * 2.0 +
        ABS(t.danceability - p_danceability) * 2.0 +
        ABS(t.valence - p_valence) * 1.8 +
        ABS(t.tempo - p_tempo) * 1.5 +
        ABS(t.acousticness - p_acousticness) * 1.2 +
        ABS(t.instrumentalness - p_instrumentalness) * 1.0 +
        ABS(t.loudness - p_loudness) * 0.8
      )::FLOAT AS distance
    FROM tracks t
    WHERE t.language = p_lang
    AND t.energy IS NOT NULL
    AND t.id NOT IN (
      SELECT ph.track_id 
      FROM play_history ph 
      WHERE ph.user_id = p_user_id 
      AND ph.track_id IS NOT NULL
    )
  ) sub
  ORDER BY 
    (
      sub.distance 
      + (CASE WHEN sub.source = 'kaggle' THEN 0.8 ELSE 0.0 END) 
      - (0.4 / (1.0 + (EXTRACT(EPOCH FROM (NOW() - sub.created_at)) / 86400.0) * 0.1))
    )::FLOAT ASC,
    sub.created_at DESC
  LIMIT 100;
END;
$$ LANGUAGE plpgsql;

-- 5. Create Playlists Table (stores playlist reference only)
CREATE TABLE IF NOT EXISTS playlists (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  playlist_id     TEXT UNIQUE NOT NULL,  -- YouTube Music Playlist ID or full URL
  title           TEXT NOT NULL,
  description     TEXT,
  thumbnail_url   TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

