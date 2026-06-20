import React, { useRef } from 'react';
import { PRESETS, PRESET_LABELS } from '../lib/presets';

export function PresetButtons({ activePreset, onSelectPreset, showForYou, onSelectForYou }) {
  const scrollRef = useRef(null);

  const handleSelect = (key) => {
    onSelectPreset(key, PRESETS[key]);
  };

  return (
    <div className="preset-chip-bar-wrapper">
      <div className="preset-chip-bar" ref={scrollRef}>
        {/* For You chip — only if taste profile exists */}
        {showForYou && (
          <button
            className={`preset-chip ${activePreset === 'for_you' ? 'active' : ''}`}
            onClick={() => onSelectForYou && onSelectForYou()}
            type="button"
          >
            ✨ For You
          </button>
        )}

        {/* Preset mood chips */}
        {Object.values(PRESET_LABELS).map(({ label, key }) => (
          <button
            key={key}
            className={`preset-chip ${activePreset === key ? 'active' : ''}`}
            onClick={() => handleSelect(key)}
            type="button"
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default PresetButtons;
