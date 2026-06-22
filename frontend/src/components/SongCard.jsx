import React, { useState, useEffect, useRef } from 'react';

export function SongCard({ track, onClick, onPlayNext, onAddToQueue, onHover }) {
  const { youtube_id, track_name, artist, thumbnail_url } = track;
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef(null);
  const hoverTimerRef = useRef(null);
  
  // Default to YouTube Music standard CDN thumbnail if none is provided
  const imgUrl = thumbnail_url || (youtube_id ? `https://i.ytimg.com/vi/${youtube_id}/mqdefault.jpg` : '');

  useEffect(() => {
    if (!showMenu) return;
    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setShowMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showMenu]);

  const handleMouseEnter = () => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    
    hoverTimerRef.current = setTimeout(() => {
      if (track && track.youtube_id && onHover) {
        onHover(track);
      }
    }, 100);
  };

  const handleMouseLeave = () => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
    }
  };

  useEffect(() => {
    return () => {
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    };
  }, []);

  return (
    <div 
      className="song-card" 
      onClick={onClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      role="button"
      tabIndex={0}
      id={`track-card-${track.id}`}
    >
      {/* 3 dots menu container */}
      <div className="song-card-menu-container" ref={menuRef}>
        <button 
          className={`song-card-menu-btn ${showMenu ? 'active' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            setShowMenu(!showMenu);
          }}
          title="More options"
          aria-label="More options"
          type="button"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="12" cy="5" r="2" />
            <circle cx="12" cy="12" r="2" />
            <circle cx="12" cy="19" r="2" />
          </svg>
        </button>

        {showMenu && (
          <div className="song-card-menu-dropdown">
            <button 
              className="song-card-menu-item"
              onClick={(e) => {
                e.stopPropagation();
                setShowMenu(false);
                if (onPlayNext) onPlayNext(track);
              }}
              type="button"
            >
              Play next
            </button>
            <button 
              className="song-card-menu-item"
              onClick={(e) => {
                e.stopPropagation();
                setShowMenu(false);
                if (onAddToQueue) onAddToQueue(track);
              }}
              type="button"
            >
              Add to queue
            </button>
          </div>
        )}
      </div>

      <div className="thumbnail-container">
        {imgUrl ? (
          <img 
            src={imgUrl} 
            alt={`${track_name} by ${artist}`}
            loading="lazy"
            className="thumbnail-img"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="thumbnail-placeholder">
            <span>🎵</span>
          </div>
        )}
        <div className="play-overlay">
          <svg className="play-icon" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5v14l11-7z" />
          </svg>
        </div>
      </div>
      <div className="song-info">
        <h3 className="song-title">{track_name}</h3>
        <p className="song-artist">{artist}</p>
      </div>
    </div>
  );
}

export default SongCard;
