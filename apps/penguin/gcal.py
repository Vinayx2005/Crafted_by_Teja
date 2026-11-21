"""Google Calendar for Penguin: read, add, change, delete events on the user's primary calendar. Handed to Gemini as tools.
One-time setup (README): put an OAuth "Desktop app" client_secret.json here, then press Connect in the Apps panel (or `python gcal.py`) to sign in in the browser.
The token is saved to gcal_token.json (gitignored). Only event text goes to/from Google's Calendar API."""
import json, os
from datetime import datetime, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
SECRET = os.path.join(HERE, "client_secret.json")
EMAIL = "openid https://www.googleapis.com/auth/userinfo.email".split()       # Google always adds openid; asking for it avoids a "scope has changed" error.  which account signed in (shown in the Apps panel; picks the YouTube Music browser profile)
SERVICES = {      # each service has its own sign-in, token and account, so Calendar and YouTube Music can use different Google accounts
    "calendar": {"token": os.path.join(HERE, "gcal_token.json"), "setting": "calendar_email",
                 "scopes": ["https://www.googleapis.com/auth/calendar.events", *EMAIL]},      # events only: no access to calendar settings or sharing
    "youtube": {"token": os.path.join(HERE, "ytm_token.json"), "setting": "youtube_music_email",
                "scopes": ["https://www.googleapis.com/auth/youtube.readonly", *EMAIL]},     # list the user's playlists (ytm.py)
    "tasks": {"token": os.path.join(HERE, "tasks_token.json"), "setting": "tasks_email",
              "scopes": ["https://www.googleapis.com/auth/tasks", *EMAIL]},                 # Google Tasks (gtasks.py)
    "gmail": {"token": os.path.join(HERE, "gmail_token.json"), "setting": "gmail_email",
              "scopes": ["https://www.googleapis.com/auth/gmail.modify", *EMAIL]},          # read, draft, send, mark read; cannot permanently delete (gmail.py)
}
API = "https://www.googleapis.com/calendar/v3/calendars/primary/events"
_sessions, _expired = {}, set()      # _expired: services whose saved sign-in Google has revoked / let lapse

def session(svc, interactive=False):
    """Authorised requests session for 'calendar', 'youtube', 'tasks' or 'gmail'. Only interactive=True (the Apps panel's Connect button) may open the browser sign-in; a voice
    command never pops a browser: it raises RuntimeError with a plain message the assistant reads out (not 'no events')."""
    if svc in _sessions: return _sessions[svc]
    from google.oauth2.credentials import Credentials
    from google.auth.transport.requests import Request, AuthorizedSession
    from commands import set_setting
    c = SERVICES[svc]
    creds = Credentials.from_authorized_user_file(c["token"], c["scopes"]) if status(svc)["connected"] else None      # a token missing a scope counts as none
    if creds and creds.expired and creds.refresh_token:
        try: creds.refresh(Request())
        except Exception as e:                     # invalid_grant: Google revoked the token (an OAuth app in "Testing" mode loses refresh tokens after 7 days) or it was removed
            if "invalid_grant" not in str(e): raise
            creds = None; _expired.add(svc)
    if not creds or not creds.valid:
        if not interactive: raise RuntimeError(f"The Google {svc} sign-in has expired or is missing. Open the Penguin app, go to Apps and press Connect to sign in again.")
        if not os.path.exists(SECRET): raise RuntimeError("Google is not connected: client_secret.json is missing (see README)")
        from google_auth_oauthlib.flow import InstalledAppFlow
        creds = InstalledAppFlow.from_client_secrets_file(SECRET, c["scopes"]).run_local_server(port=0, prompt="select_account consent")
        open(c["token"], "w", encoding="utf-8").write(creds.to_json())
        _expired.discard(svc)
        set_setting(c["setting"], AuthorizedSession(creds).get("https://www.googleapis.com/oauth2/v2/userinfo", timeout=15).json().get("email", ""))
    _sessions[svc] = AuthorizedSession(creds); return _sessions[svc]

