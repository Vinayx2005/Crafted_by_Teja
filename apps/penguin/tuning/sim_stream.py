"""Replay recorded board clips through the live pipeline logic. Reports WER, utterance count, and false triggers on ambient-only audio.
  python sim_stream.py [--model small.en] [--pause 35] [--speech 0.6] [--minvoiced 8] [--filter] [--prompt]"""
import argparse, collections, json, os, time
import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, sosfilt
from pyrnnoise import RNNoise
from faster_whisper import WhisperModel
import evaluate_lib as E

ap = argparse.ArgumentParser()
ap.add_argument("--pause", type=int, default=35); ap.add_argument("--speech", type=float, default=0.6)
ap.add_argument("--preroll", type=int, default=15); ap.add_argument("--minvoiced", type=int, default=8)
ap.add_argument("--model", default="small.en"); ap.add_argument("--filter", action="store_true")
ap.add_argument("--prompt", action="store_true"); ap.add_argument("--beam", type=int, default=5)
ap.add_argument("--verbose", action="store_true"); ap.add_argument("--gate", type=float, default=0)
a = ap.parse_args()
D = os.path.dirname(os.path.abspath(__file__)); refs = json.load(open(os.path.join(D, "refs.json")))
rd = lambda f: wavfile.read(os.path.join(D, f))[1]
clips, amb = [rd(f"rec{i}_esp.wav") for i in range(len(refs))], rd("ambient_esp.wav")
rng = np.random.default_rng(0)
gap = lambda: (lambda k: amb[k:k + 32000])(int(rng.integers(0, len(amb) - 32000)))      # 2 s of real room noise
speech_stream = np.concatenate([np.concatenate([c, gap()]) for c in clips])
model = WhisperModel(a.model, compute_type="int8", cpu_threads=8)
sos = butter(2, 80, "highpass", fs=16000, output="sos")
PROMPT = "Penguin, open Google Chrome. Penguin, search for the weather. Penguin, volume down."

def run_stream(stream):
    zi, rn = np.zeros((sos.shape[0], 2)), RNNoise(16000)
    pre, buf, quiet, voiced, finals, times = collections.deque(maxlen=a.preroll), [], 0, 0, [], []
    floor, loud = collections.deque(maxlen=500), 0
    def clean(x):
        nonlocal zi
        y, zi = sosfilt(sos, x.astype(np.float32), zi=zi); outs = list(rn.denoise_chunk(y.astype(np.int16)))
        return (np.concatenate([o[1].ravel() for o in outs]).astype(np.float32) if outs else np.zeros(0, np.float32)), \
               max((float(o[0].ravel()[0]) for o in outs), default=0.0), float(np.sqrt(np.mean(y ** 2)))
    def transcribe(chunks):
        x = np.concatenate(chunks) / 32768.0; rms, pk = np.sqrt(np.mean(x ** 2)) + 1e-9, np.abs(x).max() + 1e-9
        x = (x * min(0.1 / rms, 0.95 / pk, 30)).astype(np.float32); t = time.time()
        kw = dict(repetition_penalty=1.15, no_repeat_ngram_size=3) if a.filter else {}
        segs, _ = model.transcribe(x, language="en", beam_size=a.beam, condition_on_previous_text=False,
                                   without_timestamps=True, initial_prompt=PROMPT if a.prompt else None, **kw)
        segs = list(segs); times.append(time.time() - t)
        if a.filter: segs = [s for s in segs if not (s.no_speech_prob > 0.5 and s.avg_logprob < -0.7) and s.avg_logprob > -1.2]
        return " ".join(s.text.strip() for s in segs)
    for k in range(0, len(stream) - 319, 320):
        audio, p, rms = clean(stream[k:k + 320]); sp = p > a.speech
        thr = max(250.0, a.gate * float(np.median(floor))) if a.gate and len(floor) > 50 else 0.0   # adaptive: x times the idle noise floor
        if not buf:
            pre.append(audio); floor.append(rms)
            if sp and rms > thr: buf, quiet, voiced, loud = list(pre), 0, 1, 1
            continue
        buf.append(audio); quiet, voiced = (0, voiced + 1) if sp else (quiet + 1, voiced); loud += rms > thr
        if quiet >= a.pause or len(buf) >= 1000:
            if voiced >= a.minvoiced and loud >= (5 if a.gate else 0) and (t := transcribe(buf)): finals.append(t)
            buf, pre = [], collections.deque(maxlen=a.preroll)
    return finals, times

finals, times = run_stream(speech_stream)
e, n = E.wer(" ".join(refs), " ".join(finals))
false_f, _ = run_stream(np.tile(amb, 2))          # 60 s of ambient only: anything printed is a false trigger
tag = f"{a.model} gate={a.gate} pause={a.pause} sp>{a.speech} minv={a.minvoiced} filter={a.filter} prompt={a.prompt}"
print(f"{tag}\n  WER {100 * e / n:5.1f}% ({e}/{n})  utterances {len(finals)}/{len(refs)}  "
      f"avg decode {np.mean(times):.2f}s  false triggers in 60s ambient: {len(false_f)} {false_f}")
if a.verbose:
    for f in finals: print("    ", f)
