"""Penguin's desktop icon target (double-click): opens the Penguin app window, and starts Penguin (with the floating button) first if it is not running yet.
If Penguin is already running (e.g. it started with Windows) this just brings up the app window, so there is never a second copy listening on the microphone."""
import os, subprocess, sys, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))

def running_url():
    for port in range(8765, 8776):
        try:
            if b"<title>Penguin" in urllib.request.urlopen(f"http://127.0.0.1:{port}/", timeout=0.6).read(4000): return f"http://127.0.0.1:{port}"
        except Exception: pass

if url := running_url():
    sys.path.insert(0, HERE); import ui; ui._url = url; ui.show_window()          # already running: just open the app window
else:
    subprocess.Popen([sys.executable, os.path.join(HERE, "penguin.py"), "--window"], cwd=HERE, creationflags=0x00000008 | 0x00000200)   # DETACHED_PROCESS | NEW_PROCESS_GROUP: lives on without this launcher
