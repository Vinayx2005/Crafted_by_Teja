# Video Editor (Content Studio)

The Video Editor is the front end for the editing set-up in `D:\Editing`. It does not edit video itself. It gives the editing that used to happen only in chat (with the **long-form whiteboard animation** skill and the other editing skills) a screen of its own: projects, steps, previews and a chat with the editor.

---

## 1. The three parts

| Part | Where it lives | What it does |
|---|---|---|
| **Video Editor page** | Content Studio → sidebar → **Video Editor** (under Silence remover) | What you see and click: projects, steps, outputs, the plan, the chat, the Claude sign-in |
| **Editor bridge** | `D:\Editing\editor-bridge\server.mjs` (start it with `start.cmd`) | A small server on the editing PC. It passes messages between the page and Claude Code, and serves the project files to the page |
| **Claude Code + the editing skills** | Runs inside `D:\Editing` | Does the actual editing with `CLAUDE.md`, the long-form-whiteboard-animation skill (Parts 1–9), telugu-captions, resolve-handoff, the remotion-* skills, `tools/` (Python, FFmpeg, Whisper) and `remotion/` |

```
Studio page  ⇄  editor bridge (127.0.0.1:4317)  ⇄  Claude Code in D:\Editing  →  projects/<video>/raw · work · out
```

The editor uses exactly the same skills as editing in chat. The page only sends your messages and shows what comes back.

---

## 2. Getting started

1. **Start the bridge:** double-click `D:\Editing\editor-bridge\start.cmd` and keep that window open while you edit. (Or run `node D:\Editing\editor-bridge\server.mjs`.)
2. **Open Studio on the same PC:** go to **Video Editor** in the sidebar.
3. **It connects by itself:** there is nothing to paste. The bridge gives its access key only to the Studio pages, and the browser remembers it.
4. **Open your video:** press **Open folder** and choose the folder on your PC that holds the footage, in the normal Windows "Select folder" window (see *Opening a folder* below).
5. **Sign the editor in to Claude once:** press **Sign in with Claude** at the top of the page and finish signing in on the Claude page that opens. The panel turns green by itself. If the sign-in page shows a code, paste it into the box and press **Submit code**.

If the bridge is not running, the page shows **"Start the editor on your PC"** with these steps.

---

## 3. What the page shows

### Claude sign-in (top)
- **Not signed in:** a **Sign in with Claude** button, plus **Use an Anthropic Console account** for API billing instead of your Claude subscription.
- **Signed in:** a green **Editor signed in to Claude** label with a **Sign out** link.

### Layout
The page is laid out like a video editor:

```
┌──────────────────┬───────────────────────────────┬────┐
│  Media files     │  Preview player               │ dB │
│                  │                               │    │
├──────────────────┴───────────────────────────────┤ me │
│  AI features  [Pauses] [Unwanted] [Captions] [Storyboard] [Ask AI] │
├──────────────────────────────────────────────────┤ r  │
│  Timeline   V2 Graphics  👁 🔒                     │    │
│             V1 Footage   👁 🔒                     │    │
│             CC Captions  👁 🔒                     │    │
│             A1 Audio     👁 🔒 🔊                  │    │
└──────────────────────────────────────────────────┴────┘
```

### Toolbar (above the editor)
- **Video picker:** every project in `D:\Editing\projects`, including grouped ones (for example *90 day mentroship videos → Orientation*). The video being edited right now is marked "• editing".
- **Open folder:** opens a video folder from anywhere on this PC (see below).
- **New video:** creates an empty project with `raw/`, `work/` and `out/` folders, optionally inside an existing group.
- **Export:** renders the video to a file (see below).

### Opening a folder
**Open folder** works like opening a project in any other editor:
1. The standard Windows **Select folder** window opens. If you don't see it, check the taskbar.
2. Choose the folder that holds the video's footage, for example `D:\Videos\My vlog`, and press **Open folder**.
3. It opens straight away and appears in the video picker from then on.

