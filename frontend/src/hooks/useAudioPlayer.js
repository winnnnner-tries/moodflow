import { useState, useEffect, useRef, useCallback } from 'react';

// Create a single global AudioContext to avoid initialization issues
let audioCtx = null;
let audio = null;
let source = null;
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
  
  audio = new Audio();
  audio.crossOrigin = "anonymous";
  
  // Set up elements
  source = audioCtx.createMediaElementSource(audio);
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

  // Connection chain: source -> biquad
  source.connect(biquadNode);
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

  useEffect(() => {
    initAudioGraph();

    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);
    const handleTimeUpdate = () => {
      if (audio) setCurrentTime(audio.currentTime);
    };
    const handleDurationChange = () => {
      const dur = audio.duration;
      if (dur && isFinite(dur) && dur > 0) {
        setDuration(dur);
      }
    };
    const handleLoadedMetadata = () => {
      const dur = audio.duration;
      if (dur && isFinite(dur) && dur > 0) {
        setDuration(dur);
      }
    };
    const handleError = (e) => {
      console.error("Audio element error:", audio.error);
    };

    audio.addEventListener('play', handlePlay);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('durationchange', handleDurationChange);
    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('error', handleError);

    return () => {
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('pause', handlePause);
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('durationchange', handleDurationChange);
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('error', handleError);
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

  const play = async (streamUrl) => {
    if (!audioCtx) initAudioGraph();
    if (audioCtx.state === 'suspended') {
      await audioCtx.resume();
    }
    if (streamUrl) {
      setDuration(0);
      setCurrentTime(0);
      audio.src = streamUrl;
      audio.load(); // Force reload with new src
    }
    try {
      await audio.play();
      setIsPlaying(true);
    } catch (err) {
      console.error("Playback failed:", err);
      throw err; // Re-throw so loadAndPlayTrack can catch it
    }
  };

  const pause = () => {
    if (audio) {
      audio.pause();
      setIsPlaying(false);
    }
  };

  const seek = (seconds) => {
    if (audio) {
      audio.currentTime = seconds;
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
    if (!audio) return;
    const ratio = Math.pow(2, semitones / 12);
    audio.preservesPitch = false;
    audio.playbackRate = speed * ratio;
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
    if (!audio) return;
    const ratio = Math.pow(2, pitch / 12);
    audio.playbackRate = rate * ratio;
  };

  const changeVolume = (val) => {
    setVolume(val);
    if (gainNode) {
      gainNode.gain.setValueAtTime(val, audioCtx.currentTime);
    }
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
    setVolume,
    volume,
    currentTime,
    duration,
    isPlaying,
    effects: { reverb, pitch, bassBoost, is8D, speed },
    audioElement: audio
  };
}
export default useAudioPlayer;
