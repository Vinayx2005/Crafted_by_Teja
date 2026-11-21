"""YouTube Music library by voice, using its own Google sign-in (gcal.session('youtube')). Handed to Gemini as tools."""
import difflib
from gcal import session
from commands import open_music_url

API = "https://www.googleapis.com/youtube/v3/playlists"

def _playlists():
    d = session("youtube").get(API, params={"part": "snippet", "mine": "true", "maxResults": 50}, timeout=15).json()
    if "error" in d: raise RuntimeError(d["error"].get("message", "YouTube error"))
    return {"liked songs": "LL", **{i["snippet"]["title"].lower(): i["id"] for i in d.get("items", [])}}

def list_my_playlists() -> str:
    """List the names of the user's own YouTube Music / YouTube playlists (plus Liked songs)."""
    try: return ", ".join(n for n in _playlists()) 
    except Exception as e: return f"could not read playlists: {e}"

def play_my_playlist(name: str) -> str:
    """Play one of the user's OWN playlists, or 'liked songs', on YouTube Music. name: the playlist name as the user said it."""
    try: pl = _playlists()
    except Exception as e: return f"could not read playlists: {e}"
    hit = difflib.get_close_matches(name.lower(), pl, 1, 0.5) or [n for n in pl if name.lower() in n]
    if not hit: return f"no playlist called {name!r}; you have: {', '.join(pl)}"
    open_music_url("https://music.youtube.com/playlist?list=" + pl[hit[0]]); return f"playing your playlist {hit[0]}"

TOOLS = [list_my_playlists, play_my_playlist]
