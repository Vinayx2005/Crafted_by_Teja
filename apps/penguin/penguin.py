"""Penguin: ESP32-P4 mic (or --pc mic) -> 80 Hz high-pass -> RNNoise denoise + voice detect -> loudness gate -> auto-gain -> Whisper
-> fixed phrases (commands.py) or Gemini (brain.py). Opens its own window (ui.py); the terminal is optional. Ctrl+C quits.
Say "Penguin, open chrome" or type in the window.

  python penguin.py                 # board mic on COM3
  python penguin.py --gain 30       # set board mic gain in dB (0-42, steps of 6)
  python penguin.py --pc            # laptop mic instead (to compare)
  python penguin.py --raw           # skip RNNoise audio (still used for voice detection)
  python penguin.py --no-window     # don't open the window (open the printed URL yourself)
"""
import argparse, collections, os, queue, re, sys, threading, time
if sys.stdout is None:                                       # started with pythonw (no console): keep output in a log file
    sys.stdout = sys.stderr = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "penguin.log"), "a", buffering=1, encoding="utf-8")
import ipv4                                                 # before any network use: IPv6 is unreachable on this network and made the first call take minutes
import ui                                                   # light import: the window opens before the slow model loading below

ap = argparse.ArgumentParser()
ap.add_argument("--port", default="COM3"); ap.add_argument("--gain", type=int)
ap.add_argument("--pc", action="store_true"); ap.add_argument("--raw", action="store_true")
ap.add_argument("--no-window", action="store_true")
ap.add_argument("--wav", help="dev/test: play this 16 kHz mono wav into Penguin as if it came from the microphone")
ap.add_argument("--window", action="store_true")      # also open the full window (closing it quits Penguin); default is just the floating button
args = ap.parse_args()

q = queue.Queue()                                            # mic frames (numpy int16) and text typed in the window (str)
print("Penguin window:", ui.start(q, open_window=args.window), flush=True)
import bubble; bubble.start()
ui.emit("status", state="loading")

import re
from datetime import datetime
import numpy as np
from scipy.signal import butter, sosfilt
from pyrnnoise import RNNoise
from faster_whisper import WhisperModel
from commands import handle, parse, raw_command, strip_wake
from brain import ask, speak, speaking, _env, warm, warm_voice, LIVE as LIVE_Q, live_answer, ack, prepare_acks, interrupt, preempt, play_level
import notes, english, weather, mcp_tools

RATE, FRAME = 16000, 320             # 20 ms frames, same as the firmware
SPEECH_P = 0.8                       # RNNoise speech probability threshold
GATE = 4                             # speech must also be this many times louder than the room's noise floor
PAUSE, LIVE, MAXLEN, PREROLL, MIN_VOICED = 35, 35, 1000, 15, 8   # in 20 ms frames: 0.7 s / 0.7 s / 20 s / 0.3 s / 0.16 s

last_frame = [time.time()]
def mic_in(frame):
    """Every mic frame comes through here (from the audio callback, not the slow main loop): to the loop's queue, and into a voice recording
    if one is running, so a recording never loses audio when the loop is busy transcribing."""
    last_frame[0] = time.time(); q.put(frame)
    if notes.rec.active and not ui.state["muted"]: notes.rec.feed(frame)

MAGIC = b"\xa5\x5a"
def esp_reader(port, stop):
    """Reads the ESP32 board's audio frames from a serial port until `stop` is set."""
    s = None
    try:
        import serial
        s = serial.Serial(port, 921600, timeout=0.5)
        s.dtr, s.rts = False, True; time.sleep(0.1); s.rts = False       # reset board -> starts streaming
        if args.gain is not None:
            time.sleep(1.5); s.write(bytes([args.gain]))
        buf = bytearray()
        while not stop.is_set():
            buf += s.read(4096)
            while (i := buf.find(MAGIC)) >= 0 and len(buf) - i >= 644:
                if buf[i + 642:i + 644] == MAGIC:                       # validated frame
                    mic_in(np.frombuffer(bytes(buf[i + 2:i + 642]), "<i2")); del buf[:i + 642]
                else:
                    del buf[:i + 1]
            if len(buf) > 1 << 16: del buf[:-1024]                       # ponytail: drop junk if never in sync
    except Exception as e:
        if not stop.is_set():
            ui.emit("error", text=f"Microphone problem on {port}: {str(e)[:150]} - typing still works. Pick another microphone below the circle."); ui.emit("status", state="offline")
    finally:
        if s is not None: s.close()

