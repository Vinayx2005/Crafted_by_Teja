"""Penguin voice commands for this laptop (fixed phrases, offline). Say "Penguin, <command>".
  open|launch|start <app>          any Start-menu app
  search [for] <text>              Google in the default browser
  volume up|down, mute, play, pause, next, previous
Anything else goes to Gemini (brain.py), which calls open_app / search_web / press_key as tools.
Run `python commands.py` to self-check the parser."""
import ctypes, difflib, json, os, re, subprocess, threading, urllib.parse, webbrowser

KEYS = {"volume up": 0xAF, "volume down": 0xAE, "mute": 0xAD, "play": 0xB3, "pause": 0xB3,
        "next": 0xB0, "previous": 0xB1}
_apps = {}

def _norm(s): return re.sub(r"[^a-z0-9 ]", "", s.lower()).strip()

def strip_wake(text):
    """'Hey Penguin, open chrome.' -> 'open chrome' (normalised, wake word and politeness removed); None if not addressed to Penguin."""
    words = _norm(text).split()
    if words[:1] in (["hey"], ["hi"], ["ok"]): words = words[1:]
    if not words: return None
    n = 1                                                                                # words used by the wake word
    if difflib.SequenceMatcher(None, words[0], "penguin").ratio() < 0.6:
        if words[:1] and words[0] in ("pengwin", "pengwen", "pengu", "pengin") or (len(words) > 1 and words[0] in ("ten", "10", "pen", "pan", "ben") and words[1] in ("win", "when", "gwen", "wing")): n = 1 if words[0].startswith("peng") else 2      # speech-to-text mishearings seen in the log: "10 win", "ten win"
        else: return None
    words = words[n - 1:]
    return re.sub(r"^((please|can you|could you|now|then|also|okay)\s+)+", "", " ".join(words[1:]))     # not next/so/just: "next song", "just eat"

def raw_command(text):
    """Like strip_wake but keeps the original punctuation and case: Gemini needs 'ravi@gmail.com', not 'ravigmailcom'."""
    return re.sub(r"^\W*(?:(?:hey|hi|ok)\W+)?\w+\W*", "", text, count=1, flags=re.I).strip()

def parse(text):
    """'Penguin, open chrome' -> ('open', 'chrome'); None if not addressed to Penguin."""
    cmd = strip_wake(text)
    if cmd is None: return None
    if re.search(r"\benglish\b", cmd) and re.match(r"(turn on|switch on|switch to|turn|switch|start|begin|enable|activate|open|launch|go|put|set)\b.*\benglish\b.*(teach|teacher|tutor|class|lesson|practi[cs]e|speaking|conversation|mode|coach)|(teach|coach) me english|english (teach(ing|er)?|tutor|coach|practice|speaking|class|lesson)( mode)?( on)?$|english mode( on)?$", cmd) and not re.search(r"\b(stop|exit|quit|end|leave|off|disable|close)\b", cmd): return "english", "on"      # before "start <app>"
    if re.search(r"\benglish\b", cmd) and re.match(r"(turn off|switch off|stop|exit|quit|end|leave|disable|close|finish)\b", cmd): return "english", "off"
    if re.match(r"(start|begin|resume)( a| the| my)?( new)?( voice| audio)? (recording|record)\b|record( a| the| my)?( voice| audio)?( note| memo| meeting| call| this| it| me)?$", cmd): return "record", "start"      # before "start <app>"
    if re.match(r"(stop|end|finish|save)( the| my)?( voice| audio)? record(ing)?\b", cmd): return "record", "stop"
    if re.match(r"(take|make|write|add|save|create|jot down)( a| an| the)?( quick| voice| new)? note\b\W*\w|note( that| down)? \w|jot down \w", cmd): return "note", cmd
    if m := re.match(r"(?:open|launch|start|run)\s+(.+)", cmd):
        # Allow-list: a plain launch only if it is a real installed app. "open daddys chat", "open the first chat" and
        # "open whatsapp and send ..." go to Gemini.
        rest = re.sub(r"^(the|my|a)\s+", "", m[1])
        if re.search(r"\b(and|then|on|in|inside|send|message|click|type|search|go to)\b", rest) or not _best(rest, _pc_apps()): return "unknown", cmd
        return "open", rest
    if m := re.match(r"(?:search|google|look up)(?: for)?\s+(.+)", cmd):
        rest = m[1]
        if re.match(r"google\s+\w+$", cmd) and _best(cmd, _pc_apps()): return "open", cmd            # "google chrome" is the app, not a search
        # "search whatsapp for ravi", "search for daddy in the chat" are in-app searches (Gemini), not Google searches
        if INAPP.search(rest) or ((w := re.match(r"(\w+)\s+for\s+\S", rest)) and _best(w[1], _pc_apps())): return "unknown", cmd
        return "search", rest
    if re.match(r"(spent|paid|bought|add (an )?expense)\b", cmd): return "expense", cmd           # logged in PFT (pft.py)
    if cmd in KEYS: return "key", cmd
    if m := re.match(r"play\s+(?:(?:some|the|a|my)\s+)?(.+?)(?:\s+(?:on|in)\s+(?:youtube\s*music|yt music|music))?$", cmd): return "music", m[1]
    return "unknown", cmd

