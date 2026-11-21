"""Hear Penguin's possible voices one after another, then pick one. Run from apps/penguin:  python tuning/voice_audition.py"""
import asyncio, base64, ctypes, os, sys, tempfile, time
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import brain

SENT = "Hi, I'm Penguin. The capital of Australia is Canberra, and I've opened the calculator for you."
EDGE = ["en-IN-NeerjaNeural", "en-IN-PrabhatNeural", "en-US-AriaNeural", "en-US-GuyNeural", "en-GB-SoniaNeural", "en-US-JennyNeural"]
GEMINI = ["Kore", "Sulafat"]
tmp = tempfile.mkdtemp(prefix="penguin_voices_")
mci = ctypes.windll.winmm.mciSendStringW

def play(path):
    mci("close pv", None, 0, None); mci(f'open "{path}" alias pv', None, 0, None); mci("play pv wait", None, 0, None); mci("close pv", None, 0, None)

async def make_edge(voice, path):
    import edge_tts
    await edge_tts.Communicate(SENT, voice).save(path)

def make_gemini(voice, path):
    from google import genai
    r = genai.Client(api_key=brain._key()).interactions.create(
        model="gemini-3.8-flash-tts", input=[{"type": "user_input", "content": [{"type": "text", "text": SENT}]}],
        response_format={"type": "audio"}, generation_config={"speech_config": [{"voice": voice}]})
    open(path, "wb").write(base64.b64decode(r.output_audio.data))

items = [("Windows David (your current voice)", None, "windows")]
print("Preparing voices (Gemini ones take ~7 s each)...")
for v in EDGE:
    p = os.path.join(tmp, v + ".mp3"); t = time.time()
    try: asyncio.run(make_edge(v, p)); items.append((f"Microsoft neural: {v}  (fast, ~1 s)", p, v)); print("  ready", v, f"{time.time() - t:.1f}s")
    except Exception as e: print("  skipped", v, "-", str(e)[:80])
for v in GEMINI:
    p = os.path.join(tmp, "gemini_" + v + ".wav"); t = time.time()
    try: make_gemini(v, p); items.append((f"Gemini: {v}  (natural but ~5-7 s delay)", p, "gemini:" + v)); print("  ready", v, f"{time.time() - t:.1f}s")
    except Exception as e: print("  skipped", v, "-", str(e)[:80])

def say(i):
    label, path, _ = items[i]; print(f"\n[{i + 1}] {label}")
    brain.speak(SENT) if path is None else play(path)

for i in range(len(items)): say(i)
while True:
    c = input(f"\nType a number (1-{len(items)}) to hear it again, or press Enter when you've decided: ").strip()
    if not c: break
    if c.isdigit() and 1 <= int(c) <= len(items): say(int(c) - 1)
print("\nTell Claude your favourite - the number and name, e.g. '3, en-US-AriaNeural'.")
