export function normaliseParams(raw, source = "user_added") {
  const result = { ...raw };
  if (raw.danceability !== undefined && raw.danceability !== null) {
    result.danceability = Math.min(parseFloat(raw.danceability) / 3.0, 1.0);
  }
  if (raw.tempo !== undefined && raw.tempo !== null) {
    result.tempo = Math.min(parseFloat(raw.tempo) / 250.0, 1.0);
  }
  if (raw.loudness !== undefined && raw.loudness !== null) {
    result.loudness = Math.min((parseFloat(raw.loudness) + 60.0) / 60.0, 1.0);
  }
  return result;
}
