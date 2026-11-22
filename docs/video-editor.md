# Video Editor (Content Studio)

The Video Editor is the front end for the editing set-up in `D:\Editing`. It does not edit video itself. It gives the editing that used to happen only in chat (with the **long-form whiteboard animation** skill and the other editing skills) a screen of its own: projects, steps, previews and a chat with the editor.

---

## 1. The three parts

| Part | Where it lives | What it does |
|---|---|---|
| **Video Editor page** | Content Studio → sidebar → **Video Editor** (under Knowledge) | What you see and click: projects, steps, outputs, the plan, the chat, the Claude sign-in |
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
4. **Start a project:** the Video Editor opens on your projects page. Press **Create new project** and choose (or make) the folder on your PC for this video, in the normal Windows "Select folder" window (see *Create new project* below). Then add the footage under **Media files**.
5. **Sign the editor in to Claude once:** press **Sign in with Claude** at the top of the page and finish signing in on the Claude page that opens. The panel turns green by itself. If the sign-in page shows a code, paste it into the box and press **Submit code**.

If the bridge is not running, the page shows **"Start the editor on your PC"** with these steps.

---

## 3. What the page shows

### Claude sign-in (top of the projects page)
The sign-in is shown on the Video Editor's projects page. Inside a project it is hidden, along with the page title, so the project's title row (name, save status, Export) is the top of the page. If the editor is ever signed out, the sign-in panel appears inside the project too.
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

### Projects page (what Video Editor opens on)
**Video Editor** first shows all your projects as cards, with **Create new project** at the top right.
- **Each card** shows the project's name, its folder on the PC (and its group, for example *90 day mentroship videos*), and where it stands: *No footage yet*, *Footage added*, *Being edited*, *Preview ready* or *Final ready*. It also shows the number of footage videos and when it was last edited. A project the AI editor or an export is working on shows **working now**.
- **Open** (or a click on the card) opens the project in the editor.
- **Remove from the list** (bin icon) appears only on projects added from another folder. It removes only the link; the folder and everything in it stay on your PC.
- **No projects yet:** the page shows a short explanation and the **Create new project** button.

### Create new project
1. Press **Create new project**. The standard Windows **Select folder** window opens. If you don't see it, check the taskbar.
2. Choose the folder where this video's edit should live, for example `D:\Videos\My vlog`. To start fresh, press **New folder** in that window, name it, and choose it.
3. The project opens straight away, named after the folder. Add the footage under **Media files → Footage** (**Upload**, or **Add from this PC**), then start editing.

The whole edit happens in that folder. Choosing a folder that's already a project just opens it.