What happens behind the scenes:
- **Nothing is copied or moved.** The folder is linked into `D:\Editing\projects\<folder name>` with a Windows folder link (a junction). Every tool, skill and render sees it as a normal project, while the files stay where they are.
- **Folders added inside it:** `raw\`, `work\` and `out\` are created when missing. The edit's working files go in `work\`, and outputs (storyboards, previews, finals, .srt files) go in `out\`.
- **Footage:** videos and audio already sitting in the folder itself show under **Footage**, next to anything in `raw\`.
- **Same folder again:** opening a folder that's already open selects it. A folder inside `D:\Editing\projects` opens directly, without a link.
- **Refused:** a whole drive, and `D:\Editing` itself.
- **Removing it from the list:** delete the link `D:\Editing\projects\<folder name>`. In File Explorer it has a shortcut arrow. Deleting the link leaves your folder and footage untouched.

### Export
**Export** renders the current edit straight from `work/edit.json` (or `work/promo.json`). It uses the same Remotion composition and asset staging as `tools/render.py`, with no AI turn involved, so it needs no Claude sign-in. Pick one of two outputs:

| Output | Quality | File | How it is made |
|---|---|---|---|
| **Preview** | Low: 720p, **under 30 MB** | `out/<name> - phone preview.mp4` | If the final is newer than the edit, it is just re-encoded (about 30 s for 3 min). Otherwise the edit is rendered first. The bitrate is picked from the length to stay under 30 MB, so it reaches the phone over Remote Control |
| **Final output** | High: 1080p | `out/<name>.mp4` | Remotion render at crf 14, x264 slow preset, JPEG quality 100 (the skill's final settings). Expect 10–30 minutes for a few minutes of video |

- The dialog shows each existing file with its size and date, flags it when it's **older than the edit**, and has **Play** (opens it in the player) and **Download**.
- While it runs, the dialog shows the stage (bundling, rendering frames, making the small copy), percent and elapsed time. The toolbar button shows **Exporting NN%**, so you can close the dialog.
- **Cancel** stops the render. The previous file stays as it was, because a new file only replaces the old one once it's finished.
- An export takes the same one-job-at-a-time slot as the AI editor (both rebuild `D:\Editing\public`). While either runs, the other waits.
- After an export, Remotion's temp copies are cleaned up, as `render.py` does.
- **Refresh** button: reloads the file lists.

### Media files (top left)
Click any file to open it in the preview player.
- **Footage:** the raw files in `raw/`, plus two ways to add more:
  - **Upload** from the browser, with a progress bar.
  - **Add from this PC** by path (for example `D:\Footage\IMG_3124.MOV`). It is instant on the same drive and uses no extra space, which suits 1–2 GB raw files.
- **Outputs:** everything in `out/`, newest first: storyboards, style frames, previews, finals, `.srt` files.
- **Images:** working stills from `work/` (contact sheets, style frames), as thumbnails.
- **Docs:** the **graphics plan** (`work/plan.md`, shown as the two-column table), the **brief** (`work/brief.md`) and caption files.

### Preview player (top right)
- Plays videos (with seeking) and shows images and documents.
- It opens on the newest **final** (else the newest **preview**), which is the video the timeline describes.
- When something else is open, **Show the edit** switches back to it.
- Buttons to open the file in a new tab or download it.

### Volume meter (right edge)
- A live **L / R level meter in dB** (0 down to −60) for whatever the player is playing, with peak markers and the current peak level on top.
- Green up to about −18 dB, yellow towards −6 dB, red near 0 dB.
- A **mute** button at the bottom.

### AI features (bar under the media and player)
The bar's buttons hand work to the AI editor. The skill keeps its own approval gates, so nothing is exported before you approve. Anything else (the final export, a one-off question) goes through **Ask AI**.

| Button | What it does |
|---|---|
| **Create 1st draft** (orange) | Starts the 1st draft (see below). Its label follows the draft: *Making the storyboard…* → *Storyboard ready: review it* → *Editing the 1st draft…* → *1st draft ready* |
| **Remove pauses & fillers** | Opens the **Silence remover** in a popup, on the timeline's video (see below) |
| **Find unwanted parts** | List retakes, mistakes, repeated lines and off-topic tangents with start/end times and the words spoken. Nothing is cut until you pick which ones to remove |
| **Auto captions & .srt file** | A real `.srt` in `out/`, then the before/after caption table and the spelling check. Uses the telugu-captions skill (asking for the script first) when the video is in Telugu or Tenglish |
| **Storyboard** 🔒 | Locked until the 1st draft has made its storyboard; then opens the storyboard review |
| **Request changes** | A box for changes in plain words, like a message to Claude |

### 1st draft
1. **Create 1st draft** opens the **brief**:
   - **Intake questions** from the skill (Part 1, Step 0), with the usual answers pre-selected: cleanup, colour grade, captions, format, language, style, audio, B-roll, transitions & SFX.
   - **Optional details:** target length and the lower third (name, role).
   - **"What do you want in this video?"**, where you write anything else the way you would in chat. You can also paste a script for the captions.
2. **Up to the storyboard:** the AI editor saves the answers to `work/brief.md` and edits the way it does in chat: analyse, HDR check, raw cut if needed, transcript, graphics plan, `work/edit.json`, then the **storyboard sheets** in `out/`. For the 1st draft the storyboard is the approval step, so it doesn't stop for plan approval, and it doesn't render yet. If it needs something only you can answer, it asks in the AI editor chat and waits.
3. **Storyboard review:** when the sheets are ready, **Storyboard** unlocks and the review opens by itself, showing the 5-second storyboard and the finished-frames sheet full width. It has two buttons:
   - **Approve and edit the 1st draft**
   - **Request changes**: the AI editor makes the changes and remakes the storyboard for approval again.
4. **The draft:** after approval the AI editor renders the draft with its QA checks, as `out/<video> - 1st draft.mp4`. When it is ready it opens in the player and starts playing.
5. **Changes to the draft:** **Request changes** (or the orange button once the draft is ready) sends changes, and the AI editor renders the draft again.

Where the draft stands is saved in `work/editor/state.json`, so it survives a page reload.

### Request changes
- A large text box for changes, written the way you would tell Claude (*"At 0:24 move the card to the left, it covers the face"*).
- **Insert time** adds the player's current time and file name at the cursor.
- **Send changes** (or **Ctrl+Enter**) sends it. While a 1st draft is in progress, the message tells the AI editor what to redo afterwards: remake the storyboard, or render the draft again.

- **Ask AI** opens the **AI editor** chat panel, sliding in from the right. A dot on the button means there's a new reply.
- **Stop** appears while the editor is working.

### Silence remover popup (Remove pauses & fillers)
The full Silence remover (the same tool as the sidebar's **Silence remover**) opens over the editor, working directly on the video in the timeline. There is no project list and no "New project" step.

- **Which video:** the footage on the timeline's **V1** track, i.e. the source the edit is built from (for example `work/source_30cfr.mp4`). If the video has no edit yet, it uses the video in the preview, else the first raw video. The popup header names the file it is working on.
- **Straight to removing silences:** it opens on the whole video, with the silences already checked. **Change part** limits it to a section.
- **Continues where you left off:** there is one saved session per video, so closing and reopening the popup keeps your cuts and settings.
- **Video:** read from `D:\Editing` through the bridge, with a progress bar. It is not copied into the browser, so large files don't fill browser storage.
- **Same tools as the sidebar version:** **Find unwanted parts**, settings, cut/keep, preview the edited version. Its buttons (Back to the editor, Change part, Restart, Settings, Save project, Export…) sit in the popup header.
- **What it saves into the edit:** anything you export or save (it is still downloaded as before) is also saved into the edit:
  - the **exported video** goes to `raw/`, where it shows under Media files → Footage;
  - the **cut list** and **project file** (`.silence.json`) go to `work/`.

  The popup footer lists each saved file, with **Play** for the video.
- **Use it in the edit:** tells the AI editor to use the new cut (`raw/<name>`) as the source from now on, mentioning the cut list. The AI editor then rebuilds the frame-accurate source from it.
- **Closing:** **Back to the editor**, ✕ or **Esc**. The session also appears on the sidebar's Silence remover page, marked *from the Video Editor*.

### Timeline (bottom)
The timeline is read from the props that drive the Remotion render: `work/edit.json` (or `work/promo.json` for promo videos), so it shows the real edit at its real times.

| Track | What is on it |
|---|---|
| **V2 Graphics** | Whiteboard scenes, cards, list and stat cards, lower thirds, titles, slides, the opener, zooms. Overlapping items stack in lanes |
| **V1 Footage** | The source cuts laid end to end, B-roll cutaways, split screens |
| **CC Captions** | Caption cues, when the captions are part of the render |
| **A1 Audio** | The voice, music and SFX |

- **Track buttons:** 👁 shows or hides the track on the timeline, 🔒 locks it so its clips can't be selected, and 🔊 on A1 mutes the player.
- **Ruler and playhead:** the red playhead follows the player. Click anywhere on the ruler or tracks to jump there.
- **Zoom:** **−**, **Fit** and **+** in the timeline header.
- **Click a clip** to select it and jump to its start. A bar at the bottom shows its type, times and text, with **Ask AI to change this**. That opens the AI editor with the clip already described, for example *"About the whiteboard at 1:11.5–1:35.8 ("24-hour exercise / …"): "*; you type what to change.
- **Empty timeline:** before the editor has built the edit, the timeline says it fills in once `work/edit.json` exists.

#### Shortcuts
Hover **Shortcuts** in the timeline header to see them.

| Shortcut | What it does |
|---|---|
| **Space** | Play / pause the player |
| **← / →** | Jump to the previous / next cut: any clip start or end on V2, V1 and A1 (captions are skipped, and hidden tracks are ignored). The timeline scrolls to keep the playhead in view |
| **Alt + scroll** | Zoom the timeline in / out around the mouse |
| **Shift + scroll** | Move the timeline left / right |

The keys do nothing while you type in a box, or while a dialog or the Silence remover popup is open, so they never clash with typing or with the Silence remover's own shortcuts.

### AI editor (chat panel)
- Type answers, approvals or changes in plain words, for example *"at 0:24 move the card to the left"*. **Enter** sends; **Shift+Enter** starts a new line.
- The editor's replies appear as text. Its background work (running tools, rendering) folds into one **"Worked through N steps"** line you can expand.
- **Stop** ends the current job, including any render it started.
- **New conversation** (icon in the panel header) clears the chat; every project file stays.
- **Close** with ✕ or **Esc**.

---

## 4. An edit from start to finish

1. **Create a video** with **New video**, and add the raw footage under **Media files → Footage**.
2. Open **Ask AI** and say *"Start editing this video"*. The editor reads Part 1 of the skill, looks at the folder and asks the **intake questions** (cleanup, colour grade, captions, format, style, B-roll, SFX…) in the AI editor panel, with its default for each.
3. **Answer in the panel.** The answers are saved to `work/brief.md` (**Docs → Brief**).
4. It analyses the footage, converts HDR if needed, cuts it if the cleanup isn't done (Part 2), transcribes, and writes the **graphics plan** (**Docs → Graphics plan**). It waits for you.
5. Approve the plan in the panel, or press **Storyboard**. Along the way you can use **Remove pauses & fillers**, **Find unwanted parts** and **Auto captions & .srt file**. The style frames and the **storyboard** (one frame every 5 s, plus a finished-frames sheet) land in `out/` and appear under **Media files → Outputs**. The **timeline** fills in from `work/edit.json`. It waits.
6. Approve the storyboard in the panel. It renders the preview and checks smoothness, length and audio. The preview opens in the player, the timeline follows it, and the meter shows the levels. It waits.
7. Make changes from the timeline: click a clip, press **Ask AI to change this**, and say what to change.
8. Approve the preview in the panel (*"export the final"*). It renders the HQ 1080p final, polishes the audio, puts the `.srt` next to it, and deletes old previews and storyboard sheets, as the skill says.

The skill's rules apply throughout: SFX need your approval, the brand and whiteboard styles hold, text never goes on a face, and so on.

---

## 5. Rules the editor keeps automatically

- **Same skills, same gates:** it follows `D:\Editing\CLAUDE.md` and the long-form-whiteboard-animation skill exactly, and nothing is exported before you approve.
- **Questions in the chat:** where it would normally ask in a pop-up, it asks in the chat as a numbered list with its default for each, then waits.
- **Everything to review goes in `out/`:** storyboards, style frames, previews, finals, `.srt` files, B-roll thumbnails and SFX files. The page shows that folder automatically.
- **One edit at a time across all videos:** storyboards and renders both rebuild `D:\Editing\public`, so they must not overlap. A second request is refused with a message naming the video in progress.
- **Each video remembers its conversation:** the chat is saved in `projects/<video>/work/editor/chat.jsonl` and the session in `work/editor/session.json`. You can close the page and continue later.

---

## 6. Limits and safety

- **Only on the editing PC:** the bridge listens on `127.0.0.1` only. The page works in a browser on that PC (local Studio or tools.craftedbyteja.com), not from a phone or another computer.
- **Locked down:**
  - Every request needs the editor's access key (`D:\Editing\editor-bridge\token.txt`). The page gets it automatically from `GET /api/pair`, which answers only Studio's addresses: browsers always send the page's address with the request, and a page cannot fake it.
  - Only Studio's addresses can call the bridge from a browser, and the bridge only answers requests addressed to `127.0.0.1` / `localhost`, which blocks DNS-rebinding tricks.
  - Files are served only from a project's `raw/`, `work/` and `out/` folders.
- **It works without asking permission:** nobody is at a terminal to approve each step, so the editor can run Python, FFmpeg and Remotion and edit files in `D:\Editing` freely, the same as editing in chat.
- **Separate sign-in:** the editor's Claude Code has its own Claude sign-in, managed from the panel at the top of the page.

---

## 7. Troubleshooting

| You see | Do this |
|---|---|
| "Start the editor on your PC" | Double-click `D:\Editing\editor-bridge\start.cmd`, then **Try again** |
| "Could not connect" | Close the bridge window, double-click `start.cmd` again, then **Try again** |
| The folder window doesn't appear | Check the taskbar. It can open behind the browser |
| "The editor is not signed in to Claude yet" | Use **Sign in with Claude** at the top of the page |
| "The editor is busy with …" | Another video is being edited; wait for it, or open that video and press **Stop** |
| New files don't appear | Press **Refresh** in the project header |
| The chat has gone off track | **New conversation**; the project files stay as they are |

---

## 8. Where everything lives

| What | File |
|---|---|
| Video Editor page | `apps/tools/src/app/studio/[id]/video-editor.tsx` |
| Sidebar entry | `apps/tools/src/app/studio/shell.tsx` (`video` in `NAV`) |
| Section switch | `apps/tools/src/app/studio/[id]/page.tsx` |
| Bridge server | `D:\Editing\editor-bridge\server.mjs` |
| Start script | `D:\Editing\editor-bridge\start.cmd` |
| Access key (handed to Studio automatically) | `D:\Editing\editor-bridge\token.txt` |
| Folder window script | `D:\Editing\editor-bridge\pick-folder.ps1` |
| Per-video chat and session | `D:\Editing\projects\<video>\work\editor\` |

### Bridge API (for reference)
All routes are under `http://127.0.0.1:4317/api` and need the `X-Editor-Token` header (or `?t=` for media links). The exceptions are `/ping` and `/pair`, which Studio uses to fetch the key.

