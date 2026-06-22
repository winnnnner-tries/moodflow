import { useState, useEffect, useRef, useCallback } from 'react';

// Create a single global AudioContext and two audio elements for gapless player pool
let audioCtx = null;
let audio1 = null;
let audio2 = null;
let activeAudio = null;
let inactiveAudio = null;
let source1 = null;
let source2 = null;
let preloadedUrl = null;

let gainNode = null;
let reverbNode = null;
let biquadNode = null;
let pannerNode = null;
let wetGain = null;
let dryGain = null;

function initAudioGraph() {
  if (audioCtx) return;

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  audioCtx = new AudioContextClass();
  
  audio1 = new Audio();
  audio1.crossOrigin = "anonymous";
  
  audio2 = new Audio();
  audio2.crossOrigin = "anonymous";
  
  // Set up elements
  source1 = audioCtx.createMediaElementSource(audio1);
  source2 = audioCtx.createMediaElementSource(audio2);
  
  gainNode = audioCtx.createGain();
  reverbNode = audioCtx.createConvolver();
  biquadNode = audioCtx.createBiquadFilter();
  pannerNode = audioCtx.createStereoPanner();
  wetGain = audioCtx.createGain();
  dryGain = audioCtx.createGain();

  // Create simple synthesized impulse response for reverb
  reverbNode.buffer = createImpulseResponse(audioCtx, 2.5, 2.0);

  // Set default settings
  biquadNode.type = "lowshelf";
  biquadNode.frequency.value = 150;
  biquadNode.gain.value = 0;

  wetGain.gain.value = 0.0;
  dryGain.gain.value = 1.0;

  // Connection chain: both sources connect to biquad filter
  source1.connect(biquadNode);
  source2.connect(biquadNode);
  
  // Dry path: biquad -> dryGain -> panner
  biquadNode.connect(dryGain);
  dryGain.connect(pannerNode);
  
  // Wet path: biquad -> reverb -> wetGain -> panner
  biquadNode.connect(reverbNode);
  reverbNode.connect(wetGain);
  wetGain.connect(pannerNode);
  
  // Final: panner -> gain -> destination
  pannerNode.connect(gainNode);
  gainNode.connect(audioCtx.destination);

  // Default references
  activeAudio = audio1;
  inactiveAudio = audio2;
}

function createImpulseResponse(context, duration, decay) {
  const sampleRate = context.sampleRate;
  const length = sampleRate * duration;
  const impulse = context.createBuffer(2, length, sampleRate);
  const left = impulse.getChannelData(0);
  const right = impulse.getChannelData(1);
  for (let i = 0; i < length; i++) {
    const percent = i / length;
    const val = (Math.random() * 2 - 1) * Math.pow(1 - percent, decay);
    left[i] = val;
    right[i] = val;
  }
  return impulse;
}

