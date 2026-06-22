import React, { useState, useEffect, useRef } from 'react';
import FeedScreen from './components/FeedScreen';
import PlayerScreen from './components/PlayerScreen';
import AudioEffects from './components/AudioEffects';
import UpNextQueue from './components/UpNextQueue';

// Hooks
import useAudioPlayer from './hooks/useAudioPlayer';
import useTasteProfile from './hooks/useTasteProfile';
import useEssentia from './hooks/useEssentia';
import useInnertube from './hooks/useInnertube';
import { supabase } from './lib/supabase';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

const formatTime = (secs) => {
  if (isNaN(secs) || !isFinite(secs)) return '0:00';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
};

export function App() {
  const [screen, setScreen] = useState('feed'); // 'feed' | 'player'
  const [queue, setQueue] = useState([]);
  const [currentTrackIndex, setCurrentTrackIndex] = useState(-1);
  const currentTrack = currentTrackIndex >= 0 && currentTrackIndex < queue.length ? queue[currentTrackIndex] : null;
  const [playbackError, setPlaybackError] = useState(null);

  // Drawers visibility states
  const [isEffectsOpen, setIsEffectsOpen] = useState(false);
  const [isQueueOpen, setIsQueueOpen] = useState(false);

  // Sleep Timer states
  const [sleepTime, setSleepTime] = useState(0); // minutes
  const [sleepRemaining, setSleepRemaining] = useState(0); // seconds
  const sleepTimerRef = useRef(null);

  // Toast state
  const [toast, setToast] = useState(null);

  // Profile update tracking for current track
  const hasLoggedProfileUpdateRef = useRef(false);

  // Consecutive skip failure counter to prevent infinite loop
  const consecutiveFailsRef = useRef(0);
  const MAX_CONSECUTIVE_FAILS = 3;

  // Custom Hooks
  const { 
    play, 
    pause, 
    seek, 
    setReverb, 
    setPitch, 
    setBassBoost, 
    set8D, 
    setSpeed, 
    setVolume,
    volume,
    currentTime,
    duration,
    isPlaying,
    effects,
    audioElement,
    preloadTrack
  } = useAudioPlayer();

  const { 
    profile, 
    userId, 
    logTrackPlayed, 
    updateTasteProfile,
    updateLanguagePref
  } = useTasteProfile();

  const { analyzeTrack, abortCalibration } = useEssentia();
  const { searchTrack, searchTracks, getStreamUrl, loading: innertubeLoading } = useInnertube();

  // Background Calibration states
  const [calibrationQueue, setCalibrationQueue] = useState([]);
  const [calibrationProgress, setCalibrationProgress] = useState({ current: 0, total: 0 });
  const [isCalibratingActive, setIsCalibratingActive] = useState(false);
  const isCalibratingRef = useRef(false);
  const [isAutoCalibrationMode, setIsAutoCalibrationMode] = useState(false);
  const [isPlayerFetching, setIsPlayerFetching] = useState(false);

  // Ref to track the last preloaded youtube_id natively
  const lastPreloadedYtIdRef = useRef(null);

  // Draggable Calibration Pill States & Pointer Events Handlers
  const [pillPosition, setPillPosition] = useState({ x: 0, y: 0 });
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0 });

  const handlePointerDown = (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    isDraggingRef.current = true;
    dragStartRef.current = {
      x: e.clientX - pillPosition.x,
      y: e.clientY - pillPosition.y
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e) => {
    if (!isDraggingRef.current) return;
    const newX = e.clientX - dragStartRef.current.x;
    const newY = e.clientY - dragStartRef.current.y;
    setPillPosition({ x: newX, y: newY });
  };

  const handlePointerUp = (e) => {
    isDraggingRef.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  // Toggle handler for auto calibration mode
  const handleToggleAutoCalibration = () => {
    setIsAutoCalibrationMode(!isAutoCalibrationMode);
  };

  // Play/pause sync calibration handler
  useEffect(() => {
    // Only calibrate playing track on-demand when Auto-Calibration is OFF
    if (isAutoCalibrationMode) return;

    if (isPlaying && currentTrack) {
      const isPlaceholder = currentTrack.energy === 0.5 && currentTrack.danceability === 0.5 && currentTrack.valence === 0.5;
      if (currentTrack.energy === null || currentTrack.energy === undefined || isPlaceholder) {
        console.log(`[Calibration] Playback active. Triggering background Essentia analysis for "${currentTrack.track_name}"...`);
        const streamUrl = `${API_BASE_URL}/stream/${currentTrack.youtube_id}`;
        analyzeTrack(currentTrack.id, streamUrl);
      }
    } else {
      // Abort active player calibration if song is paused/changed
      abortCalibration();
    }
  }, [isPlaying, currentTrack, isAutoCalibrationMode, analyzeTrack, abortCalibration]);

  // Background Loop 1: Fetch uncalibrated tracks when Auto-Calibration mode is enabled
  useEffect(() => {
    if (!isAutoCalibrationMode) {
      setCalibrationQueue([]);
      setCalibrationProgress({ current: 0, total: 0 });
      return;
    }

    const fetchUncalibratedTracks = async () => {
      try {
        console.log("[Calibration] Scanning database for uncalibrated tracks...");
        
        // Fetch count
        const { count, error: countError } = await supabase
          .from('tracks')
          .select('*', { count: 'exact', head: true })
          .eq('energy', 0.5)
          .eq('danceability', 0.5)
          .eq('valence', 0.5)
          .eq('tempo', 0.5)
          .eq('acousticness', 0.5);

        if (countError) throw countError;
        
        console.log(`[Calibration] Found total ${count} uncalibrated tracks in database.`);

        // Fetch first batch of 50 tracks
        const { data, error } = await supabase
          .from('tracks')
          .select('*')
          .eq('energy', 0.5)
          .eq('danceability', 0.5)
          .eq('valence', 0.5)
          .eq('tempo', 0.5)
          .eq('acousticness', 0.5)
          .order('created_at', { ascending: false })
          .limit(50);

        if (error) throw error;
        
        if (data && data.length > 0) {
          setCalibrationQueue(data);
          setCalibrationProgress({ current: 0, total: count || data.length });
        } else {
          setToast({
            id: Date.now(),
            message: "All tracks are already calibrated!"
          });
          setIsAutoCalibrationMode(false);
        }
      } catch (err) {
        console.error("[Calibration] Error fetching uncalibrated tracks:", err);
      }
    };

    fetchUncalibratedTracks();
  }, [isAutoCalibrationMode]);

  // Background Loop 2: Fetch next batch when local queue runs low during Auto-Calibration
  useEffect(() => {
    if (!isAutoCalibrationMode) return;
    
    const remainingToCalibrate = calibrationProgress.total - calibrationProgress.current;
    if (calibrationQueue.length < 5 && remainingToCalibrate > calibrationQueue.length) {
      const fetchNextBatch = async () => {
        try {
          console.log("[Calibration] Local queue running low. Fetching next batch...");
          const { data, error } = await supabase
            .from('tracks')
            .select('*')
            .eq('energy', 0.5)
            .eq('danceability', 0.5)
            .eq('valence', 0.5)
            .eq('tempo', 0.5)
            .eq('acousticness', 0.5)
            .order('created_at', { ascending: false })
            .limit(50);
          
          if (error) throw error;
          if (data && data.length > 0) {
            setCalibrationQueue(prev => {
              const existingIds = new Set(prev.map(t => t.id));
              const newTracks = data.filter(t => !existingIds.has(t.id));
              return [...prev, ...newTracks];
            });
          }
        } catch (err) {
          console.error("[Calibration] Error fetching next batch:", err);
        }
      };
      
      fetchNextBatch();
    }
  }, [calibrationQueue.length, calibrationProgress.total, calibrationProgress.current, isAutoCalibrationMode]);

  // Background Loop 3: Process calibration queue sequentially when Auto-Calibration mode is active
  useEffect(() => {
    if (!isAutoCalibrationMode || calibrationQueue.length === 0 || isCalibratingRef.current || isPlayerFetching) {
      setIsCalibratingActive(isCalibratingRef.current);
      return;
    }

    let isMounted = true;
    const backgroundAbortController = new AbortController();
    const CALIBRATION_SERVICE_URL = import.meta.env.VITE_CALIBRATION_SERVICE_URL || 'http://localhost:8001';
    
    const processNext = async () => {
      if (isCalibratingRef.current || !isAutoCalibrationMode || isPlayerFetching) return;
      isCalibratingRef.current = true;
      setIsCalibratingActive(true);

      const track = calibrationQueue[0];
      console.log(`[Calibration Loop] Starting for: "${track.track_name}" (ID: ${track.id})`);

      try {
        let youtube_id = track.youtube_id;
        if (!youtube_id) {
          const resolved = await searchTrack(`${track.track_name} ${track.artist}`);
          if (resolved && resolved.youtube_id) {
            youtube_id = resolved.youtube_id;
          }
        }

        if (youtube_id && isMounted && isAutoCalibrationMode && !isPlayerFetching) {
          const streamUrl = `${API_BASE_URL}/stream/${youtube_id}`;
          
          const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error("Audio analysis timed out")), 120000)
          );
          
          const analyzePromise = (async () => {
            const response = await fetch(`${CALIBRATION_SERVICE_URL}/calibrate`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ trackId: track.id, youtubeId: youtube_id }),
              signal: backgroundAbortController.signal
            });
            if (!response.ok) throw new Error(`Calibration returned status ${response.status}`);
            return response.json();
          })();

          await Promise.race([
            analyzePromise,
            timeoutPromise
          ]);
          
          console.log(`[Calibration Loop] Done processing: "${track.track_name}"`);
        }
      } catch (err) {
        if (err.name === 'AbortError') {
          console.log(`[Calibration Loop] Aborted processing for "${track.track_name}".`);
          return; // Stop processing further if aborted
        }
        console.error(`[Calibration Loop] Error processing track "${track.track_name}":`, err.message || err);
        
        // Mark as failed/processed with minor offset in DB to prevent infinite retry loops
        try {
          if (isMounted && isAutoCalibrationMode && !isPlayerFetching) {
            await fetch(`${API_BASE_URL}/tracks/${track.id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                energy: 0.5001,
                danceability: 0.5001,
                valence: 0.5001,
                tempo: 0.5001,
                acousticness: 0.5001
              })
            });
          }
        } catch (patchErr) {
          console.error("[Calibration Loop] Failed to mark track in DB:", patchErr);
        }
      } finally {
        if (isMounted && isAutoCalibrationMode) {
          isCalibratingRef.current = false;
          setIsCalibratingActive(false);
          setCalibrationQueue(prev => prev.slice(1));
          setCalibrationProgress(prev => ({ ...prev, current: prev.current + 1 }));
        }
      }
    };

    const timer = setTimeout(() => {
      processNext();
    }, 2000);

    return () => {
      isMounted = false;
      clearTimeout(timer);
      backgroundAbortController.abort();
      isCalibratingRef.current = false;
      setIsCalibratingActive(false);
    };
  }, [calibrationQueue, isAutoCalibrationMode, isPlayerFetching]);

  // Compute effective duration: prefer audio element duration if valid, else fallback to track metadata
  const effectiveDuration = (() => {
    if (duration && isFinite(duration) && duration > 0) {
      return duration;
    }
    if (currentTrack && currentTrack.duration_ms) {
      return currentTrack.duration_ms / 1000;
    }
    return 0;
  })();

  // Handle auto-play next track when current ends
  useEffect(() => {
    if (!audioElement) return;

    const handleSongEnded = () => {
      consecutiveFailsRef.current = 0; // Song completed successfully, reset counter
      handleNext();
    };

    audioElement.addEventListener('ended', handleSongEnded);
    return () => {
      audioElement.removeEventListener('ended', handleSongEnded);
    };
  }, [audioElement, currentTrackIndex, queue]);



  // Track progress to trigger taste profile updates and play log (>80% listened)
  useEffect(() => {
    if (!currentTrack || effectiveDuration <= 0 || hasLoggedProfileUpdateRef.current) return;

    const progressRatio = currentTime / effectiveDuration;
    if (progressRatio >= 0.8) {
      hasLoggedProfileUpdateRef.current = true;
      console.log(`Song completed >80% (${Math.round(progressRatio*100)}%). Updating profile & logging history.`);
      
      // Update User Taste Profile rolling average in DB
      updateTasteProfile(currentTrack);
      
      // Log completed play history row in DB
      logTrackPlayed(currentTrack.id, true);
    }
  }, [currentTime, effectiveDuration, currentTrack]);

  // Sleep Timer countdown implementation
  useEffect(() => {
    if (sleepTime > 0) {
      setSleepRemaining(sleepTime * 60);
      
      if (sleepTimerRef.current) clearInterval(sleepTimerRef.current);
      
      sleepTimerRef.current = setInterval(() => {
        setSleepRemaining((prev) => {
          if (prev <= 1) {
            clearInterval(sleepTimerRef.current);
            pause();
            setSleepTime(0);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } else {
      if (sleepTimerRef.current) clearInterval(sleepTimerRef.current);
      setSleepRemaining(0);
    }

    return () => {
      if (sleepTimerRef.current) clearInterval(sleepTimerRef.current);
    };
  }, [sleepTime]);

  // Pre-resolve the stream URL of the next track in the queue to enable instant transition
  useEffect(() => {
    if (!currentTrack || currentTrackIndex === -1 || queue.length <= 1) return;
    
    const nextIdx = (currentTrackIndex + 1) % queue.length;
    const nextTrack = queue[nextIdx];
    if (!nextTrack || !nextTrack.youtube_id) return;
    
    const timer = setTimeout(async () => {
      try {
        console.log(`[Pre-resolve] Background resolving next song: "${nextTrack.track_name}"`);
        await fetch(`${API_BASE_URL}/stream/${nextTrack.youtube_id}`);
        console.log(`[Pre-resolve] Next song resolved and cached successfully: "${nextTrack.track_name}"`);
      } catch (err) {
        console.log("[Pre-resolve] Failed to pre-resolve next track:", err);
      }
    }, 4000);
    
    return () => clearTimeout(timer);
  }, [currentTrackIndex, queue, currentTrack]);

  // Update ambient background colors based on current track audio features
  useEffect(() => {
    if (currentTrack) {
      const energy = currentTrack.energy ?? 0.5;
      const valence = currentTrack.valence ?? 0.5;
      
      const r1 = Math.round(100 + energy * 155);
      const g1 = Math.round(40 + (1 - valence) * 80);
      const b1 = Math.round(180 + valence * 75);

      const r2 = Math.round(30 + valence * 220);
      const g2 = Math.round(60 + energy * 100);
      const b2 = Math.round(100 + (1 - energy) * 155);

      document.documentElement.style.setProperty('--mood-color-1', `${r1}, ${g1}, ${b1}`);
      document.documentElement.style.setProperty('--mood-color-2', `${r2}, ${g2}, ${b2}`);
    }
  }, [currentTrack]);

  // Preload the next track's audio natively via the inactive player element 25 seconds before the current track ends
  useEffect(() => {
    if (!currentTrack || duration <= 0 || queue.length <= 1 || currentTrackIndex === -1) return;
    
    const nextIdx = (currentTrackIndex + 1) % queue.length;
    const nextTrack = queue[nextIdx];
    if (!nextTrack || !nextTrack.youtube_id) return;

    // Trigger native preload when 25 seconds remain in the current song
    if (currentTime >= duration - 25) {
      if (lastPreloadedYtIdRef.current === nextTrack.youtube_id) return;
      
      lastPreloadedYtIdRef.current = nextTrack.youtube_id;
      const preloadUrl = `${API_BASE_URL}/stream/${nextTrack.youtube_id}`;
      console.log(`[DoublePlayer Preload] Preloading next song "${nextTrack.track_name}" natively via inactive audio element...`);
      preloadTrack(preloadUrl);
    }
  }, [currentTime, duration, currentTrackIndex, queue, currentTrack, preloadTrack]);

  const loadAndPlayTrack = async (track, index, customQueue = null) => {
    setPlaybackError(null);
    hasLoggedProfileUpdateRef.current = false;
    
    try {
      setIsPlayerFetching(true);
      let activeTrack = { ...track };
      const currentActiveQueue = customQueue || queue;
      
      // 0. If track doesn't have a database ID, register it first
      if (!activeTrack.id) {
        try {
          console.log(`Registering missing track in DB: ${activeTrack.track_name} by ${activeTrack.artist}`);
          const regResponse = await fetch(`${API_BASE_URL}/tracks`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              track_name: activeTrack.track_name,
              artist: activeTrack.artist,
              album: activeTrack.album,
              youtube_id: activeTrack.youtube_id,
              thumbnail_url: activeTrack.thumbnail_url,
              duration_ms: activeTrack.duration_ms,
              language: activeTrack.language || 'en',
              explicit: activeTrack.explicit
            })
          });
          if (regResponse.ok) {
            const dbTrack = await regResponse.json();
            activeTrack = { ...activeTrack, ...dbTrack };
            
            // Update the item in our queue in place if index is valid
            if (index >= 0 && index < currentActiveQueue.length) {
              const updatedQueue = [...currentActiveQueue];
              updatedQueue[index] = activeTrack;
              setQueue(updatedQueue);
            }
          }
        } catch (err) {
          console.error("Failed to dynamically register track on play:", err);
        }
      }

      // Log immediately that play started (completed=false)
      if (activeTrack.id) {
        logTrackPlayed(activeTrack.id, false);
      }
      
      // 1. If youtube_id is null (e.g. static Kaggle song), resolve it first via search
      if (!activeTrack.youtube_id) {
        console.log(`Resolving youtube_id for: ${activeTrack.track_name} by ${activeTrack.artist}`);
        const resolved = await searchTrack(`${activeTrack.track_name} ${activeTrack.artist}`);
        if (!resolved || !resolved.youtube_id) {
          throw new Error("Could not find matching video on YouTube Music.");
        }
        // Merge resolved data into our track, keeping DB fields like id
        activeTrack = { ...activeTrack, ...resolved };
        
        // Update the item in our queue in place
        if (index >= 0 && index < currentActiveQueue.length) {
          const updatedQueue = [...currentActiveQueue];
          updatedQueue[index] = activeTrack;
          setQueue(updatedQueue);
        }
      }

      // 2. Direct proxy url on localhost:8000 to avoid CORS
      const streamUrl = `${API_BASE_URL}/stream/${activeTrack.youtube_id}`;

      // 3. Start audio element playback
      await play(streamUrl);

      // Reset consecutive failure counter on success
      consecutiveFailsRef.current = 0;
      setIsPlayerFetching(false);

    } catch (err) {
      setIsPlayerFetching(false);
      if (err.name === "AbortError" || err.message?.includes("interrupted by a call to pause")) {
        console.log("Play request was safely aborted/interrupted.");
        return;
      }
      console.error("loadAndPlayTrack failed:", err);
      setPlaybackError(err.message || "Failed to stream audio.");
      
      // Increment consecutive fail counter
      consecutiveFailsRef.current += 1;
      
      // Only auto-skip if we haven't hit the limit
      if (consecutiveFailsRef.current < MAX_CONSECUTIVE_FAILS) {
        setTimeout(() => {
          handleNext();
        }, 3000);
      } else {
        console.warn("Too many consecutive failures. Stopping auto-skip.");
        setPlaybackError("Multiple songs failed to load. Please try a different song or check your connection.");
      }
    }
  };

  const preResolvedTracksRef = useRef(new Set());
  const handleTrackHover = useCallback((track) => {
    if (!track || !track.youtube_id) return;
    const ytId = track.youtube_id;
    if (preResolvedTracksRef.current.has(ytId)) return;
    
    preResolvedTracksRef.current.add(ytId);
    console.log(`[Hover Pre-resolve] Warming up backend stream cache for: "${track.track_name}"`);
    fetch(`${API_BASE_URL}/stream/${ytId}`).catch(err => {
      console.warn("[Hover Pre-resolve] Failed to pre-resolve:", err);
      preResolvedTracksRef.current.delete(ytId);
    });
  }, []);

  const handleSelectTrack = (track, tracksList, index) => {
    consecutiveFailsRef.current = 0; // User action resets fail counter
    
    // If we clicked a song card on feed with a feed list
    if (tracksList) {
      setQueue(tracksList);
      setCurrentTrackIndex(index);
      loadAndPlayTrack(track, index, tracksList);
      setScreen('player');
    } else {
      // If we clicked the mini-player or direct track from search
      let idx = queue.findIndex(t => t.id === track.id);
      if (idx === -1) {
        const newQueue = [...queue];
        newQueue.splice(currentTrackIndex + 1, 0, track);
        setQueue(newQueue);
        idx = currentTrackIndex + 1;
      }
      setCurrentTrackIndex(idx);
      if (idx !== currentTrackIndex) {
        loadAndPlayTrack(track, idx);
      }
      setScreen('player');
    }
  };

  const handleSelectSearchTrack = async (searchTrackItem) => {
    consecutiveFailsRef.current = 0; // User action resets fail counter
    
    try {
      const response = await fetch(`${API_BASE_URL}/tracks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          track_name: searchTrackItem.track_name,
          artist: searchTrackItem.artist,
          album: searchTrackItem.album,
          youtube_id: searchTrackItem.youtube_id,
          thumbnail_url: searchTrackItem.thumbnail_url,
          duration_ms: searchTrackItem.duration_ms,
          language: searchTrackItem.language || 'en',
          explicit: searchTrackItem.explicit
        })
      });
      if (!response.ok) throw new Error("Failed to register search track.");
      const dbTrack = await response.json();
      
      handleSelectTrack(dbTrack, null, -1);
    } catch (err) {
      console.error("handleSelectSearchTrack failed:", err);
      setPlaybackError("Failed to load search result: " + err.message);
    }
  };

  const handlePlayTrackFromQueue = (index) => {
    consecutiveFailsRef.current = 0;
    setCurrentTrackIndex(index);
    loadAndPlayTrack(queue[index], index);
    setIsQueueOpen(false);
  };

  const handleNext = () => {
    if (queue.length <= 1) {
      setToast({
        id: Date.now(),
        message: "Add songs to play next!"
      });
      return;
    }
    const nextIdx = (currentTrackIndex + 1) % queue.length;
    setCurrentTrackIndex(nextIdx);
    loadAndPlayTrack(queue[nextIdx], nextIdx);
  };

  const handlePrevious = () => {
    if (queue.length <= 1) {
      setToast({
        id: Date.now(),
        message: "Add songs to play next!"
      });
      return;
    }
    consecutiveFailsRef.current = 0;
    const prevIdx = (currentTrackIndex - 1 + queue.length) % queue.length;
    setCurrentTrackIndex(prevIdx);
    loadAndPlayTrack(queue[prevIdx], prevIdx);
  };

  const handleReorderQueue = (sourceIdx, targetIdx) => {
    const newQueue = [...queue];
    const [moved] = newQueue.splice(sourceIdx, 1);
    newQueue.splice(targetIdx, 0, moved);
    setQueue(newQueue);
    
    // Maintain correct pointer to current track
    if (currentTrackIndex === sourceIdx) {
      setCurrentTrackIndex(targetIdx);
    } else if (currentTrackIndex > sourceIdx && currentTrackIndex <= targetIdx) {
      setCurrentTrackIndex(currentTrackIndex - 1);
    } else if (currentTrackIndex < sourceIdx && currentTrackIndex >= targetIdx) {
      setCurrentTrackIndex(currentTrackIndex + 1);
    }
  };

  const handleRemoveFromQueue = (index) => {
    if (index === currentTrackIndex) {
      handleNext();
    }
    const newQueue = queue.filter((_, idx) => idx !== index);
    setQueue(newQueue);
    
    if (index < currentTrackIndex) {
      setCurrentTrackIndex(currentTrackIndex - 1);
    }
  };

  const handlePlayNext = (track) => {
    if (queue.length === 0 || currentTrackIndex === -1) {
      setQueue([track]);
      setCurrentTrackIndex(0);
      loadAndPlayTrack(track, 0);
    } else {
      const newQueue = [...queue];
      newQueue.splice(currentTrackIndex + 1, 0, track);
      setQueue(newQueue);
    }
    setToast({
      id: Date.now(),
      message: `"${track.track_name}" will play next`
    });
  };

  const handleAddToQueue = (track) => {
    if (queue.length === 0 || currentTrackIndex === -1) {
      setQueue([track]);
      setCurrentTrackIndex(0);
      loadAndPlayTrack(track, 0);
    } else {
      const newQueue = [...queue];
      newQueue.push(track);
      setQueue(newQueue);
    }
    setToast({
      id: Date.now(),
      message: `Added "${track.track_name}" to queue`
    });
  };

  // Keep a stable ref of loadAndPlayTrack to prevent hook dependency churn
  const loadAndPlayTrackRef = useRef(loadAndPlayTrack);
  useEffect(() => {
    loadAndPlayTrackRef.current = loadAndPlayTrack;
  });

  // Handle asynchronous playback/decoding errors from the audio element
  useEffect(() => {
    if (!audioElement) return;

    const handleAudioError = () => {
      const err = audioElement.error;
      console.error("[AudioElement] Asynchronous error event:", err);
      
      let msg = "Failed to load audio stream.";
      if (err) {
        if (err.code === 1) msg = "Playback aborted by user/system.";
        else if (err.code === 2) msg = "Network error while downloading audio.";
        else if (err.code === 3) msg = "Audio decoding failed (unsupported format).";
        else if (err.code === 4) msg = "Audio stream not supported or blocked.";
        if (err.message) msg += ` (${err.message})`;
      }
      
      setPlaybackError(msg);
      setIsPlayerFetching(false);

      consecutiveFailsRef.current += 1;
      if (consecutiveFailsRef.current >= 3) {
        console.log("Too many consecutive failures. Stopping auto-skip.");
        return;
      }

      // Automatically skip to the next track after a short delay
      if (queue.length > 1 && currentTrackIndex !== -1) {
        const nextIdx = (currentTrackIndex + 1) % queue.length;
        if (nextIdx !== currentTrackIndex) {
          console.log(`Skipping to next track at index ${nextIdx} due to async audio error...`);
          setTimeout(() => {
            if (loadAndPlayTrackRef.current) {
              loadAndPlayTrackRef.current(queue[nextIdx], nextIdx);
            }
          }, 1500);
        }
      }
    };

    audioElement.addEventListener('error', handleAudioError);
    return () => {
      audioElement.removeEventListener('error', handleAudioError);
    };
  }, [audioElement, currentTrackIndex, queue]);

  // Sync Media Session API metadata for OS-level music controls
  useEffect(() => {
    if (!currentTrack || !('mediaSession' in navigator)) return;

    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: currentTrack.track_name,
        artist: currentTrack.artist,
        album: currentTrack.album || 'MoodFlow',
        artwork: [
          { 
            src: currentTrack.thumbnail_url || `https://i.ytimg.com/vi/${currentTrack.youtube_id}/mqdefault.jpg`, 
            sizes: '512x512', 
            type: 'image/jpeg' 
          }
        ]
      });
    } catch (e) {
      console.warn("Failed to set MediaSession metadata:", e);
    }
  }, [currentTrack]);

  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
  }, [isPlaying]);

  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    
    try {
      navigator.mediaSession.setActionHandler('play', play);
      navigator.mediaSession.setActionHandler('pause', pause);
      navigator.mediaSession.setActionHandler('previoustrack', handlePrevious);
      navigator.mediaSession.setActionHandler('nexttrack', handleNext);
    } catch (e) {
      console.warn("Failed to set MediaSession action handlers:", e);
    }
    
    return () => {
      if (!('mediaSession' in navigator)) return;
      try {
        navigator.mediaSession.setActionHandler('play', null);
        navigator.mediaSession.setActionHandler('pause', null);
        navigator.mediaSession.setActionHandler('previoustrack', null);
        navigator.mediaSession.setActionHandler('nexttrack', null);
      } catch (e) {}
    };
  }, [play, pause, handlePrevious, handleNext]);

  return (
    <div className="app-container">
      <div className="app-layout">
        {/* Navigation Sidebar Dock */}
        <aside className="floating-dock">
          <div className="dock-logo">
            <span className="dock-logo-icon" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg viewBox="0 0 128 128" width="24" height="24" style={{ flexShrink: 0 }}>
                <defs>
                  <linearGradient id="logo-wave-grad" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stop-color="#9a82ff" />
                    <stop offset="50%" stop-color="#d07cf0" />
                    <stop offset="100%" stop-color="#f43f5e" />
                  </linearGradient>
                </defs>
                <path d="M 28 68 C 38 32, 52 32, 64 64 C 76 96, 90 96, 100 60" 
                      fill="none" 
                      stroke="url(#logo-wave-grad)" 
                      strokeWidth="16" 
                      strokeLinecap="round" 
                      strokeLinejoin="round" />
              </svg>
            </span>
            <span className="dock-logo-text">MoodFlow</span>
          </div>
          
          <nav className="dock-nav">
            <button 
              className={`dock-nav-item ${screen === 'feed' ? 'active' : ''}`}
              onClick={() => setScreen('feed')}
              title="Home Feed"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                <polyline points="9 22 9 12 15 12 15 22" />
              </svg>
              <span className="dock-item-label">Home Feed</span>
            </button>
            
            <button 
              className={`dock-nav-item ${screen === 'player' ? 'active' : ''} ${!currentTrack ? 'disabled' : ''}`}
              onClick={() => currentTrack && setScreen('player')}
              title={currentTrack ? "Now Playing" : "No Song Active"}
              disabled={!currentTrack}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <polygon points="10 8 16 12 10 16 10 8" fill="currentColor" />
              </svg>
              <span className="dock-item-label">Now Playing</span>
            </button>

            <button 
              className="dock-nav-item"
              onClick={() => setIsQueueOpen(true)}
              title="Up Next Queue"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="8" y1="6" x2="21" y2="6" />
                <line x1="8" y1="12" x2="21" y2="12" />
                <line x1="8" y1="18" x2="21" y2="18" />
                <line x1="3" y1="6" x2="3.01" y2="6" />
                <line x1="3" y1="12" x2="3.01" y2="12" />
                <line x1="3" y1="18" x2="3.01" y2="18" />
              </svg>
              <span className="dock-item-label">Play Queue</span>
            </button>

            <button 
              className="dock-nav-item"
              onClick={() => setIsEffectsOpen(true)}
              title="Audio Effects"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="4" y1="21" x2="4" y2="14" />
                <line x1="4" y1="10" x2="4" y2="3" />
                <line x1="12" y1="21" x2="12" y2="12" />
                <line x1="12" y1="8" x2="12" y2="3" />
                <line x1="20" y1="21" x2="20" y2="16" />
                <line x1="20" y1="12" x2="20" y2="3" />
                <line x1="1" y1="14" x2="7" y2="14" />
                <line x1="9" y1="8" x2="15" y2="8" />
                <line x1="17" y1="16" x2="23" y2="16" />
              </svg>
              <span className="dock-item-label">Audio Effects</span>
            </button>
          </nav>
          
        </aside>

        <div className="main-content-area">
          <div className="mobile-view-wrapper">
            {screen === 'feed' ? (
              <FeedScreen 
                onSelectTrack={handleSelectTrack}
                onSelectSearchTrack={handleSelectSearchTrack}
                userId={userId}
                tasteProfile={profile}
                updateLanguagePref={updateLanguagePref}
                searchService={searchTracks}
                currentPlayingTrack={currentTrack}
                onPlayNext={handlePlayNext}
                onAddToQueue={handleAddToQueue}
                isAutoCalibrationMode={isAutoCalibrationMode}
                onToggleAutoCalibration={handleToggleAutoCalibration}
                onHoverTrack={handleTrackHover}
              />
            ) : (
              <PlayerScreen 
                track={currentTrack}
                onBack={() => setScreen('feed')}
                isPlaying={isPlaying}
                onTogglePlay={() => isPlaying ? pause() : play()}
                currentTime={currentTime}
                duration={effectiveDuration}
                onSeek={seek}
                onNext={handleNext}
                onPrevious={handlePrevious}
                onOpenEffects={() => setIsEffectsOpen(true)}
                onOpenQueue={() => setIsQueueOpen(true)}
                playbackError={playbackError || (innertubeLoading ? "Loading audio stream..." : null)}
              />
            )}

            {/* Audio Effects Bottom Drawer */}
            <AudioEffects 
              isOpen={isEffectsOpen}
              onClose={() => setIsEffectsOpen(false)}
              effects={effects}
              onPitchChange={setPitch}
              onReverbChange={setReverb}
              onBassBoostToggle={setBassBoost}
              on8DToggle={set8D}
              onSpeedChange={setSpeed}
              sleepTime={sleepTime}
              onSleepTimeChange={setSleepTime}
              sleepRemaining={sleepRemaining}
            />

            {/* Up Next Queue Bottom Drawer */}
            <UpNextQueue 
              isOpen={isQueueOpen}
              onClose={() => setIsQueueOpen(false)}
              queue={queue}
              currentTrackIndex={currentTrackIndex}
              onRemove={handleRemoveFromQueue}
              onReorder={handleReorderQueue}
              onPlayTrack={handlePlayTrackFromQueue}
            />
          </div>
        </div>
      </div>

      {/* Mobile Bottom Dock Bar */}
      <div className="mobile-bottom-dock">
        <button 
          className={`mobile-dock-btn ${screen === 'feed' ? 'active' : ''}`}
          onClick={() => setScreen('feed')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            <polyline points="9 22 9 12 15 12 15 22" />
          </svg>
          <span>Feed</span>
        </button>
        <button 
          className={`mobile-dock-btn ${screen === 'player' ? 'active' : ''} ${!currentTrack ? 'disabled' : ''}`}
          onClick={() => currentTrack && setScreen('player')}
          disabled={!currentTrack}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <polygon points="10 8 16 12 10 16 10 8" fill="currentColor" />
          </svg>
          <span>Player</span>
        </button>
        <button 
          className="mobile-dock-btn"
          onClick={() => setIsQueueOpen(true)}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="8" y1="6" x2="21" y2="6" />
            <line x1="8" y1="12" x2="21" y2="12" />
            <line x1="8" y1="18" x2="21" y2="18" />
            <line x1="3" y1="6" x2="3.01" y2="6" />
            <line x1="3" y1="12" x2="3.01" y2="12" />
            <line x1="3" y1="18" x2="3.01" y2="18" />
          </svg>
          <span>Queue</span>
        </button>
        <button 
          className="mobile-dock-btn"
          onClick={() => setIsEffectsOpen(true)}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="4" y1="21" x2="4" y2="14" />
            <line x1="4" y1="10" x2="4" y2="3" />
            <line x1="12" y1="21" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12" y2="3" />
            <line x1="20" y1="21" x2="20" y2="16" />
            <line x1="20" y1="12" x2="20" y2="3" />
            <line x1="1" y1="14" x2="7" y2="14" />
            <line x1="9" y1="8" x2="15" y2="8" />
            <line x1="17" y1="16" x2="23" y2="16" />
          </svg>
          <span>Effects</span>
        </button>
      </div>

      {/* Dynamic Desktop Bottom Miniplayer */}
      {currentTrack && screen === 'feed' && (
        <div className="bottom-mini-player">
          <div className="mini-player-left" onClick={() => setScreen('player')}>
            <img 
              src={currentTrack.thumbnail_url || `https://i.ytimg.com/vi/${currentTrack.youtube_id}/mqdefault.jpg`} 
              alt="" 
              className="mini-player-thumb"
            />
            <div className="mini-player-info">
              <span className="mini-title">{currentTrack.track_name}</span>
              <span className="mini-artist">{currentTrack.artist}</span>
            </div>
          </div>
          
          <div className="mini-player-center">
            <div className="mini-player-controls-row">
              <button className="mini-ctrl-btn" onClick={handlePrevious} aria-label="Previous">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <polygon points="19 20 9 12 19 4 19 20" />
                  <line x1="5" y1="4" x2="5" y2="20" stroke="currentColor" strokeWidth="2.5" />
                </svg>
              </button>
              
              <button className="mini-ctrl-btn-primary" onClick={() => isPlaying ? pause() : play()} aria-label={isPlaying ? "Pause" : "Play"}>
                {isPlaying ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="#000000">
                    <rect x="6" y="4" width="4" height="16" />
                    <rect x="14" y="4" width="4" height="16" />
                  </svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="#000000" style={{ marginLeft: '2px' }}>
                    <polygon points="8 5 19 12 8 19 8 5" />
                  </svg>
                )}
              </button>
              
              <button className="mini-ctrl-btn" onClick={handleNext} aria-label="Next">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <polygon points="5 4 15 12 5 20 5 4" />
                  <line x1="19" y1="4" x2="19" y2="20" stroke="currentColor" strokeWidth="2.5" />
                </svg>
              </button>
            </div>
            
            <div className="mini-player-progress-row">
              <span className="mini-time-text">{formatTime(currentTime)}</span>
              <input 
                type="range"
                min="0"
                max={effectiveDuration || 100}
                value={currentTime}
                onChange={(e) => seek(parseFloat(e.target.value))}
                className="mini-progress-bar"
                style={{ '--progress-percent': `${effectiveDuration > 0 ? (currentTime / effectiveDuration) * 100 : 0}%` }}
              />
              <span className="mini-time-text">{formatTime(effectiveDuration)}</span>
            </div>
          </div>
          
          <div className="mini-player-right">
            <button className="mini-volume-btn" onClick={() => setVolume(volume > 0 ? 0 : 1)} aria-label="Volume">
              {volume === 0 ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M11 5L6 9H2v6h4l5 4V5z"/>
                  <line x1="23" y1="9" x2="17" y2="15"/>
                  <line x1="17" y1="9" x2="23" y2="15"/>
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M11 5L6 9H2v6h4l5 4V5z"/>
                  <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
                  <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
                </svg>
              )}
            </button>
            <input 
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={volume}
              onChange={(e) => setVolume(parseFloat(e.target.value))}
              className="mini-volume-slider"
            />
            
            <button className="mini-utility-btn" onClick={() => setIsEffectsOpen(true)} aria-label="Effects" title="Audio Effects">
              🎛️
            </button>
            <button className="mini-utility-btn" onClick={() => setIsQueueOpen(true)} aria-label="Queue" title="Queue">
              🎶
            </button>
          </div>
        </div>
      )}

      {/* Timed Toast Notification */}
      {toast && (
        <ToastNotification 
          key={toast.id}
          message={toast.message} 
          onClose={() => setToast(null)} 
        />
      )}

      {/* Global Calibration Progress Overlay */}
      {calibrationProgress.total > 0 && calibrationProgress.current < calibrationProgress.total && (
        <div 
          className="global-calibration-pill movable"
          style={{
            transform: `translate(${pillPosition.x}px, ${pillPosition.y}px)`,
            cursor: isDraggingRef.current ? 'grabbing' : 'grab',
            touchAction: 'none'
          }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        >
          <div className="calibration-spinner-ring"></div>
          <div className="calibration-info">
            <span className="calibration-title">Calibrating Audio Analysis...</span>
            <span className="calibration-subtitle">
              {calibrationProgress.current}/{calibrationProgress.total} • {calibrationQueue[0]?.track_name || 'Processing...'}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// Toast notification component with animated shrink-to-dismiss progress bar
function ToastNotification({ message, duration = 3000, onClose }) {
  useEffect(() => {
    const timer = setTimeout(() => {
      onClose();
    }, duration);
    return () => clearTimeout(timer);
  }, [duration, onClose]);

  return (
    <div className="toast-notification-container">
      <div className="toast-notification">
        <span className="toast-message">{message}</span>
        <div className="toast-progress-bar" style={{ animationDuration: `${duration}ms` }} />
      </div>
    </div>
  );
}

export default App;