# "search whatsapp for ravi" / "search for daddy in the chat" are in-app searches, not Google searches: they go to Gemini, which has no screen tools.
INAPP = re.compile(r"\b(in|on|inside|into) (the |this |that |my )?(notepad|chat|app|window|document|file|page|tab|whatsapp|chrome|browser|facebook|youtube|screen|folder|menu)\b", re.I)

def _pc_apps():
    """Start-menu apps {normalised name: AppID}. Never raises; an empty result is not cached, so the next call retries."""
    if not _apps:
        try:
            out = subprocess.run(["powershell", "-NoProfile", "-Command", "Get-StartApps | ConvertTo-Json"],
                                 capture_output=True, text=True, timeout=25).stdout
            data = json.loads(out or "[]")
            _apps.update({_norm(a["Name"]): a["AppID"] for a in ([data] if isinstance(data, dict) else data)})
        except Exception: pass
    return _apps

def _best(name, names):
    name = {"vs code": "visual studio code", "vscode": "visual studio code", "files": "file explorer"}.get(_norm(name), _norm(name))
    if len(name) < 3: return None                               # "a", "it", "up" must never match an app
    hits = [n for n in names if re.search(r"\b" + re.escape(name), n)]    # word-start match: "chrome" -> "google chrome", "calc" -> "calculator"
    if hits: return min(hits, key=len)
    return next(iter(difflib.get_close_matches(name, names, 1, 0.75)), None)

# The three actions below are also handed to Gemini as tools: names, type hints and docstrings are its schema.
def open_app(name: str) -> str:
    """Open an application installed on the user's Windows laptop, e.g. Chrome, Spotify, Notepad, Calculator, VS Code."""
    apps = _pc_apps(); n = _best(name, apps)
    if not n: return f"no app called {name!r}"
    subprocess.Popen(["explorer.exe", f"shell:AppsFolder{chr(92)}{apps[n]}"]); return f"opened {n}"

def search_web(query: str) -> str:
    """Search Google for the query in the user's default web browser."""
    webbrowser.open("https://www.google.com/search?q=" + urllib.parse.quote_plus(query)); return f"searching {query!r}"

SETTINGS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "settings.json")      # connected-app choices (gitignored)

def get_setting(key):
    try: return json.load(open(SETTINGS, encoding="utf-8")).get(key, "")
    except (OSError, ValueError): return ""

def set_setting(key, value):
    try: data = json.load(open(SETTINGS, encoding="utf-8"))
    except (OSError, ValueError): data = {}
    data[key] = value; json.dump(data, open(SETTINGS, "w", encoding="utf-8"))

def browser_for(email):
    """(exe, profile folder, label) of the Chrome/Edge profile signed in as `email`, else None. Only reads profile names, never passwords/cookies."""
    for name, folder, exe in (("Chrome", r"Google\Chrome", r"Google\Chrome\Application\chrome.exe"), ("Edge", r"Microsoft\Edge", r"Microsoft\Edge\Application\msedge.exe")):
        try: cache = json.load(open(os.path.join(os.environ["LOCALAPPDATA"], folder, "User Data", "Local State"), encoding="utf-8"))["profile"]["info_cache"]
        except Exception: continue
        for d, info in cache.items():
            if email and info.get("user_name", "").lower() == email.lower():
                for root in (os.environ.get("ProgramFiles"), os.environ.get("ProgramFiles(x86)"), os.environ.get("LOCALAPPDATA")):
                    if root and os.path.exists(path := os.path.join(root, exe)): return path, d, f"{name} - {info.get('name', d)}"
    return None

def open_music_url(url):
    """Open a music.youtube.com URL in the browser profile signed in as the connected account (else the default browser)."""
    if b := browser_for(get_setting("youtube_music_email")): subprocess.Popen([b[0], f"--profile-directory={b[1]}", url])
    else: webbrowser.open(url)