export function useAudioPlayer() {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1.0);
  
  const [reverb, setReverbState] = useState(0);
  const [pitch, setPitchState] = useState(0);
  const [bassBoost, setBassBoostState] = useState(false);
  const [is8D, setIs8DState] = useState(false);
  const [speed, setSpeedState] = useState(1.0);

  const animationRef = useRef(null);
  const panAngleRef = useRef(0);

  // Expose activeAudio state triggers to force re-render when players swap
  const [, forceUpdate] = useState({});

  useEffect(() => {
    initAudioGraph();

    const handlePlay = (e) => {
      if (e.target === activeAudio) setIsPlaying(true);
    };
    const handlePause = (e) => {
      if (e.target === activeAudio) setIsPlaying(false);
    };
    const handleTimeUpdate = (e) => {
      if (e.target === activeAudio) setCurrentTime(activeAudio.currentTime);
    };
    const handleDurationChange = (e) => {
      if (e.target === activeAudio) {
        const dur = activeAudio.duration;
        if (dur && isFinite(dur) && dur > 0) {
          setDuration(dur);
        }
      }
    };
    const handleLoadedMetadata = (e) => {
      if (e.target === activeAudio) {
        const dur = activeAudio.duration;
        if (dur && isFinite(dur) && dur > 0) {
          setDuration(dur);
        }
      }
    };
    const handleError = (e) => {
      if (e.target === activeAudio) {
        console.error("Audio element error on active track:", activeAudio.error);
      }
    };

    [audio1, audio2].forEach(a => {
      if (a) {
        a.addEventListener('play', handlePlay);
        a.addEventListener('pause', handlePause);
        a.addEventListener('timeupdate', handleTimeUpdate);
        a.addEventListener('durationchange', handleDurationChange);
        a.addEventListener('loadedmetadata', handleLoadedMetadata);
        a.addEventListener('error', handleError);
      }
    });

    return () => {
      [audio1, audio2].forEach(a => {
        if (a) {
          a.removeEventListener('play', handlePlay);
          a.removeEventListener('pause', handlePause);
          a.removeEventListener('timeupdate', handleTimeUpdate);
          a.removeEventListener('durationchange', handleDurationChange);
          a.removeEventListener('loadedmetadata', handleLoadedMetadata);
          a.removeEventListener('error', handleError);
        }
      });
    };
  }, []);

  // 8D Audio spatializer
  useEffect(() => {
    if (is8D && isPlaying) {
      const update8D = () => {
        if (!pannerNode) return;
        panAngleRef.current += 0.02;
        pannerNode.pan.value = Math.sin(panAngleRef.current);
        animationRef.current = requestAnimationFrame(update8D);
      };
      update8D();
    } else {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      if (pannerNode) pannerNode.pan.value = 0;
    }
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [is8D, isPlaying]);

  const preloadTrack = useCallback((streamUrl) => {
    if (!audioCtx) initAudioGraph();
    if (streamUrl) {
      preloadedUrl = streamUrl;
      inactiveAudio.src = streamUrl;
      inactiveAudio.load();
      console.log(`[DoublePlayer] Background preloading next song: ${streamUrl}`);
    }
  }, []);

  const play = async (streamUrl) => {
    if (!audioCtx) initAudioGraph();
    if (audioCtx.state === 'suspended') {
      await audioCtx.resume();
    }
    
    if (streamUrl) {
      // Check if we hit the preloaded player
      if (preloadedUrl && streamUrl === preloadedUrl) {
        console.log("[DoublePlayer] Cache HIT! Swapping players for gapless playback.");
        
        // Pause active audio and mute/stop it
        activeAudio.pause();
        
        // Swap active and inactive players
        const temp = activeAudio;
        activeAudio = inactiveAudio;
        inactiveAudio = temp;
        
        // Reset preloaded status
        preloadedUrl = null;
        forceUpdate({}); // Force re-render to update audioElement bindings
      } else {
        console.log("[DoublePlayer] Cache MISS. Loading track on active audio.");
        setDuration(0);
        setCurrentTime(0);
        activeAudio.src = streamUrl;
        activeAudio.load();
      }
    }
    
    try {
      // Re-apply speed and pitch parameters to active audio element
      const ratio = Math.pow(2, pitch / 12);
      activeAudio.preservesPitch = pitch === 0;
      activeAudio.playbackRate = speed * ratio;
      
      await activeAudio.play();
      setIsPlaying(true);
      
      // Update durations/metadata sync
      setCurrentTime(activeAudio.currentTime);
      if (activeAudio.duration) setDuration(activeAudio.duration);
    } catch (err) {
      console.error("Playback failed:", err);
      throw err;
    }
  };

  const pause = () => {
    if (activeAudio) {
      activeAudio.pause();
      setIsPlaying(false);
    }
  };

  const seek = (seconds) => {
    if (activeAudio) {
      activeAudio.currentTime = seconds;
      setCurrentTime(seconds);
    }
  };

  const setReverb = (val) => {
    setReverbState(val);
    if (wetGain && dryGain) {
      wetGain.gain.setValueAtTime(val * 0.7, audioCtx.currentTime);
      dryGain.gain.setValueAtTime(1.0 - (val * 0.3), audioCtx.currentTime);
    }
  };

  const setPitch = (semitones) => {
    setPitchState(semitones);
    if (!activeAudio) return;
    const ratio = Math.pow(2, semitones / 12);
    activeAudio.preservesPitch = semitones === 0;
    activeAudio.playbackRate = speed * ratio;
  };

  const setBassBoost = (enabled) => {
    setBassBoostState(enabled);
    if (biquadNode) {
      biquadNode.gain.setValueAtTime(enabled ? 15 : 0, audioCtx.currentTime);
    }
  };

  const set8D = (enabled) => {
    setIs8DState(enabled);
  };

  const setSpeed = (rate) => {
    setSpeedState(rate);
    if (!activeAudio) return;
    const ratio = Math.pow(2, pitch / 12);
    activeAudio.playbackRate = rate * ratio;
  };

  const changeVolume = (val) => {
    setVolume(val);
    if (gainNode) {
      gainNode.gain.setValueAtTime(val, activeAudio ? activeAudio.context?.currentTime || audioCtx.currentTime : audioCtx.currentTime);
    }
    if (audio1) audio1.volume = val;
    if (audio2) audio2.volume = val;
  };

  return {
    play,
    pause,
    seek,
    setReverb,
    setPitch,
    setBassBoost,
    set8D,
    setSpeed,
    setVolume: changeVolume,
    preloadTrack,
    volume,
    currentTime,
    duration,
    isPlaying,
    effects: { reverb, pitch, bassBoost, is8D, speed },
    audioElement: activeAudio
  };
}
export default useAudioPlayer;