sos = butter(2, 80, "highpass", fs=RATE, output="sos"); zi = np.zeros((sos.shape[0], 2))
rn = RNNoise(RATE)
def clean(x):
    """int16 frame -> (audio float32, speech probability, loudness)."""
    global zi
    y, zi = sosfilt(sos, x.astype(np.float32), zi=zi)
    outs = list(rn.denoise_chunk(y.astype(np.int16)))
    p, level = max((float(o[0].ravel()[0]) for o in outs), default=0.0), float(np.sqrt(np.mean(y ** 2)))
    return y, p, level      # Whisper gets the un-denoised audio: RNNoise only decides when someone is speaking (its artefacts made "Penguin" come out as "Win")

fast = WhisperModel("base.en", compute_type="int8", cpu_threads=4)    # live preview
good = WhisperModel(_env("PENGUIN_MODEL", "small.en"), compute_type="int8", cpu_threads=4)   # final text. large-v3-turbo measured 16-25 s per clip on this 4-core laptop: far too slow
PROMPT = "Penguin, open Chrome. Penguin, play a song on YouTube Music. Penguin, what is on my calendar tomorrow? Penguin, take a note."   # primes the name and typical commands

def run(model, chunks, beam):
    a = np.concatenate(chunks) / 32768.0
    rms, peak = np.sqrt(np.mean(a ** 2)) + 1e-9, np.abs(a).max() + 1e-9
    a = (a * min(0.1 / rms, 0.95 / peak, 30)).astype(np.float32)     # auto-gain: loud enough, no clipping
    segs, _ = model.transcribe(a, language="en", beam_size=beam, condition_on_previous_text=False,
                               without_timestamps=True, initial_prompt=PROMPT, vad_filter=True)     # VAD stops "Thank you." invented from silence
    return " ".join(s.text.strip() for s in segs)

for _m in (fast, good): _m.transcribe(np.zeros(16000, np.float32), language="en")      # first inference is slow: pay for it at start-up

def show(text, end="\r"):
    print(f"\r{text[-110:]:<115}", end=end, flush=True)

def drain():
    """Kept for the callers; does nothing now. It used to drop the microphone audio that piled up while the main loop was busy speaking, but requests run in their own
    thread now (bg) and the loop keeps reading the microphone, so there is nothing to drop (and dropping would eat your interruption)."""

worker = [None]
def bg(fn, *a, **k):
    """Run one request (process) in its own thread: the main loop keeps hearing the microphone while Penguin thinks and speaks, which is what lets you interrupt it.
    A new request replaces the one still running (its speech is cut and dropped)."""
    old = worker[0]
    if old and old.is_alive(): preempt(old); old.join(0.3)
    def go():
        try: fn(*a, **k)
        except Exception as e: print(f"  [error] {type(e).__name__}: {e}", flush=True); ui.emit("error", text=f"Something went wrong: {str(e)[:150]}")
        finally:
            if worker[0] is threading.current_thread(): idle()
    t = threading.Thread(target=go, daemon=True); worker[0] = t; t.start()

