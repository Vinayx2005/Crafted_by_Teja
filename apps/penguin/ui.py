"""Penguin's local web UI: a tiny stdlib HTTP + Server-Sent-Events server that serves ui/index.html and streams events to it.
Listens on 127.0.0.1 only. Pages must present a per-run token, so other websites can't drive Penguin."""
import json, os, queue, re, secrets, shutil, subprocess, threading, time, webbrowser
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
TOKEN = secrets.token_urlsafe(16)
state = {"state": "loading", "muted": False, "armed": False, "armed_at": 0.0, "click": True, "english": False, "voice": True, "barge": True}      # read by the main loop (muted)
on_interrupt = None                                # set by penguin.py: cuts Penguin off mid-sentence
perm_q, perm_ready = queue.Queue(), [False]        # permission requests for the floating button's Allow / Deny box (mcp_tools.py); perm_ready is set once the button exists
on_english = None                                  # set by penguin.py: switches the English teacher mode
mic_options = on_select_mic = None                  # set by penguin.py: the microphone dropdown
inbox = None                                      # queue the main loop reads typed text from (set by start)
_subs, _hist, _lock = [], [], threading.Lock()

def resting():
    """The status Penguin shows when it is not busy."""
    return "muted" if state["muted"] else "listening" if state["armed"] or not state["click"] else "idle"

def set_voice(on):
    """The Settings switch: the wake word "Penguin" on/off. Off = saying "Penguin" no longer wakes it; the button, the circle, typing, notes and everything else work as before. Remembered across restarts."""
    from commands import set_setting
    state["voice"] = bool(on); set_setting("wake_word", bool(on))
    emit("voice", on=state["voice"]); emit("live", text=""); emit("status", state=resting())

def ask_permission(title, detail, timeout=60):
    """Block until the user answers the Allow once / Always allow / Deny box shown by the floating button. Returns 'once', 'always' or 'deny' (also 'deny' on timeout, or if there is no button to show the box)."""
    if not perm_ready[0]: return "deny"
    box, ev = {"answer": "deny"}, threading.Event()
    perm_q.put((title, detail, box, ev, time.time() + timeout)); ev.wait(timeout + 2)
    return box["answer"]

def set_barge(on):
    """Settings switch: interrupting Penguin while it talks. Remembered across restarts."""
    from commands import set_setting
    state["barge"] = bool(on); set_setting("barge_in", bool(on)); emit("barge", on=state["barge"])

def emit(type, **data):
    """Send an event to every open page. status/user/action/reply/error are kept so a reloaded page can show the conversation."""
    ev = {"type": type, **data}
    with _lock:
        if type == "status": state["state"] = data["state"]
        if type in ("user", "action", "reply", "error"): _hist.append(ev); del _hist[:-100]
        for s in _subs:
            if type != "level" or s.qsize() < 50: s.put(ev)       # drop meter ticks for a stalled page

def _apps():
    """Connected apps for the window. Calendar and YouTube Music each have their own Google account."""
    import gcal
    from commands import get_setting, browser_for
    yt = get_setting("youtube_music_email"); b = browser_for(yt) if yt else None
    return {"youtube_music": {"email": yt, "browser": b[2] if b else None, **gcal.status("youtube")},
            "google_calendar": {"email": get_setting("calendar_email"), **gcal.status("calendar")},
            "google_tasks": {"email": get_setting("tasks_email"), **gcal.status("tasks")},
            "gmail": {"email": get_setting("gmail_email"), **gcal.status("gmail")},
            "pft": __import__("pft").status()}

PORT = 8765
_pft_state = ""      # one-time value PFT's connect page must echo back, so only a page this Connect click opened can link an account

def _pft_connect():
    import pft; global _pft_state
    _pft_state = secrets.token_urlsafe(24)
    webbrowser.open(f"{pft.url()}/connect-penguin?port={PORT}&state={_pft_state}")

