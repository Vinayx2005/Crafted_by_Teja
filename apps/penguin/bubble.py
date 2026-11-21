"""Penguin's floating button: always on top, draggable, bottom-right by default. Click = start/stop listening (same as the window's circle).
Tiny arrow chip hides it behind the screen edge; the edge tab brings it back. Right-click: window / mute / quit. tkinter only (stdlib)."""
import ctypes, math, os, queue, re, subprocess, threading, time, webbrowser, tkinter as tk
import ui

D, TAB = 64, 22                                   # button diameter, hidden-tab width
COLORS = {"loading": "#6b7280", "idle": "#3b82f6", "listening": "#22c55e", "hearing": "#22c55e", "transcribing": "#f59e0b",
          "thinking": "#a855f7", "speaking": "#14b8a6", "muted": "#ef4444", "offline": "#ef4444"}
ANIMATED = ('listening', 'hearing', 'transcribing', 'thinking')
KEY = "#010203"                                   # transparent colour

def _area():
    try:
        ctypes.windll.shcore.SetProcessDpiAwareness(1)
        r = (ctypes.c_long * 4)(); ctypes.windll.user32.SystemParametersInfoW(0x30, 0, r, 0)      # SPI_GETWORKAREA: screen minus taskbar
        return r[0], r[1], r[2], r[3]
    except Exception: return 0, 0, 1920, 1040

def _toggle():
    s = ui.state
    if s["muted"]: ui.emit("error", text="Penguin is muted: right-click the button and choose Unmute.")
    elif s["state"] != "loading":
        s["armed"] = not s["armed"]
        if s["armed"] and ui.on_interrupt: ui.on_interrupt()          # clicking to talk cuts Penguin off
        ui.emit("live", text=""); ui.emit("status", state="listening" if s["armed"] else "idle")

EDGE = 16                                         # the button can't be dragged closer than this to a screen edge
PAD = 28                                          # room around the button for the listening ripples

def _ell(cx, cy, ox, oy, rx, ry, ang, loc=0):
    """Ellipse centred (ox, oy) from (cx, cy), tilted `loc` degrees on its own, then the whole picture rotated `ang` degrees around (cx, cy). Returns polygon points."""
    cl, sl, ca, sa, pts = math.cos(math.radians(loc)), math.sin(math.radians(loc)), math.cos(math.radians(ang)), math.sin(math.radians(ang)), []
    for i in range(24):
        t = i * math.pi / 12; px, py = rx * math.cos(t), ry * math.sin(t)
        px, py = ox + px * cl - py * sl, oy + px * sl + py * cl
        pts += [cx + px * ca - py * sa, cy + px * sa + py * ca]
    return pts

_IMG, _SRC = {}, [None]

