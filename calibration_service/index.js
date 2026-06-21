import express from 'express';
import cors from 'cors';
import axios from 'axios';
import essentiaJs from 'essentia.js';
import decode from 'audio-decode';

const { Essentia, EssentiaWASM } = essentiaJs;
const essentia = new Essentia(EssentiaWASM);

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const API_BASE_URL = process.env.API_BASE_URL || process.env.VITE_API_BASE_URL || 'http://localhost:8000';

app.post('/calibrate', async (req, res) => {
  const { trackId, youtubeId } = req.body;
  
  if (!trackId || !youtubeId) {
    return res.status(400).json({ error: 'Missing trackId or youtubeId' });
  }

  const streamUrl = `${API_BASE_URL}/stream/${youtubeId}`;
  
  console.log(`[Calibration] Calibrating track ${trackId} (youtubeId: ${youtubeId})...`);
  
  const sendLog = async (level, message, error = null) => {
    try {
      await axios.post(`${API_BASE_URL}/log`, { level, message, error });
    } catch (e) {}
  };

  const cancelTokenSource = axios.CancelToken.source();
  let isAborted = false;

  req.on('close', () => {
    isAborted = true;
    console.log(`[Calibration] Connection closed by client. Aborting calibration for track ${trackId}`);
    cancelTokenSource.cancel('Client aborted request');
  });

  try {
    await sendLog('info', `[Service] Fetching stream for youtubeId: ${youtubeId}`);
    
    // 1. Fetch entire audio stream into a Buffer
    const response = await axios.get(streamUrl, {
      responseType: 'arraybuffer',
      cancelToken: cancelTokenSource.token,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    const buffer = Buffer.from(response.data);
    
    if (isAborted) {
      console.log(`[Calibration] Already aborted before decoding track ${trackId}`);
      return;
    }
    
    await sendLog('info', `[Service] Stream fetched. Decoding audio bytes (size: ${buffer.length})...`);
    
    // 2. Decode the buffer
    const audioBuffer = await decode(buffer);
    const channelData = audioBuffer.getChannelData 
      ? audioBuffer.getChannelData(0) 
      : (audioBuffer.channelData ? audioBuffer.channelData[0] : null);
    
    if (!channelData) {
      throw new Error('Failed to extract channel data from decoded audio');
    }

    const sampleRate = audioBuffer.sampleRate || 44100;
    const length = channelData.length;

    if (isAborted) {
      console.log(`[Calibration] Already aborted before Essentia analysis for track ${trackId}`);
      return;
    }

    await sendLog('info', `[Service] Audio decoded: ${length} samples at ${sampleRate}Hz. Running Essentia DSP analysis...`);

    // 3. Convert float array to Essentia vector
    const signal = essentia.arrayToVector(channelData);
    
    // 4. Calculate BPM/Tempo
    const rhythm = essentia.RhythmExtractor2013(signal);
    const bpm = rhythm.bpm || 120.0;
    const tempo = Math.max(0.01, Math.min(1.0, 0.0041904 * bpm - 0.0193186));
    
    // 5. Calculate Danceability
    const danceData = essentia.Danceability(signal);
    const rawDance = danceData.danceability || 1.0;
    const danceability = Math.max(0.01, Math.min(1.0, 0.2303228 * rawDance - 0.0428636));
    const initialDanceability = Math.max(0.1, Math.min(0.95, ((rawDance - 0.80) / 0.50) * 0.80 + 0.10));
    
    // 6. Calculate Key
    const keyData = essentia.KeyExtractor(signal);
    const scale = keyData.scale || 'major';
    
    // 7. Calculate Dynamic Complexity
    const dcData = essentia.DynamicComplexity(signal);
    const dynamicComplexity = dcData.dynamicComplexity || 3.0;
    
    // 8. Loudness and Energy
    const rawLoudnessDb = dcData.loudness || -15.0;
    const rawLoudness = Math.max(0.0, Math.min(1.0, (rawLoudnessDb + 60.0) / 60.0));
    const loudness = Math.max(0.01, Math.min(1.0, 0.7374455 * rawLoudness + 0.2947261));
    
    const frameSize = 2048;
    const numFrames = Math.floor(length / frameSize);
    let totalEnergy = 0;
    let peakRms = 0;
    
    for (let i = 0; i < numFrames; i++) {
      const start = i * frameSize;
      let sumSquares = 0;
      for (let j = 0; j < frameSize; j++) {
        const val = channelData[start + j];
        sumSquares += val * val;
      }
      const rms = Math.sqrt(sumSquares / frameSize);
      totalEnergy += rms;
      if (rms > peakRms) peakRms = rms;
    }
    
    const avgRms = numFrames > 0 ? totalEnergy / numFrames : 0.05;
    const rawEnergy = Math.max(0.1, Math.min(0.95, (avgRms / Math.max(peakRms, 0.01)) * 1.5));
    const energy = Math.max(0.01, Math.min(1.0, 0.7421250 * rawEnergy + 0.2763965));
    
    // 9. Zero-Crossing Rate
    let zeroCrossings = 0;
    const step = Math.max(1, Math.floor(length / 1000000));
    let zcrCount = 0;
    for (let i = step; i < length; i += step) {
      if (channelData[i] * channelData[i - step] < 0) {
        zeroCrossings++;
      }
      zcrCount++;
    }
    const zcr = zcrCount > 0 ? zeroCrossings / zcrCount : 0.05;
    
    // 10. Advanced Psychoacoustic Heuristics
    const compA = 0.7 * (1.0 - rawEnergy) + 0.3 * (dynamicComplexity / 15.0);
    const acousticness = Math.max(0.01, Math.min(1.0, 1.7700 * compA - 0.3900));
    
    const zcrNorm = Math.max(0.0, Math.min(1.0, (zcr - 0.07) / 0.13));
    const instrumentalness = Math.max(0.01, Math.min(0.95, Math.pow(1.0 - zcrNorm, 2.5) * 0.9 + 0.01));
    
    const rawSpeechiness = Math.max(0.02, Math.min(0.5, zcr * 1.2 + (1.0 - rawEnergy) * 0.1));
    const speechiness = Math.max(0.01, Math.min(1.0, 0.2634306 * rawSpeechiness + 0.0360055));
    
    const rawLiveness = Math.max(0.05, Math.min(0.8, 0.05 + (rawEnergy * 0.15) + (dynamicComplexity / 20.0)));
    const liveness = Math.max(0.01, Math.min(1.0, -0.8012243 * rawLiveness + 0.4557817));
    
    const scaleScore = scale === 'major' ? 0.15 : -0.15;
    const compV = 0.4 * rawEnergy + 0.4 * initialDanceability + scaleScore + 0.2;
    const valence = Math.max(0.01, Math.min(1.0, 0.1677804 * compV + 0.3787337));
    
    // Clean up WASM vector memory
    signal.delete();
    
    const features = {
      energy: parseFloat(energy.toFixed(4)),
      danceability: parseFloat(danceability.toFixed(4)),
      valence: parseFloat(valence.toFixed(4)),
      tempo: parseFloat(tempo.toFixed(4)),
      acousticness: parseFloat(acousticness.toFixed(4)),
      instrumentalness: parseFloat(instrumentalness.toFixed(4)),
      speechiness: parseFloat(speechiness.toFixed(4)),
      liveness: parseFloat(liveness.toFixed(4)),
      loudness: parseFloat(loudness.toFixed(4))
    };

    if (isAborted) {
      console.log(`[Calibration] Already aborted before patching DB for track ${trackId}`);
      return;
    }

    console.log(`[Calibration] Analysis success for track ${trackId}:`, features);
    await sendLog('info', `[Service] DSP analysis complete. Patching track in DB: ${JSON.stringify(features)}`);
    
    // 11. Patch the features to python backend
    const patchResp = await axios.patch(`${API_BASE_URL}/tracks/${trackId}`, features);
    
    if (patchResp.status !== 200) {
      throw new Error(`PATCH failed with status ${patchResp.status}`);
    }
    
    console.log(`[Calibration] Successfully patched track ${trackId}`);
    await sendLog('info', `[Service] Track patched successfully in DB.`);
    
    res.json({ success: true, features });
  } catch (err) {
    if (axios.isCancel(err)) {
      console.log(`[Calibration] Axios request cancelled for track ${trackId}`);
      if (!res.headersSent) {
        res.status(499).json({ error: 'Calibration aborted by client' });
      }
      return;
    }
    if (isAborted) {
      console.log(`[Calibration] Request was aborted by client, ignoring error: ${err.message}`);
      return;
    }
    console.error(`[Calibration] Failed for track ${trackId}:`, err.message);
    await sendLog('error', `Failed to calibrate track ${trackId}`, err.stack || err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    }
  }
});

const PORT = process.env.PORT || 8001;
app.listen(PORT, () => {
  console.log(`MoodFlow Calibration Service running on port ${PORT}`);
});