def play_music(query: str) -> str:
    """Play a song, artist, album or playlist on YouTube Music (opens it in the user's signed-in browser). query: what to play, e.g. 'Shape of You Ed Sheeran'."""
    from ytmusicapi import YTMusic
    for kind in ("songs", "videos"):
        if hits := YTMusic().search(query, filter=kind, limit=1):
            url = "https://music.youtube.com/watch?v=" + hits[0]["videoId"]
            open_music_url(url)
            return f"playing {hits[0]['title']}"
    return f"nothing found for {query!r}"

def press_key(key: str) -> str:
    """Press a media key on the laptop. key must be one of: volume up, volume down, mute, play, pause, next, previous."""
    if key not in KEYS: return f"unknown key {key!r}"
    vk = KEYS[key]; ctypes.windll.user32.keybd_event(vk, 0, 0, 0); ctypes.windll.user32.keybd_event(vk, 0, 2, 0)
    return key

def handle(text):
    """Run a fixed-phrase command. None if not addressed to Penguin or not a fixed phrase (caller may ask Gemini)."""
    p = parse(text)
    if not p or p[0] == "unknown": return None
    act, arg = p
    if act == "record":
        import notes; return notes.begin() if arg == "start" else notes.finish()
    if act == "note":      # the transcript is the user's exact words (parse() lowercases and strips punctuation, so use the original text)
        import notes
        body = re.sub(r"^(?:(?:take|make|write|add|save|create|jot down)\s+(?:a |an |the )?(?:quick |voice |new )?note|note(?: down)?|jot down)\b[\s:,.\-]*(?:that |saying |to say |about )?", "", raw_command(text), flags=re.I).strip()
        return "saved note: " + notes.save(body, "text")["title"] if body else None
    if act == "expense":
        from pft import add_expense; return add_expense(arg)
    return {"open": open_app, "search": search_web, "key": press_key, "music": play_music}[act](arg)

threading.Thread(target=_pc_apps, daemon=True).start()          # warm the app list

if __name__ == "__main__":
    assert parse("Penguin, open Chrome.") == ("open", "chrome")
    assert parse("Penguin search for the weather in Hyderabad") == ("search", "the weather in hyderabad")
    assert parse("Penguin volume down") == ("key", "volume down")
    assert parse("Penguin, please open notepad") == ("open", "notepad")
    assert parse("Penguins open chrome") == ("open", "chrome")             # Whisper mishearing the name
    assert parse("Penguin what is the capital of France") == ("unknown", "what is the capital of france")
    assert parse("Penguin open whatsapp and send message to daddy")[0] == "unknown"
    assert parse("Penguin now open facebook on google chrome")[0] == "unknown"
    assert parse("Penguin open visual studio code") == ("open", "visual studio code")
    assert parse("Penguin, open Daddy's chat")[0] == "unknown"                # in-app targets are NOT app launches
    assert parse("Penguin open the chat with daddy")[0] == "unknown"
    assert parse("Penguin open the first chat")[0] == "unknown"
    assert parse("Penguin, open the calculator") == ("open", "calculator")    # leading article is fine
    assert strip_wake("Hey Penguin, can you open the first chat?") == "open the first chat" and strip_wake("open chrome") is None
    assert parse("Penguin search for daddy in the chat")[0] == "unknown" and parse("Penguin search whatsapp for ravi")[0] == "unknown"
    assert parse("Penguin google chrome") == ("open", "google chrome")
    assert parse("Penguin spent 1000 rupees on pani puri today from sbi") == ("expense", "spent 1000 rupees on pani puri today from sbi")
    assert parse("Penguin play shape of you on youtube music") == ("music", "shape of you") and parse("Penguin pause") == ("key", "pause")
    assert parse("Penguin next song") == ("unknown", "next song") and strip_wake("Penguin just eat pizza") == "just eat pizza"
    assert parse("Penguin, now open notepad") == ("open", "notepad")
    assert parse("open chrome") is None and parse("what a nice day") is None
    assert handle("Penguin what is the capital of France") is None and handle("hello there") is None
    assert parse("Penguin, turn on English teaching mode") == ("english", "on") and parse("Penguin stop English mode") == ("english", "off") and parse("Penguin teach me English") == ("english", "on")
    assert parse("Penguin what is the English word for chai")[0] == "unknown" and parse("Penguin translate this to English")[0] == "unknown"
    assert parse("Penguin start recording") == ("record", "start") and parse("Penguin, record a voice note") == ("record", "start") and parse("Penguin stop recording") == ("record", "stop")
    assert parse("Penguin take a note buy milk and eggs")[0] == "note" and parse("Penguin note that I owe Ravi money")[0] == "note" and parse("Penguin take a note")[0] == "unknown"
    assert parse("Penguin what is a musical note")[0] == "unknown" and parse("Penguin record a video")[0] == "unknown" and parse("Penguin stop")[0] == "unknown"
    print("parser OK;", handle("Penguin open calculator"))
