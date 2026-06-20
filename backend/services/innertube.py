import re
from ytmusicapi import YTMusic

class InnertubeService:
    def __init__(self):
        # Initialize without auth headers as requested (unofficial API, no key)
        self.yt = YTMusic()

    def parse_duration(self, duration_str: str) -> int:
        """Parse duration string like '3:45' or '1:02:30' into milliseconds."""
        if not duration_str:
            return 0
        try:
            parts = list(map(int, duration_str.split(':')))
            seconds = 0
            if len(parts) == 1:
                seconds = parts[0]
            elif len(parts) == 2:
                seconds = parts[0] * 60 + parts[1]
            elif len(parts) == 3:
                seconds = parts[0] * 3600 + parts[1] * 60 + parts[2]
            return seconds * 1000
        except Exception:
            return 0

    def search_track(self, query: str):
        """Search YouTube Music for a song and return normalized track info."""
        try:
            results = self.yt.search(query, filter="songs")
            if not results:
                return None
            
            # Use the first search result
            item = results[0]
            youtube_id = item.get("videoId")
            if not youtube_id:
                return None
            
            track_name = item.get("title", "")
            
            artists = item.get("artists", [])
            artist_names = [a.get("name", "") for a in artists]
            artist = ", ".join(artist_names) if artist_names else "Unknown Artist"
            
            album_data = item.get("album")
            album = album_data.get("name") if album_data else None
            
            thumbnails = item.get("thumbnails", [])
            thumbnail_url = thumbnails[-1].get("url") if thumbnails else f"https://i.ytimg.com/vi/{youtube_id}/mqdefault.jpg"
            
            # Duration parsing
            duration_ms = 0
            if "duration_seconds" in item:
                duration_ms = int(item["duration_seconds"]) * 1000
            elif "duration" in item:
                duration_ms = self.parse_duration(item["duration"])
            
            # Basic defaults
            language = "en"  # Default fallback, can be refined based on query or track name
            explicit = item.get("isExplicit", False)
            
            return {
                "youtube_id": youtube_id,
                "track_name": track_name,
                "artist": artist,
                "album": album,
                "thumbnail_url": thumbnail_url,
                "duration_ms": duration_ms,
                "language": language,
                "explicit": explicit
            }
        except Exception as e:
            print(f"Error searching track: {e}")
            return None

    def search_tracks_list(self, query: str, limit: int = 5):
        """Search YouTube Music for songs and return a list of normalized track infos."""
        try:
            results = self.yt.search(query, filter="songs")
            if not results:
                return []
            
            tracks = []
            for item in results[:limit]:
                youtube_id = item.get("videoId")
                if not youtube_id:
                    continue
                
                track_name = item.get("title", "")
                
                artists = item.get("artists", [])
                artist_names = [a.get("name", "") for a in artists]
                artist = ", ".join(artist_names) if artist_names else "Unknown Artist"
                
                album_data = item.get("album")
                album = album_data.get("name") if album_data else None
                
                thumbnails = item.get("thumbnails", [])
                thumbnail_url = thumbnails[-1].get("url") if thumbnails else f"https://i.ytimg.com/vi/{{youtube_id}}/mqdefault.jpg"
                
                duration_ms = 0
                if "duration_seconds" in item:
                    duration_ms = int(item["duration_seconds"]) * 1000
                elif "duration" in item:
                    duration_ms = self.parse_duration(item["duration"])
                
                language = "en"
                explicit = item.get("isExplicit", False)
                
                tracks.append({
                    "youtube_id": youtube_id,
                    "track_name": track_name,
                    "artist": artist,
                    "album": album,
                    "thumbnail_url": thumbnail_url,
                    "duration_ms": duration_ms,
                    "language": language,
                    "explicit": explicit
                })
            return tracks
        except Exception as e:
            print(f"Error in search_tracks_list: {e}")
            return []

    def get_playlist_tracks(self, playlist_id: str, limit: int = None):
        """Fetch details and tracks of a public YouTube Music playlist."""
        try:
            # Fetch playlist tracks using limit (None fetches all tracks)
            playlist = self.yt.get_playlist(playlistId=playlist_id, limit=limit)
            if not playlist or "tracks" not in playlist:
                return {"title": "Unknown Playlist", "tracks": []}
            
            tracks = []
            for item in playlist["tracks"]:
                youtube_id = item.get("videoId")
                if not youtube_id:
                    continue
                
                track_name = item.get("title", "")
                
                artists = item.get("artists", [])
                artist_names = [a.get("name", "") for a in artists]
                artist = ", ".join(artist_names) if artist_names else "Unknown Artist"
                
                album_data = item.get("album")
                album = album_data.get("name") if album_data and isinstance(album_data, dict) else (album_data if isinstance(album_data, str) else None)
                
                thumbnails = item.get("thumbnails", [])
                thumbnail_url = thumbnails[-1].get("url") if thumbnails else f"https://i.ytimg.com/vi/{youtube_id}/mqdefault.jpg"
                
                duration_ms = 0
                if "duration_seconds" in item:
                    duration_ms = int(item["duration_seconds"]) * 1000
                elif "duration" in item:
                    duration_ms = self.parse_duration(item["duration"])
                
                language = "en"  # Default
                explicit = item.get("isExplicit", False)
                
                tracks.append({
                    "youtube_id": youtube_id,
                    "track_name": track_name,
                    "artist": artist,
                    "album": album,
                    "thumbnail_url": thumbnail_url,
                    "duration_ms": duration_ms,
                    "language": language,
                    "explicit": explicit
                })
            
            return {
                "title": playlist.get("title", "Unknown Playlist"),
                "description": playlist.get("description", ""),
                "thumbnail_url": playlist.get("thumbnails", [{}])[-1].get("url"),
                "tracks": tracks
            }
        except Exception as e:
            print(f"Error in get_playlist_tracks: {e}")
            return {"title": "Error Loading Playlist", "tracks": []}


    def get_stream_url(self, youtube_id: str) -> str:
        """Retrieve stream URL for a youtube video ID."""
        try:
            song_data = self.yt.get_song(videoId=youtube_id)
            streaming_data = song_data.get("streamingData", {})
            adaptive_formats = streaming_data.get("adaptiveFormats", [])
            
            # Find audio-only formats
            audio_formats = [f for f in adaptive_formats if f.get("mimeType", "").startswith("audio/")]
            
            if not audio_formats:
                # Fallback to any adaptive format
                audio_formats = adaptive_formats
            
            if not audio_formats:
                raise ValueError("No adaptive formats found for video.")
            
            # Sort to prioritize audio/mp4 (AAC) over audio/webm (Opus) because it decodes reliably in browser OfflineAudioContext
            audio_formats.sort(key=lambda x: (1 if "audio/mp4" in x.get("mimeType", "") else 0, int(x.get("bitrate", 0))), reverse=True)
            
            # Try to find a format with a direct URL
            for fmt in audio_formats:
                url = fmt.get("url")
                if url:
                    return url
            
            # If no direct URL, it might be ciphered. Try to extract signatureCipher
            for fmt in audio_formats:
                cipher = fmt.get("signatureCipher") or fmt.get("cipher")
                if cipher:
                    # Parse signatureCipher which is query-string-like: url=...&s=...&sp=sig
                    from urllib.parse import parse_qs
                    parsed = parse_qs(cipher)
                    url_list = parsed.get("url")
                    if url_list:
                        # Return the url component. Without JS deciphering, this might fail,
                        # but we return it as a best effort.
                        return url_list[0]
            
            # Last fallback
            raise ValueError("No direct stream URL found.")
        except Exception as e:
            print(f"Error getting stream URL for {youtube_id}: {e}")
            raise e

innertube_service = InnertubeService()