def status(svc):
    """{'connected': signed in with every needed permission, 'ready': client_secret.json present} for the Apps panel."""
    try: ok = set(SERVICES[svc]["scopes"]) <= set(json.load(open(SERVICES[svc]["token"], encoding="utf-8")).get("scopes", []))
    except (OSError, ValueError): ok = False
    return {"connected": ok and svc not in _expired, "expired": svc in _expired, "ready": os.path.exists(SECRET)}

def disconnect(svc):
    from commands import set_setting
    _sessions.pop(svc, None)
    if os.path.exists(SERVICES[svc]["token"]): os.remove(SERVICES[svc]["token"])
    set_setting(SERVICES[svc]["setting"], "")

def _call(method, url=API, **kw):
    try: r = session("calendar").request(method, url, timeout=15, **kw)
    except RuntimeError as e: return {"error": str(e)}
    if r.status_code == 204: return {}
    return r.json() if r.ok else {"error": f"calendar error {r.status_code}: {r.text[:200]}"}

def _when(e):
    s = e.get("start", {}); return s.get("dateTime") or s.get("date") or ""

def list_events(start: str, end: str = "") -> str:
    """List the user's Google Calendar events. start/end are local ISO times like '2026-10-12T00:00:00'; end defaults to 7 days after start.
    Each line shows the event id, which you need for change_event / delete_event."""
    s = datetime.fromisoformat(start); e = datetime.fromisoformat(end) if end else s + timedelta(days=7)
    d = _call("GET", params={"timeMin": s.astimezone().isoformat(), "timeMax": e.astimezone().isoformat(),
                             "singleEvents": "true", "orderBy": "startTime", "maxResults": 25})
    if "error" in d: return d["error"]
    return "\n".join(f"{x['id']} | {_when(x)} | {x.get('summary', '(no title)')}" for x in d.get("items", [])) or "no events"

def add_event(title: str, start: str, end: str = "", description: str = "", location: str = "") -> str:
    """Add an event to the user's Google Calendar. start/end are local ISO times like '2026-10-12T15:00:00'; end defaults to 1 hour after start."""
    s = datetime.fromisoformat(start).astimezone(); e = datetime.fromisoformat(end).astimezone() if end else s + timedelta(hours=1)
    body = {"summary": title, "start": {"dateTime": s.isoformat()}, "end": {"dateTime": e.isoformat()}}
    if description: body["description"] = description
    if location: body["location"] = location
    d = _call("POST", json=body)
    return d.get("error") or f"added {title!r} at {_when(d)}"

def change_event(event_id: str, title: str = "", start: str = "", end: str = "", description: str = "", location: str = "") -> str:
    """Change an existing Google Calendar event (get event_id from list_events). Pass only the fields to change; times are local ISO.
    If only start is given the event keeps its length."""
    url = f"{API}/{event_id}"; body = {}
    if title: body["summary"] = title
    if description: body["description"] = description
    if location: body["location"] = location
    if start:
        old = _call("GET", url)
        if "error" in old: return old["error"]
        s = datetime.fromisoformat(start).astimezone()
        if end: e = datetime.fromisoformat(end).astimezone()
        else:
            o = old["start"].get("dateTime"); oe = old["end"].get("dateTime")
            e = s + (datetime.fromisoformat(oe) - datetime.fromisoformat(o) if o and oe else timedelta(hours=1))
        body["start"], body["end"] = {"dateTime": s.isoformat()}, {"dateTime": e.isoformat()}
    elif end: body["end"] = {"dateTime": datetime.fromisoformat(end).astimezone().isoformat()}
    d = _call("PATCH", url, json=body)
    return d.get("error") or f"updated {d.get('summary', 'event')!r}"

def delete_event(event_id: str, confirmed: bool = False) -> str:
    """Delete a Google Calendar event (irreversible). Pass confirmed=True only if the user explicitly asked to delete/cancel this event; otherwise leave it False and ask them."""
    if not confirmed: return "NOT deleted: ask the user to say so explicitly"
    d = _call("DELETE", f"{API}/{event_id}")
    return d.get("error") or "deleted the event"

TOOLS = [list_events, add_event, change_event, delete_event]

if __name__ == "__main__":        # sign in and show the next events
    session("calendar", interactive=True); print(list_events(datetime.now().replace(microsecond=0).isoformat()))