def _try(f):
    try: f()
    except Exception as e: emit("error", text=f"Google sign-in failed: {e}")

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _host_ok(self): return self.headers.get("Host", "").split(":")[0] in ("127.0.0.1", "localhost")
    def _send(self, code, body=b"", ctype="text/plain"):
        self.send_response(code); self.send_header("Content-Type", ctype); self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store"); self.end_headers(); self.wfile.write(body)
    def _write(self, ev): self.wfile.write(b"data: " + json.dumps(ev).encode() + b"\n\n"); self.wfile.flush()

    def do_GET(self):
        if not self._host_ok(): return self._send(403)
        path, _, query = self.path.partition("?")
        if path == "/":
            html = open(os.path.join(HERE, "ui", "index.html"), encoding="utf-8").read().replace("__TOKEN__", TOKEN)
            return self._send(200, html.encode(), "text/html; charset=utf-8")
        q = {k: v[0] for k, v in urllib.parse.parse_qs(query).items()}
        if path == "/api/mcp" and q.get("t") == TOKEN:
            import mcp_tools; return self._send(200, json.dumps(mcp_tools.status()).encode(), "application/json")
        if path == "/api/mics" and q.get("t") == TOKEN and mic_options: return self._send(200, json.dumps(mic_options()).encode(), "application/json")
        if path == "/api/notes" and q.get("t") == TOKEN:
            import notes
            slim = [{k: n[k] for k in ("id", "created", "kind", "title", "summary", "seconds")} for n in notes.all_notes()]
            return self._send(200, json.dumps({"recording": notes.rec.active, "notes": slim}).encode(), "application/json")
        if path == "/api/note" and q.get("t") == TOKEN:
            import notes; n = notes.get(q.get("id"))
            return self._send(200, json.dumps(n).encode(), "application/json") if n else self._send(404)
        if path == "/note-audio" and q.get("t") == TOKEN:
            import notes; n = notes.get(q.get("id"))
            if not n or not n["audio"]: return self._send(404)
            return self._send(200, open(notes._path(n["id"], "wav"), "rb").read(), "audio/wav")
        if path == "/events" and query == "t=" + TOKEN: return self._events()
        if path == "/api/apps" and query == "t=" + TOKEN: return self._send(200, json.dumps(_apps()).encode(), "application/json")
        self._send(404)

    def do_POST(self):
        if self.path == "/pft-callback": return self._pft_callback()
        if not self._host_ok() or self.headers.get("X-Penguin-Token") != TOKEN: return self._send(403)
        try: body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
        except ValueError: return self._send(400)
        if self.path == "/api/mute":
            state["muted"] = bool(body.get("muted")); emit("status", state=resting())
        elif self.path == "/api/say" and str(body.get("text", "")).strip(): inbox.put(str(body["text"]).strip()[:500])
        elif self.path == "/api/mic" and on_select_mic and isinstance(body.get("id"), str):
            msg = on_select_mic(body["id"][:200])
            return self._send(200, json.dumps({"message": msg, **mic_options()}).encode(), "application/json")
        elif self.path == "/api/english" and on_english:
            msg = on_english(bool(body.get("on")))
            return self._send(200, json.dumps({"message": msg, "english": state["english"]}).encode(), "application/json")
        elif self.path == "/api/voice": set_voice(body.get("on"))
        elif self.path == "/api/barge": set_barge(body.get("on"))
        elif self.path == "/api/arm":           # the user clicked the circle: toggle listening on/off
            if state["muted"]: emit("error", text="Penguin is muted: press Unmute first.")
            elif state["state"] == "loading": pass
            else:
                state["armed"] = not state["armed"]
                if state["armed"] and on_interrupt: on_interrupt()          # clicking to talk cuts Penguin off
                emit("live", text=""); emit("status", state=resting())
        elif self.path == "/api/notes":
            import notes; act = body.get("action")
            if act == "record_start": msg = notes.begin()
            elif act == "record_stop": msg = notes.finish()
            elif act == "add" and str(body.get("text", "")).strip(): msg = "saved note: " + notes.save(str(body["text"]).strip()[:20000], "text")["title"]
            elif act == "delete": msg = "deleted" if notes.remove(str(body.get("id", ""))) else "no such note"
            else: return self._send(400)
            return self._send(200, json.dumps({"message": msg, "recording": notes.rec.active}).encode(), "application/json")
        elif self.path == "/api/gcal":
            import gcal, pft
            svc = body.get("service")
            if svc == "pft":
                if body.get("action") == "disconnect": pft.disconnect()
                else: _pft_connect()
                return self._send(200, json.dumps(_apps()).encode(), "application/json")
            if svc not in gcal.SERVICES: return self._send(400)
            if body.get("action") == "disconnect": gcal.disconnect(svc)
            elif not gcal.status(svc)["ready"]:      # first-time setup: open the credentials page and the folder to drop client_secret.json in
                webbrowser.open("https://console.cloud.google.com/apis/credentials"); os.startfile(HERE)
            else:          # browser sign-in blocks until finished, so run it off the request thread
                threading.Thread(target=lambda: _try(lambda: gcal.session(svc, interactive=True)), daemon=True).start()
            return self._send(200, json.dumps(_apps()).encode(), "application/json")
        elif self.path == "/api/apps":
            email = str(body.get("email", "")).strip()[:100]
            if email and not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email): return self._send(400)
            from commands import set_setting; set_setting("youtube_music_email", email)
            return self._send(200, json.dumps(_apps()).encode(), "application/json")
        else: return self._send(404)
        self._send(204)

    def _pft_callback(self):
        """PFT's /connect-penguin page posts the new session here (a plain form POST from the browser)."""
        global _pft_state
        import pft
        if not self._host_ok(): return self._send(403)
        f = {k: v[0] for k, v in urllib.parse.parse_qs(self.rfile.read(min(int(self.headers.get("Content-Length", 0)), 20000)).decode()).items()}
        ok = _pft_state and secrets.compare_digest(f.get("state", ""), _pft_state) and f.get("refresh_token") and f.get("supabase_url")
        _pft_state = ""                                         # single use
        if ok: pft.save(f)
        page = "Penguin is connected to Personal FT. You can close this tab." if ok else "Could not connect: start again from Penguin's Apps panel."
        self._send(200, f"<!doctype html><meta charset=utf-8><title>Penguin</title><body style='font:18px sans-serif;padding:3em'>{page}".encode(), "text/html; charset=utf-8")

    def _events(self):
        self.send_response(200); self.send_header("Content-Type", "text/event-stream"); self.send_header("Cache-Control", "no-store")
        self.end_headers()
        q = queue.Queue()
        with _lock: _subs.append(q); hello = {"type": "hello", "state": dict(state), "history": list(_hist)}
        try:
            self._write(hello)
            while True:
                try: self._write(q.get(timeout=4))
                except queue.Empty: self.wfile.write(b": keepalive\n\n"); self.wfile.flush()
        except OSError: pass                                      # page closed
        finally:
            with _lock: _subs.remove(q)

