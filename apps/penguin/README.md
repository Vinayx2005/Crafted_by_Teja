# Penguin

Offline voice assistant for the laptop. Say **"Penguin, open Chrome"** and it happens.
Standalone app in the craftedbyteja monorepo â€” Python + ESP32-P4 firmware, no Node/Next.js, shares nothing with the other apps.

```
ESP32-P4 mic (ES8311) --UART--> high-pass + RNNoise + loudness gate --> Whisper --> commands
```

## Hardware
Waveshare ESP32-P4-WIFI6-DB on COM3 (one analog MEMS mic -> ES8311 codec). `firmware/mic_stream` streams 16 kHz mono PCM
over the USB-serial port. No board? Run with `--pc` to use the laptop mic.

## Setup
```
pip install -r requirements.txt
```
Flash the firmware (ESP-IDF v6.1, once):
```
cd firmware/mic_stream
idf.py set-target esp32p4
idf.py -p COM3 flash
```
`sdkconfig.defaults` already targets chip rev v1.x â€” IDF 6.1 refuses early-silicon chips otherwise.

## Run
Double-click the **Penguin** icon on the Desktop (`launch.pyw`): it opens the Penguin app and the floating button together. If Penguin is already running (it also starts with Windows, button only) the icon just opens the app window, so there is never a second copy on the microphone.
The app (`ui.py` + `ui/index.html`, served on 127.0.0.1 only) has the orb, live captions, the conversation, English, Notes, Apps (connections), **Settings** and Mute, and a box to type commands.
Closing the app window leaves Penguin and the floating button running; quit from the button's right-click menu. Errors go to `penguin.log` when run without a console.
**Settings -> Wake word "Penguin"** is an on/off switch (also in the button's right-click menu), remembered across restarts. Off = saying "Penguin" no longer wakes it; the button, the circle, typing, notes and every other voice feature work as before.
```
python penguin.py              # floating button only, board mic on COM3
python penguin.py --window     # also open the app window
python penguin.py --gain 30    # board mic gain in dB (0-42)
python penguin.py --pc         # laptop mic
python penguin.py --raw        # skip RNNoise audio (still used to detect speech)
python penguin.py --no-window  # headless: open the printed http://127.0.0.1:8765 yourself
```
From the repo root: `npm run dev:penguin`. First start downloads the Whisper models (~0.5 GB).

## Commands
Always start with "Penguin" â€” everything else is just transcribed.

| Say | Does |
|---|---|
| open / launch / start `<app>` | any Start-menu app |
| search for `<text>` | Google in the default browser |
| volume up / down, mute, play, pause, next, previous | media keys |

## Gemini (free-form commands, answers, spoken replies)
Anything after "Penguin" that is not a fixed phrase goes to Gemini (`brain.py`): "Penguin, launch the browser and look up cheap flights",
"Penguin, what's the capital of Australia?". Gemini can call the same actions (open app, search, media keys) and its short answer is
printed and spoken in a Microsoft neural voice (`en-GB-SoniaNeural`, via the `edge-tts` package - an unofficial online service; if she fails or takes over 4 s Penguin tries `en-US-AriaNeural`, then the offline Windows voice). Change them with `PENGUIN_VOICE` / `PENGUIN_FALLBACK_VOICE` in `.env.local`; `tuning/voice_audition.py` lets you hear options. Only the transcribed text is sent to Google, never audio.
1. Get a key at https://aistudio.google.com/apikey
2. `copy .env.example .env.local` (or `.env`) and paste it after `GEMINI_API_KEY=` (both are gitignored - never commit it).
Default model `gemini-3.5-flash-lite` (fastest); set `PENGUIN_GEMINI_MODEL=gemini-3.8-flash` in `.env` for a smarter one.
No key or no internet: fixed phrases still work and Penguin prints why Gemini is unavailable.

Add phrases in `commands.py` (`parse` + `handle`); `python commands.py` self-checks the parser.

## Google Calendar (read, add, change, delete events)
"Penguin, what's on my calendar tomorrow?", "add dentist Friday at 3pm", "move it to 4", "delete the dentist appointment" (asks you to confirm first). Gemini calls `gcal.py`.
One-time setup: Google Cloud console -> new project -> enable **Google Calendar API** -> OAuth consent screen (External, add yourself as a test user) ->
Credentials -> **OAuth client ID, type Desktop app** -> download as `apps/penguin/client_secret.json`. Then `pip install -r requirements.txt` and run `python gcal.py`
once to sign in; the token is saved in `gcal_token.json`. Both files are gitignored. Scope is events only (primary calendar).

## Google Tasks
"Penguin, add a task to call the bank tomorrow", "what are my tasks", "mark the bank task done". Own Google sign-in (Apps -> Google Tasks -> Connect), so it can be a
different account from Calendar. Enable the **Google Tasks API** in the same Cloud project; scope is Tasks only. Code: `gtasks.py`.

## English teacher mode
Say **"Penguin, turn on English teaching mode"** (or click **English** in the window): a strict conversation coach marks every grammar mistake, gives the corrected and natural version, scores you and sets
random impromptu tasks, tracking your weak points over time. Say "stop English mode" to end with a summary. Full method, rules and limits: [ENGLISH_TEACHER.md](ENGLISH_TEACHER.md). Code: `english.py`.

## Speaking to Penguin: click the circle, talk, click again
Penguin starts **not listening**. Click the **circle** at the top of the window and talk for as long as you like (up to 10 minutes): nothing is cut off while you pause to think.
When you finish, click the circle again: Penguin then transcribes everything you said in one go and answers. No wake word is needed. Typing, the Notes panel and the ðŸŽ™ record button work any time.
For the old always-listening, wake-word behaviour set `PENGUIN_ACTIVATION=wake` in `.env.local`. In click mode a very quiet clip (nothing louder than room noise) is dropped with a "I did not hear anything" popup.

## Notes and voice recordings (local)
"Penguin, take a note: call Ravi about the invoice", "Penguin, start recording" ... "Penguin, stop recording" (recording continues while you talk; max 1 hour), or use the **Notes**
button in the window (Record / Stop, write a note, open, play back, delete). Everything is stored in `apps/penguin/notes/` (gitignored): one `.json` per note plus a `.wav` for recordings.
Each note keeps the **exact transcript** (recordings are transcribed by local Whisper `small.en`, audio never leaves the laptop), a **summary** and **action items**.
The summary/action items are written by Gemini from the transcript text only; set `PENGUIN_NOTES_LOCAL_ONLY=1` in `.env.local` to skip that (then notes get the transcript only).
Ask Penguin "what notes do I have", "read my note about the invoice". **Delete** a note with the trash icon in the list (or the Delete button inside a note; both ask first), or by voice/chat: "delete my note about the invoice" (Penguin only deletes when you clearly say delete; recordings are deleted with their audio). While recording, the mic is also used for normal commands, and audio while Penguin speaks may have small gaps.

## Knowledge, live facts and memory
Penguin answers as a generalist from Gemini's knowledge, and for anything that may have changed (news, weather, prices, rates, scores, current office-holders) or when unsure
it calls `web_lookup` (Google Search through Gemini) instead of guessing. It remembers lasting facts you tell it ("my startup is Acme", "my CA is Ravi") in
`memory.json` (gitignored, newest 100) and uses them in later chats; say "forget ..." to remove one. It also keeps the last 10 minutes of conversation for follow-ups.
Honest limit: the model itself is not retrained daily. Staying current comes from live search plus this memory.

## Maths and startup numbers
"Penguin, what is 12 plus 8 times 3 divided by 4" (proper BODMAS), "what is 18% of 4.5 lakh", "pre-money 4 crore, raising 1 crore: what does the investor get",
"founders 50 and 30, ESOP 10, angel 10, raise 1 crore at 4 crore pre-money with a 5% pool: new holding pattern". Gemini calls `maths.py` instead of
guessing (models get arithmetic wrong); `python maths.py` self-checks it. Simplifying assumptions: one priced round, no convertible notes or liquidation preferences.

## YouTube (videos)
"Penguin, play a video about GST filing on YouTube", "search YouTube for ...", "which channels am I subscribed to". Same Google account as YouTube Music (one sign-in, one browser profile; Apps -> YouTube or YouTube Music -> Connect does both).
Needs the **YouTube Data API v3** enabled in the Cloud project; without it "play a video" still opens YouTube's search page in your signed-in browser. Code: `youtube.py`.

## Gmail
"Any unread emails?", "read the one from the bank", "email ravi@x.com that I'll be late". Own Google sign-in (Apps -> Gmail -> Connect). Enable the **Gmail API**
in the Cloud project and add the account as a test user. Penguin only saves a **draft** unless you clearly say to send; email text is treated as untrusted data.
Scope `gmail.modify` (read, draft, send, mark read; no permanent delete). Code: `gmail.py`.

## Interrupting
Talk over Penguin (or click its button, or type a new request) and it stops at once, then treats what you said as the next command (no need to say "Penguin" again). It tells your voice from its own echo by
comparing the microphone with the loudness of what it is playing, so it works best with headphones; with speakers it may cut itself off, so turn it off in **Settings -> Interrupt while Penguin talks**
(or `PENGUIN_BARGE_IN=0`). Requests run in their own thread so the microphone stays open while Penguin thinks and speaks; a newer request replaces one still running.

## Extra tools (MCP) and the permission gate
Copy `mcp.example.json` to `mcp.json`, list your MCP servers (same shape as Claude Desktop's `mcpServers`: `command`, `args`, `env`), restart Penguin. Gemini gets one tool, `use_mcp_tool(server, tool, arguments_json)`, plus a list of what each server offers
(Settings shows them). The gate is enforced in `mcp_tools.py`, not left to the model: a tool the server marks read-only runs by itself; every other tool shows an **Allow once / Always allow / Deny** box beside the floating button and waits for your click
(no click in 60 s = denied). Per server you can add `"allow": [tools]`, `"deny": [tools]`, `"auto_allow_read_only": false`. "Always allow" choices are kept in `mcp_permissions.json`. Results come back marked as untrusted data. Both files are gitignored.
Needs `pip install "mcp<2"` (the v2 API differs).

## No screen control
Penguin does not use the mouse or keyboard (the screen agent was removed). It only transcribes speech and works through fixed phrases
(open an app, search, media keys) and its connected apps: Google Calendar and YouTube Music, each with its own Google account
(Apps panel -> Connect). Anything it can't do through those, it says so.

## How it stays accurate
- Live preview uses `base.en` (rough, ends in `...`); the final line after a pause uses `small.en`.
- Speech only counts if RNNoise says voice (p > 0.8) **and** it is 4x louder than the room's noise floor (`GATE`).
  On the author's room this cut false lines from 10 to 1 per minute of silence; read-aloud sentences scored 1-2% word errors.
- Tune for your room with `tuning/`: `record_eval.py` records sentences, `evaluate.py` scores models, `sim_stream.py` replays them through the live logic.

## Limits
English only, laptop only, CPU Whisper adds ~2 s after you stop talking.

