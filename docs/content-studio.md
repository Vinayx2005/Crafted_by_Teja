# Content Studio: how it works

A private tool for teams that make short-form video (YouTube Shorts and Instagram Reels). It researches what to make, finds the sources, studies what competitors do, and writes the script. It learns from the team's feedback.

This document explains the product, the architecture, the backend, the data model, the AI layer, every configuration setting, and how to run and deploy it. It is written so that someone new can understand and operate the app without asking the author.

**Status when this was written (November 2026):** the studio is fully built and has been tested locally with real data. It lives in the repository but was **not yet committed or deployed** to the live site. Section 13 lists exactly what is needed to deploy it. Instagram competitor analysis is manual (paste-in); the official Instagram connection is partly set up but not wired in (section 15).

---

## Contents

1. [What it does](#1-what-it-does)
2. [How a person uses it](#2-how-a-person-uses-it)
3. [Architecture at a glance](#3-architecture-at-a-glance)
4. [Technology stack and code layout](#4-technology-stack-and-code-layout)
5. [Data model (Supabase)](#5-data-model-supabase)
6. [Authentication and access control](#6-authentication-and-access-control)
7. [The backend API](#7-the-backend-api)
8. [The AI layer](#8-the-ai-layer)
9. [External data sources](#9-external-data-sources)
10. [The competitor pipeline, step by step](#10-the-competitor-pipeline-step-by-step)
11. [The daily automatic refresh](#11-the-daily-automatic-refresh)
12. [Configuration reference](#12-configuration-reference)
13. [Setup from scratch and deployment](#13-setup-from-scratch-and-deployment)
14. [Quotas, costs and limits](#14-quotas-costs-and-limits)
15. [Instagram: current state](#15-instagram-current-state)
16. [Security notes](#16-security-notes)
17. [Known limitations](#17-known-limitations)
18. [Troubleshooting](#18-troubleshooting)
19. [Glossary](#19-glossary)

---

## 1. What it does

The studio has three jobs, shown as three tabs inside each "page" (a page is one social account or brand being worked on):

| Tab | Purpose |
|---|---|
| **Work** | A four-step guided flow: find trending topics, pick sources, generate a script, give feedback and improve it. |
| **Competition** | Find creators, add them to a list, and have the system study their most viral Shorts: hooks, structure, CTAs, topics. |
| **Learnings** | The team's own instructions for the page (audience, voice, languages) and a combined "playbook" of what works across all competitors. |

The idea that ties them together: **competitor research and the team's own feedback both flow back into every script the system writes.**

- Competitors' most viral Shorts are analysed and combined into a **playbook** of hook patterns, body structure, conclusion and CTA rules.
- The team's own **direction** (audience, voice, rules) is binding and wins over the playbook.
- Every thumbs up, note and star rating on a script is saved and fed into later scripts. This is the **learning loop**.

---

## 2. How a person uses it

### 2.1 Signing in and teams

- Sign in at `/studio` with an email and password (Supabase Auth). "Create account" makes a new login.
- The studio is organised in **organisations**. You belong to an organisation through a **role**: Owner, Admin, Editor or Viewer (section 6).
- An Owner or Admin adds a teammate in the **Team** box on the home page: enter the email and a role, then send the **invite link** it shows (once, valid 7 days, only usable by that email). The teammate opens the link, signs in (or uses "Create account" with that email) and joins.
- You only ever see the pages (brands) of your own organisations.

### 2.1a Navigation

The studio is its own light-themed app with a left sidebar (a slide-out menu on tablets and phones) and a top bar showing the organisation, a **brand selector** and your profile menu (with **Sign out**). The sidebar sections map to the screens below:

| Sidebar | What it opens |
|---|---|
| Home | Your brands and the Team box (section 2.2) |
| Create | The platform-to-script flow (2.3) with the collapsible **AI writing insights** |
| Library | Every script the brand has written; opening one continues it in Create |
| Knowledge | Documents and notes the writer may rely on (2.3a) |
| Research | **Competitors** (2.4) and **What works** (the combined playbook, 2.5) |
| Brand Settings | Brand profile, **Your direction** (2.5) and Archive |

The sections below still use the older names "Work", "Competition" and "Learnings" for the same features.

### 2.2 Pages (brands)

The home screen lists pages. A page holds: name, niche (a few words, such as "Personal finance"), audience, voice and style notes, and the languages it posts in (English, Telugu, Hindi). Page name and niche are edited from the page's **Settings** button. Audience, voice and languages are edited in the **Learnings** tab.

### 2.3 Create: from topic to script

1. **Platforms.** Pick what to make: **YouTube long format** (a 3 to 10 minute video script), **Shorts / Reels** (a vertical video under 90 seconds), **Reddit** (picking it asks whether this is a **new post**, a title and the post text of 150 to 400 words, or a **reply to a comment**, 50 to 200 words; both are written like a community member and never promotional) or **WhatsApp group** (a short 40 to 120 word message). Pick several to get a version of each. The hook, body, conclusion and CTA are stored the same way for every format: for Reddit the hook is the title and the CTA is a discussion question; for WhatsApp the hook is the opening line.
2. **Topic.** Type a topic, or paste a description, an article or notes (up to 3,000 characters). Optionally **share your opinion** on the topic (your view, experience or stance): the script is written from that point of view, as an opinion and never as a sourced fact. Choose the language, and the length for each video format picked (Shorts / Reels 30 to 90 seconds; YouTube 3, 5, 8 or 10 minutes). Reddit posts and replies and WhatsApp messages have no length setting. For a Reddit reply you paste the comment being answered (up to 3,000 characters); the reply answers that comment, and the comment is treated as someone else's text, never as instructions. If you add nothing else, the topic is the comment itself. Press **Write script**. "Let the AI pick a trending topic" is there for when there is no topic: it works from what is trending for the brand.
3. **Script and feedback.** There is no idea to choose: one request does it all. The server turns the topic into search keywords, searches news, YouTube, Wikipedia and Hacker News (and checks your competitors' recent uploads), keeps only results that share the topic's own keywords, and asks Gemini for 3 to 5 candidate ideas that cite those sources (every cited id is checked on the server, and an idea with no verified source is dropped). A second, short AI step then **picks the strongest idea or combines the best of several** into one plan, guided by your words, your opinion and the brand's voice, and one script per platform is written from that single plan with the plan's sources plus a few more relevant ones, and your Knowledge. If no idea can be backed by a source, the script is still written from your topic, opinion and Knowledge, keeps to general points, and a note says to check the facts before posting. The script is shown as **one consolidated piece**, one spoken line per line, with no section labels (the stored script still has hook, body, conclusion and CTA, which the learning loop uses). Below it, a separate **feedback box**: Good or Needs work, a 1 to 5 star rating and a free-text note. **Improve with my feedback** writes a new version (v2, v3, ...) for that platform; **Save feedback only** stores it. Feedback is whole-script feedback and goes into every later prompt exactly as before. Scripts do not store their platform yet, so a script reopened from the Library shows without a platform tab.

### 2.3a Knowledge

Material about the brand that the writer can use as fact: product details, past articles, FAQs, policies, research. In **Knowledge** you can **upload documents** (PDF, Word `.docx`, `.txt`, `.md`, `.csv`, up to 2.5 MB each, several at once, drag and drop works) or **add text** by typing or pasting, and later **edit** or **delete** any of them. Up to 50 per brand, each up to 60,000 characters.

- **Only text is stored.** Word and text files are read in the browser. A PDF is read by Gemini **10 pages at a time** (a whole book cannot be retyped in one request), with progress shown, and the file is thrown away. A section that times out is split in half and retried; any other hiccup gets one retry. A 137-page book takes about four to five minutes. Scanned PDFs work too, since Gemini reads the page images. Because one resource holds at most 60,000 characters, a long book is saved as several parts, "Title (part 1 of 4)" and so on. Uploading a file with a name you already added asks first, so you do not end up with duplicates (which would put every passage in the writer's prompt twice).
- **How the writer uses it.** For every script and rewrite the server cuts the brand's knowledge into passages, scores them against the topic's keywords (everyday words ignored), and puts the best ones, up to about 10,000 characters, into the prompt as brand knowledge. The writer may state these as fact. With no keyword match, the start of each document is used so basic brand facts still get through. It is reference material only: instructions hidden inside a document are ignored.
- **Who can do what.** Viewers can read the list; Editors and above add, edit and delete.
- **One-time setup.** The table is created by `migrations/studio_knowledge.sql` (check with `studio_knowledge_validate.sql`, undo with `studio_knowledge_rollback.sql`). It is server only: the browser cannot read it directly. Until it is run, the screen says so and script writing carries on without knowledge.

### 2.4 Competition tab

- **Find creators:** type a topic or a creator's name, or paste a YouTube channel link or `@handle`. Results show subscribers and video count. **Add to competition** puts the creator on the list.
- **Add an Instagram creator:** add by username. Instagram has no free official way to read other people's reels, so for these creators you paste each reel's caption and what is said (**Add a reel**), and the system analyses it the same way.
- **Analyse / Analyse all:** studies the creators (details in section 10). "Analyse all" processes every YouTube creator one after another and then rebuilds the Learnings playbook.
- Each creator card expands to show stats, **popular hooks**, topics, how their videos are built, CTA and caption style, what works and what to avoid, and the list of top Shorts that were analysed.

### 2.5 Learnings tab

- **Your direction:** who watches the page, voice, style and the team's own rules (for example "always end with a question", "never start with a greeting"), and the languages. These are **binding**: every script, rewrite and topic idea follows them, and they win over the competitor playbook. The languages chosen decide which script languages the Work tab offers.
- **What works across your competitors:** the combined playbook (content types that win, hook rules and reusable hook templates, body structure, conclusion rules, CTA rules, style, things to avoid), based on the most viral Shorts of all competitors. **Update learnings** rebuilds it.

---

## 3. Architecture at a glance

```
 Browser (Next.js client components)
   |  1. Sign-in, simple reads/writes (pages, team, feedback, competitors, scripts list)
   |     talks straight to Supabase with the user's login; Row Level Security is the lock
   |  2. Anything needing a secret key (AI, YouTube, research) calls
   v     POST /api/studio  {action: ...}   with the user's session token
 Next.js route handler  (apps/tools/src/app/api/studio/route.ts)
   |  verifies the token with Supabase, checks the email is on the team list
   |  then runs the action:
   +--> Supabase (service role key, server only): reads/writes studio_* tables, studio_cache
   +--> Gemini API:  text generation, JSON output, watching YouTube videos by URL
   +--> YouTube Data API v3:  channel search, uploads, view counts
   +--> Free public feeds:  Google Trends RSS, Google News RSS, Google search
   |                         suggestions, Hacker News (Algolia), Wikipedia
   v
 JSON response to the browser

 GitHub Actions (daily, 04:00 IST)
   scripts/studio-refresh.mjs  -->  POST /api/studio  (authenticated with a shared secret)
   refreshes every YouTube competitor and rebuilds each page's playbook
```

Design choices worth knowing:

- **Two ways in.** Simple data (pages, team, feedback, ratings, competitor list) is read and written by the browser directly through Supabase, protected by Row Level Security. Anything that needs a secret (AI, YouTube) goes through one server endpoint.
- **One API endpoint, many actions.** `POST /api/studio` with an `action` field, instead of many routes. This keeps authentication and error handling in one place.
- **Long jobs are split into short calls.** The site's function time limit is 60 seconds, so competitor analysis is broken into small calls that the browser (or the daily job) repeats until done.
- **Free-tier friendly.** Results are cached, repeat runs only do new work, and cheaper models are used for bulk work.

---

## 4. Technology stack and code layout

| Layer | Technology |
|---|---|
| Framework | Next.js 14 (App Router), React 18, TypeScript (strict) |
| Styling | Tailwind CSS, `lucide-react` icons. Dark theme, shared with the rest of the Tools app |
| Database and auth | Supabase (Postgres, PostgREST, Supabase Auth), client library `@supabase/supabase-js` |
| AI | Google Gemini API (REST, no SDK) |
| Video data | YouTube Data API v3 (REST, no SDK) |
| Hosting | Vercel (the Tools app, served at `tools.craftedbyteja.com`) |
| Scheduling | GitHub Actions |
| Repo layout | npm workspaces monorepo; the studio is part of `apps/tools` |

There are no extra runtime dependencies beyond `@supabase/supabase-js`. Gemini, YouTube and all feeds are called with plain `fetch`.

### Files

```
apps/tools/
  src/
    app/
      studio/                     (the browser screens; everything here is gated by login)
        layout.tsx                noindex metadata, wraps everything in the login gate
        shell.tsx                 login screen, team check, header, sign-out
        page.tsx                  home: page list, create page, Team box
        page-form.tsx             create/edit form for a page
        ui.tsx                    shared styles, small components, formatters
        [id]/page.tsx             a page's screen: tabs Work / Competition / Learnings, Settings
        [id]/work.tsx             the four-step Work flow and script history
        [id]/competition.tsx      search, competitor list, analysis progress, Analyse all
        [id]/learnings.tsx        Your direction + the combined playbook
      api/studio/route.ts         the single backend endpoint (all actions)
    lib/studio/
      server.ts                   auth check, Gemini client, cache, database helpers
      sources.ts                  feeds and the YouTube API
      prompts.ts                  every AI prompt, in one place
      shared.ts                   types and constants used by browser and server
      client.ts                   browser Supabase client and the api() helper
    lib/wa.mjs                    a tiny service-role PostgREST client (shared with another tool)
  scripts/studio-refresh.mjs      the daily refresh job
.github/workflows/studio-refresh.yml
migrations/studio.sql             the database schema
```

---

## 5. Data model (Supabase)

All tables are in the `public` schema and are created by `migrations/studio.sql` (safe to re-run).

| Table | Purpose | Key columns |
|---|---|---|
| `studio_organisations` | A team or company | `name`, `slug` |
| `studio_org_members` | Who belongs to which organisation, with their role | `organisation_id`, `user_id`, `role` (`owner`, `admin`, `editor`, `viewer`) |
| `studio_org_invites` | Pending invitations (server only) | `email`, `role`, `token_hash` (the token itself is never stored), `expires_at`, `accepted_at` |
| `studio_brands` | A social account or brand (the "page"). Replaces `studio_pages`; the ids are the same | `organisation_id`, `name`, `niche`, `description`, `audience`, `voice`, `languages`, `writing_rules`, `prohibited_terms`, `supported_platforms`, `logo_url`, `archived_at` |
| `studio_content`, `studio_content_versions`, `studio_content_feedback` | The general content store for the coming universal engine (Phase 3). Existing scripts were copied in; the classic screens still use `studio_scripts` for now | content with immutable versions and feedback |
| `studio_ai_usage` | One row per AI call, for limits (server only) | `organisation_id`, `user_id`, `action` |
| `studio_knowledge` | Knowledge (text of uploaded documents and notes). Server only | `brand_id`, `title`, `kind` (`text` or `file`), `file_name`, `content` |
| `studio_pages`, `studio_members` | **Legacy.** Kept unchanged for rollback only. Nothing reads them any more | |
| `studio_competitors` | A creator being studied | `page_id`, `platform` (`youtube` or `instagram`), `ext_id` (channel id or username), `name`, `followers`, `summary jsonb` (the per-creator playbook), `analyzed_at`. Unique per page/platform/`ext_id` |
| `studio_videos` | Videos of a competitor | `competitor_id`, `ext_id`, `title`, `caption`, `published_at`, `views`, `likes`, `comments`, `duration_s`, `is_short`, `transcript`, `hook`, `structure jsonb`, `analyzed_at`. Unique per competitor/`ext_id` |
| `studio_scripts` | Generated scripts and their versions | `page_id`, `root_id` (first version's id, links all revisions), `version`, `topic`, `language`, `length_s`, `sources jsonb`, `hook`, `body`, `conclusion`, `cta`, `rating` (1 to 5) |
| `studio_feedback` | The learning loop's raw material | `script_id`, `page_id`, `section` (`overall`, `hook`, `body`, `conclusion`, `cta`), `sentiment` (`up` or `down`), `note` |
| `studio_cache` | Short-lived and derived results | `key` (primary key), `data jsonb`, `at`. **Server only** |

Competitors, scripts and feedback link to a brand (`page_id` points at `studio_brands`). Deleting a brand deletes its competitors, videos, scripts and feedback (`on delete cascade`), but the app never deletes brands: **Archive** hides a brand and makes it read-only, and an Admin can restore it.

### JSON shapes stored in the database

- `studio_competitors.summary`: `{ about, stats{...}, topics[], hook_patterns[], script_structure, cta_style, caption_style, recent_trends[], what_works[], what_to_avoid[], note? }`. `stats` carries the analysis window, number of Shorts in it, how many passed the view threshold, and average, median, best views.
- `studio_videos.structure`: `{ hook_type, beats[], cta, topic, style_notes, language }` (or `{ error }` if a video could not be read).
- `studio_scripts.sources`: the list of sources the script was allowed to use.

### What lives in `studio_cache`

| Key | Contents | Lifetime |
|---|---|---|
| `trends3:<pageId>:<hash>` | The latest trending-topic ideas. The hash covers niche, audience, voice, languages and the competitor list, so changing any of them refreshes the ideas | 6 hours (the Refresh button bypasses it) |
| `sources3:<langs>:<hash>` | Extra reading for a search query | 6 hours |
| `playbook:<pageId>` | The combined competitor playbook for a page | Kept until rebuilt |

### Access control in the database

Every table has Row Level Security. Access depends on the caller's role in the organisation that owns the brand (helper functions `studio_has_role`, `studio_brand_can`):

| Table | Read | Add | Change | Delete |
|---|---|---|---|---|
| Brands | Viewer | Admin | Admin | never (archive instead) |
| Competitors | Viewer | Editor | server only | Admin |
| Videos | Viewer | server only | server only | server only |
| Scripts | Viewer | server only | Editor, star rating only | never |
| Feedback | Viewer | Editor | never | never |
| Members, organisations | Viewer | server only | server only | server only |
| Invites, AI usage | server only | | | |

Writes to a brand that is archived are refused. The public (`anon`) key has no access to any studio table. `studio_cache` has no client access either. The server uses the service role key and therefore applies the same rules itself (section 6).

---

## 6. Authentication and access control

There are four layers:

1. **Login (Supabase Auth).** The browser holds the session. `shell.tsx` shows the login form without a session, a "not part of any organisation" message with no membership, and the app otherwise. An invite link (`/studio?invite=...`) is accepted here once the person is signed in.
2. **Database lock (Row Level Security).** The table above. This is the boundary for what the browser reads and writes directly.
3. **Server permission check on every API action.** `lib/studio/access.ts` (`authorise`) decides. The browser's claims are never trusted: the server looks up which organisation owns the brand, competitor, script or content named in the request, checks the caller's role there, and refuses a request whose ids do not belong together (for example a script of another brand). A missing id and an id of someone else's organisation give the **same** 404, so ids cannot be probed. A role that is too low gets 403, and writing to an archived brand gets 409.
4. **Usage limits and hardening.** AI calls are counted per organisation (default 300 a day) and per person (default 20 a minute); the daily job is counted but never blocked. Text from the web is fenced as untrusted data inside prompts, links are screened (`http` and `https` only), unexpected server errors show a short reference instead of details, and `/studio` and `/api/studio` send security headers (the content-security policy is report-only for now).

### Roles

| Role | Can |
|---|---|
| Viewer | Read everything in the organisation |
| Editor | Plus: research, write and revise scripts, rate, give feedback, add competitors and run their analysis |
| Admin | Plus: create, edit and archive brands, manage members and invitations (not Owners), see usage |
| Owner | Plus: make or remove other Owners. The last Owner can never be removed or demoted |

Nobody can promote themselves. Invitations can never create an Owner. New organisations are created only by a platform admin (emails in `STUDIO_PLATFORM_ADMINS`).

**The daily job has no login.** It authenticates with a shared secret, `STUDIO_CRON_SECRET`, sent as the bearer token. The server accepts it only when the variable is set and at least 16 characters long, and compares it with a constant-time check. The secret is limited to four actions (`fetchVideos`, `deepVideos`, `summarise`, `consolidate`); everything else returns 403. Still treat it like a password.

Anyone can create a Supabase account (sign-up is open), but without membership of an organisation they cannot see or change anything.

---

## 7. The backend API

One endpoint: `POST /api/studio`, JSON body `{ "action": "<name>", ... }`. Every request needs the bearer token (a user session or the cron secret). Errors return `{ "error": "<message>" }` with a status code (401 sign in, 403 role too low, 404 not found or not yours, 409 brand archived, 429 limit reached, 400 bad input, 501 missing key, 502 upstream failure). The route has `maxDuration = 60` seconds.

| Action | Input | What it does | External calls |
|---|---|---|---|
| `trends` | `pageId`, `fresh?` | Collects signals and returns up to 8 ideas, each with verified sources. Cached 6 h | Google Trends, Google Suggest, Google News, YouTube (niche videos + competitor uploads), **1 Gemini call** |
| `ideas` | `pageId`, `brief`, `platforms[]`, `language`, `opinion?`, `trending?` | Finds verified sources and candidate ideas for what the person typed (or, with `trending`, what is trending for the brand), then has the AI **choose or combine them into one `plan`** (title, angle, opening line, sources). Also returns the candidate `topics`, the `query` used, a `reason` when nothing could be built, and `thin: true` when the plan has no source behind it | Google News, YouTube, Hacker News, Wikipedia, competitor uploads, **1 to 2 Gemini calls** (one extra, on the lite model, only to boil a long description down to keywords) |
| `knowledge.list`, `.get` | `pageId` (and `id`) | Lists a brand's knowledge resources (preview only), or one in full. Viewer | none |
| `knowledge.add`, `.update`, `.delete` | `pageId`, `title`, `content`, `fileName?` / `id` | Adds text (or a text file already read in the browser), edits, deletes. Editor | none |
| `knowledge.readPdf` | `pageId`, `fileName`, `data` (base64 PDF), `from`, `to` | Has Gemini read pages `from` to `to` (at most 25) and returns their text and the document's page count. Stores nothing; the browser then saves the text with `knowledge.add`. Editor | 1 Gemini call (lite) per section |
| `sources` | `topic`, `query?`, `language`, `fresh?` | Finds extra reading for a topic by keyword, filtered for relevance. Cached 6 h | Google News, YouTube search, Hacker News, Wikipedia |
| `script` | new: `pageId, topic, language, lengthS, sources, instruction, platform?, opinion?, replyTo?` (one of the four formats, or `Reddit reply`). Revise: `pageId, reviseOf, feedback, instruction, platform?, opinion?, replyTo?` | Writes a script, or a new version using feedback. Saves it as a row | **1 Gemini call** |
| `search` | `term` | Finds YouTube channels by topic, name, link or `@handle` | YouTube `search.list` + `channels.list` |
| `fetchVideos` | `competitorId` | Reads the creator's recent uploads (30 days, or up to 365 if nothing viral) and upserts them | YouTube `playlistItems` + `videos` |
| `deepVideos` | `competitorId` | Has Gemini watch up to 3 not-yet-watched viral Shorts per call and stores transcript, hook, structure, CTA | Gemini (lite model) with the YouTube URL, 1 call per video |
| `summarise` | `competitorId` | Builds the creator's playbook from their viral Shorts. If none qualify it stores a plain explanation and spends nothing | **1 Gemini call** (none if no viral Shorts) |
| `addReel` | `competitorId, url?, caption, transcript, views?, likes?` | Analyses a pasted Instagram reel | Gemini (lite), 1 call |
| `playbook` | `pageId` | Returns the saved combined playbook and when it was built | none |
| `consolidate` | `pageId` | Rebuilds the combined playbook from every competitor's watched viral Shorts | **1 Gemini call** |

Actions above need a role: Viewer for `playbook`; Editor for the rest (`fetchVideos`, `deepVideos`, `summarise` and `consolidate` may also be called by the daily job). `sources` and `search` use the named page, or your single organisation.

Organisation and brand actions (all need a signed-in user):

| Action | Role | What it does |
|---|---|---|
| `org.list` | any member | Your organisations and roles; whether you may create one |
| `org.create` / `org.update` | platform admin / Admin | Create or rename an organisation |
| `member.list` | Viewer | People (and, for Admins, pending invitations) |
| `member.invite` | Admin | Returns an invite link token, shown once |
| `invite.revoke` | Admin | Cancels a pending invitation |
| `invite.accept` | the invited person | Joins using the token; the signed-in email must match |
| `member.setRole` / `member.remove` | Admin (Owners: Owner) | Change a role or remove someone (or leave yourself) |
| `brand.list` / `brand.create` / `brand.update` / `brand.archive` | Viewer / Admin / Admin / Admin | Brand profile and archive |
| `usage.get` | Admin | AI calls in the last 24 hours and the limits |

What the browser reads directly with Supabase (no API call): brands, competitors (add; Admins delete), videos, scripts, feedback rows, and star ratings. Everything else goes through the API.

---

## 8. The AI layer

### 8.1 Models and client

`lib/studio/server.ts` calls the Gemini REST API with `fetch`. Two models are used:

| Setting | Default | Used for |
|---|---|---|
| `STUDIO_MODEL` | `gemini-flash-latest` | Quality work: trend ideas, scripts, summaries, the playbook |
| `STUDIO_LITE_MODEL` | `gemini-flash-lite-latest` | Bulk work, which has its own free quota: watching videos, reading pasted reels |

Behaviour: JSON mode (`responseMimeType: application/json`) when structured output is needed; a 45-second timeout per call; on 429, 500 or 503 it waits (4 s, then 12 s) and retries twice; a 429 that persists becomes a friendly "free limit used up" message; reasoning ("thought") text is discarded; the model's JSON is parsed leniently (code fences and stray text tolerated).

**Watching videos.** For competitor analysis Gemini is given the public YouTube URL directly (`file_data.file_uri`) and returns the spoken transcript, hook, hook type, beats, CTA, topic and style. This avoids unofficial transcript scrapers, which YouTube blocks from servers.

### 8.2 The prompts (all in `lib/studio/prompts.ts`)

| Prompt | Job |
|---|---|
| `trendsPrompt` | Turns the day's signals into up to 8 ideas. Every idea must cite source ids (`n#` news, `y#` YouTube, `c#` competitor upload). Search demand is context only, never a source |
| `scriptPrompt` | Writes Hook, Body, Conclusion, CTA in the chosen language and length, using only the ticked sources |
| `revisePrompt` | Rewrites a script from per-section feedback while keeping what was liked and the body's line-by-line format |
| `watchPrompt` / `readReelPrompt` | Analyse one video (watched) or one pasted reel (text) into transcript, hook, beats, CTA, topic, style |
| `summarisePrompt` | Builds one creator's playbook. YouTube mode studies the viral Shorts of the window. Instagram mode uses pasted reels |
| `playbookPrompt` | Combines all creators' viral Shorts into one page-level playbook, judging each video against that creator's own median views |

### 8.3 What goes into a script prompt (priority order)

1. **The page's details and the team's direction** (niche, audience, voice and rules, languages). Marked **binding**: where they disagree with the playbook, the team's words win.
2. The topic, language style rules and length (about 2.5 spoken words per second).
3. The **sources** (the only facts the writer may rely on).
4. The **competitor playbook** (or, until one exists, short per-creator summaries).
5. The **learning-loop block** (next section).
6. Fixed rules: hook must stop the scroll, body is one idea per line, one clear CTA, no invented numbers or names, written for the ear (no hashtags, emojis or stage directions).

### 8.4 The learning loop

Feedback rows and star ratings are stored per page. On every script, rewrite and topic request the server builds a block from:

- the **last 30 feedback notes** (with liked or disliked markers),
- the **3 most recent scripts rated 4 or 5 stars** (to imitate their style),
- the **3 most recent scripts rated 1 or 2 stars** (to avoid).

No model is trained or fine-tuned. The learning is the feedback being re-sent as context each time. The ceiling is the prompt size (it uses the latest items only).

### 8.5 Guarding against invented information

- **Sources are looked up, not generated.** For trend ideas the model only returns source *ids*; the server maps them to real items. An idea with no resolvable source is dropped. A source that does not exist can never reach the screen.
- **Extra sources are relevance-filtered.** Search engines match loosely, so a source is kept only if its title or text shares at least a third of the topic's keywords.
- **The script writer is told to use only facts from the sources** and to keep claims general (and say what to double-check) when sources are thin.

---

## 9. External data sources

| Source | Used for | Notes |
|---|---|---|
| Google Trends daily RSS (India) | "What India is searching now" | Context only, never counted as a source |
| Google search suggestions | What people search about the niche | Short niche phrase, with a fallback to the first two words |
| Google News RSS | Niche news this week; extra reading per topic | Headlines and publisher only, no article text |
| YouTube Data API v3 | Channel search, competitor uploads, view counts, niche top videos | Needs `YOUTUBE_API_KEY`. See quota in section 14 |
| Hacker News (Algolia) | Extra reading (stories with 20+ points) | Mostly tech topics |
| Wikipedia | Background summary for a topic | English only |
| Gemini video understanding | Transcript and hook of a public YouTube video | Public videos only |

All sources are official APIs or public feeds. Nothing in the studio scrapes Instagram, WhatsApp or any site that forbids it.

---

## 10. The competitor pipeline, step by step

Run by the **Analyse** button for one creator, **Analyse all** for every creator, or the daily job. A YouTube Short here means a video of **180 seconds or less**.

1. **`fetchVideos`.** Reads the creator's uploads playlist (the channel id with `UC` swapped for `UU`), newest first, back **30 days**, up to 150 videos (stats included). Stores them (upsert). If **no Short in that window reached 10,000 views**, it reads further back (up to 365 days, 300 videos) so the wider windows have data.
2. **Pick the viral set (`viralOf`).** Shorts past **10,000 views**, posted in the last **30 days**, best 10 by views. If there are none, the window **widens to 90 days, then 365**. The card says which window was used.
3. **`deepVideos`.** Gemini (lite model) watches each Short in the viral set that has not been watched yet, **3 per call** (to stay inside the time limit). The browser or job repeats the call until none remain. A video that cannot be read is marked so it is not retried forever. A daily limit (429) stops the loop without marking videos as failed.
4. **`summarise`.** One Gemini call over the watched Shorts produces the creator's playbook (hook patterns, structure, CTA, topics, what works and what to avoid) and stores it with statistics for the window. If nothing is viral, it stores a plain-language note instead ("no Shorts reached 10,000 views", "only long videos", and so on) and makes no AI call.
5. **`consolidate`.** Combines every creator's watched viral Shorts into the page's **combined playbook**, stored in `studio_cache` under `playbook:<pageId>`. Each video is measured against **its own creator's median views**, which is a fairer signal across big and small channels.

The tuning numbers live in one line, `VIRAL` in `lib/studio/shared.ts`:

```ts
export const VIRAL = { days: 30, minViews: 10_000, top: 10, maxShortS: 180, widenTo: [90, 365] };
```

Set `widenTo: []` to keep the rule strictly to the last 30 days.

**Instagram creators** follow the same logic but on pasted reels: each pasted reel is analysed on its own, and "Learn from these reels" builds the summary. They are included in the combined playbook.

---

## 11. The daily automatic refresh

- **What:** `apps/tools/scripts/studio-refresh.mjs`, run by `.github/workflows/studio-refresh.yml`.
- **When:** every day at 22:30 UTC (04:00 IST), or on demand from the GitHub Actions tab ("Run workflow").
- **How:** it reads the competitor list straight from Supabase (service role key), then calls the live site's `/api/studio` with `STUDIO_CRON_SECRET`:
  - For each YouTube creator, least recently analysed first: `fetchVideos`, then `deepVideos` (up to 4 repeats), then `summarise`.
  - Only **new** viral Shorts are watched, so a daily run usually costs 0 to 3 Gemini calls per creator, not a full re-analysis.
  - If the free limit is hit, it stops and tomorrow's run starts with the creators it skipped.
  - Finally it calls `consolidate` once per page to rebuild each combined playbook.
- **Result:** the job fails (red) only if every creator failed; partial success counts as success.
- **Not covered:** Instagram creators (their data is pasted by hand).
- **Local test:** set `STUDIO_SITE_URL=http://localhost:3002` and run `node apps/tools/scripts/studio-refresh.mjs` with the Supabase and cron secret variables loaded.

---

## 12. Configuration reference

### 12.1 Environment variables

| Variable | Where it is used | Required | Purpose |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Browser, server, daily job | Yes | Supabase project URL. Public by design |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser, server (token check) | Yes | Supabase anon (public) key |
| `SUPABASE_SERVICE_ROLE_KEY` | Server, daily job | Yes | Full database access. **Secret, server only, never in the browser** |
| `GEMINI_API_KEY` | Server | Yes | Google AI Studio key for Gemini |
| `YOUTUBE_API_KEY` | Server | Yes for competitors and trends | Google Cloud API key with **YouTube Data API v3** enabled. A Gemini key cannot be reused for this |
| `STUDIO_CRON_SECRET` | Server and GitHub | For the daily job | Long random string (16+ characters), identical on the site and in GitHub |
| `STUDIO_MODEL` | Server | No | Overrides the quality model (default `gemini-flash-latest`) |
| `STUDIO_LITE_MODEL` | Server | No | Overrides the bulk model (default `gemini-flash-lite-latest`) |
| `STUDIO_PLATFORM_ADMINS` | Server | No | Comma-separated emails allowed to create organisations |
| `STUDIO_ORG_DAILY_AI_LIMIT` | Server | No | AI calls per organisation per day (default 300) |
| `STUDIO_USER_MINUTE_AI_LIMIT` | Server | No | AI calls per person per minute (default 20) |
| `STUDIO_SITE_URL` | Daily job | No | Defaults to `https://tools.craftedbyteja.com`; set to `http://localhost:3002` to test locally |

Where to set them:

- **Local:** `apps/tools/.env.local` (git-ignored). Restart the dev server after changing it.
- **Production:** Vercel, in the tools project's environment variables with **Production** ticked. Variables only apply to a **new** deployment.
- **GitHub:** repository Settings, Secrets and variables, Actions: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `STUDIO_CRON_SECRET`.

### 12.2 Supabase

- Run `migrations/studio.sql` (original tables), then (for the writer's knowledge) `studio_knowledge.sql`, and the organisation migrations in order: `studio_orgs_a_schema.sql`, `studio_orgs_b_backfill.sql`, check with `studio_orgs_c_validate.sql`, then `studio_orgs_d_cutover.sql` and check with `studio_orgs_d_validate.sql`. Take a backup first (`node scripts/studio-backup.mjs` in `apps/tools`). Undo: `studio_orgs_d_rollback.sql`, then `studio_orgs_rollback.sql`.
- Email and password sign-in must be enabled. If "confirm email" is on, new teammates must confirm before signing in.
- The tables are in `public`, so no change to the exposed schemas is needed.

### 12.3 Google keys

- **Gemini:** create a key in Google AI Studio.
- **YouTube:** in Google Cloud Console, enable **YouTube Data API v3**, create an API key, and restrict it to that API.

### 12.4 Vercel behaviour to know about

`apps/tools/vercel.json` contains an `ignoreCommand` that **skips a build when nothing inside `apps/tools` changed** since the last deployment. This saves builds when other apps in the monorepo change, but it means "Redeploy" of an unchanged commit is **cancelled**. To pick up new environment variables, push any small change inside `apps/tools`.

---

## 13. Setup from scratch and deployment

### 13.1 Run it locally

1. Install Node 20 or later. From the repo root run `npm install`.
2. Create `apps/tools/.env.local` with the variables in 12.1 (at minimum the Supabase pair, the service role key, `GEMINI_API_KEY`, `YOUTUBE_API_KEY`).
3. Run the migration (12.2) in Supabase.
4. Start the app: `npm run dev --workspace apps/tools` (serves on port 3002), then open `http://localhost:3002/studio`.
5. Sign in with an email that is in `studio_members`.

### 13.2 Deploy

1. Commit and push the studio code to the main branch (it is currently only in the working tree).
2. Set the environment variables on the tools project in Vercel (Production), including `STUDIO_CRON_SECRET`.
3. Add the three GitHub secrets (12.1).
4. Push a change inside `apps/tools` so Vercel builds with the new variables.
5. Open `/studio` on the live site, sign in, create a page, add competitors, press **Analyse all**.
6. Test the daily job once: GitHub, Actions, "Studio competitor refresh", Run workflow. A green run with `done: N of N refreshed` means it works.

### 13.3 Adding a teammate

Owner or Admin opens the studio home, **Team** box, enters the email and a role and presses **Create invite link**. Send the link to the teammate (it is shown once). They open it, choose **Create account** with that email (confirming the email first if Supabase requires it), sign in, and they are in. If they sign in without the link they will see "not part of any organisation": open the link again while signed in.

---

## 14. Quotas, costs and limits

Everything runs on free tiers. Rough costs of each user action:

| Action | Gemini calls | YouTube units |
|---|---|---|
| Find trending topics | 1 (quality) | about 100 (niche videos) plus about 2 per competitor |
| Sources for a topic | 0 | about 100 |
| Generate or revise a script | 1 (quality) | 0 |
| Search creators | 0 | about 101 |
| Analyse one creator (first time) | up to 10 (lite) + 1 (quality) | a few |
| Daily refresh, per creator | usually 0 to 3 (lite) + 1 (quality) | a few |
| Update learnings | 1 (quality) | 0 |

- **YouTube Data API:** 10,000 units per day, resetting at midnight Pacific time. A search costs 100 units; most other calls cost 1. When exhausted the app shows a clear message.
- **Gemini free tier:** daily and per-minute limits that Google has changed more than once; published figures vary widely. The app retries briefly on rate-limit errors and then shows "free limit used up". If the same Gemini key is shared with another product, they share one limit. A separate key avoids that.
- **Vercel function time:** 60 seconds per API call, which is why competitor analysis works in small steps.
- **Cache:** trend ideas and extra sources are reused for 6 hours to save quota.

---

## 15. Instagram: current state

- **Working today:** Instagram creators can be added by username, and reels are analysed from pasted caption and spoken words.
- **Not enabled:** automatic reading of Instagram creators. Instagram has no free official way to read arbitrary creators' posts. The official route (Business Discovery in the Instagram Graph API) reads only **Business or Creator** accounts, by exact username, and needs a Meta developer app and a connected account.
- **Set up so far:** a Meta app named "Content Studio" (Business type, Instagram use case, unpublished) exists in the owner's Meta business portfolio, and a system user and tokens were created. **Blocker:** the Instagram account has not yet been assigned to the system user, so lookups fail with a permissions error. Tokens saved in `.env.local` (`INSTAGRAM_ACCESS_TOKEN...`) are **not used by any code yet**.
- If this is finished later, it would add an "analyse this Instagram creator" action in `route.ts` and `sources.ts`. It still could not search by topic or read reel videos.

---

## 16. Security notes

- The service role key and cron secret exist only on the server and in GitHub secrets. Only `NEXT_PUBLIC_*` variables reach the browser.
- Data is protected twice: row-level security in the database, and a role check on every API action (section 6).
- The studio is marked `noindex` so search engines do not list it.
- Competitor channel pictures are loaded with `referrerPolicy="no-referrer"` because Google's image server rejects requests carrying some site addresses (it returned HTTP 429).
- Pasted sources and notes are plain text; there is no file upload.
- Token hygiene: never paste keys or tokens into chats or commit them. Rotate any key that has been shared. Prefer tokens with the fewest permissions.
- Third-party terms: the studio uses official APIs and public feeds only. It does not scrape WhatsApp or Instagram.

---

## 17. Known limitations

- **India-focused.** Trends and news are fetched for India. Other regions would need the region settings changed in `sources.ts`.
- **News gives headlines only**, not article text. Paste text as an own source when a script needs detail.
- **Instagram is manual** (section 15).
- **Shorts only.** Competitor learning ignores long videos. A creator who posts only long videos shows an explanatory note instead of a playbook.
- **The playbook does not rebuild by itself when the team's direction changes.** Scripts always apply the direction regardless; press **Update learnings** to refresh the playbook text.
- **One shared workspace.** Every team member sees every page. There are no per-user or per-page permissions.
- **No automated test suite.** The app was verified by running real flows with real data (AI calls, YouTube, database, screens, phone layout). A regression suite would be a sensible next step.
- **The learning loop is context, not training.** It uses only the most recent feedback.
- **Data growth:** videos and cache rows are never deleted automatically.
- **Minor:** a double click on "Create page" can create a duplicate page.

---

## 18. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| A red setup message on login | Migrations not run, or wrong Supabase project | Run the migrations in 12.2; check the URL and anon key |
| "Not part of any organisation yet" | The person has no membership | An Owner or Admin creates an invite link in the Team box; open it while signed in |
| "Only an Admin or Owner can remove a competitor" | Editors and Viewers cannot delete competitors | Ask an Admin |
| "Something went wrong on our side (ref abc123)" | An unexpected server error | Search the server log for the reference |
| API returns `db 401: Invalid API key` (server log) | Wrong `SUPABASE_SERVICE_ROLE_KEY` on the server | Re-paste the service role key (not the anon key), then push a change so Vercel rebuilds |
| Vercel "Redeploy" is cancelled | `ignoreCommand` skips builds with no change in `apps/tools` | Push any small change inside `apps/tools` |
| "YOUTUBE_API_KEY is not set" | Missing variable | Add it and restart (local) or redeploy (Vercel) |
| "API keys are not supported by this API" from YouTube | A Gemini key was used for YouTube | Create a separate Google Cloud key with YouTube Data API v3 enabled |
| "Free limit is used up" (Gemini) | Free-tier rate or daily limit | Wait a minute or until tomorrow; use a separate key; the daily job resumes tomorrow |
| "YouTube's free daily limit is used up" | 10,000-unit quota reached | Wait for midnight Pacific time |
| Channel pictures show as broken | Image host rejects the referrer | Already handled with `no-referrer`; hard refresh |
| A creator shows "nothing viral to learn from" | No Shorts over 10,000 views in the windows checked | Add larger creators, or lower `minViews` in `VIRAL` |
| Dev server error about a port in use | Another app is using 3002 | Use the auto-port launch config or stop the other server |
| Daily job red in GitHub | Missing or mismatched `STUDIO_CRON_SECRET`, or site not deployed | Make the secret identical on Vercel and GitHub; confirm the site is live |

---

## 19. Glossary

- **Page:** one social account or brand worked on in the studio.
- **Competitor:** a creator the page studies.
- **Viral set:** a creator's best Shorts (at least 10,000 views, last 30 days, top 10), widened to 90 or 365 days if empty.
- **Playbook:** the written lessons from viral Shorts. One per creator, plus one combined per page.
- **Direction:** the team's own instructions for the page (audience, voice, rules, languages). Binding.
- **Learning loop:** feedback and ratings are saved and sent back into every later prompt.
- **Hook:** the first 2 to 3 seconds of a video, meant to stop the scroll.
- **CTA:** call to action, the one thing viewers are asked to do.
- **RLS:** row-level security, the database's per-row access rules.
- **Service role key:** a Supabase key with full access that bypasses RLS; server only.
- **Median:** the middle view count; used to judge a video against its own creator's normal.