CLICK = _env("PENGUIN_ACTIVATION", "click") != "wake"   # click (default): Penguin listens only while switched on by clicking the circle (click again = off). wake: always listening for "Penguin"
ui.state["click"] = CLICK
WAKE_ALWAYS = _env("PENGUIN_ALWAYS_LISTEN", "1") != "0"      # 1 (default): while the button is not switched on, Penguin still listens for the word "Penguin" and wakes by itself (0 = only the button)
follow = [0.0]                                                  # after a bare "Penguin" -> "Yes?": the next sentence (within 8 s) is the command, no wake word needed
WAKELESS_ALL = os.environ.get("PENGUIN_WAKELESS") == "1"        # 1 = questions/chat also need no "Penguin" (ambient talk will trigger Gemini)

def english_say(card, spoken):
    ui.emit("reply", text=card); print("  -> " + card.encode("ascii", "replace").decode(), flush=True)       # (a redirected console can't print emoji)
    ui.emit("status", state="speaking"); speak(spoken); drain()

def english_toggle(on):
    """Switch the English teacher mode on or off (from the window button or by voice). The greeting / lesson summary is spoken in the background."""
    def run():
        try:
            ui.state["english"] = on; ui.emit("english", on=on)
            ui.emit("status", state="thinking")
            english_say(*(english.start() if on else english.stop()))
        except Exception as e:
            if on: ui.state["english"] = False; ui.emit("english", on=False)
            ui.emit("error", text=f"English teacher unavailable: {str(e)[:200]}")
        finally: idle()
    if on == english.active: return "already " + ("on" if on else "off")
    threading.Thread(target=run, daemon=True).start()
    return "English teaching mode " + ("on" if on else "off")
ui.on_english = english_toggle

def english_turn(text, typed):
    """While the teacher mode is on, everything said or typed is a practice answer (a wake word, if present, is dropped)."""
    body = raw_command(text) if strip_wake(text) is not None else text
    ui.emit("user", text=body, typed=typed, addressed=True)
    if english.is_exit(body): english_toggle(False); return
    ui.emit("status", state="thinking")
    try: english_say(*english.turn(body))
    except Exception as e:
        ui.emit("error", text=f"English teacher problem: {str(e)[:200]}")

def process(text, typed=False):
    """One finished utterance (spoken or typed): fixed phrase -> Gemini (which calls the connected apps). Reports to the window."""
    if english.active: return english_turn(text, typed)
    raw, cmd = text, parse(text)
    if not cmd:                                                            # no wake word needed for commands: "open whatsapp", "volume down", "play ..."
        c = parse("Penguin " + raw)
        if typed or (c and (WAKELESS_ALL or c[0] in ("open", "search", "music", "expense", "record", "note", "english") or (c[0] == "key" and " " in c[1]))):
            text = "Penguin " + raw; cmd = parse(text)                     # behaves exactly as if the wake word had been said
    ui.emit("user", text=raw, typed=typed, addressed=bool(cmd))
    if not cmd: return
    if cmd[0] == "english": english_toggle(cmd[1] == "on"); return
    if not cmd[1]: ui.emit("reply", text="Yes?"); speak("Yes?"); drain(); return     # just "Penguin"
    if cmd[0] != "unknown":                                                # fixed phrase: instant, offline
        reply = handle(text)
        if not reply: return
        print(f"  -> {reply}", flush=True); ui.emit("action", text=reply)
        if reply.startswith(("opened ", "playing ", "added ", "saved ", "recording ")) or cmd[0] in ("expense", "record", "note"): speak(reply[0].upper() + reply[1:] + "."); drain()
        return
    if weather.ASK.search(raw) and (reply := weather.answer(raw)):          # weather straight from Open-Meteo: ~1 s instead of 3 chained Gemini calls (~5 s)
        ui.emit("reply", text=reply); ui.emit("status", state="speaking"); speak(reply); drain(); return
    if m := re.search(r"what('?s| is| was)? (the )?(current )?(time|date|day)|what time is it", raw.lower()):     # instant, no Gemini round trip (~1 s)
        n = datetime.now(); reply = n.strftime("It is %I:%M %p.").replace(" 0", " ") if "time" in m.group(0) else n.strftime("Today is %A, %d %B %Y.")
        ui.emit("reply", text=reply); ui.emit("status", state="speaking"); speak(reply); drain(); return
    ui.emit("status", state="thinking")                                    # a question or chat: ask Gemini, speak the answer
    try:
        question, done, t0 = raw_command(text) or cmd[1], threading.Event(), time.time()
        try:
            if LIVE_Q.search(question):                                          # news / prices / who currently holds a post: one grounded call, and say so at once
                threading.Thread(target=ack, args=("Let me check.",), daemon=True).start(); reply = live_answer(question)
            else:
                threading.Thread(target=lambda: done.wait(1.3) or ack("One moment."), daemon=True).start()      # a slow answer (tool call) is announced instead of silence
                reply = ask(question, on_action=lambda a: ui.emit("action", text=a))
        finally: done.set()
        print(f"  -> {reply}  [{time.time() - t0:.1f}s]", flush=True); ui.emit("reply", text=reply)
        ui.emit("status", state="speaking"); speak(reply); drain()
    except Exception as e:
        msg = f"Gemini unavailable: {str(e)[:200]}"; print(f"  -> {msg}", flush=True); ui.emit("error", text=msg)
        try: speak("Sorry, I could not reach Gemini."); drain()
        except Exception: pass

