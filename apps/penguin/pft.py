"""Penguin -> PFT (Personal FT): log an expense by voice through PFT's Quick Add pipeline (POST /api/penguin/expense).
Connect in the Apps panel: PFT's /connect-penguin page signs you in with Google and hands Penguin its own session, saved in
pft_token.json (gitignored). PFT_URL (in .env.local) says where PFT runs; default https://pft.craftedbyteja.com (set http://localhost:3000 only to test a local `npm run dev:pft`)."""
import json, os, urllib.error, urllib.request

TOKEN = os.path.join(os.path.dirname(os.path.abspath(__file__)), "pft_token.json")

def url():
    from brain import _env      # lazy: brain imports this module
    return _env("PFT_URL", "https://pft.craftedbyteja.com").rstrip("/")

def _load():
    try: return json.load(open(TOKEN, encoding="utf-8"))
    except (OSError, ValueError): return {}

def status():
    t = _load(); return {"connected": bool(t.get("refresh_token")), "email": t.get("email", ""), "ready": True}

def save(fields):
    keep = {k: str(fields.get(k, "")) for k in ("email", "access_token", "refresh_token", "supabase_url", "anon_key")}
    json.dump(keep, open(TOKEN, "w", encoding="utf-8"))

def disconnect():
    if os.path.exists(TOKEN): os.remove(TOKEN)

def _access_token():
    """A fresh access token: the saved refresh token is exchanged every call (Supabase rotates it, so the new one is saved)."""
    t = _load()
    if not t.get("refresh_token"): raise RuntimeError("PFT is not connected: open Apps and connect Personal FT")
    req = urllib.request.Request(t["supabase_url"] + "/auth/v1/token?grant_type=refresh_token", method="POST",
                                 data=json.dumps({"refresh_token": t["refresh_token"]}).encode(),
                                 headers={"apikey": t["anon_key"], "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r: d = json.load(r)
    except urllib.error.HTTPError as e:
        if e.code in (400, 401): disconnect(); raise RuntimeError("PFT sign-in expired: connect Personal FT again in the Apps panel")
        raise
    save({**t, "access_token": d["access_token"], "refresh_token": d["refresh_token"]})
    return d["access_token"]

def add_expense(sentence: str) -> str:
    """Add an expense to the user's PFT finance app. sentence: the user's words about the spend, e.g. 'spent 1000 rupees on pani puri today from SBI'.
    The category and bank are worked out automatically."""
    try: jwt = _access_token()
    except RuntimeError as e: return str(e)
    except Exception as e: return f"could not reach PFT sign-in: {e}"
    req = urllib.request.Request(url() + "/api/penguin/expense", method="POST", data=json.dumps({"transcript": sentence}).encode(),
                                 headers={"Authorization": "Bearer " + jwt, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r: d = json.load(r)
    except urllib.error.HTTPError as e:                 # 4xx/5xx still carry a sentence Penguin can say
        try: return json.load(e).get("error") or f"PFT error {e.code}"
        except ValueError: return f"PFT error {e.code}"
    except Exception as e: return f"could not reach PFT: {e}"
    return f"added {d['amount']:g} rupees, {d['description']}, {d['category']}, {d['bank']}, {d['date']}"

TOOLS = [add_expense]