def _penguin(c, cx, cy, ang=0):
    """The penguin from ui/penguin.svg, shown as ui/penguin.png (the SVG rendered once: `python -c "import pymupdf; pymupdf.open('ui/penguin.svg')[0].get_pixmap(matrix=pymupdf.Matrix(2,2), alpha=True).save('ui/penguin.png')"`).
    Rotated in 18 degree steps (cached) to spin while Penguin is processing; falls back to the emoji if the picture or Pillow is missing."""
    try:
        from PIL import Image, ImageTk
        if _SRC[0] is None: im = Image.open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "ui", "penguin.png")).convert("RGBA"); _SRC[0] = im.crop(im.getbbox())
        key = round(ang / 18) % 20
        if key not in _IMG:
            src = _SRC[0]; side = int(max(src.size) * 1.45); sq = Image.new("RGBA", (side, side), (0, 0, 0, 0)); sq.paste(src, ((side - src.width) // 2, (side - src.height) // 2))
            _IMG[key] = ImageTk.PhotoImage(sq.rotate(-key * 18, Image.BICUBIC).resize((int(D * .8), int(D * .8)), Image.LANCZOS))
        c.create_image(cx, cy, image=_IMG[key])
    except Exception: c.create_text(cx, cy, text="🐧", font=("Segoe UI Emoji", 18))

def _anim(c, st, n, cx, cy):
    """Per-state animation: listening = ripples spreading out from the button, processing (transcribing / thinking) = a loader ring."""
    r0 = D // 2 - 5
    if st in ("listening", "hearing"):
        for k in range(3):                                         # three ripples, each starting a third of a cycle after the last
            p = ((n + k * 12) % 36) / 36; r = r0 + 2 + p * (PAD + 6)
            c.create_oval(cx - r, cy - r, cx + r, cy + r, outline="#22c55e", width=3 if p < .5 else 2, stipple="" if p < .45 else "gray50" if p < .75 else "gray25")
    elif st in ("transcribing", "thinking"):
        col = "#f59e0b" if st == "transcribing" else "#a855f7"; r = r0 + 9
        for a in (0, 120, 240): c.create_arc(cx - r, cy - r, cx + r, cy + r, start=-n * 12 + a, extent=70, style="arc", outline=col, width=4)

MODES = {"chat": "Ask anything… (it can search the web)", "rephrase": "Paste text to rephrase…", "grammar": "Paste text to fix the grammar…"}
_CHATS, _CUR = [], [None]          # every chat window's {title, hist, log}: kept while Penguin runs (lost on quit or shutdown), so any past chat can be reopened from the history button
BG, FG, ACC = "#111827", "#e5e7eb", "#3b82f6"
INLINE = re.compile(r"\*\*(.+?)\*\*|`([^`]+)`|==(.+?)==|\[([^\]]+)\]\((https?://[^)\s]+)\)|(?<![\w*])\*(?![\s*])(.+?)(?<![\s*])\*(?![\w*])|(https?://[^\s)>\]]+)")      # bold, code, highlight, [label](url), italic, bare url

def open_link(url):
    """Open in Google Chrome when installed, else the default browser."""
    for root in (os.environ.get("ProgramFiles"), os.environ.get("ProgramFiles(x86)"), os.environ.get("LOCALAPPDATA")):
        if root and os.path.exists(exe := os.path.join(root, r"Google\Chrome\Application\chrome.exe")): subprocess.Popen([exe, url]); return
    webbrowser.open(url)

def _new_chat():
    if _CHATS and not _CHATS[-1]["log"]: _CUR[0] = _CHATS[-1]; return          # the newest chat is still empty: reuse it
    _CHATS.append({"title": "New chat", "hist": [], "log": []}); _CUR[0] = _CHATS[-1]

def _del_word_back(e):
    """Ctrl+Backspace: delete the word (and the spaces) before the cursor; Tk's Text widget has no such shortcut."""
    w = e.widget
    if w.tag_ranges("sel"): w.delete("sel.first", "sel.last")
    elif m := re.search(r"\S+\s*$|\s+$", w.get("insert linestart", "insert")): w.delete(f"insert-{len(m.group())}c", "insert")
    elif w.compare("insert", ">", "1.0"): w.delete("insert-1c", "insert")
    return "break"

def _del_word_fwd(e):
    w = e.widget
    if w.tag_ranges("sel"): w.delete("sel.first", "sel.last")
    elif m := re.match(r"\s*\S+|\s+", w.get("insert", "insert lineend")): w.delete("insert", f"insert+{len(m.group())}c")
    elif w.compare("insert", "<", "end-1c"): w.delete("insert", "insert+1c")
    return "break"

class Popup:
    """Small chat-style window opened by long-pressing the button: Chat (can search the web), Rephrase, Grammar. Enter sends, Shift+Enter = new line.
    History (clock button) lists every chat since Penguin started; New starts a fresh one."""
    def __init__(self, root, results, near):
        self.root, self.results, self.mode, self.busy, self.last = root, results, "chat", False, ""
        if not _CUR[0]: _new_chat()
        w = self.w = tk.Toplevel(root); w.title("Penguin"); w.configure(bg=BG); w.attributes("-topmost", True)
        L, T, R, B = _area(); W, H = 400, 460; x, y = min(max(near[0] - W + D, L), R - W), min(max(near[1] - H - 12, T), B - H)
        w.geometry(f"{W}x{H}+{x}+{y}"); w.protocol("WM_DELETE_WINDOW", self.close); w.bind("<Escape>", lambda e: self.close())
        bar = tk.Frame(w, bg=BG); bar.pack(fill="x", padx=8, pady=(8, 4)); self.btns = {}
        for m in MODES:
            b = tk.Button(bar, text=m.capitalize(), relief="flat", bd=0, padx=8, pady=3, command=lambda m=m: self.set_mode(m), font=("Segoe UI", 9)); b.pack(side="left", padx=2); self.btns[m] = b
        tk.Button(bar, text="New", relief="flat", bd=0, bg="#374151", fg=FG, command=self.new, font=("Segoe UI", 9), padx=6).pack(side="right")
        tk.Button(bar, text="🕘", relief="flat", bd=0, bg="#374151", fg=FG, command=self.history_menu, font=("Segoe UI Emoji", 9), padx=6).pack(side="right", padx=4)
        self.out = tk.Text(w, bg="#1f2937", fg=FG, wrap="word", relief="flat", bd=0, padx=8, pady=6, font=("Segoe UI", 10), state="disabled", height=14)
        self.out.pack(fill="both", expand=True, padx=8); self.out.tag_config("me", foreground="#93c5fd"); self.out.tag_config("err", foreground="#fca5a5")
        F = "Segoe UI"; self.out.tag_config("bold", font=(F, 10, "bold")); self.out.tag_config("italic", font=(F, 10, "italic")); self.out.tag_config("code", font=("Consolas", 9), background="#374151", foreground="#fbbf24")
        self.out.tag_config("hl", background="#a16207", foreground="#ffffff"); self.out.tag_config("bullet", lmargin1=8, lmargin2=22); self.out.tag_config("quote", foreground="#9ca3af", font=(F, 10, "italic"), lmargin1=14, lmargin2=14)
        for i, sz in ((1, 14), (2, 12), (3, 11)): self.out.tag_config(f"h{i}", font=(F, sz, "bold"), spacing1=4, spacing3=2)
        self.out.tag_config("link", foreground="#60a5fa", underline=True); self.out.tag_bind("link", "<Enter>", lambda e: self.out.config(cursor="hand2")); self.out.tag_bind("link", "<Leave>", lambda e: self.out.config(cursor=""))
        row = tk.Frame(w, bg=BG); row.pack(fill="x", padx=8, pady=8)
        self.inp = tk.Text(row, bg="#1f2937", fg=FG, insertbackground=FG, wrap="word", relief="flat", height=3, width=1, padx=6, pady=4, font=("Segoe UI", 10))
        side = tk.Frame(row, bg=BG); side.pack(side="right", padx=(6, 0)); self.inp.pack(side="left", fill="x", expand=True)
        self.send_btn = tk.Button(side, text="Send", bg=ACC, fg="white", relief="flat", bd=0, padx=10, pady=4, command=self.send); self.send_btn.pack(fill="x")
        tk.Button(side, text="Copy reply", bg="#374151", fg=FG, relief="flat", bd=0, padx=6, pady=2, font=("Segoe UI", 8), command=self.copy).pack(fill="x", pady=(4, 0))
        for t in (self.inp, self.out):
            t.bind("<Control-a>", lambda e: (e.widget.tag_add("sel", "1.0", "end-1c"), "break")[1]); t.bind("<Control-A>", lambda e: (e.widget.tag_add("sel", "1.0", "end-1c"), "break")[1])
        self.inp.config(undo=True); self.inp.bind("<Control-BackSpace>", _del_word_back); self.inp.bind("<Control-Delete>", _del_word_fwd)
        self.inp.bind("<Return>", lambda e: (self.send(), "break")[1]); self.inp.bind("<Shift-Return>", lambda e: None)
        self.set_mode("chat"); self.show(); w.lift(); w.focus_force(); self.inp.focus_set()
    def set_mode(self, m):
        self.mode = m
        for k, b in self.btns.items(): b.config(bg=ACC if k == m else "#374151", fg="white" if k == m else FG)
        self.w.title(f"Penguin – {MODES[m]}")
    def show(self):
        """Redraw the current chat's transcript."""
        self.out.config(state="normal"); self.out.delete("1.0", "end"); self.out.config(state="disabled")
        for t, tag in _CUR[0]["log"]: self.write(t, tag, log=False)
    def write(self, text, tag=None, log=True):
        """tag 'md' = a Gemini reply: render Markdown (headings, bullets, quotes, bold, italic, code, ==highlight==, [label](url) links)."""
        if log: _CUR[0]["log"].append((text, tag))
        o = self.out; o.config(state="normal"); start = o.index("end-1c")
        if tag != "md": o.insert("end", text, tag)
        else:
            for line in text.rstrip("\n").split("\n"):
                base = ()
                if m := re.match(r"(#{1,3})\s+(.*)", line): base, line = (f"h{len(m.group(1))}",), m.group(2)
                elif m := re.match(r"\s*[-*+]\s+(.*)", line): base, line = ("bullet",), "• " + m.group(1)
                elif m := re.match(r"\s*(\d+\.)\s+(.*)", line): base, line = ("bullet",), m.group(1) + " " + m.group(2)
                elif line.startswith(">"): base, line = ("quote",), line.lstrip("> ")
                pos = 0
                for m in INLINE.finditer(line):
                    o.insert("end", line[pos:m.start()], base); pos = m.end(); g = m.lastindex
                    if g in (5, 7):                                                    # link: [label](url) or a bare url
                        url = m.group(5) if g == 5 else m.group(7).rstrip(".,;"); label = m.group(4) if g == 5 else url
                        t = f"lk{len(o.tag_names())}"; o.insert("end", label + (" ↗" if g == 5 else ""), base + ("link", t)); o.tag_bind(t, "<Button-1>", lambda e, u=url: open_link(u))
                    else: o.insert("end", m.group(g), base + ({1: "bold", 2: "code", 3: "hl", 6: "italic"}[g],))
                o.insert("end", line[pos:] + "\n", base)
            o.insert("end", "\n")
        o.yview(start) if log and tag in ("md", None) else o.see("end"); o.config(state="disabled")      # a fresh reply starts at the top of the window; your own message and redraws go to the end
    def new(self):
        _new_chat(); self.show()
    def history_menu(self):
        m = tk.Menu(self.w, tearoff=0)
        past = [c for c in _CHATS if c["log"]]
        if not past: m.add_command(label="No chats yet", state="disabled")
        for c in reversed(past): m.add_command(label=("● " if c is _CUR[0] else "   ") + c["title"][:45], command=lambda c=c: (_CUR.__setitem__(0, c), self.show()))
        m.tk_popup(self.w.winfo_pointerx(), self.w.winfo_pointery())
    def copy(self):
        if self.last: self.root.clipboard_clear(); self.root.clipboard_append(self.last)
    def send(self):
        text = self.inp.get("1.0", "end").strip()
        if not text or self.busy: return
        chat = _CUR[0]
        if not chat["log"]: chat["title"] = text.replace("\n", " ")                # the first message names the chat
        self.inp.delete("1.0", "end"); self.busy = True; self.send_btn.config(text="…"); mode, hist = self.mode, list(chat["hist"])
        self.write(f"{mode.capitalize()}: " + text + "\n", "me")
        def job():
            import brain
            try: self.results.put((self, chat, mode, text, brain.quick(mode, text, hist), None))
            except Exception as e: self.results.put((self, chat, mode, text, None, str(e)[:200]))
        threading.Thread(target=job, daemon=True).start()
    def done(self, chat, mode, text, reply, err):
        self.busy = False; self.send_btn.config(text="Send")
        if err: entry = ("Could not get a reply: " + err + "\n\n", "err")
        else:
            self.last = reply; entry = (reply, "md") if mode == "chat" else (reply + "\n\n", None)
            if mode == "chat": chat["hist"][:] = (chat["hist"] + [(text, reply)])[-30:]
        if chat is _CUR[0]: self.write(*entry)                                      # shown now (and logged); a reply that arrives after you switched chats is only logged
        else: chat["log"].append(entry)
    def close(self): self.w.destroy()
    def alive(self):
        try: return self.w.winfo_exists()
        except tk.TclError: return False

def _run():
    L, T, R, B = _area()
    root = tk.Tk(); root.overrideredirect(True); root.attributes("-topmost", True, "-transparentcolor", KEY); root.configure(bg=KEY)
    CW, CH = D + 2 * PAD + 12, D + 2 * PAD; cx = cy = PAD + D // 2; chip = (PAD + D + 4, PAD + 10)
    c = tk.Canvas(root, width=CW, height=CH, bg=KEY, highlightthickness=0); c.pack()
    x, y, hidden, drag = R - D - 36 - PAD, B - D - 36 - PAD, False, None     # (x, y) = window corner; the button itself sits PAD inside. ponytail: position isn't saved between runs
    place = lambda: root.geometry(f"+{R - TAB}+{y + PAD}" if hidden else f"+{x}+{y}")
    n = [0]; results = queue.Queue(); pop = [None]
    evq = queue.Queue()                                           # what Penguin heard / said / hit: shown in a small note above the button
    with ui._lock: ui._subs.append(evq)
    perms = []                                                    # open Allow / Deny boxes: (window, answer box, event, deadline)
    def show_perm(title, detail, box, ev, deadline):
        w = tk.Toplevel(root); w.title("Penguin - " + title); w.configure(bg=BG); w.attributes("-topmost", True); w.resizable(False, False)
        tk.Label(w, text="\U0001F510 " + title, bg=BG, fg="white", font=("Segoe UI", 11, "bold")).pack(anchor="w", padx=14, pady=(12, 4))
        tk.Label(w, text=detail, bg=BG, fg=FG, font=("Segoe UI", 9), wraplength=380, justify="left").pack(anchor="w", padx=14)
        row = tk.Frame(w, bg=BG); row.pack(fill="x", padx=14, pady=12)
        def answer(a): box["answer"] = a; ev.set(); w.destroy()
        for label, a, col in (("Allow once", "once", ACC), ("Always allow", "always", "#374151"), ("Deny", "deny", "#7f1d1d")):
            tk.Button(row, text=label, bg=col, fg="white", relief="flat", bd=0, padx=12, pady=5, command=lambda a=a: answer(a)).pack(side="left", padx=(0, 8))
        w.protocol("WM_DELETE_WINDOW", lambda: answer("deny")); w.update_idletasks()
        w.geometry(f"+{max(L, min(R - w.winfo_reqwidth(), x + PAD + D - w.winfo_reqwidth()))}+{max(T, y + PAD - w.winfo_reqheight() - 12)}"); w.lift(); w.focus_force()
        perms.append((w, ev, deadline)); show_tip("Penguin needs your permission")
    tip = tk.Toplevel(root); tip.overrideredirect(True); tip.attributes("-topmost", True); tip.withdraw()
    tiplab = tk.Label(tip, bg="#111827", fg="#e5e7eb", font=("Segoe UI", 9), wraplength=280, justify="left", padx=10, pady=6); tiplab.pack()
    tip_until = [0.0]
    shown = {}
    def show_tip(text):
        if time.time() - shown.get(text, 0) < 30: return                          # the same message is not shown again for 30 s
        shown[text] = time.time()
        tiplab.config(text=text[:220]); tip.update_idletasks(); w, h = tip.winfo_reqwidth(), tip.winfo_reqheight()
        tx, ty = min(max(x + PAD + D - w, L), R - w), max(y + PAD - h - 8, T); tip.geometry(f"+{tx}+{ty}"); tip.deiconify(); tip.lift(); tip_until[0] = time.time() + 5
    def open_popup():
        if pop[0] and pop[0].alive(): pop[0].close(); pop[0] = None
        else: pop[0] = Popup(root, results, (x + PAD, y + PAD))
    def long_press():
        nonlocal drag
        if drag and not drag[4] and not hidden: drag = drag[:4] + (True,); open_popup()      # held still: open the popup, and the release is not a click
    def draw():
        c.delete("all"); st = ui.state["state"]; col = COLORS.get("muted" if ui.state["muted"] else st, "#3b82f6")
        if hidden:
            c.config(width=TAB, height=D); c.create_rectangle(0, 8, TAB, D - 8, fill=col, outline=""); c.create_text(TAB // 2 + 1, D // 2, text="‹", fill="white", font=("Segoe UI", 16, "bold"))
        else:
            c.config(width=CW, height=CH); _anim(c, last[0], n[0], cx, cy)
            c.create_oval(cx - D // 2 + 5, cy - D // 2 + 5, cx + D // 2 - 5, cy + D // 2 - 5, fill="#fdfaf3", outline=col, width=4)
            _penguin(c, cx, cy, n[0] * 18 % 360 if last[0] in ("transcribing", "thinking") else 0)           # the penguin itself spins while processing
            c.create_oval(chip[0] - 8, chip[1] - 8, chip[0] + 8, chip[1] + 8, fill="#374151", outline="white"); c.create_text(chip[0], chip[1], text="›", fill="white", font=("Segoe UI", 11, "bold"))   # hide chip
    def set_hidden(h):
        nonlocal hidden
        hidden = h; draw(); place()
    def press(e): nonlocal drag; drag = (e.x_root, e.y_root, x, y, False); root.after(500, long_press)
    def move(e):
        nonlocal x, y, drag
        if not drag: return
        dx, dy = e.x_root - drag[0], e.y_root - drag[1]
        if abs(dx) + abs(dy) > 5 or drag[4]:
            drag = drag[:4] + (True,)
            if not hidden: x, y = min(max(drag[2] + dx, L - PAD + EDGE), R - D - 14 - PAD - EDGE), min(max(drag[3] + dy, T - PAD + EDGE), B - D - PAD - EDGE); place()
    def release(e):
        nonlocal drag
        was, drag = drag, None
        if not was or was[4]: return
        if hidden: set_hidden(False)
        elif math.hypot(e.x - chip[0], e.y - chip[1]) < 10: set_hidden(True)             # the hide chip
        else: _toggle()
    def show_menu(e):
        import brain
        menu = tk.Menu(root, tearoff=0); vm = tk.Menu(menu, tearoff=0); pick = tk.StringVar(value=brain.VOICE)
        for label, v in brain.VOICES.items(): vm.add_radiobutton(label=label, value=v, variable=pick, command=lambda v=v: brain.set_voice(v))
        bb = tk.BooleanVar(value=ui.state["barge"]); menu.add_checkbutton(label="Interrupt Penguin while it talks", variable=bb, command=lambda: ui.set_barge(bb.get()))
        vv = tk.BooleanVar(value=ui.state["voice"]); menu.add_checkbutton(label="Wake word: say \"Penguin\"", variable=vv, command=lambda: ui.set_voice(vv.get()))
        menu.add_command(label="Quick chat / rephrase / grammar", command=open_popup)
        menu.add_cascade(label="Voice", menu=vm)
        if ui.mic_options:
            mm = tk.Menu(menu, tearoff=0)
            try:
                info = ui.mic_options(); mic = tk.StringVar(value=info["current"])
                for o in info["options"]: mm.add_radiobutton(label=o["label"][:60], value=o["id"], variable=mic, command=lambda i=o["id"]: threading.Thread(target=ui.on_select_mic, args=(i,), daemon=True).start())
            except Exception: mm.add_command(label="Could not list microphones", state="disabled")
            menu.add_cascade(label="Microphone", menu=mm)
        menu.add_command(label="Open Penguin app", command=lambda: ui.show_window())
        menu.add_command(label="Mute / Unmute", command=lambda: (ui.state.update(muted=not ui.state["muted"]), ui.emit("status", state=ui.resting())))
        menu.add_command(label="Hide", command=lambda: set_hidden(True)); menu.add_separator(); menu.add_command(label="Quit Penguin", command=lambda: os._exit(0))
        menu.tk_popup(e.x_root, e.y_root)
    c.bind("<ButtonPress-1>", press); c.bind("<B1-Motion>", move); c.bind("<ButtonRelease-1>", release); c.bind("<Button-3>", show_menu)
    last = [None]
    def tick():
        cur = ("muted" if ui.state["muted"] else ui.state["state"])
        n[0] += 1
        while not results.empty():
            p, chat, mode, text, reply, err = results.get()
            if p.alive(): p.done(chat, mode, text, reply, err)
        while not evq.empty():
            ev = evq.get()
            if ev["type"] == "user" and ev.get("text"): show_tip("🎙 " + ev["text"])
            elif ev["type"] in ("toast", "error") and ev.get("text"): show_tip(ev["text"])
            elif ev["type"] == "reply" and ev.get("text"): show_tip(ev["text"])
        while not ui.perm_q.empty(): show_perm(*ui.perm_q.get())
        for item in list(perms):
            w, ev, dl = item
            if ev.is_set() or time.time() > dl:
                perms.remove(item); ev.set()
                try: w.destroy()
                except tk.TclError: pass
        if tip_until[0] and time.time() > tip_until[0]: tip.withdraw(); tip_until[0] = 0
        if cur != last[0] or (cur in ANIMATED and not hidden): last[0] = cur; draw()
        if n[0] % 20 == 0: root.attributes("-topmost", True); tip.attributes("-topmost", True)
        root.after(50, tick)
    ui.perm_ready[0] = True
    draw(); place(); tick(); root.mainloop()

def start(): threading.Thread(target=_run, daemon=True).start()