import devices
from commands import get_setting, set_setting
_mic = {"stream": None, "stop": None, "id": None, "label": ""}
_mic_lock = threading.Lock()

def mic_options():
    """What the window's microphone dropdown shows: what is plugged in right now, and which one Penguin uses."""
    opts = [{"id": "default", "label": "System default microphone"}]
    opts += [{"id": "pc:" + n.strip(), "label": n.strip()} for n in devices.audio_inputs()]
    opts += [{"id": "board:" + p, "label": f"ESP32 board on {p} ({d.split(' (')[0]})"} for p, d in devices.serial_boards().items()]
    return {"current": _mic["id"], "label": _mic["label"], "options": opts}

def _stop_mic():
    if _mic["stream"] is not None:
        try: _mic["stream"].stop(); _mic["stream"].close()
        except Exception: pass
        _mic["stream"] = None
    if _mic["stop"] is not None: _mic["stop"].set(); _mic["stop"] = None        # the board's reader thread sees this and closes its port

def select_mic(mic_id, _retry=True, quiet=False):
    """Switch the microphone while running. Returns a short message for the window."""
    if notes.rec.active: return "Stop the recording first, then switch microphone."
    with _mic_lock:
        prev = _mic["id"]; _stop_mic()
        try:
            if mic_id.startswith("board:"):
                port = mic_id[6:]; stop = threading.Event(); _mic["stop"] = stop
                threading.Thread(target=esp_reader, args=(port, stop), daemon=True).start()
                label = f"ESP32 board on {port}"
            else:
                import sounddevice as sd
                sd._terminate(); sd._initialize()          # PortAudio only lists devices at start-up: refresh so a mic plugged in since then is found
                dev = None
                if mic_id.startswith("pc:"):
                    name = mic_id[3:]
                    dev = next((i for i, d in enumerate(sd.query_devices()) if d["max_input_channels"] > 0 and d["name"].startswith(name)), None)
                    if dev is None: raise RuntimeError(f"{name} is not available")
                s = sd.InputStream(samplerate=RATE, blocksize=FRAME, dtype="int16", channels=1, device=dev, callback=lambda d, *_: mic_in(d[:, 0].copy()))
                s.start(); _mic["stream"] = s; label = devices.full_name(sd.query_devices(s.device)["name"])
        except Exception as e:
            _stop_mic(); msg = f"Could not use that microphone: {str(e)[:120]}"
            if not quiet: ui.emit("error", text=msg)
            if _retry and prev and prev != mic_id: select_mic_locked_restore(prev)
            return msg
        _mic["id"], _mic["label"] = mic_id, label
    drain(); ui.state["mic"] = label
    set_setting("mic", mic_id); print(f"  microphone: {label}", flush=True)
    ui.emit("toast", text=f"🎙 Using microphone: {label}", kind="mic"); ui.emit("mic", id=mic_id)
    return f"Using {label}"