| Route | Purpose |
|---|---|
| `GET /ping` | Is the bridge running |
| `GET /health` | Folder, Claude Code path, current job |
| `GET /auth/status` · `POST /auth/login` · `GET /auth/login` · `POST /auth/code` · `POST /auth/cancel` · `POST /auth/logout` | Claude sign-in for the editor |
| `GET /projects` · `POST /projects` | List or create projects |
| `GET /p/detail?id=` | Steps, files, brief and plan for one video |
| `GET /p/timeline?id=` | The render props behind the timeline (`work/edit.json` or `work/promo.json`, whichever is newer) |
| `GET /p/chat?id=` · `GET /p/stream?id=` | Chat history, and live updates (server-sent events) |
| `POST /p/message?id=` · `POST /p/stop?id=` · `POST /p/new-chat?id=` | Send a message, stop the job, start a new conversation |
| `POST /p/upload?id=&name=` · `POST /p/add-local?id=` | Add raw footage |
| `GET /pair` | The access key, only for Studio's addresses (automatic connect) |
| `POST /open-folder` `{path?}` | Show the Windows folder window (or use a typed path) and open that folder as a project |
| `GET /p/export?id=` · `POST /p/export?id=` `{mode: preview\|final\|cancel}` | Export status (existing files, running job), start an export, cancel it |
| `GET /p/file?id=&path=` | Serve a file from `raw/`, `work/` or `out/` (supports seeking) |
