# Content Studio: Phase 1 implementation plan
## Backend foundation and security (organisations, brands, roles, server-side authorisation)

**Status:** in progress. **Step 0 is done. Steps 1 and 2 are prepared and tested but NOT yet run on the real database.** See the progress table in section 10.

This follows the PRD's rule that high-impact database and security changes are planned first and approved before they run. Every step below that touches the shared database says **who runs it** and has a **gate** (a check that must pass before the next step starts).

---

## 1. Scope

**In Phase 1**
- Organisations, membership, four roles (Owner, Admin, Editor, Viewer), invitations.
- Brands as the canonical replacement for today's "pages", with the full brand profile fields.
- The generic content tables (`content`, `content_versions`, `content_feedback`) created and filled with existing scripts, ready for Phase 3.
- Organisation-aware authorisation on **every** `/api/studio` action, not just new ones.
- Migration and backfill of existing Studio data, with a backup and a rollback path.
- The security hardening in PRD section 14.4.
- An automated test suite for authorisation and isolation.

**Not in Phase 1:** the light theme, new navigation, Create/Library screens, new content formats, Brand Settings screens. The existing Studio screens stay and keep working, with small data-layer changes only (section 8).

**Stays untouched:** every non-Studio table (finance, CMS, WhatsApp finder and others share the project), the competitor pipeline logic, the Gemini integration, the daily refresh (its permissions get narrower, see 5.4).

---

## 2. Decisions