def _quit_when_closed(grace=10):
    """Exit once the window we opened has been closed (no page connected) for `grace` seconds - the mic must not stay on unseen."""
    seen, gone = False, None
    while True:
        time.sleep(2)
        with _lock: n = len(_subs)
        if n: seen, gone = True, None
        elif seen: gone = gone or time.time()
        if gone and time.time() - gone > grace: os._exit(0)

def show_window():
    """Open the app-style window (Edge, else the default browser)."""
    edge = shutil.which("msedge") or os.path.expandvars(r"%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe")
    if os.path.exists(edge): subprocess.Popen([edge, f"--app={_url}", "--window-size=480,800"])     # app-style window, no tabs/address bar
    else: webbrowser.open(_url)

def start(inbox_queue, open_window=True):
    """Start serving (background thread) and, if asked, open the window (closing the window leaves Penguin and its floating button running; Quit is in the button's right-click menu). Returns the URL."""
    global inbox, PORT
    inbox = inbox_queue
    from commands import get_setting; state["voice"] = get_setting("wake_word") is not False      # saved by the Settings switch (on by default)
    state["barge"] = get_setting("barge_in") is not False and os.environ.get("PENGUIN_BARGE_IN") != "0"
    class Server(ThreadingHTTPServer):
        allow_reuse_address = False           # on Windows True lets a 2nd instance silently share the port with the 1st
        daemon_threads = True
    for port in range(8765, 8776):
        try: server = Server(("127.0.0.1", port), Handler); break
        except OSError: continue
    else: raise RuntimeError("no free port between 8765 and 8775")
    PORT = port
    import notes; notes.events = emit; notes.blocked = lambda: "Penguin is muted, so it cannot hear anything: press Unmute, then record again" if state["muted"] else "Penguin is still starting up: try again in a few seconds" if state["state"] == "loading" else ""     # keep the window in sync; refuse to record while muted
    threading.Thread(target=server.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{port}"
    global _url; _url = url
    if open_window:
        show_window()
    return url