def select_mic_locked_restore(prev):
    threading.Thread(target=select_mic, args=(prev, False), daemon=True).start()       # back to the microphone that worked

ui.mic_options, ui.on_select_mic, ui.on_interrupt = mic_options, select_mic, interrupt

saved = get_setting("mic")
first = saved if saved and (saved == "default" or saved in {o["id"] for o in mic_options()["options"]}) else ("default" if args.pc else f"board:{args.port}")
if not args.wav and select_mic(first, _retry=False).startswith("Could not") and first != "default": select_mic("default", _retry=False)       # (--wav: no real microphone, only the file)
def wake_on():
    """The wake word 'Penguin' is active: click mode + always-listen + the Settings switch is on. Off = Penguin only listens when you click the button (everything else works as before)."""
    return CLICK and WAKE_ALWAYS and ui.state["voice"]

def _mic_watchdog():
    """A mic stream can die silently (sleep/resume, USB hiccup, unplugged) and then Penguin hears nothing. No audio for a while -> reopen the same microphone; if it is gone,
    fall back to the system default once and say so. Retries back off (4 s, 8, 16 ... 60 s) and only the first failure is announced, so there is no endless popup."""
    wait, told = 4, False
    while True:
        time.sleep(2)
        if time.time() - last_frame[0] <= 4: wait, told = 4, False; continue                 # audio is flowing: reset
        if not _mic["id"] or notes.rec.active or time.time() - last_frame[0] < wait: continue
        last_frame[0] = time.time()
        if not select_mic(_mic["id"], quiet=True).startswith("Could not"): continue
        if not told:
            told = True; ui.emit("toast", text="Your microphone is not available. Trying the system default; you can also pick one by right-clicking the Penguin button.", kind="unplug")
            old = _mic["id"]
            if old != "default" and not select_mic("default", _retry=False, quiet=True).startswith("Could not"): set_setting("mic", old); continue      # stay on the default for now but remember your choice for next start
        wait = min(wait * 2, 60)
threading.Thread(target=_mic_watchdog, daemon=True).start()
threading.Thread(target=prepare_acks, daemon=True).start()
threading.Thread(target=mcp_tools.start, daemon=True).start()       # extra tool servers from mcp.json (none by default)
if args.wav:
    def _feed_wav():
        from scipy.io import wavfile
        time.sleep(3); _, data = wavfile.read(args.wav)
        for i in range(0, len(data) - FRAME, FRAME): mic_in(data[i:i + FRAME].astype(np.int16)); time.sleep(FRAME / RATE)
    threading.Thread(target=_feed_wav, daemon=True).start()
devices.watch(lambda text, kind: ui.emit("toast", text=text, kind=kind), lambda: _mic["label"])      # popups when a mic or board is plugged in or out

def _note_done(n):
    """A finished recording (called from the transcription thread)."""
    msg = f"Saved your recording: {n['title']}."
    ui.emit("action", text=msg); print(f"  -> {msg}", flush=True)
    try: speak(msg)
    except Exception: pass
