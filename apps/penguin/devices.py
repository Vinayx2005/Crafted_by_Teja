"""Watches for microphones and serial boards being plugged in or out, and tells the window (a popup) which microphone Penguin is using.
Input devices come from Windows' winmm (it lists what is connected right now; PortAudio only caches the list from startup).
`python devices.py` self-checks the plug/unplug logic."""
import ctypes, re, threading, time
from ctypes import wintypes

class _Caps(ctypes.Structure):
    _fields_ = [("mid", wintypes.WORD), ("pid", wintypes.WORD), ("ver", wintypes.UINT), ("name", ctypes.c_wchar * 32),
                ("formats", wintypes.DWORD), ("channels", wintypes.WORD), ("res", wintypes.WORD)]

def audio_inputs():
    """Names of the microphones / line-in devices Windows sees now (the driver cuts names at 31 characters)."""
    out = []
    try:
        for i in range(ctypes.windll.winmm.waveInGetNumDevs()):
            c = _Caps()
            if ctypes.windll.winmm.waveInGetDevCapsW(i, ctypes.byref(c), ctypes.sizeof(c)) == 0: out.append(c.name)
    except Exception: pass
    return out

def serial_boards():
    """{port: description} for connected USB-serial devices (the ESP32 board shows up here)."""
    try:
        from serial.tools import list_ports
        return {p.device: p.description for p in list_ports.comports()}
    except Exception: return {}

def full_name(short):
    """The complete device name (the winmm/MME one is cut short); falls back to what we have."""
    try:
        import sounddevice as sd
        for d in sd.query_devices():
            if d["max_input_channels"] > 0 and d["name"].startswith(short.strip()) and len(d["name"]) > len(short): return d["name"]
    except Exception: pass
    return short

def diff(old, new):
    """(added, removed) between two {id: label} snapshots."""
    return [new[k] for k in new if k not in old], [old[k] for k in old if k not in new]

def snapshot():
    return {**{"mic:" + n: "Microphone: " + n for n in audio_inputs()}, **{"port:" + p: f"USB device {p} ({d.split(' (')[0]})" for p, d in serial_boards().items()}}

def watch(toast, active_label=None, every=2.0):
    """Background thread: calls toast(text, kind) when something is plugged in or out. active_label: the mic Penguin is using (text, or a function returning it), so losing it is called out."""
    def run():
        old = snapshot()
        while True:
            time.sleep(every)
            new = snapshot()
            added, removed = diff(old, new)
            for a in added: toast(f"Connected: {a}", "plug")
            for r in removed:
                now = active_label() if callable(active_label) else active_label
                name = r.split(": ", 1)[-1].strip()
                lost = bool(now) and (name in now or any(c in now for c in re.findall(r"COM\d+", r)))      # same mic, or same serial port
                toast(f"Disconnected: {r}" + (" - Penguin was using it" if lost else ""), "unplug")
            old = new
    threading.Thread(target=run, daemon=True).start()

if __name__ == "__main__":
    a = {"mic:A": "Microphone: A", "port:COM3": "USB device COM3 (x)"}
    b = {"mic:A": "Microphone: A", "mic:B": "Microphone: B"}
    assert diff(a, b) == (["Microphone: B"], ["USB device COM3 (x)"]) and diff(a, a) == ([], [])
    print("devices OK; microphones now:", audio_inputs(), "| serial:", serial_boards())
