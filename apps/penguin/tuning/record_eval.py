"""Record test sentences from BOTH the ESP32-P4 board mic and the laptop mic at once.
For each sentence: press Enter, read it aloud at normal volume, press Enter again."""
import json, os, sys, threading, time
import numpy as np, serial, sounddevice as sd
from scipy.io import wavfile

OUT = os.path.dirname(os.path.abspath(__file__))
SENTENCES = [
    "Penguin, open calculator.",
    "Penguin, open Google Chrome.",
    "Penguin, search for the weather in Hyderabad.",
    "Penguin, volume down.",
    "Please set a reminder for the team meeting tomorrow at ten thirty in the morning.",
    "What is the capital of Australia and how far is it from Sydney?",
    "I need to transfer five thousand rupees to my savings account today.",
    "The quick brown fox jumps over the lazy dog near the river bank.",
    "Turn on the lights in the living room and play some relaxing music.",
    "Penguin, open Visual Studio Code.",
]
esp, pc = [], []                                   # lists of 320-sample int16 frames
MAGIC = b"\xa5\x5a"

def esp_reader():
    s = serial.Serial("COM3", 921600, timeout=0.5)
    s.dtr, s.rts = False, True; time.sleep(0.1); s.rts = False
    buf = bytearray()
    while True:
        buf += s.read(4096)
        while (i := buf.find(MAGIC)) >= 0 and len(buf) - i >= 644:
            if buf[i + 642:i + 644] == MAGIC:
                esp.append(np.frombuffer(bytes(buf[i + 2:i + 642]), "<i2")); del buf[:i + 642]
            else:
                del buf[:i + 1]

threading.Thread(target=esp_reader, daemon=True).start()
sd.InputStream(samplerate=16000, blocksize=320, dtype="int16", channels=1,
               callback=lambda d, *_: pc.append(d[:, 0].copy())).start()
print("Starting board mic... (3 s)"); time.sleep(3)
print(f"Board frames flowing: {len(esp) > 0}   Laptop mic frames flowing: {len(pc) > 0}\n")
if not esp or not pc: sys.exit("A mic is not streaming - tell Claude.")
wavfile.write(os.path.join(OUT, "_test.wav"), 16000, np.zeros(160, "int16")); os.remove(os.path.join(OUT, "_test.wav"))   # fail fast if saving is broken

for i, text in enumerate(SENTENCES):
    print(f"[{i + 1}/{len(SENTENCES)}]  READ:  {text}")
    input("   press Enter, then speak ... "); a, b = len(esp), len(pc)
    input("   press Enter when finished ... "); time.sleep(0.3)
    e, p = np.concatenate(esp[a:len(esp)]), np.concatenate(pc[b:len(pc)])
    wavfile.write(os.path.join(OUT, f"rec{i}_esp.wav"), 16000, e); wavfile.write(os.path.join(OUT, f"rec{i}_pc.wav"), 16000, p)
    print(f"   saved ({len(e) / 16000:.1f}s board, {len(p) / 16000:.1f}s laptop, "
          f"board level {int(np.sqrt(np.mean(e.astype(float) ** 2)))}, peak {abs(e).max()})\n")
json.dump(SENTENCES, open(os.path.join(OUT, "refs.json"), "w"))
print("Done! Tell Claude you finished.")
