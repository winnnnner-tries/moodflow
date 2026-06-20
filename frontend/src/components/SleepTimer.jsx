import React from 'react';

const TIMER_OPTIONS = [
  { label: 'Off', value: 0 },
  { label: '15 Min', value: 15 },
  { label: '30 Min', value: 30 },
  { label: '45 Min', value: 45 },
  { label: '60 Min', value: 60 }
];

export function SleepTimer({ selectedTime, onChange, remainingSeconds }) {
  const formatTime = (secs) => {
    if (secs <= 0) return '';
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  return (
    <div className="sleep-timer-container">
      <div className="effect-header-row">
        <span className="effect-title">⏰ Sleep Timer</span>
        {remainingSeconds > 0 && (
          <span className="timer-countdown">Remaining: {formatTime(remainingSeconds)}</span>
        )}
      </div>
      <div className="sleep-timer-options">
        {TIMER_OPTIONS.map((opt) => {
          const isActive = selectedTime === opt.value;
          return (
            <button
              key={opt.value}
              onClick={() => onChange(opt.value)}
              className={`timer-opt-btn ${isActive ? 'active' : ''}`}
              type="button"
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default SleepTimer;
