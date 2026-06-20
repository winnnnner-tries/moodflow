import React from 'react';

const SLIDER_METADATA = [
  { key: 'energy', label: 'Energy', min: 0, max: 1, step: 0.01, desc: 'High energy vs Calm' },
  { key: 'danceability', label: 'Danceability', min: 0, max: 1, step: 0.01, desc: 'Rhythmic stability & beats' },
  { key: 'valence', label: 'Valence', min: 0, max: 1, step: 0.01, desc: 'Happy/Positive vs Sad/Angry' },
  { key: 'tempo', label: 'Tempo', min: 0, max: 1, step: 0.01, desc: 'BPM speed (slow to fast)' },
  { key: 'acousticness', label: 'Acousticness', min: 0, max: 1, step: 0.01, desc: 'Acoustic instruments percentage' },
  { key: 'instrumentalness', label: 'Instrumentalness', min: 0, max: 1, step: 0.01, desc: 'Vocal absence ratio' },
  { key: 'speechiness', label: 'Speechiness', min: 0, max: 1, step: 0.01, desc: 'Presence of spoken words' },
  { key: 'liveness', label: 'Liveness', min: 0, max: 1, step: 0.01, desc: 'Audience and live performance feel' },
  { key: 'loudness', label: 'Loudness', min: 0, max: 1, step: 0.01, desc: 'Dynamic level / volume density' }
];

export function ParameterSliders({ values, onChange }) {
  const handleSliderChange = (key, val) => {
    onChange({
      ...values,
      [key]: parseFloat(val)
    });
  };

  return (
    <div className="parameter-sliders">
      {SLIDER_METADATA.map(({ key, label, min, max, step, desc }) => {
        const val = values[key] !== undefined ? values[key] : 0.5;
        return (
          <div className="slider-group" key={key}>
            <div className="slider-label-row">
              <span className="slider-label">{label}</span>
              <span className="slider-value">{Math.round(val * 100)}%</span>
            </div>
            <input 
              type="range"
              min={min}
              max={max}
              step={step}
              value={val}
              onChange={(e) => handleSliderChange(key, e.target.value)}
              className="mood-range-input"
              aria-label={label}
            />
            <span className="slider-desc">{desc}</span>
          </div>
        );
      })}
    </div>
  );
}

export default ParameterSliders;
