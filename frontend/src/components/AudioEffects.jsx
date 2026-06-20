import React from 'react';
import SleepTimer from './SleepTimer';

export function AudioEffects({ 
  isOpen, 
  onClose, 
  effects, 
  onPitchChange, 
  onReverbChange, 
  onBassBoostToggle, 
  on8DToggle, 
  onSpeedChange,
  sleepTime,
  onSleepTimeChange,
  sleepRemaining
}) {
  if (!isOpen) return null;

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer-content" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-header">
          <div className="drawer-handle" onClick={onClose} />
          <h2>Audio Effects</h2>
          <button className="close-drawer-btn" onClick={onClose}>Done</button>
        </div>

        <div className="drawer-body">
          {/* Pitch Shifter */}
          <div className="effect-section">
            <div className="effect-header-row">
              <span className="effect-title">🎹 Pitch Shifter</span>
              <span className="effect-value">
                {effects.pitch > 0 ? `+${effects.pitch}` : effects.pitch} semitones
              </span>
            </div>
            <input 
              type="range"
              min="-6"
              max="6"
              step="1"
              value={effects.pitch}
              onChange={(e) => onPitchChange(parseInt(e.target.value))}
              className="mood-range-input"
            />
            <div className="slider-limits">
              <span>Low (-6)</span>
              <span>Normal (0)</span>
              <span>High (+6)</span>
            </div>
          </div>

          {/* Reverb */}
          <div className="effect-section">
            <div className="effect-header-row">
              <span className="effect-title">🌌 Reverb Intensity</span>
              <span className="effect-value">{Math.round(effects.reverb * 100)}%</span>
            </div>
            <input 
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={effects.reverb}
              onChange={(e) => onReverbChange(parseFloat(e.target.value))}
              className="mood-range-input"
            />
            <div className="slider-limits">
              <span>Dry</span>
              <span>Wet</span>
            </div>
          </div>

          {/* Bass Boost and 8D Audio Toggles */}
          <div className="toggles-grid">
            <div className="toggle-card">
              <div className="toggle-info">
                <span className="toggle-title">🔊 Bass Boost</span>
                <span className="toggle-desc">Enhance lower frequencies</span>
              </div>
              <button 
                onClick={() => onBassBoostToggle(!effects.bassBoost)}
                className={`switch-btn ${effects.bassBoost ? 'on' : ''}`}
                type="button"
                aria-label="Toggle Bass Boost"
              >
                <div className="switch-handle" />
              </button>
            </div>

            <div className="toggle-card">
              <div className="toggle-info">
                <span className="toggle-title">🌀 8D Spatial Audio</span>
                <span className="toggle-desc">Binaural smooth panning sweep</span>
              </div>
              <button 
                onClick={() => on8DToggle(!effects.is8D)}
                className={`switch-btn ${effects.is8D ? 'on' : ''}`}
                type="button"
                aria-label="Toggle 8D Audio"
              >
                <div className="switch-handle" />
              </button>
            </div>
          </div>

          {/* Playback Speed */}
          <div className="effect-section">
            <span className="effect-title">⚡ Playback Speed</span>
            <div className="speed-options">
              {[0.75, 1.0, 1.25, 1.5].map((rate) => {
                const isActive = effects.speed === rate;
                return (
                  <button
                    key={rate}
                    onClick={() => onSpeedChange(rate)}
                    className={`speed-btn ${isActive ? 'active' : ''}`}
                    type="button"
                  >
                    {rate}x
                  </button>
                );
              })}
            </div>
          </div>

          {/* Sleep Timer */}
          <div className="effect-section">
            <SleepTimer 
              selectedTime={sleepTime} 
              onChange={onSleepTimeChange} 
              remainingSeconds={sleepRemaining}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export default AudioEffects;
