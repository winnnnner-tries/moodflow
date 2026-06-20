import { useState, useEffect } from 'react';
import { getOrCreateUserId } from '../lib/userId';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

export function useTasteProfile() {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const userId = getOrCreateUserId();

  const fetchProfile = async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch(`${API_BASE_URL}/profile/${userId}`);
      if (!resp.ok) {
        throw new Error("Failed to load user profile");
      }
      const data = await resp.json();
      setProfile(data);
      return data;
    } catch (err) {
      setError(err.message);
      console.error("fetchProfile error:", err);
      return null;
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProfile();
  }, []);

  const logTrackPlayed = async (trackId, completed = false) => {
    try {
      const resp = await fetch(`${API_BASE_URL}/history`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          user_id: userId,
          track_id: trackId,
          completed: completed
        })
      });
      if (!resp.ok) {
        console.error("History logging failed:", resp.statusText);
      }
    } catch (err) {
      console.error("Failed to log play history:", err);
    }
  };

  const updateTasteProfile = async (trackParams) => {
    try {
      // Pick only parameter keys needed
      const allowedKeys = [
        "energy", "danceability", "valence", "tempo", 
        "acousticness", "instrumentalness", "speechiness", 
        "liveness", "loudness"
      ];
      
      const payload = {};
      allowedKeys.forEach(k => {
        // Default parameter value to 0.5 if it's null/undefined
        payload[k] = trackParams[k] !== undefined && trackParams[k] !== null ? trackParams[k] : 0.5;
      });

      const resp = await fetch(`${API_BASE_URL}/profile/${userId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });
      
      if (resp.ok) {
        const updatedProfile = await resp.json();
        setProfile(updatedProfile);
        return updatedProfile;
      }
    } catch (err) {
      console.error("Failed to update taste profile:", err);
    }
    return null;
  };

  const updateLanguagePref = async (langCode) => {
    try {
      const resp = await fetch(`${API_BASE_URL}/profile/${userId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ language_pref: langCode })
      });
      if (resp.ok) {
        const updatedProfile = await resp.json();
        setProfile(updatedProfile);
        return updatedProfile;
      }
    } catch (err) {
      console.error("Failed to update language preference:", err);
    }
    return null;
  };

  return { 
    profile, 
    loading, 
    error, 
    logTrackPlayed, 
    updateTasteProfile, 
    updateLanguagePref,
    fetchProfile, 
    userId 
  };
}
export default useTasteProfile;
