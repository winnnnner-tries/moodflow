import { useCallback, useRef } from 'react';

const CALIBRATION_SERVICE_URL = import.meta.env.VITE_CALIBRATION_SERVICE_URL || 'http://localhost:8001';

export function useEssentia() {
  const abortControllerRef = useRef(null);

  const abortCalibration = useCallback(() => {
    if (abortControllerRef.current) {
      console.log("[useEssentia] Aborting active calibration request...");
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  }, []);

  const analyzeTrack = useCallback(async (trackId, streamUrl, customSignal = null) => {
    if (!trackId || !streamUrl) return;
    
    // If not using a custom signal, manage the internal player abort controller
    let signal;
    if (customSignal) {
      signal = customSignal;
    } else {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      abortControllerRef.current = new AbortController();
      signal = abortControllerRef.current.signal;
    }
    
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
        body: JSON.stringify({ trackId, youtubeId }),
        signal: signal
      });
      
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `Calibration service returned status ${response.status}`);
      }
      
      const data = await response.json();
      console.log(`[useEssentia] Calibration success for track ${trackId}:`, data.features);
      return data.features;
    } catch (err) {
      if (err.name === 'AbortError') {
        console.log(`[useEssentia] Calibration for track ${trackId} was aborted.`);
      } else {
        console.error(`[useEssentia] Calibration failed for track ${trackId}:`, err);
      }
      throw err;
    } finally {
      if (!customSignal && abortControllerRef.current?.signal === signal) {
        abortControllerRef.current = null;
      }
    }
  }, []);

  return { analyzeTrack, abortCalibration };
}

export default useEssentia;

