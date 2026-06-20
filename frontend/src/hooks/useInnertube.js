import { useState } from 'react';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

export function useInnertube() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  /**
   * Search for a single track (returns the first match or null).
   * Used internally for resolving youtube_id of feed tracks.
   */
  const searchTrack = async (query) => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch(`${API_BASE_URL}/search?q=${encodeURIComponent(query)}`);
      if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(errText || "Search request failed");
      }
      const results = await resp.json();
      // Return the FIRST result as a single object, or null
      if (Array.isArray(results) && results.length > 0) {
        return results[0];
      }
      return null;
    } catch (err) {
      setError(err.message);
      console.error("useInnertube searchTrack error:", err);
      return null;
    } finally {
      setLoading(false);
    }
  };

  /**
   * Search for multiple tracks (returns full array).
   * Used for the search dropdown in FeedScreen.
   */
  const searchTracks = async (query) => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch(`${API_BASE_URL}/search?q=${encodeURIComponent(query)}`);
      if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(errText || "Search request failed");
      }
      const results = await resp.json();
      return Array.isArray(results) ? results : [];
    } catch (err) {
      setError(err.message);
      console.error("useInnertube searchTracks error:", err);
      return [];
    } finally {
      setLoading(false);
    }
  };

  const getStreamUrl = (youtubeId) => {
    // The stream URL is just the proxy endpoint — no fetch needed
    return `${API_BASE_URL}/stream/${youtubeId}`;
  };

  return { searchTrack, searchTracks, getStreamUrl, loading, error };
}
export default useInnertube;
