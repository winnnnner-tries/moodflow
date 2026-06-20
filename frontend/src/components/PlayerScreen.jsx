import React from 'react';

export function PlayerScreen({
  track,
  onBack,
  isPlaying,
  onTogglePlay,
  currentTime,
  duration,
  onSeek,
  onNext,
  onPrevious,
  onOpenEffects,
  onOpenQueue,
  playbackError
}) {
  if (!track) return null;

  const formatTime = (secs) => {
    if (isNaN(secs)) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const handleProgressBarChange = (e) => {
    onSeek(parseFloat(e.target.value));
  };

  const percent = duration > 0 ? (currentTime / duration) * 100 : 0;
  
  const getHighResThumbnail = (url) => {
    if (!url) return '';
    if (url.includes('googleusercontent.com') || url.includes('ggpht.com')) {
      return url.replace(/=w\d+-h\d+/, '=w500-h500').replace(/-w\d+-h\d+/, '-w500-h500');
    }
    if (url.includes('ytimg.com')) {
      // Safely replace default quality filename suffix without mangling prefixes like 'sd' or 'hq'
      return url.replace(/\/(default|mqdefault|sddefault|hqdefault)\.jpg/, '/hqdefault.jpg');
    }
    return url;
  };

  const thumbUrl = getHighResThumbnail(track.thumbnail_url) || `https://i.ytimg.com/vi/${track.youtube_id}/hqdefault.jpg`;

  return (
    <div className="player-screen">
      {/* Top Navigation Row */}
      <header className="player-header">
        <button className="back-btn" onClick={onBack} aria-label="Go Back">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <span className="now-playing-label">Now Playing</span>
        <button className="effects-menu-btn" onClick={onOpenEffects} aria-label="Open Audio Effects">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <circle cx="12" cy="12" r="1" />
            <circle cx="12" cy="5" r="1" />
            <circle cx="12" cy="19" r="1" />
          </svg>
        </button>
      </header>

      {/* Album Artwork / Thumbnail Container */}
      <div className="player-body">
        <div className={`artwork-container ${isPlaying ? 'playing' : ''}`}>
          <img 
            src={thumbUrl} 
            alt={`${track.track_name} artwork`} 
            className="player-artwork"
          />
        </div>

        <div className="player-controls-wrapper">
          {/* Track Title and Artist */}
          <div className="track-metadata">
            <h2 className="player-track-title">{track.track_name}</h2>
            <p className="player-track-artist">{track.artist}</p>
          </div>

          {/* Playback Error Toast */}
          {playbackError && (
            <div className="playback-error-toast">
              <span>⚠️ {playbackError}</span>
            </div>
          )}

          {/* Progress Slider and Timing */}
          <div className="progress-section">
            <input 
              type="range"
              min="0"
              max={duration || 100}
              value={currentTime}
              onChange={handleProgressBarChange}
              className="player-progress-bar"
              style={{ '--progress-percent': `${percent}%` }}
            />
            <div className="time-row">
              <span>{formatTime(currentTime)}</span>
              <span>{formatTime(duration)}</span>
            </div>
          </div>

          {/* Primary Controls Row */}
          <div className="player-controls">
            <button className="ctrl-btn-secondary" onClick={onPrevious} aria-label="Previous Song">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="19 20 9 12 19 4 19 20" />
                <line x1="5" y1="4" x2="5" y2="20" stroke="currentColor" strokeWidth="2.5" />
              </svg>
            </button>

            <button className="ctrl-btn-primary" onClick={onTogglePlay} aria-label={isPlaying ? "Pause" : "Play"}>
              {isPlaying ? (
                <svg width="32" height="32" viewBox="0 0 24 24" fill="#000000">
                  <rect x="6" y="4" width="4" height="16" />
                  <rect x="14" y="4" width="4" height="16" />
                </svg>
              ) : (
                <svg width="32" height="32" viewBox="0 0 24 24" fill="#000000" style={{ marginLeft: '4px' }}>
                  <polygon points="8 5 19 12 8 19 8 5" />
                </svg>
              )}
            </button>

            <button className="ctrl-btn-secondary" onClick={onNext} aria-label="Next Song">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="5 4 15 12 5 20 5 4" />
                <line x1="19" y1="4" x2="19" y2="20" stroke="currentColor" strokeWidth="2.5" />
              </svg>
            </button>
          </div>
          
          {/* Slide-Up Queue Button */}
          <div className="player-footer">
            <button className="queue-toggle-btn" onClick={onOpenQueue}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: '6px' }}>
                <line x1="8" y1="6" x2="21" y2="6" />
                <line x1="8" y1="12" x2="21" y2="12" />
                <line x1="8" y1="18" x2="21" y2="18" />
                <line x1="3" y1="6" x2="3.01" y2="6" strokeWidth="3" />
                <line x1="3" y1="12" x2="3.01" y2="12" strokeWidth="3" />
                <line x1="3" y1="18" x2="3.01" y2="18" strokeWidth="3" />
              </svg>
              Up Next Queue
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default PlayerScreen;
