import React, { useState, useEffect, useRef, useMemo } from 'react';
import PresetButtons from './PresetButtons';
import ParameterSliders from './ParameterSliders';
import SongCard from './SongCard';
import { PRESETS, getTimeAwarePreset } from '../lib/presets';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

const LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'hi', name: 'Hindi' },
  { code: 'ta', name: 'Tamil' },
  { code: 'te', name: 'Telugu' },
  { code: 'ml', name: 'Malayalam' },
  { code: 'kn', name: 'Kannada' },
  { code: 'bn', name: 'Bengali' },
  { code: 'ko', name: 'Korean' }
];

function getGreeting() {
  const hour = new Date().getHours();
  if (hour >= 6 && hour < 12) return { text: 'Good Morning', emoji: '☀️' };
  if (hour >= 12 && hour < 17) return { text: 'Good Afternoon', emoji: '🌤️' };
  if (hour >= 17 && hour < 21) return { text: 'Good Evening', emoji: '🌅' };
  return { text: 'Late Night', emoji: '🌙' };
}

export function FeedScreen({ 
  onSelectTrack, 
  onSelectSearchTrack,
  userId, 
  tasteProfile, 
  updateLanguagePref,
  searchService,
  currentPlayingTrack,
  onPlayNext,
  onAddToQueue,
  isAutoCalibrationMode,
  onToggleAutoCalibration
}) {
  const [selectedLanguage, setSelectedLanguage] = useState(localStorage.getItem("moodflow_user_lang") || 'en');
  const [showOnboarding, setShowOnboarding] = useState(!localStorage.getItem("moodflow_user_lang"));

  // Time-aware auto-preset on cold start
  const timePreset = useMemo(() => getTimeAwarePreset(), []);
  const [activePreset, setActivePreset] = useState(timePreset.key);
  const [timeBadge, setTimeBadge] = useState(timePreset.badge);
  const [showAdvanced, setShowAdvanced] = useState(false);
  
  // Advanced parameters state — initialize from time-aware preset
  const [params, setParams] = useState(PRESETS[timePreset.key] || PRESETS.chill);
  
  // Feed state — sections-based
  const [feedSections, setFeedSections] = useState([]);
  const [tracks, setTracks] = useState([]);
  const [loadingFeed, setLoadingFeed] = useState(false);
  const [feedError, setFeedError] = useState(null);
  
  // Discovery dial
  const [discovery, setDiscovery] = useState(0.3);

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(null);
  const [searchResults, setSearchResults] = useState([]);
  
  // Collapsible feed sections state
  const [isQuickPicksOpen, setIsQuickPicksOpen] = useState(true);
  const [isRecommendedMixOpen, setIsRecommendedMixOpen] = useState(true);

  // Playlist states
  const [activePlaylist, setActivePlaylist] = useState(null);
  const [loadingPlaylist, setLoadingPlaylist] = useState(false);
  const [playlistError, setPlaylistError] = useState(null);
  const [customPlaylistUrl, setCustomPlaylistUrl] = useState('');
  const [savedPlaylists, setSavedPlaylists] = useState([]);

  const [featuredPlaylists, setFeaturedPlaylists] = useState([]);

  // Greeting
  const greeting = useMemo(() => getGreeting(), []);

  const fetchFeaturedPlaylists = async (lang, currentPreset) => {
    try {
      const presetParam = currentPreset ? `&preset=${currentPreset}` : '';
      const response = await fetch(`${API_BASE_URL}/sync/playlists/featured?lang=${lang}${presetParam}`);
      if (response.ok) {
        const data = await response.json();
        setFeaturedPlaylists(data);
      }
    } catch (err) {
      console.error("Failed to load featured playlists:", err);
    }
  };

  const fetchSavedPlaylists = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/sync/playlists`);
      if (response.ok) {
        const data = await response.json();
        setSavedPlaylists(data);
      }
    } catch (err) {
      console.error("Failed to load saved playlists:", err);
    }
  };

  useEffect(() => {
    fetchSavedPlaylists();
  }, []);

  // Global mouse tracking for background ambient glow
  useEffect(() => {
    const handleGlobalMouseMove = (e) => {
      const x = (e.clientX / window.innerWidth) * 100;
      const y = (e.clientY / window.innerHeight) * 100;
      document.documentElement.style.setProperty('--global-mouse-x', `${x}%`);
      document.documentElement.style.setProperty('--global-mouse-y', `${y}%`);
    };
    
    window.addEventListener('mousemove', handleGlobalMouseMove);
    return () => window.removeEventListener('mousemove', handleGlobalMouseMove);
  }, []);

  const handleLoadPlaylist = async (playlistId) => {
    setLoadingPlaylist(true);
    setPlaylistError(null);
    try {
      let cleanId = playlistId.trim();
      if (cleanId.includes('list=')) {
        // Handle full URL inputs
        const parts = cleanId.split('list=')[1];
        cleanId = parts.split('&')[0];
      }
      
      const response = await fetch(`${API_BASE_URL}/sync/playlist/${cleanId}?lang=${selectedLanguage}`);
      if (!response.ok) {
        throw new Error("Failed to sync playlist from YouTube Music.");
      }
      const data = await response.json();
      setActivePlaylist({ ...data, playlist_id: cleanId });
    } catch (err) {
      console.error(err);
      setPlaylistError(err.message || "Error loading playlist.");
    } finally {
      setLoadingPlaylist(false);
    }
  };

  const isPlaylistSaved = activePlaylist && savedPlaylists.some(p => p.playlist_id === activePlaylist.playlist_id);

  const handleToggleSavePlaylist = async () => {
    if (!activePlaylist) return;
    const isSaved = isPlaylistSaved;
    try {
      if (isSaved) {
        const response = await fetch(`${API_BASE_URL}/sync/playlists/${activePlaylist.playlist_id}`, {
          method: 'DELETE'
        });
        if (response.ok) {
          setSavedPlaylists(prev => prev.filter(p => p.playlist_id !== activePlaylist.playlist_id));
        }
      } else {
        const response = await fetch(`${API_BASE_URL}/sync/playlists`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ playlist_id: activePlaylist.playlist_id })
        });
        if (response.ok) {
          const newSaved = await response.json();
          setSavedPlaylists(prev => [newSaved, ...prev]);
        }
      }
    } catch (err) {
      console.error("Error toggling playlist save:", err);
    }
  };


  const handlePlaylistImportSubmit = (e) => {
    e.preventDefault();
    if (!customPlaylistUrl.trim()) return;
    handleLoadPlaylist(customPlaylistUrl);
    setCustomPlaylistUrl('');
  };

  const handlePlayPlaylistDirectly = async (e, playlistId) => {
    e.stopPropagation();
    setLoadingPlaylist(true);
    setPlaylistError(null);
    try {
      let cleanId = playlistId.trim();
      if (cleanId.includes('list=')) {
        const parts = cleanId.split('list=')[1];
        cleanId = parts.split('&')[0];
      }
      
      const response = await fetch(`${API_BASE_URL}/sync/playlist/${cleanId}?lang=${selectedLanguage}`);
      if (!response.ok) {
        throw new Error("Failed to load playlist tracks.");
      }
      const data = await response.json();
      if (data.tracks && data.tracks.length > 0) {
        onSelectTrack(data.tracks[0], data.tracks, 0);
      } else {
        throw new Error("No tracks found in this playlist.");
      }
    } catch (err) {
      console.error(err);
      setPlaylistError(err.message || "Error playing playlist directly.");
    } finally {
      setLoadingPlaylist(false);
    }
  };


  // Fetch feed — try /feed/sections first, fall back to /feed
  const fetchFeed = async (langCode, moodParams) => {
    setLoadingFeed(true);
    setFeedError(null);
    try {
      // Try new sections endpoint first
      const sectionsParams = new URLSearchParams({
        lang: langCode,
        preset: activePreset,
        discovery: discovery,
        energy: moodParams.energy,
        danceability: moodParams.danceability,
        valence: moodParams.valence,
        tempo: moodParams.tempo,
        acousticness: moodParams.acousticness,
        instrumentalness: moodParams.instrumentalness,
        loudness: moodParams.loudness,
        user_id: userId
      });

      try {
        const sectionsResponse = await fetch(`${API_BASE_URL}/feed/sections?${sectionsParams.toString()}`);
        if (sectionsResponse.ok) {
          const sectionsData = await sectionsResponse.json();
          const sectionsArray = sectionsData.sections || [];
          if (Array.isArray(sectionsArray) && sectionsArray.length > 0) {
            setFeedSections(sectionsArray);
            // Also collect all tracks for fallback flat display
            const allTracks = sectionsArray.flatMap(s => s.tracks || []);
            setTracks(allTracks);
            return;
          }
        }
      } catch (sectionsErr) {
        console.warn("Sections endpoint unavailable, falling back to /feed:", sectionsErr);
      }

      // Fallback to old /feed endpoint
      const queryParams = new URLSearchParams({
        lang: langCode,
        energy: moodParams.energy,
        danceability: moodParams.danceability,
        valence: moodParams.valence,
        tempo: moodParams.tempo,
        acousticness: moodParams.acousticness,
        instrumentalness: moodParams.instrumentalness,
        loudness: moodParams.loudness,
        user_id: userId
      });

      const response = await fetch(`${API_BASE_URL}/feed?${queryParams.toString()}`);
      if (!response.ok) {
        throw new Error("Failed to load feed tracks from database.");
      }
      const data = await response.json();
      setTracks(data || []);
      setFeedSections([]);
    } catch (err) {
      setFeedError(err.message);
    } finally {
      setLoadingFeed(false);
    }
  };

  // Trigger feed reload when language or parameters change
  useEffect(() => {
    fetchFeed(selectedLanguage, params);
    fetchFeaturedPlaylists(selectedLanguage, activePreset);
    
    // Dynamically adjust ambient backdrop mesh gradients on preset/parameter changes
    if (params) {
      const energy = params.energy ?? 0.5;
      const valence = params.valence ?? 0.5;
      
      const r1 = Math.round(100 + energy * 155);
      const g1 = Math.round(40 + (1 - valence) * 80);
      const b1 = Math.round(180 + valence * 75);

      const r2 = Math.round(30 + valence * 220);
      const g2 = Math.round(60 + energy * 100);
      const b2 = Math.round(100 + (1 - energy) * 155);

      document.documentElement.style.setProperty('--mood-color-1', `${r1}, ${g1}, ${b1}`);
      document.documentElement.style.setProperty('--mood-color-2', `${r2}, ${g2}, ${b2}`);
    }
  }, [selectedLanguage, params, discovery]);

  const handleSelectPreset = (presetKey, presetParams) => {
    setActivePreset(presetKey);
    setParams(presetParams);
    setTimeBadge(null); // Clear time badge when user manually selects
  };

  // Sync language with user taste profile if available
  useEffect(() => {
    if (tasteProfile && tasteProfile.language_pref) {
      localStorage.setItem("moodflow_user_lang", tasteProfile.language_pref);
      setSelectedLanguage(tasteProfile.language_pref);
      setShowOnboarding(false);
    }
  }, [tasteProfile]);

  const handleSelectOnboardingLang = (langCode) => {
    localStorage.setItem("moodflow_user_lang", langCode);
    setSelectedLanguage(langCode);
    setShowOnboarding(false);
    
    // Also update preferred language in Supabase user profile
    if (updateLanguagePref) {
      updateLanguagePref(langCode);
    }
  };

  const handleSelectForYou = () => {
    if (!tasteProfile) return;
    
    // Construct mood vector from user taste profile averages
    const forYouParams = {
      energy: tasteProfile.avg_energy ?? 0.5,
      danceability: tasteProfile.avg_danceability ?? 0.5,
      valence: tasteProfile.avg_valence ?? 0.5,
      tempo: tasteProfile.avg_tempo ?? 0.5,
      acousticness: tasteProfile.avg_acousticness ?? 0.5,
      instrumentalness: tasteProfile.avg_instrumentalness ?? 0.1,
      speechiness: tasteProfile.avg_speechiness ?? 0.1,
      liveness: tasteProfile.avg_liveness ?? 0.1,
      loudness: tasteProfile.avg_loudness ?? 0.7
    };
    
    setActivePreset('for_you');
    setParams(forYouParams);
    setTimeBadge(null);
  };

  const handleSearchSubmit = async (e) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    
    setSearching(true);
    setSearchError(null);
    setSearchResults([]);
    try {
      const results = await searchService(searchQuery);
      if (results && results.length > 0) {
        setSearchResults(results);
      } else {
        setSearchError("No match found for that search query.");
      }
    } catch (err) {
      setSearchError("Failed to search. Check backend connection.");
    } finally {
      setSearching(false);
    }
  };

  // Render a horizontal scroll section
  const renderHorizontalSection = (section) => {
    const sectionTracks = section.tracks || [];
    if (sectionTracks.length === 0) return null;

    return (
      <div key={section.id} className="feed-section feed-section-fadein">
        <div className="feed-section-header">
          <h3 className="feed-section-title">{section.title}</h3>
          {section.subtitle && <p className="feed-section-subtitle">{section.subtitle}</p>}
        </div>
        <div className="feed-section-scroll">
          {sectionTracks.map((track, index) => {
            const img = track.thumbnail_url || `https://i.ytimg.com/vi/${track.youtube_id}/mqdefault.jpg`;
            return (
              <div key={`${section.id}-${track.id || track.youtube_id}`} className="feed-scroll-card-wrapper">
                <SongCard 
                  track={track} 
                  onClick={() => onSelectTrack(track, sectionTracks, index)}
                  onPlayNext={onPlayNext}
                  onAddToQueue={onAddToQueue}
                />
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // Render a grid section
  const renderGridSection = (section) => {
    const sectionTracks = section.tracks || [];
    if (sectionTracks.length === 0) return null;

    return (
      <div key={section.id} className="feed-section feed-section-fadein">
        <div className="feed-section-header">
          <h3 className="feed-section-title">{section.title}</h3>
          {section.subtitle && <p className="feed-section-subtitle">{section.subtitle}</p>}
        </div>
        <div className="songs-grid">
          {sectionTracks.map((track, index) => (
            <SongCard 
              key={track.id} 
              track={track} 
              onClick={() => onSelectTrack(track, sectionTracks, index)}
              onPlayNext={onPlayNext}
              onAddToQueue={onAddToQueue}
            />
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className={`feed-screen ${currentPlayingTrack ? 'has-mini-player' : ''}`}>
      {/* Onboarding Language Choice Overlay */}
      {showOnboarding && (
        <div className="onboarding-overlay">
          <div className="onboarding-modal">
            <h2>Welcome to MoodFlow</h2>
            <p>Please select your preferred language to begin. We'll show you music tailored to this choice.</p>
            <div className="onboarding-lang-grid">
              {LANGUAGES.map((lang) => (
                <button
                  key={lang.code}
                  className="onboarding-lang-btn"
                  onClick={() => handleSelectOnboardingLang(lang.code)}
                  type="button"
                >
                  {lang.name}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Top Header Row with Time Greeting and Language Indicator */}
      <header className="feed-header">
        <div className="feed-greeting">
          <h1>{greeting.text} {greeting.emoji}</h1>
          <span className="brand-subtitle">MoodFlow</span>
        </div>
        <div className="feed-header-controls">
          <button 
            className={`auto-calib-badge ${isAutoCalibrationMode ? 'active' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              onToggleAutoCalibration();
            }}
            title={isAutoCalibrationMode ? "Turn OFF Auto-Calibration" : "Turn ON Auto-Calibration"}
          >
            ⚙️ {isAutoCalibrationMode ? 'Auto-Calib: ON' : 'Auto-Calib: OFF'}
          </button>
          
          <div className="current-lang-badge" onClick={() => setShowOnboarding(true)}>
            <span>🌐 {LANGUAGES.find(l => l.code === selectedLanguage)?.name || 'Select Lang'}</span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{marginLeft: '4px'}}>
              <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>
            </svg>
          </div>
        </div>
      </header>

      {/* Search Input Bar */}
      <form onSubmit={handleSearchSubmit} className="search-form">
        <div className="search-input-wrapper">
          <input 
            type="text" 
            placeholder="Search YouTube Music for artists, songs..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="search-input"
            disabled={searching}
          />
          <button type="submit" className="search-btn" disabled={searching}>
            {searching ? (
              <span className="spinner" />
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            )}
          </button>
        </div>
        {searchError && <p className="search-error-msg">{searchError}</p>}
        
        {/* Dropdown list of Search results */}
        {searchResults && searchResults.length > 0 && (
          <div className="search-dropdown">
            <div className="search-dropdown-header">
              <span>Results from YouTube Music</span>
              <button type="button" className="clear-search-btn" onClick={() => setSearchResults([])}>
                Dismiss
              </button>
            </div>
            <div className="search-dropdown-list">
              {searchResults.map((track) => {
                const img = track.thumbnail_url || `https://i.ytimg.com/vi/${track.youtube_id}/mqdefault.jpg`;
                return (
                  <div 
                    key={track.youtube_id} 
                    className="search-dropdown-item"
                    onClick={() => {
                      onSelectSearchTrack(track);
                      setSearchResults([]);
                    }}
                  >
                    <img src={img} alt="" className="search-item-thumb" referrerPolicy="no-referrer" />
                    <div className="search-item-info">
                      <span className="search-item-title">{track.track_name}</span>
                      <span className="search-item-artist">{track.artist}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </form>

      {/* YT Music Playlists & Trending */}
      <section className="playlists-section">
        <div className="playlists-row-header">
          <span className="section-title">YT Music Playlists</span>
          <form onSubmit={handlePlaylistImportSubmit} className="playlist-import-form">
            <input 
              type="text" 
              placeholder="Paste Playlist URL or ID..." 
              value={customPlaylistUrl}
              onChange={(e) => setCustomPlaylistUrl(e.target.value)}
              className="playlist-import-input"
              disabled={loadingPlaylist}
            />
            <button type="submit" className="playlist-import-btn" disabled={loadingPlaylist}>
              {loadingPlaylist ? 'Syncing...' : 'Sync Playlist'}
            </button>
          </form>
        </div>

        {playlistError && <p className="search-error-msg">{playlistError}</p>}
        {loadingPlaylist && (
          <div className="feed-loading-container" style={{ minHeight: '100px' }}>
            <div className="spinner" />
            <p style={{ marginTop: '8px', fontSize: '12px' }}>Syncing tracks with database...</p>
          </div>
        )}

        <div className="playlists-carousel">
          {[
            ...featuredPlaylists
          ].map((playlist) => {
            const hasThumb = !!playlist.thumbnail_url;
            return (
              <div 
                key={playlist.id} 
                className="playlist-card"
                onClick={() => handleLoadPlaylist(playlist.id)}
              >
                <div 
                  className="playlist-thumb-wrapper" 
                  style={hasThumb ? { backgroundImage: `url(${playlist.thumbnail_url})`, backgroundSize: 'cover', backgroundPosition: 'center' } : { background: playlist.gradient }}
                >
                  {!hasThumb && <span className="playlist-procedural-icon">{playlist.icon}</span>}
                  <div className="playlist-overlay-play" onClick={(e) => handlePlayPlaylistDirectly(e, playlist.id)}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="#ffffff">
                      <polygon points="6 3 20 12 6 21 6 3" />
                    </svg>
                  </div>
                </div>
                <span className="playlist-card-title">{playlist.title}</span>
              </div>
            );
          })}
        </div>
      </section>

      {/* Preset Chip Bar */}
      <section className="presets-section">
        <div className="presets-row-header">
          <span className="section-title">Select Mood</span>
          {timeBadge && (
            <span className="time-badge">{timeBadge}</span>
          )}
        </div>
        <PresetButtons 
          activePreset={activePreset} 
          onSelectPreset={handleSelectPreset}
          showForYou={!!tasteProfile}
          onSelectForYou={handleSelectForYou}
        />
      </section>

      {/* Discovery Dial */}
      <section className="discovery-dial">
        <div className="discovery-labels">
          <span>🔒 Comfort</span>
          <span>🔮 Discover</span>
        </div>
        <input
          type="range"
          className="discovery-slider"
          min="0"
          max="1"
          step="0.05"
          value={discovery}
          onChange={(e) => setDiscovery(parseFloat(e.target.value))}
          style={{ '--discovery-percent': `${discovery * 100}%` }}
        />
      </section>

      {/* Advanced sliders toggle */}
      <section className="advanced-toggle-section">
        <button 
          onClick={() => setShowAdvanced(!showAdvanced)} 
          className="advanced-toggle-btn"
          type="button"
        >
          <span>Advanced Parameters Control</span>
          <svg 
            className={`chevron-icon ${showAdvanced ? 'open' : ''}`} 
            width="18" 
            height="18" 
            viewBox="0 0 24 24" 
            fill="none" 
            stroke="currentColor" 
            strokeWidth="2.5"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
        {showAdvanced && (
          <div className="sliders-drawer">
            <ParameterSliders values={params} onChange={(newParams) => {
              setActivePreset('custom');
              setParams(newParams);
              setTimeBadge(null);
            }} />
          </div>
        )}
      </section>

      {/* Feed Song Card Grid — Sectioned Layout */}
      <main className="feed-main">
        <div className="feed-grid-header">
          <span className="section-title">Parametric Feed</span>
          <button 
            className="refresh-feed-btn"
            onClick={() => fetchFeed(selectedLanguage, params)}
            disabled={loadingFeed}
            aria-label="Refresh Feed"
          >
            <svg 
              className={loadingFeed ? 'spin' : ''} 
              width="18" 
              height="18" 
              viewBox="0 0 24 24" 
              fill="none" 
              stroke="currentColor" 
              strokeWidth="2.5"
            >
              <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
            </svg>
          </button>
        </div>

        {feedError && (
          <div className="error-box">
            <p>Error loading feed: {feedError}</p>
            <button onClick={() => fetchFeed(selectedLanguage, params)}>Try Again</button>
          </div>
        )}

        {loadingFeed ? (
          <div className="feed-loading-container">
            <div className="spinner-large" />
            <p>Generating personalized feed...</p>
          </div>
        ) : feedSections.length > 0 ? (
          /* Sectioned feed from /feed/sections */
          <div className="feed-sections-container">
            {feedSections.map((section, idx) => (
              section.section_type === 'horizontal_scroll'
                ? renderHorizontalSection(section)
                : renderGridSection(section)
            ))}
          </div>
        ) : tracks.length === 0 ? (
          <div className="empty-feed-box">
            <p>No tracks found in database for this configuration.</p>
            <p className="subtext">Make sure to import seed data via the sync endpoint first!</p>
          </div>
        ) : (
          /* Fallback: old flat feed layout with Quick Picks + Recommended Mix */
          <div className="feed-sections-container">
            {tracks.length > 4 && (
              <div className="quick-picks-section">
                <div 
                  className="quick-picks-header-toggle" 
                  onClick={() => setIsQuickPicksOpen(!isQuickPicksOpen)}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', marginBottom: '12px' }}
                >
                  <span className="section-title">Quick Picks</span>
                  <svg 
                    className={`chevron-icon ${isQuickPicksOpen ? 'open' : ''}`} 
                    width="18" 
                    height="18" 
                    viewBox="0 0 24 24" 
                    fill="none" 
                    stroke="currentColor" 
                    strokeWidth="2.5"
                    style={{ transition: 'transform 0.2s ease', transform: isQuickPicksOpen ? 'rotate(180deg)' : 'rotate(0deg)', color: 'var(--text-secondary)' }}
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </div>
                <div className={`collapsible-content ${isQuickPicksOpen ? 'expanded' : 'collapsed'}`}>
                  <div className="quick-picks-grid">
                    {tracks.slice(0, 12).map((track, index) => {
                      const songImg = track.thumbnail_url || `https://i.ytimg.com/vi/${track.youtube_id}/mqdefault.jpg`;
                      return (
                        <div 
                          key={`quick-${track.id}`} 
                          className="quick-pick-item"
                          onClick={() => onSelectTrack(track, tracks, index)}
                        >
                          <div className="quick-pick-thumb-wrapper">
                            <img src={songImg} alt="" className="quick-pick-thumb" referrerPolicy="no-referrer" />
                            <div className="quick-pick-overlay">
                              <svg className="quick-pick-play-icon" viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
                                <path d="M8 5v14l11-7z" />
                              </svg>
                            </div>
                          </div>
                          <div className="quick-pick-info">
                            <span className="quick-pick-title">{track.track_name}</span>
                            <span className="quick-pick-artist">{track.artist}</span>
                          </div>
                          <div className="quick-pick-actions" onClick={(e) => e.stopPropagation()}>
                            <button 
                              className="quick-pick-action-btn"
                              onClick={() => onPlayNext && onPlayNext(track)}
                              title="Play Next"
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                <polyline points="5 4 15 12 5 20 5 4" />
                                <line x1="19" y1="4" x2="19" y2="20" />
                              </svg>
                            </button>
                            <button 
                              className="quick-pick-action-btn"
                              onClick={() => onAddToQueue && onAddToQueue(track)}
                              title="Add to Queue"
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                <line x1="12" y1="5" x2="12" y2="19" />
                                <line x1="5" y1="12" x2="19" y2="12" />
                              </svg>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            <div className="parametric-mix-section" style={{ marginTop: '24px' }}>
              <div 
                className="parametric-mix-header-toggle" 
                onClick={() => setIsRecommendedMixOpen(!isRecommendedMixOpen)}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', marginBottom: '12px' }}
              >
                <span className="section-title">Recommended Mix</span>
                <svg 
                  className={`chevron-icon ${isRecommendedMixOpen ? 'open' : ''}`} 
                  width="18" 
                  height="18" 
                  viewBox="0 0 24 24" 
                  fill="none" 
                  stroke="currentColor" 
                  strokeWidth="2.5"
                  style={{ transition: 'transform 0.2s ease', transform: isRecommendedMixOpen ? 'rotate(180deg)' : 'rotate(0deg)', color: 'var(--text-secondary)' }}
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </div>
              <div className={`collapsible-content ${isRecommendedMixOpen ? 'expanded' : 'collapsed'}`}>
                <div className="songs-grid">
                  {tracks.slice(tracks.length > 4 ? 12 : 0).map((track, index) => (
                    <SongCard 
                      key={track.id} 
                      track={track} 
                      onClick={() => onSelectTrack(track, tracks, tracks.length > 4 ? index + 12 : index)}
                      onPlayNext={onPlayNext}
                      onAddToQueue={onAddToQueue}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
      {/* Playlist Details Overlay */}
      {activePlaylist && (
        <div className="playlist-modal-overlay" onClick={() => setActivePlaylist(null)}>
          <div className="playlist-modal-container" onClick={(e) => e.stopPropagation()}>
            <button className="playlist-modal-close-btn" onClick={() => setActivePlaylist(null)}>✕</button>
            <div className="playlist-modal-header">
              <img 
                src={activePlaylist.thumbnail_url || 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=300&q=80'} 
                alt={activePlaylist.title} 
                className="playlist-modal-thumb" 
                referrerPolicy="no-referrer"
              />
              <div className="playlist-modal-meta">
                <span className="playlist-modal-title">{activePlaylist.title}</span>
                <p className="playlist-modal-desc">{activePlaylist.description || 'No description available.'}</p>
                <div style={{ display: 'flex', gap: '8px', marginTop: '12px', flexWrap: 'wrap' }}>
                  {activePlaylist.tracks && activePlaylist.tracks.length > 0 && (
                    <button 
                      className="playlist-play-all-btn"
                      onClick={() => {
                        onSelectTrack(activePlaylist.tracks[0], activePlaylist.tracks, 0);
                        setActivePlaylist(null);
                      }}
                    >
                      ▶ Play All ({activePlaylist.tracks.length} songs)
                    </button>
                  )}
                  <button 
                    className={`playlist-save-btn ${isPlaylistSaved ? 'saved' : ''}`}
                    onClick={handleToggleSavePlaylist}
                    style={{
                      background: isPlaylistSaved ? 'rgba(255, 255, 255, 0.1)' : 'var(--accent-primary, #8b5cf6)',
                      border: isPlaylistSaved ? '1px solid rgba(255, 255, 255, 0.2)' : 'none',
                      color: '#ffffff',
                      padding: '8px 16px',
                      borderRadius: '20px',
                      cursor: 'pointer',
                      fontWeight: 'bold',
                      fontSize: '13px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      transition: 'all 0.2s ease'
                    }}
                  >
                    {isPlaylistSaved ? '❤️ In Library' : '🤍 Save to Library'}
                  </button>
                </div>
              </div>
            </div>
            <div className="playlist-modal-body">
              {activePlaylist.tracks && activePlaylist.tracks.length > 0 ? (
                activePlaylist.tracks.map((track, index) => {
                  const songImg = track.thumbnail_url || `https://i.ytimg.com/vi/${track.youtube_id}/mqdefault.jpg`;
                  return (
                    <div 
                      key={track.id || track.youtube_id} 
                      className="playlist-song-row"
                      onClick={() => {
                        onSelectTrack(track, activePlaylist.tracks, index);
                        setActivePlaylist(null);
                      }}
                    >
                      <img src={songImg} alt="" className="playlist-song-thumb" referrerPolicy="no-referrer" />
                      <div className="playlist-song-info">
                        <span className="playlist-song-title">{track.track_name}</span>
                        <span className="playlist-song-artist">{track.artist}</span>
                      </div>
                    </div>
                  );
                })
              ) : (
                <p style={{ textAlign: 'center', padding: '20px', color: 'var(--text-secondary)' }}>No tracks in this playlist.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


export default FeedScreen;
