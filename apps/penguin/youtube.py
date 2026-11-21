"""YouTube (videos) by voice, on the SAME Google account as YouTube Music: one sign-in (gcal.session('youtube')), one browser profile.
Videos open in the Chrome/Edge profile signed in as that account, so subscriptions, history and Premium apply. Handed to Gemini as tools."""
import urllib.parse
from gcal import session
from commands import open_music_url          # opens any URL in the connected account's browser profile

API = "https://www.googleapis.com/youtube/v3"

def _search(query, n):
    d = session("youtube").get(API + "/search", params={"part": "snippet", "q": query, "type": "video", "maxResults": n}, timeout=15).json()
    if "error" in d: raise RuntimeError(d["error"].get("message", "YouTube error"))
    return [(i["id"]["videoId"], i["snippet"]["title"], i["snippet"]["channelTitle"]) for i in d.get("items", [])]

def search_youtube(query: str) -> str:
    """Search YouTube and list the top 5 videos (title and channel) without playing anything."""
    try: hits = _search(query, 5)
    except Exception as e: return f"could not search YouTube: {e}"
    return "\n".join(f"{t} - {c}" for _, t, c in hits) or "no videos found"

def play_youtube(query: str) -> str:
    """Play a YouTube VIDEO (not a song: use play_music for songs) in the user's signed-in browser. query: what to watch, e.g. 'Naval Ravikant interview' or 'how to file GST return'."""
    try:
        hits = _search(query, 1)
        if hits: open_music_url("https://www.youtube.com/watch?v=" + hits[0][0]); return f"playing {hits[0][1]} on YouTube"
    except Exception: pass                    # API off or out of quota: the search results page still works, no API needed
    open_music_url("https://www.youtube.com/results?search_query=" + urllib.parse.quote_plus(query)); return f"opened YouTube search for {query!r}"

def list_subscriptions() -> str:
    """List the channels the user is subscribed to on YouTube (up to 50, alphabetical)."""
    try:
        d = session("youtube").get(API + "/subscriptions", params={"part": "snippet", "mine": "true", "maxResults": 50, "order": "alphabetical"}, timeout=15).json()
        if "error" in d: return f"could not read subscriptions: {d['error'].get('message', 'YouTube error')}"
        return ", ".join(i["snippet"]["title"] for i in d.get("items", [])) or "no subscriptions"
    except Exception as e: return f"could not read subscriptions: {e}"

TOOLS = [play_youtube, search_youtube, list_subscriptions]
