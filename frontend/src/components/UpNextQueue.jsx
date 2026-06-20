import React from 'react';

export function UpNextQueue({ isOpen, onClose, queue, currentTrackIndex, onRemove, onReorder, onPlayTrack }) {
  if (!isOpen) return null;

  // Render items that are after the current playing track index
  const upcomingTracks = queue.slice(currentTrackIndex + 1);

  const handleDragStart = (e, index) => {
    e.dataTransfer.setData('text/plain', index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e) => {
    e.preventDefault();
  };

  const handleDrop = (e, targetRelativeIndex) => {
    e.preventDefault();
    const sourceRelativeIndex = parseInt(e.dataTransfer.getData('text/plain'), 10);
    
    // Map relative indices to absolute queue indices
    const sourceIndex = currentTrackIndex + 1 + sourceRelativeIndex;
    const targetIndex = currentTrackIndex + 1 + targetRelativeIndex;
    
    if (sourceIndex !== targetIndex) {
      onReorder(sourceIndex, targetIndex);
    }
  };

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer-content queue-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-header">
          <div className="drawer-handle" onClick={onClose} />
          <h2>Up Next</h2>
          <button className="close-drawer-btn" onClick={onClose}>Close</button>
        </div>

        <div className="drawer-body">
          {upcomingTracks.length === 0 ? (
            <div className="empty-queue">
              <p>Queue is empty</p>
              <span className="subtitle">Add more songs from the feed!</span>
            </div>
          ) : (
            <div className="queue-list">
              {upcomingTracks.map((track, relIdx) => {
                const absoluteIndex = currentTrackIndex + 1 + relIdx;
                const thumbUrl = track.thumbnail_url || `https://i.ytimg.com/vi/${track.youtube_id}/mqdefault.jpg`;

                return (
                  <div
                    key={track.id + '-' + absoluteIndex}
                    className="queue-item"
                    draggable
                    onDragStart={(e) => handleDragStart(e, relIdx)}
                    onDragOver={handleDragOver}
                    onDrop={(e) => handleDrop(e, relIdx)}
                  >
                    <div className="drag-handle">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="4" y1="9" x2="20" y2="9" />
                        <line x1="4" y1="15" x2="20" y2="15" />
                      </svg>
                    </div>

                    <img 
                      src={thumbUrl} 
                      alt="" 
                      className="queue-item-thumb" 
                      onClick={() => onPlayTrack(absoluteIndex)}
                    />

                    <div className="queue-item-info" onClick={() => onPlayTrack(absoluteIndex)}>
                      <span className="queue-item-title">{track.track_name}</span>
                      <span className="queue-item-artist">{track.artist}</span>
                    </div>

                    <button 
                      className="remove-queue-btn" 
                      onClick={() => onRemove(absoluteIndex)}
                      aria-label="Remove from queue"
                      type="button"
                    >
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default UpNextQueue;
