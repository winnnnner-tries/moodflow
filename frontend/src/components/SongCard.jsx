import React, { useState, useEffect, useRef } from 'react';

export function SongCard({ track, onClick, onPlayNext, onAddToQueue }) {
  const { youtube_id, track_name, artist, thumbnail_url } = track;
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef(null);
  const cardRef = useRef(null);
  const requestRef = useRef(null);
  
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

  const targetPos = useRef({ rx: 0, ry: 0, mx: 0, my: 0 });
  const currentPos = useRef({ rx: 0, ry: 0, mx: 0, my: 0 });
  const isLoopActive = useRef(false);

  const lerp = (start, end, factor) => start + (end - start) * factor;

  const updateAnimation = () => {
    if (!cardRef.current) {
      isLoopActive.current = false;
      return;
    }

    const tp = targetPos.current;
    const cp = currentPos.current;
    
    const threshold = 0.01;
    const isMoving = 
      Math.abs(tp.rx - cp.rx) > threshold ||
      Math.abs(tp.ry - cp.ry) > threshold ||
      Math.abs(tp.mx - cp.mx) > threshold ||
      Math.abs(tp.my - cp.my) > threshold;

    if (isMoving) {
      cp.rx = lerp(cp.rx, tp.rx, 0.12);
      cp.ry = lerp(cp.ry, tp.ry, 0.12);
      cp.mx = lerp(cp.mx, tp.mx, 0.12);
      cp.my = lerp(cp.my, tp.my, 0.12);

      cardRef.current.style.setProperty('--mx', `${cp.mx}px`);
      cardRef.current.style.setProperty('--my', `${cp.my}px`);
      cardRef.current.style.setProperty('--rx', `${cp.rx}deg`);
      cardRef.current.style.setProperty('--ry', `${cp.ry}deg`);

      requestRef.current = requestAnimationFrame(updateAnimation);
    } else {
      // Settle exactly to target values
      cp.rx = tp.rx;
      cp.ry = tp.ry;
      cp.mx = tp.mx;
      cp.my = tp.my;
      
      cardRef.current.style.setProperty('--mx', `${cp.mx}px`);
      cardRef.current.style.setProperty('--my', `${cp.my}px`);
      cardRef.current.style.setProperty('--rx', `${cp.rx}deg`);
      cardRef.current.style.setProperty('--ry', `${cp.ry}deg`);

      isLoopActive.current = false;
    }
  };

  const startLoop = () => {
    if (!isLoopActive.current) {
      isLoopActive.current = true;
      requestRef.current = requestAnimationFrame(updateAnimation);
    }
  };

  const handleMouseMove = (e) => {
    if (!cardRef.current) return;
    
    const rect = cardRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    
    const rx = -((y - cy) / cy) * 15;
    const ry = ((x - cx) / cx) * 15;
    
    targetPos.current = { rx, ry, mx: x, my: y };
    startLoop();
  };

  const handleMouseLeave = () => {
    if (!cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    targetPos.current = { rx: 0, ry: 0, mx: rect.width / 2, my: rect.height / 2 };
    startLoop();
  };

  useEffect(() => {
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, []);

  return (
    <div 
      className="song-card" 
      ref={cardRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onClick={onClick}
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