notes.on_done = _note_done
idle = lambda: ui.emit("status", state="muted" if ui.state["muted"] else "listening" if ui.state["armed"] or not CLICK or time.time() < follow[0] else "idle")
print("Listening... just talk, or type in the window (Ctrl+C to stop)")
idle()
pre = collections.deque(maxlen=PREROLL); buf, quiet, since, voiced, loud, tick, utt_t = [], 0, 0, 0, 0, 0, 0.0
import concurrent.futures
ex1 = concurrent.futures.ThreadPoolExecutor(1)             # transcribes finished sentences while you are still talking
futs, seg, vrun, qrun = [], 0, 0, 0                         # sentence transcriptions so far, where the open sentence starts, voiced/quiet frame counts
talk, MAX_TALK = [], 30000                          # click-to-talk: the audio of the current answer (20 ms frames; 10 minutes at most)
sp_pre, n_sp, over, ratios, dispatched = collections.deque(maxlen=45), 0, 0, [], False      # barge-in: recent mic frames while Penguin speaks, frames since it started, frames that sound like you, how loud its own echo is
floor = collections.deque(maxlen=500)          # last 10 s of idle loudness = the room's noise floor
try:
    while True:
        item = q.get()
        if isinstance(item, str):                                          # typed in the window
            bg(process, item, typed=True); continue
        if ui.state["muted"]:
            buf, pre = [], collections.deque(maxlen=PREROLL); continue     # muted: ignore the mic completely
        if speaking.is_set():
            if not ui.state["barge"]:
                buf, pre = [], collections.deque(maxlen=PREROLL); continue  # interrupting is switched off: ignore the mic while Penguin talks
            audio, p, level = clean(item); sp_pre.append(audio); n_sp += 1; ref = play_level[0]
            if n_sp <= 12: ratios.append(level / max(ref, 1.0))             # the first 0.25 s of speech: how loud Penguin's own voice reaches the microphone
            echo = (sorted(ratios)[len(ratios) // 2] if ratios else 1.0) * ref
            over = over + 1 if (n_sp > 12 and p > SPEECH_P and level > max(350.0, 2.5 * echo + 200.0)) else max(0, over - 2)       # clearly louder than the echo, and speech
            if over >= 10:                                                  # you are talking over Penguin: stop it and take what you say as the next command
                interrupt(); follow[0] = time.time() + 12; ui.emit("status", state="listening"); print("  [barge-in] you cut Penguin off", flush=True)
                buf, quiet, since, voiced, loud, utt_t, woke = list(sp_pre)[-16:], 0, 0, 10, 10, time.time(), False
                pre = collections.deque(maxlen=PREROLL); speaking.clear(); over = n_sp = 0; ratios.clear(); sp_pre.clear()
            continue
        n_sp, over = 0, 0; ratios.clear(); sp_pre.clear()
        audio, p, level = clean(item)
        if CLICK:
            # Click-to-talk: while the circle is on, keep EVERYTHING you say (no automatic end-of-sentence cut); clicking it off transcribes it all at once.
            if ui.state["armed"]:
                if buf: buf, pre = [], collections.deque(maxlen=PREROLL)
                if not talk: [threading.Thread(target=f, daemon=True).start() for f in (warm, warm_voice, weather.prefetch)]      # open the Gemini connection while you speak: the first call after idle costs ~2 s extra
                talk.append(audio); tick += 1
                vrun, qrun = (vrun + 1, 0) if p > SPEECH_P else (vrun, qrun + 1)
                if qrun == PAUSE and vrun >= MIN_VOICED:                   # a sentence just ended: transcribe it in the background now, so clicking off only has the tail left
                    futs.append(ex1.submit(run, good, talk[seg:], 1)); seg, vrun = len(talk), 0
                if tick % 4 == 0: ui.emit("level", v=round(level))         # ~12 Hz mic meter
                if len(talk) >= MAX_TALK: ui.state["armed"] = False; ui.emit("toast", text="Reached the 10 minute limit: sending what you said.", kind="mic"); idle()
                continue
            if talk:
                chunks, talk = talk, []
                if max((float(np.sqrt(np.mean(np.concatenate(chunks[i:i + 12]) ** 2))) for i in range(0, len(chunks), 12)), default=0) < 120:
                    ui.emit("toast", text="I did not hear anything. Click the Penguin button, speak, then click it again.", kind="unplug"); futs, seg, vrun, qrun = [], 0, 0, 0; idle(); continue
                ui.emit("status", state="transcribing")
                tail = run(good, chunks[seg:], 1) if vrun >= MIN_VOICED else ""
                text = " ".join(x for x in [f.result() for f in futs] + [tail] if x).strip(); futs, seg, vrun, qrun = [], 0, 0, 0
                if text:
                    show(text, end=chr(10))
                    bg(process, "Penguin " + text if strip_wake(text) is None else text)       # clicking replaces the wake word
                else:
                    ui.emit("toast", text="I could not make out any words. Try again.", kind="unplug"); idle()
                continue
            if not wake_on() and time.time() >= follow[0]: floor.append(level); buf, pre = [], collections.deque(maxlen=PREROLL); continue
        tick += 1
        if tick % 4 == 0: ui.emit("level", v=round(level))                 # ~12 Hz mic meter
        if follow[0] and not buf and time.time() > follow[0]: follow[0] = 0; idle()          # nobody spoke after "Penguin": back to idle
        if follow[0] and not ui.state["voice"]: follow[0] = 0                         # wake word switched off in the middle of a follow-up window
        speech = p > SPEECH_P
        thr = max(250.0, GATE * float(np.median(floor))) if len(floor) > 50 else 0.0
        if not buf:
            pre.append(audio); floor.append(level)
            if speech and level > thr:
                buf, quiet, since, voiced, loud, utt_t, woke = list(pre), 0, 0, 1, 1, time.time(), None; None if wake_on() else ui.emit("status", state="hearing")
            continue
        buf.append(audio); since += 1; loud += level > thr
        if wake_on() and woke is None and not ui.state["armed"] and time.time() >= follow[0] and voiced >= 30 and len(buf) < 70:      # 0.6-1.4 s in
            woke = strip_wake(run(fast, buf, 1)) is not None                                                        # looked once per sentence
            if woke: follow[0] = time.time() + 12; idle()          # animation starts now; the rest of the sentence is still being recorded
        quiet, voiced = (0, voiced + 1) if speech else (quiet + 1, voiced)
        if quiet >= (55 if time.time() < follow[0] else PAUSE) or len(buf) >= MAXLEN:           # after a bare "Penguin" allow a thinking pause (1.1 s) inside the command
            if voiced >= MIN_VOICED and loud >= 5:
                amb = wake_on()                                                  # not switched on by the button: only react to "Penguin ..."
                followup = amb and time.time() < follow[0] and not woke                       # the sentence after a bare "Penguin": it IS the command
                head = run(fast, buf, 1) if amb and not followup else None                     # cheap look with base.en
                if amb and not followup and strip_wake(head) is None: show(""); follow[0] = 0       # not for Penguin: ignore it
                elif amb and not followup and strip_wake(head) == "":                           # just "Penguin": no "Yes?" - the ripples are already on, say the command now
                    show(head, end="\n"); follow[0] = time.time() + 12
                else:
                    ui.emit("status", state="transcribing")
                    if text := run(good, buf, 5):
                        show(text, end="\n")
                        if amb and strip_wake(text) is None: text = "Penguin " + (text if followup else raw_command(text))   # follow-up, or the wake word was spelled differently
                        elif CLICK and not amb and strip_wake(text) is None: text = "Penguin " + text
                        follow[0] = 0; bg(process, text); dispatched = True
                    else:
                        show(""); follow[0] = 0
            else:
                show("")
            ui.emit("live", text="")
            if not dispatched: idle()                                       # a started request sets the status itself
            dispatched = False; buf, pre = [], collections.deque(maxlen=PREROLL)
        elif since >= LIVE and not wake_on() and q.qsize() < 3 and voiced >= MIN_VOICED and loud >= 5:
            preview = run(fast, buf, 1); show(preview + " ..."); ui.emit("live", text=preview); since = 0
except KeyboardInterrupt:
    print("\nStopped.")