### Toolbar (inside a project)
- **Back to the projects page:** click the **Video Editor** icon in the left rail (there is no Projects button).
- **Project name** (large, at the top left): hover it to see the folder where this edit lives on the PC.
- **Saved indicator:** *All changes saved* (hover for the time of the last save), *Saving…* while a change is being written, or *Not saved* with the reason (for example, when the editor on this PC isn't running).
- **Export:** renders the video to a file (see below). The saved indicator and Export sit on the right of the title row.
- **No Refresh button:** the file lists reload by themselves while the AI editor works, after every change, and whenever you come back to the tab or window.

### Auto-save
Every change is saved to the project on this PC the moment you make it. There is no Save button to remember.

| What | Where it is saved |
|---|---|
| Timeline edits: cuts, deletes, drops, Apply to timeline, Undo | `work/edit.json` at once, with the previous version in `work/editor/history` |
| Markers, where the 1st draft stands | `work/editor/state.json` |
| Silence remover sessions: settings, removed and kept parts, unwanted parts, transcript | About a second after each change, in this browser **and** in `work/editor/silence/<session>.json`. If the browser loses them (cleared data, another browser), opening Remove pauses & fillers brings them back from the project folder |
| Where you were: the file in the player, timeline preview or not, the playhead | `work/editor/state.json` every couple of seconds. Opening the project again puts you back there |

Reloading the page keeps the open project open (in that browser tab). Coming to the Video Editor fresh still starts on the projects page.

What happens behind the scenes when a folder becomes a project:
- **Nothing is copied or moved.** The folder is linked into `D:\Editing\projects\<folder name>` with a Windows folder link (a junction). Every tool, skill and render sees it as a normal project, while the files stay where they are.
- **Folders added inside it:** `raw\`, `work\` and `out\` are created when missing. The edit's working files go in `work\`, and outputs (storyboards, previews, finals, .srt files) go in `out\`.
- **Footage:** videos and audio already sitting in the folder itself show under **Footage**, next to anything in `raw\`.
- **Same folder again:** opening a folder that's already open selects it. A folder inside `D:\Editing\projects` opens directly, without a link.
- **Refused:** a whole drive, and `D:\Editing` itself.
- **Removing it from the list:** use the bin icon on its card. It deletes only the link `D:\Editing\projects\<folder name>`, which has a shortcut arrow in File Explorer. Your folder and footage stay untouched.

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
- **What it opens on:** a render of the edit (final, else preview) when it is up to date with the timeline; otherwise the **timeline** itself; otherwise the newest render or the first footage video.
- **Timeline preview** (header says *Timeline · the edit as cut, without graphics*): plays exactly what is on the timeline, the footage cuts (V1) in order, skipping everything that was cut out or deleted and switching files where the cuts do. Its own controls show **timeline time** (for example `0:12.3 / 29:32.8`), with play/pause and a scrub bar over the edit's length; at the end, play starts over. After a cut, delete or drop it follows the new edit straight away, at the same moment. Graphics, B-roll, captions and music only appear in a render (**Export**).
- **A file from Media files:** clicking a card plays that whole file with the normal video controls. **Play timeline** in the header switches back to the timeline preview, and **Show the edit** to the render.
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
| **Find unwanted parts** | Opens a popup like **Remove pauses & fillers**, on the timeline's video, that works **only on unwanted parts** (fillers, fumbles, repeated takes): no silences are marked and there are no silence settings. It starts listening as soon as it opens, highlights what it finds in red, and nothing is cut until you remove them. **Apply to timeline** puts the result back on the timeline. It keeps its own session and its own Apply record, separate from Remove pauses & fillers, so applying one never undoes the other's cuts |
| **Auto captions & .srt file** | A real `.srt` in `out/`, then the before/after caption table and the spelling check. Uses the telugu-captions skill (asking for the script first) when the video is in Telugu or Tenglish. Once `work/caption_review.md` exists (the 1st draft makes it), the button becomes **Captions review (N)** and opens the table instead, also while the AI works: #, time, Before (speech-to-text) and After (caption) with the changed words marked red / green, Change (corrected / added / removed) and Note. Filter by change type, search words, ▶ on a time plays that moment on the timeline (final-timeline tables only), download the `.srt`, or **Make captions again** |
| **Storyboard** 🔒 | Locked until the 1st draft has made its storyboard; then opens the storyboard review |
| **Request changes** | A box for changes in plain words, like a message to Claude |

### 1st draft
1. **Create 1st draft** opens the **brief**:
   - **Intake questions** from the skill (Part 1, Step 0), with the usual answers pre-selected: cleanup, colour grade, captions, format, language, style, audio, B-roll, transitions & SFX.
   - **Optional details:** target length and the lower third (name, role).
   - **"What do you want in this video?"**, where you write anything else the way you would in chat. You can also paste a script for the captions.
2. **Up to the storyboard:** the AI editor saves the answers to `work/brief.md` and edits the way it does in chat: analyse, HDR check, raw cut if needed, transcript, graphics plan, `work/edit.json`, then the **storyboard sheets** in `out/`. For the 1st draft the storyboard is the approval step, so it doesn't stop for plan approval, and it doesn't render yet. If it needs something only you can answer, it asks in the AI editor chat and waits.
3. **Storyboard review:** when the sheets are ready, **Storyboard** unlocks and the review opens by itself, showing the storyboard frames start to end (one every 5 s, each with its time, read from `work/storyboard_frames/` and `work/storyboard.log`), then the other sheets (opening transition, finished frames) by name. When there are no single frames, the `storyboard_1`, `storyboard_2` … sheets are shown in number order instead.
   - **Frame viewer:** click any frame or sheet to open it large. **←/→** (or the side arrows) step to the previous or next frame. Zoom with **+/−**, the mouse wheel (at the pointer) or a double-click, and drag to move around. **0** fits it to the screen, and **Esc** closes only the viewer.

   The review has two buttons:
   - **Approve and edit the 1st draft**
   - **Request changes**: the AI editor makes the changes and remakes the storyboard for approval again.
     - **Save this for future videos too** (a checkbox in Request changes, off by default): the AI editor also writes the change into the editing skill (long-form-whiteboard-animation, or the skill it belongs to) as a general rule, not as this video's times or words. It fixes a rule it would contradict instead of adding a second one, rebuilds `Skills.docx`, and says in its reply exactly what it added and in which file. The same checkbox is there when you request changes to the 1st draft.
   - **Skills from the chat (Ask AI):** above the message box, **Update the skill** starts a message that changes the editing skill itself (for every future video), and **New skill** starts one that creates a new skill in `C:\Users\vinay\.claude\skills\<name>\SKILL.md`. The 📎 button attaches files (notes, a SKILL.md, a .docx or .zip, images): they are saved in the project's `work/attachments/` and named at the end of your message. For a new skill the AI editor writes the description, asks whether video editing should point to it, rebuilds `Skills.docx`, and replies with the file it changed or made.
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
The Silence remover opens over the editor, working directly on the video in the timeline. There is no project list and no "New project" step. It used to also be a separate **Silence remover** section in the sidebar; that section was removed, since the Video Editor has it here (an old `?section=silence` link opens the Video Editor).

- **Only what is on the timeline:** it checks just the footage the timeline uses, never the parts you already cut or deleted. The popup header says what it is working on.
  - **The timeline is one continuous piece of one file** (for example `raw/raw.mp4` 34:27.5–64:00.3): it opens on that file, limited to exactly that part. This is instant, with nothing copied. **Change part** is hidden because the timeline decides the part.
  - **The timeline has several cuts** (or several files): the bridge first joins the timeline's footage cuts into one video (`work/timeline-footage-<id>.mp4`, with a progress bar). The Silence remover works on that. The file is reused until the cuts change. It is a quick 720p working copy, only for finding pauses: **Apply** always trims your original files. When all the cuts come from one file in order (the usual case, even with hundreds of cuts after a pause removal), the file is read once from the first cut, which takes seconds to a few minutes. The sound is cut exactly, and the picture is kept within a frame of it.
  - **No edit yet:** it uses the video in the preview, else the first raw video, as before.
- **Smooth playback over removed parts:** the Silence remover's player is really two players of the same video taking turns. While one plays, the other already waits, paused, at the start of the next kept part. At the cut they swap instantly, so there is no pause. Before, each jump was a seek, and camera footage only has a keyframe every few seconds (about 3.8 s in the Idea Validation footage), so each jump froze for about half a second while the browser decoded up to the new spot. If the waiting player isn't ready, for example when you click into the middle of a part, it jumps the old way. The export still records with the single player, as before.
- **Playback speed:** **1x · 1.5x · 2x · 2.5x · 3x** next to **Keep**. The sound keeps its pitch. It only changes how you watch; the export is always at normal speed.
- **Its player shows the timeline's length, not the file's:** the Silence remover's video has its own controls (play/pause, time, scrub bar, mute, full screen). Before the check they cover only the part on the timeline. Once checked (with *Preview the edited version* on) they show the **edited length**, the part minus the pauses being removed, which is what the timeline becomes after **Apply to timeline**. It changes live as you change the settings or cut/keep parts, and the scrub bar skips the removed parts.
- **Find unwanted parts, faster in the Video Editor:**
  - **Sound:** it comes ready-made from ffmpeg on this PC (`/api/p/sound16k`), not decoded in the browser. For 2 minutes that's 1 s instead of 20 s.
  - **Speech model:** it starts loading as soon as the popup opens, so it's usually ready by the time you press the button.
  - **Words already heard are reused:** if any earlier session in this edit already listened to the same footage (for example, before an **Apply**), its words are put together for the new session and Whisper doesn't listen again. Only the repeats check runs (a few seconds).
  - **Listening runs on the graphics card (GTX 1650):** the bridge runs whisper.cpp's CUDA build (`D:\Editing\tools\whisper-cuda`, official release b5454, CUDA 12.4) with the editing pipeline's own model (`D:\Editing\models\ggml-large-v3-turbo-q5_0.bin`), in a single pass with flash attention. That's about 15 s per minute of speech, against 30–35 s for Whisper in the browser (which only gets the built-in AMD chip). The progress line says *Listening to the words (graphics card)*. The same part is never listened to twice while the bridge is running. If the graphics-card engine is missing or fails, it falls back to Whisper in the browser automatically.
  - Measured on 2 minutes of the Idea Validation footage: **34 s** in all (66–95 s before). For an 18-minute timeline, expect about 3–4 minutes the first time.
  - `D:\Editing\models\ggml-base.en.bin` was tried and is not used: it is fast but drops words and invents repeats.
- **Drag the ends of a removed part:** hover over either edge of a dark (removed) part on the waveform; it turns orange with a small grip. Drag it to make the removed part longer or shorter. While dragging, a label shows the new time and how much is added (+) or given back (−), and the change is shaded. Letting go saves it as one step, so **Undo** reverses it. Dragging into a neighbouring removed part joins them; a part can't be shrunk below 50 ms this way (use **Keep** to put it all back).
- **Remove all at once:** above the list of unwanted parts, **Remove all (N)** removes every highlighted part (fillers, repeats, fumbles) in one go, **Only fillers** removes just the fillers, and **Restore all (N)** puts every removed one back. The Silence remover's own Undo reverses them too.
- **Reopening shows the work done:** after **Apply to timeline**, opening **Remove pauses & fillers** again opens the same session, with every removed part, setting and choice as you left it. The header says *Your last result is on the timeline*. Change anything and press **Apply to timeline** again: it re-applies from the timeline as it was before the first Apply (kept in `work/editor/silence-basis.json`), so nothing is cut twice and graphics are not moved twice. If the timeline's cuts have changed since (other cuts, deletes, drops, or Undo), it starts on the timeline as it is now.
- **Apply to timeline** (header button): puts the result straight onto the timeline. Every footage cut is trimmed to the parts kept, frame-accurately, from the original files (nothing is re-encoded). With **Magnetic** on, graphics, captions and sounds after each removed pause move earlier with the speech. The popup closes, and the timeline and the timeline preview show the shorter edit at once, with **Undo** in the bar under the timeline header.
- **Straight to removing silences:** it opens on the whole video, with the silences already checked. **Change part** limits it to a section.
- **Continues where you left off:** there is one saved session per video, so closing and reopening the popup keeps your cuts and settings.
- **Video:** read from `D:\Editing` through the bridge, with a progress bar. It is not copied into the browser, so large files don't fill browser storage.
- **All the Silence remover's tools:** **Find unwanted parts**, settings, cut/keep, preview the edited version. Its buttons (Back to the editor, Change part, Restart, Settings, Save project, Export…) sit in the popup header.
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
| **V2 Graphics** | Whiteboard scenes, cards, list and stat cards, lower thirds, titles, slides, the opener, zooms, B-roll cutaways. Overlapping items stack in lanes |
| **V1 Footage** | The source cuts laid end to end, split screens |
| **CC Captions** | Caption cues, when the captions are part of the render |
| **A1 Audio** | The voice, music and SFX |

- **Track buttons:** 👁 shows or hides the track on the timeline, 🔒 locks it so its clips can't be selected or dropped on, and 🔊 on A1 mutes the player.
- **Ruler and playhead:** the red playhead and the player stay in sync both ways. Click anywhere on the ruler or tracks to jump there; move or play the player and the playhead follows. That works with:
  - **The rendered edit** (an exported final or preview in `out/`): its time is the timeline time, graphics included.
  - **A footage file the cuts use** (for example `raw/raw.mp4`, before anything is rendered): the player's time is mapped through the footage cuts (V1) to the timeline. Playing runs **cut to cut** like the finished edit, jumping over the cut-out parts and switching files where the cuts do, then stops at the end. This is the **Graphics off** way of playing the timeline.
  - **The live preview with graphics** (**Graphics on**, the default whenever the timeline comes from `work/edit.json`): the player plays the edit with its whiteboards, cards, captions, B-roll, SFX and music, drawn live from `work/edit.json` by the same Remotion code the final render uses, so nothing has to be rendered first. It updates after every change (a cut, Apply to timeline, the AI editor's changes). The bridge bundles `D:\Editing\editor-bridge\live\entry.tsx` with the esbuild in `remotion\node_modules` (rebuilt by itself when `remotion\src` changes) and serves it, with the files `edit.json` names, at `/api/live/<token>/` in a frame only the Studio pages may embed. Space, ←/→, clicking the timeline and the scrub bar all drive it. Switch **Graphics on / off** in the player header (remembered on this browser; the playhead stays where it is). With Graphics off, the volume meter follows the player; with it on, the meter stays still, because the sound plays inside the preview frame. On footage with keyframes far apart, a cut can take a moment to load the first time it plays.
  - **Anything else in the player** (an image, a doc, another video): clicking the timeline opens the rendered edit if it's up to date, otherwise the footage cut under the click, at the matching moment.
- **Zoom:** **−**, **Fit** and **+** in the timeline header.
- **Click a clip** (Select tool) to select it and jump to its start. A bar at the bottom shows its type, times and text, with **Delete** and **Ask AI to change this**. That opens the AI editor with the clip already described, for example *"About the whiteboard at 1:11.5–1:35.8 ("24-hour exercise / …"): "*; you type what to change.
- **Empty timeline:** before there is an edit, the timeline is a drop area. Drag a video onto it to start the edit with that footage, or use **Create 1st draft** and the AI editor builds it.

#### Timeline tools (header)
The tools are icons only. Hover one (or tab to it) to see its name and shortcut. The keyboard icon at the right lists every shortcut.

| Tool | Key | What it does |
|---|---|---|
| **Select** | **V** | The normal mode: click a clip to select it, click elsewhere to move the playhead. With a clip selected, **Delete** (button or key) removes it |
| ↳ **Drag to select** | | With Select, press on an empty spot of the timeline and drag a box. Every clip it touches is selected (on every track it crosses; hidden or locked tracks are left out). **Shift**+drag or **Shift**+click adds to or removes from the selection. Letting go doesn't move the playhead |
| ↳ **Select forward / backward** | **Shift+A** / **Shift+Ctrl+A** | Selects every clip from the playhead to the end / from the start up to the playhead, on all visible, unlocked tracks. A clip that only touches the playhead belongs to the other side |
| ↳ **Several selected** | **Delete** · **Esc** | The bar under the timeline says *N clips selected* with **Delete all**. Delete removes them all in one step (one Undo; with Magnetic on, everything after removed footage moves earlier). **Esc** clears the selection |
| **Cut** | **C** | Click a footage clip (V1) or a B-roll clip (V2) to cut it in two at that point, to the frame. A dashed line with the time ("Cut 0:04.9") follows the mouse. Nothing moves; select a piece afterwards and press **Delete** to remove it. Graphics, captions and sounds can't be cut here; ask the AI editor |
| **Magnetic** | | On (orange, the default): removing a footage piece pulls everything after it earlier, so graphics, captions and sounds stay with the speech, and anything that sat only on the removed piece goes with it. Inserting footage by drag-and-drop pushes everything after it later. Off: the footage still closes up, but graphics, captions and sounds keep their times. Remembered in this browser |
| **Marker** | **M** | Adds a numbered marker at the playhead, or removes the one there. Markers show on the ruler: click one to jump to it, right-click to remove it. **← / →** stop at markers too. Markers are saved with the project (`work/editor/state.json`) |
| **Playback speed** | — | The **1x** button beside the marker flag. Each click changes the speed: 1x → 1.5x → 2x → 2.5x → 3x, then back to 1x. It applies to the player and to the live preview with graphics, and it stays as the playback moves from one footage file to the next. Orange when it isn't 1x |

Every cut and delete is written into `work/edit.json` and can be undone with **Undo** in the bar under the header (the same history as drops). The player shows the change after **Export** or a new preview.

#### Drag files onto the timeline
Drag any video, image or audio card from **Media files** onto a track. While you drag, the row turns green and a green line with a label shows exactly where it will land ("Insert footage at 0:06.0", "B-roll at 0:42.0"). It turns red, with the reason, where it can't go.

| Drop | On | What happens |
|---|---|---|
| Video | **V1 Footage** | Inserted as a new footage cut at the **nearest cut point** (it snaps between cuts). Everything timed after that point (graphics, B-roll, captions, sounds) moves later by the clip's length, so it all stays in sync |
| Video or image | **V2** | A full-frame **B-roll cutaway** from the drop point: images for 4 s, videos for up to 8 s (never past the end), with a soft dissolve |
| Audio | **A1** | 15 s or shorter: a **sound effect** at the drop point. Longer: the **music bed** under the whole video (quiet, ducked under the voice) |

- **What it changes:** the drop is written straight into `work/edit.json`, the same file the AI editor and the renders use, so the timeline updates at once. The player keeps showing the last render until you **Export** or make a new preview.
- **Undo:** a green bar under the timeline header says what was added, with **Undo**. Every drop first saves the previous `edit.json` in `work/editor/history` (the last 30 are kept).
- **Not allowed:** dropping while the AI editor or an export is working on this video, on a locked track, on the captions track, or onto a promo-layout video (`work/promo.json`). For those, ask the AI editor.

#### Shortcuts
Hover the keyboard icon in the timeline header to see them.

| Shortcut | What it does |
|---|---|
| **V / C** | Select tool / Cut tool |
| **Ctrl+A** | Select every clip on the timeline (visible, unlocked tracks). Inside a text box it selects the text as usual |
| **Shift+A** / **Shift+Ctrl+A** | Select all clips forward / backward from the playhead. In Chrome, Ctrl+Shift+A also opens Chrome's own tab search; the page asks Chrome not to, but if Chrome still takes it, use drag-select instead |
| **Esc** | Clear the selection |
| **M** | Add or remove a marker at the playhead |
| **Delete** / **Backspace** | Remove the selected clip or clips |
| **Space** | Play / pause the player |
| **← / →** | Jump to the previous / next cut or marker: any clip start or end on V2, V1 and A1 (captions are skipped, and hidden tracks are ignored). The timeline scrolls to keep the playhead in view |
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

1. **Create a project** with **Create new project** (pick its folder), and add the raw footage under **Media files → Footage**.
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
| New files don't appear | Switch to another tab or window and back (the lists reload when the page comes back into view), or reload the page |
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
| `POST /open-folder` `{path?, title?}` | Show the Windows folder window (or use a typed path) and open that folder as a project |
| `POST /projects/remove` `{id}` | Take a project added from another folder off the list (removes only its link) |
| `POST /p/timeline-add?id=` `{path, track: V1\|V2\|A1, at, magnetic}` · `POST /p/timeline-undo?id=` | Add a dropped file to `work/edit.json` (backup first), and undo the last change |
| `POST /p/timeline-edit?id=` `{op: split\|delete, key, index, at?, magnetic?}` · `{op: delete-many, items: [{key, index}], magnetic}` | Cut a footage or B-roll clip in two, remove a clip, or remove several in one step (ripple when magnetic) |
| `POST /p/timeline-keep?id=` `{keeps: [[start, end], …], magnetic}` | The Silence remover's result: trim the footage cuts to the parts kept (timeline seconds) |
| `POST /p/timeline-footage?id=` · `GET` | Join the timeline's footage cuts into one video for the Silence remover, and poll it |
| `GET /p/sound16k?id=&path=&start=&end=` | A file's sound (or part of it) as 16 kHz mono floats, for Whisper |
| `POST /p/transcribe?id=` `{path, start?, end?}` · `GET /p/transcribe?id=&key=` | Words with times from Whisper on the graphics card, and poll the job (`/health` says `gpuWhisper: true` when installed) |
| `GET /p/export?id=` · `POST /p/export?id=` `{mode: preview\|final\|cancel}` | Export status (existing files, running job), start an export, cancel it |
| `GET /p/file?id=&path=` | Serve a file from `raw/`, `work/` or `out/` (supports seeking) |
