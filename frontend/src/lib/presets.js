export const PRESETS = {
  workout:   { energy:0.85, danceability:0.75, valence:0.65, tempo:0.56, acousticness:0.05, instrumentalness:0.1,  speechiness:0.1,  liveness:0.15, loudness:0.88 },
  chill:     { energy:0.30, danceability:0.45, valence:0.55, tempo:0.36, acousticness:0.60, instrumentalness:0.3,  speechiness:0.05, liveness:0.1,  loudness:0.55 },
  sad:       { energy:0.25, danceability:0.30, valence:0.15, tempo:0.32, acousticness:0.70, instrumentalness:0.2,  speechiness:0.05, liveness:0.1,  loudness:0.45 },
  feel_good: { energy:0.70, danceability:0.80, valence:0.85, tempo:0.48, acousticness:0.15, instrumentalness:0.05, speechiness:0.1,  liveness:0.1,  loudness:0.82 },
  focus:     { energy:0.40, danceability:0.35, valence:0.45, tempo:0.44, acousticness:0.40, instrumentalness:0.70, speechiness:0.03, liveness:0.08, loudness:0.60 },
  hype:      { energy:0.95, danceability:0.88, valence:0.75, tempo:0.60, acousticness:0.02, instrumentalness:0.05, speechiness:0.25, liveness:0.2,  loudness:0.95 },
  romance:   { energy:0.40, danceability:0.55, valence:0.65, tempo:0.38, acousticness:0.50, instrumentalness:0.1,  speechiness:0.05, liveness:0.1,  loudness:0.62 },
  sleep:     { energy:0.10, danceability:0.15, valence:0.35, tempo:0.24, acousticness:0.85, instrumentalness:0.80, speechiness:0.03, liveness:0.05, loudness:0.30 }
};

export const PRESET_LABELS = {
  workout:   { label: '🏃 Workout',  key: 'workout' },
  chill:     { label: '☕ Chill',     key: 'chill' },
  sad:       { label: '😢 Sad',      key: 'sad' },
  feel_good: { label: '☀️ Feel Good', key: 'feel_good' },
  focus:     { label: '🧠 Focus',    key: 'focus' },
  hype:      { label: '🔥 Hype',     key: 'hype' },
  romance:   { label: '💖 Romance',  key: 'romance' },
  sleep:     { label: '🌙 Sleep',    key: 'sleep' }
};

export function getTimeAwarePreset() {
  const now = new Date();
  const hour = now.getHours();
  const day = now.getDay(); // 0=Sun, 6=Sat
  const isWeekend = day === 0 || day === 6;
  const isFriday = day === 5;

  if (isFriday && hour >= 18) return { key: 'hype', badge: '🎉 TGIF vibes' };
  if (isWeekend) {
    if (hour >= 6 && hour < 12) return { key: 'feel_good', badge: '☀️ Lazy morning' };
    if (hour >= 12 && hour < 18) return { key: 'hype', badge: '🔥 Weekend energy' };
    if (hour >= 18) return { key: 'hype', badge: '🎉 Weekend night' };
    return { key: 'sleep', badge: '🌙 Late night' };
  }
  // Weekday
  if (hour >= 6 && hour < 9) return { key: 'feel_good', badge: '☀️ Morning vibes' };
  if (hour >= 9 && hour < 12) return { key: 'focus', badge: '🧠 Focus time' };
  if (hour >= 12 && hour < 14) return { key: 'feel_good', badge: '☀️ Lunch break' };
  if (hour >= 14 && hour < 17) return { key: 'focus', badge: '🧠 Afternoon push' };
  if (hour >= 17 && hour < 21) return { key: 'chill', badge: '🌅 Wind down' };
  if (hour >= 21) return { key: 'sleep', badge: '🌙 Night mode' };
  return { key: 'chill', badge: '🌙 Late night' };
}
