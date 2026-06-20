import { useCallback } from 'react';

const CALIBRATION_SERVICE_URL = import.meta.env.VITE_CALIBRATION_SERVICE_URL || 'http://localhost:8001';

export function useEssentia() {
  const analyzeTrack = useCallback(async (trackId, streamUrl) => {
    if (!trackId || !streamUrl) return;
    
    // Extract youtube_id from the stream URL
    const parts = streamUrl.split('/');
    const youtubeId = parts[parts.length - 1];
    
    console.log(`[useEssentia] Offloading calibration for track ${trackId} (youtubeId: ${youtubeId}) to calibration service...`);
    
    try {
      const response = await fetch(`${CALIBRATION_SERVICE_URL}/calibrate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ trackId, youtubeId })
      });
      
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `Calibration service returned status ${response.status}`);
      }
      
      const data = await response.json();
      console.log(`[useEssentia] Calibration success for track ${trackId}:`, data.features);
      return data.features;
    } catch (err) {
      console.error(`[useEssentia] Calibration failed for track ${trackId}:`, err);
      throw err;
    }
  }, []);

  return { analyzeTrack };
}

export default useEssentia;

