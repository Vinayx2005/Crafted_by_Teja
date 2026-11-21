"""Score speech-to-text setups on the recorded sentences (word error rate, lower = better).
  python evaluate.py --models small.en base.en --mics esp pc --pre raw rn [--prompt]"""
import argparse, json, os, re, time
import numpy as np
from num2words import num2words
from scipy.io import wavfile
from scipy.signal import butter, sosfilt
from pyrnnoise import RNNoise
from faster_whisper import WhisperModel

ap = argparse.ArgumentParser()
ap.add_argument("--models", nargs="+", default=["small.en"]); ap.add_argument("--mics", nargs="+", default=["esp"])
ap.add_argument("--pre", nargs="+", default=["rn"]); ap.add_argument("--prompt", action="store_true")
ap.add_argument("--beam", type=int, default=5); ap.add_argument("--verbose", action="store_true")
args = ap.parse_args()
D = os.path.dirname(os.path.abspath(__file__))
refs = json.load(open(os.path.join(D, "refs.json")))
PROMPT = "Penguin, open Google Chrome. Penguin, search for the weather. Penguin, volume down. Hyderabad, rupees."

def norm(t):
    t = t.lower().replace(":", " ").replace("-", " ")
    t = re.sub(r"(?<=\d),(?=\d)", "", t)
    t = re.sub(r"\d+", lambda m: " " + num2words(int(m[0])).replace("-", " ").replace(" and ", " ") + " ", t)
    return re.sub(r"[^a-z ]", "", t).split()

def wer(ref, hyp):
    r, h = norm(ref), norm(hyp)
    d = list(range(len(h) + 1))
    for i, rw in enumerate(r, 1):
        prev, d[0] = d[0], i
        for j, hw in enumerate(h, 1):
            prev, d[j] = d[j], min(d[j] + 1, d[j - 1] + 1, prev + (rw != hw))
    return d[-1], len(r)

sos = butter(2, 80, "highpass", fs=16000, output="sos")
def prep(x, mode):
    x = x.astype(np.float32)
    if mode != "raw":
        x = sosfilt(sos, x).astype(np.float32)
    if mode == "rn":
        x = np.concatenate([o[1].ravel() for o in RNNoise(16000).denoise_chunk(x.astype(np.int16))]).astype(np.float32)
    a = x / 32768.0
    rms, peak = np.sqrt(np.mean(a ** 2)) + 1e-9, np.abs(a).max() + 1e-9
    return (a * min(0.1 / rms, 0.95 / peak, 30)).astype(np.float32)

clips = {(m, p): [prep(wavfile.read(os.path.join(D, f"rec{i}_{m}.wav"))[1], p) for i in range(len(refs))]
         for m in args.mics for p in args.pre}
print(f"{'model':<18}{'mic':<5}{'pre':<5}{'prompt':<7}{'WER%':>6}{'sec/clip':>10}")
for name in args.models:
    model = WhisperModel(name, compute_type="int8", cpu_threads=8)
    for (m, p), audio in clips.items():
        errs = words = 0; t = time.time(); outs = []
        for ref, a in zip(refs, audio):
            segs, _ = model.transcribe(a, language="en", beam_size=args.beam, condition_on_previous_text=False,
                                       without_timestamps=True, initial_prompt=PROMPT if args.prompt else None)
            hyp = " ".join(s.text.strip() for s in segs); e, n = wer(ref, hyp); errs += e; words += n; outs.append((e, hyp))
        print(f"{name:<18}{m:<5}{p:<5}{str(args.prompt):<7}{100 * errs / words:6.1f}{(time.time() - t) / len(refs):10.2f}", flush=True)
        if args.verbose:
            for (e, h), ref in zip(outs, refs): print(f"    [{e}] {h}   <- {ref}")