### Defaults I will use unless you say otherwise
| Topic | Default |
|---|---|
| Existing data | One organisation for everything that exists today (name proposed: "18startup"). Today's single team member becomes **Owner** |
| Pages to brands | Every existing page becomes a brand **with the same id**, so competitors, videos, scripts and feedback keep their links with no rewriting |
| Existing scripts | Backfilled into `content` and `content_versions` (a script's `root_id` becomes the content id, each version becomes a version row). The legacy `studio_scripts` table stays, untouched, as a rollback copy |
| Source of truth after the switch | `brands` is canonical. `studio_pages` is frozen read-only and kept for rollback |
| Legacy team list | `studio_members` is kept, frozen, for rollback |
| Invitations | Invite by email with a role. The person signs up or signs in (email confirmation is already required in this project) and accepts. Sign-ups cannot be disabled, because other apps share this Supabase project |
| Competitor permissions | Editors can add and analyse competitors; Admins and Owners can remove them |

### Decisions you made
1. **Who may create a new organisation:** only you (platform admin) at first. Everyone else joins by invitation. *(Implementation: `org.create` is limited to the emails in a platform-admin setting.)*
2. **The empty duplicate "18startup" page:** delete it before migrating. **Done**, after the backup was taken.
3. **Next.js upgrade:** skipped for now. It stays on the audit's risk list but is outside Phase 1.
4. **Test runner:** Vitest as a development-only dependency is approved (used from Step 3).

---

## 3. Data model (additive)

Names are prefixed `studio_` so they cannot clash with the other apps' tables. Suggested fields from the PRD are kept; additions are marked **(added)**.

| Table | Purpose | Columns |
|---|---|---|
| `studio_organisations` | Workspaces | `id`, `name`, `slug` (unique), `created_by`, `created_at`, `updated_at` |
| `studio_org_members` | Who belongs and with what role | `id`, `organisation_id`, `user_id` (references `auth.users`), `role` (`owner`/`admin`/`editor`/`viewer`), `created_at`. Unique per org and user |
| `studio_org_invites` **(added)** | Pending invitations | `id`, `organisation_id`, `email`, `role`, `invited_by`, `token_hash`, `expires_at`, `accepted_at` |
| `studio_brands` | Brand profiles | `id`, `organisation_id`, `name`, `niche` **(added: today's search keyword phrase)**, `description`, `audience`, `voice`, `languages`, `writing_rules`, `prohibited_terms`, `supported_platforms`, `logo_url` **(added)**, `created_at`, `updated_at` |
| `studio_content` | One row per piece of content | `id`, `organisation_id`, `brand_id`, `created_by`, `title`, `content_type`, `platform`, `status` (`draft`/`in_review`/`approved`/`archived`), `current_version`, `created_at`, `updated_at` |
| `studio_content_versions` | Every version, never overwritten | `id`, `content_id`, `version`, `parent_version_id` **(added)**, `content_body` (jsonb, so each format can have its own structure), `generation_instructions`, `sources`, `created_by`, `created_at` |
| `studio_content_feedback` | Feedback per version | `id`, `content_id`, `version_id`, `user_id`, `section`, `sentiment`, `rating`, `note`, `created_at` |
| `studio_ai_usage` **(added)** | Usage tracking and limits | `id`, `organisation_id`, `user_id`, `action`, `model`, `created_at` |

**Existing tables stay and keep their data:** `studio_pages`, `studio_competitors`, `studio_videos`, `studio_scripts`, `studio_feedback`, `studio_members`, `studio_cache`.

**One change to existing tables (Step 4, separately gated):** competitors, scripts and feedback currently have a foreign key to `studio_pages`. A brand created after the switch has no row there, so those foreign keys are **re-pointed to `studio_brands`**. This is safe because every existing id matches, and the new constraint is added and validated before the old one is dropped.

---

## 4. Migration, backup and rollback

### 4.1 Safety net before anything runs (Step 0)
1. I add a small **backup script** that exports every `studio_*` table to JSON files in a git-ignored local folder, and a **baseline report** (row counts and a checksum per table, plus the list and columns of every non-Studio table).
2. You run it once and keep the files. This is the recovery copy.

### 4.2 Files I will prepare (nothing runs until you do)
| File | What it does | Runs when |
|---|---|---|
| `migrations/studio_orgs_a_schema.sql` | Creates the new tables, indexes, helper functions and policies for the **new** tables only. Touches no existing table | Step 1 |
| `migrations/studio_orgs_b_backfill.sql` | Creates the organisation, the owner membership, brands, content and versions, feedback. Inserts only | Step 2 |
| `migrations/studio_orgs_c_validate.sql` | Read-only queries comparing before and after | Steps 2 and 4 |
| `migrations/studio_orgs_d_cutover.sql` | Re-points the three foreign keys and replaces the broad team policy on legacy tables with organisation-based policies | Step 4 |
| `migrations/studio_orgs_rollback.sql` | Restores the old policies and foreign keys and drops the new objects | Only if needed |

You run these in the Supabase SQL editor. I cannot run schema changes myself. After each one I verify with read-only queries.

### 4.3 Mapping
| Today | After |
|---|---|
| member list (1 person) | organisation "18startup", that person as Owner |
| `studio_pages` row | `studio_brands` row, same id |
| competitors, videos | unchanged, linked to the same id (now a brand) |
| scripts | one content item per `root_id`, one version row per script version, status Draft |
| feedback | `studio_content_feedback` linked to the matching content and version |
| playbook and cache rows | unchanged; they are keyed by that same id |

### 4.4 Validation (the gate after Step 2)
Counts must match exactly: brands equal pages (2, or 1 if the duplicate is deleted), content versions equal scripts (4), feedback equal feedback (2), competitors (8), videos (672). No content or version may be left without its brand and organisation, and the checksums of untouched tables must be identical to the baseline.

---

## 5. Server-side authorisation (the core of Phase 1)

### 5.1 Today's problem
Every action runs with the all-powerful service key and only asks "is this person on the team list?". It never checks that the page, competitor or script the caller named belongs to anything they may use. For example, "revise script" accepts a script id and a page id independently.

### 5.2 New design
A new module `lib/studio/access.ts`:

1. **Principal:** either a verified user (id and email from the Supabase token) or the cron job.
2. **Resource resolver:** given what the request names (organisation, brand, competitor, content or script id), looks up the **owning organisation and brand on the server**. It never trusts an organisation id sent by the browser.
3. **Role check:** the user's role in that organisation must be at least what the action needs.
4. **Consistency check:** when a request names several things (a page and a script, for example), they must belong to the same brand. A mismatch is refused.

If a resource does not exist, or exists in an organisation the caller is not in, the answer is the same "not found", so ids cannot be probed.

### 5.3 Who can do what
| Role | Can do |
|---|---|
| **Viewer** | Read content, playbooks and research results. No AI actions |
| **Editor** | Everything a viewer can, plus: trends, sources, generate and revise, feedback and ratings, add and analyse competitors, paste reels |
| **Admin** | Everything an editor can, plus: edit brands, remove competitors, invite and manage members, approve content |
| **Owner** | Everything an admin can, plus: delete the organisation, transfer ownership, change an Owner |

Team protections: only Admins and Owners manage members; nobody can remove or demote the **last Owner**; an Admin cannot change an Owner; people cannot raise their own role.

### 5.4 The daily job gets narrower
Today the cron secret can run every action. It will be limited to the four it needs: `fetchVideos`, `deepVideos`, `summarise`, `consolidate`. It cannot generate scripts or touch team data.

### 5.5 Usage limits
Every AI call is recorded in `studio_ai_usage`. A per-organisation daily cap and a per-user per-minute cap are enforced before the call, and return a clear message when reached. Both are environment settings.

### 5.6 The existing actions, secured
| Action | Needs | Extra check |
|---|---|---|
| `trends`, `sources` | Editor | `trends` on a brand the caller can access |
| `script` (new) | Editor | brand in the caller's organisation |
| `script` (revise) | Editor | the earlier script must belong to the named brand |
| `search` | Editor | none beyond role |
| `fetchVideos`, `deepVideos`, `summarise`, `addReel` | Editor | competitor belongs to a brand the caller can access |
| `playbook` | Viewer | brand access |
| `consolidate` | Editor | brand access |

---

## 6. New API actions (added to the same `/api/studio` endpoint)
`org.create`, `org.list`, `org.update`, `member.list`, `member.invite`, `member.setRole`, `member.remove`, `invite.accept`, `brand.create`, `brand.list`, `brand.update`, `brand.archive`, `usage.get`.

The existing endpoint and all ten current actions keep working with the same request and response shapes. Only the access checks tighten.

---

## 7. Security hardening (PRD 14.4)
| Item | Change |
|---|---|
| Raw database errors | Replaced by a generic message with a short reference id. Details stay in the server log |
| Links | Only `http` and `https` links are accepted when sources are stored and when they are shown |
| Source objects from the browser | Only known fields are kept, with length limits (no spreading arbitrary fields into stored data) |
| Prompt injection | Text from the web (titles, descriptions, news) is wrapped in clearly marked data blocks, with an instruction to treat it as data, and control characters are stripped |
| Team actions | Moved from direct browser writes to API actions with the protections in 5.3 |
| Duplicate submissions | Create actions disabled while pending, plus a server-side idempotency key (this prevents the duplicate pages seen in the data) |
| Security headers | Limited to `/studio` and `/api/studio` so other tools pages are unaffected: content-type sniffing off, frame protection, referrer and permissions policies. A Content-Security-Policy starts in **report-only** mode, then is enforced once it shows no breakage |
| Rate limits | See 5.5 |
| Browser-native dialogs | Replaced with proper confirmation dialogs in Phase 2 |

---

## 8. Changes to the existing Studio screens in Phase 1
Small and data-layer only, so the current Studio keeps working:
- Page screens read and write `studio_brands` instead of `studio_pages` (same fields plus the new ones).
- The Team box calls the new member and invite actions and shows roles.
- Delete page becomes "archive brand".
- A role-aware UI: viewers see read-only screens.

Phase 1 assumes **one organisation** in the UI. The organisation switcher arrives in Phase 2.

---

## 9. Security tests (the Phase 1 acceptance gate)
Automated tests run against throwaway data (two test organisations, users at each role, all prefixed so they are deleted afterwards). Real accounts and data are never used.

1. **Isolation matrix:** for every action, a user from organisation A naming a resource from organisation B is refused, with no leak of whether it exists.
2. **Role matrix:** each role is allowed or refused exactly as 5.3 says, for each action.
3. **Consistency:** mismatched page and script ids are refused.
4. **Team protections:** last-owner removal, self-promotion and admin-versus-owner changes are refused.
5. **Cron principal:** allowed the four actions, refused everything else.
6. **Database level:** the public key sees nothing; a signed-in non-member sees nothing; members only see their own organisation's rows.
7. **Usage limits:** the cap triggers and the message is clear.
8. **Regression:** the existing flows (trends, sources, generate, revise, feedback, competitor analysis, playbook, the daily job) still work for a member.
9. **No collateral change:** the non-Studio tables are byte-identical to the baseline.

This needs a test runner. I propose **Vitest as a development-only dependency** in the tools app (no effect on the production bundle). Tell me if you would rather avoid it.

---

## 10. Steps, gates and who acts

| # | Step | Who | Gate to continue |
|---|---|---|---|
| 0 | Backup script and baseline report | I write it; **you run it** | Backup files exist; baseline saved |
| 1 | Schema migration A (new tables only) | I write; **you run** | New tables visible; existing tables unchanged |
| 2 | Backfill B and validation C | I write; **you run B**; I run the read-only checks | All counts match (4.4) |
| 3 | Server authorisation layer, new actions, hardening, tests | **I implement and test locally** | Full test suite green; existing flows verified in the browser |
| 4 | Cutover D: re-point foreign keys, organisation-based policies on legacy tables | I write; **you run**; I verify | Isolation tests green against the real database; existing Studio still works for you |
| 5 | Update docs and hand over | I do | Updated guide and test report |

### Progress
| # | Status |
|---|---|
| 0 | **Done.** All 7 Studio tables backed up (672 videos, 8 competitors, 4 scripts, 2 feedback, 12 cache rows, 2 pages, 1 member) with a manifest of checksums, plus a baseline of the other apps' tables. Empty duplicate page deleted afterwards |
| 1 | **Done and verified.** `studio_orgs_a_schema.sql` ran. All 8 new tables exist and are empty; the public key is refused on every one and on the helper functions; every existing table is byte-identical to the baseline (except the duplicate page deleted earlier on purpose) |
| 2 | **Done and verified (28 of 28 checks).** 1 organisation, you as Owner, 1 brand (same id as the old page), 2 content items, 4 versions, 2 feedback rows. Every script's text, language, length, sources and version links match the originals; no existing table changed |
| 3 | **Done, verified locally** (not committed). 58 unit tests pass. Live checks against the migrated database: no token gives 401; the daily-job secret gets 403 on `script`, `trends`, `playbook`, `brand.update`, `org.create`; unknown, foreign and malformed ids all give the same 404; usage is recorded; `trends` works with real Gemini through the fenced prompts. Classic UI now reads brands, creates/updates/archives through the API, shows roles, invites by link. Security headers added (CSP report-only). |
| 4 | **Done, verified live.** Cutover run by you. Live checks: public key refused on every studio table; row counts unchanged (8 competitors, 672 videos, 4 scripts, 2 feedback, 1 brand); the Owner reads everything; browser writes to videos, script text and the old email list are refused with 403; a competitor can be added to a brand and not to a foreign one. Temporary `studio_pages` mirror removed from `brand.create`. |
| 5 | **Done.** `docs/content-studio.md` updated (roles, tables, API, setup, troubleshooting). |

**How Steps 1 and 2 were tested before touching the real database:** all three files plus the rollback were run on an in-memory Postgres that imitates Supabase (roles, `auth.users`, `auth.uid()`), loaded with the real schema and a replica of today's data. 61 checks passed: the schema applies twice cleanly; the backfill copies everything with matching counts and is safe to run twice; the public key is refused on every new table; Viewer, Editor and Owner can do exactly what the role matrix allows; a user from another organisation sees and changes nothing; the database refuses content pointing at another organisation's brand; and the rollback leaves the original data byte-identical. This was an emulation, not the real project, which is why the backup, the gates and the rollback remain.

Steps 0 to 2 only add things. Step 3 is code only and runs locally against Step 2's data. The only step that changes behaviour of existing tables is **Step 4**, and it has a tested rollback.

---

## 11. Risks and how they are handled

| Risk | Handling |
|---|---|
| A mistake in the shared database affects other apps | Additive first; `studio_` prefix; baseline checksums prove other tables are untouched; backup before any run |
| Locking people out at cutover | Rollback script prepared and tested; old policies kept until the new ones are verified |
| Earlier policy mistakes in this project (a past "RLS leak" fix exists for the finance app) | Isolation tests at the database level are a hard gate before Step 4 |
| Existing Studio breaks | Same endpoint, same shapes; regression tests; the old tables stay |
| Free AI quota exhausted by a new organisation | Usage caps and invite-only organisation creation |
| Test data pollutes real data | Prefixed throwaway organisations, removed after each run |

---

## 12. Approval requested
1. Approve this plan for Phase 1.
2. Answer the three questions in section 2.
3. Confirm Vitest as a dev-only dependency.

Approved: Phase 1, with the decisions above. I stop for you at each gate marked "you run".


## Test report (end of Phase 1)

| Layer | What | Result |
|---|---|---|
| Unit tests (Vitest, in the repo, `npm test` in `apps/tools`) | Role matrix, isolation between organisations, cross-brand id mixing, archived brands, daily-job limits, team rules, link and source sanitising, prompt fencing, usage limits | 58 pass |
| Database tests (in-memory Postgres, kept outside the repo) | Migrations A to D, validation queries, rollbacks, re-runs, role and isolation rules | A to C and the rollback: 61 pass. D: 48 pass |
| Live checks | See Steps 3 and 4 above | As designed |

Known gaps, carried to the next phase:
- The in-memory database tests are not in the repo (they would need `@electric-sql/pglite` as another dev dependency).
- The content-security policy is report-only. Enforce it after a week without reports of breakage.
- Editors can no longer edit a brand's "Your direction" (Admin only). Easy to relax if wanted.
- Script generation, revision and the Competition tab were not clicked through in the browser after the cutover; only the API and database were exercised.
- Native `prompt` / `confirm` dialogs remain (Phase 2).
- Nothing is committed or deployed yet.
