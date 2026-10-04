# SEO / AEO knowledge base

Living file. Every claim carries a date and a source, and primary sources
(Google/Bing/OpenAI/Anthropic docs) outrank agency blogs. If a line has no
source, treat it as folklore and verify before acting on it.

Refresh with `/seo-refresh`. Last full refresh: **2026-10-03**.

---

## 1. What Google actually says about AI features (AI Overviews / AI Mode)

- **There are no special requirements or optimizations to appear in AI Overviews or AI Mode.** No "AI text files", no special schema. The only requirement is being indexed and eligible for a normal snippet.
  — primary: https://developers.google.com/search/docs/appearance/ai-features (checked 2026-10-03)
- **Snippet controls suppress AI inclusion.** `nosnippet`, `data-nosnippet`, `max-snippet` and `noindex` all limit or remove a page from AI features. Never set them on blog posts.
  — primary: same page
- **`Google-Extended`** controls Gemini training use, *not* Search or AI Overviews inclusion. Blocking it does not remove you from AI Overviews.
  — primary: same page
- **AI-feature reporting is split in two.** Search Console's **Generative AI performance report** (AI Overviews + AI Mode) gives **impressions only** — no clicks, CTR, position or queries — and finished rolling out to all sites on 2026-08-31. AI *clicks* are still folded into the main Performance report under search type "Web".
  — primary: https://support.google.com/webmasters/answer/16984139 (checked 2026-10-03) and https://developers.google.com/search/docs/appearance/ai-features
- **llms.txt is not needed for Google Search.** Google documented this explicitly on 2026-06-15 ("not necessary, but acceptable for other services").
  — primary: https://developers.google.com/search/updates (2026-06-15 entry)
- **Spam policies apply to AI-generated search responses too** (documented 2026-05-15).
  — primary: https://developers.google.com/search/updates
- **Google publishes a generative-AI optimisation guide** that rules out the four tactics most AEO vendors sell: AI text files, chunking, writing-for-AI keyword rewrites, and chasing brand mentions. It also confirms **query fan-out**. Quotes are in `aeo.md` §1.
  — primary: https://developers.google.com/search/docs/fundamentals/ai-optimization-guide (quoted, checked 2026-10-03)

## 2. Content quality — the criteria Google publishes

Google's self-assessment list, condensed to what we can act on:

- Original information, research, or analysis — not a summary of what already ranks.
- Demonstrable first-hand experience and author expertise; **trust is the most important part of E-E-A-T**.
- No easily verifiable factual errors.
- A reader finishes feeling they can act, and would bookmark or recommend it.
- Named warning signs we must avoid: **"extensive automation to produce content on many topics"**, mass-producing hoping some ranks, summarising others without adding value, writing to a word count, and **changing publication dates without substantially updating content**.
- If automation substantially generates content, Google's guidance is about **disclosure and usefulness**: be able to say how it was made and why automation served the reader.
  — primary: https://developers.google.com/search/docs/fundamentals/creating-helpful-content (checked 2026-10-03)
- Guidance on AI-generated material was refreshed with quality-rater insights on **2026-10-01** — re-read that page on each refresh.
  — primary: https://developers.google.com/search/updates

## 3. Policies that can delist us

- **Scaled content abuse** — "when many pages are generated for the primary purpose of manipulating search rankings and not helping users", and the policy names the method outright: **"Using generative AI tools or other similar tools to generate many pages without adding value for users."** This is the live risk for a 100-post/month plan.
  — primary: https://developers.google.com/search/docs/essentials/spam-policies (quoted, checked 2026-10-03)
- **Site reputation abuse** — enforcement expanded in 2026 to cover first-party involvement and oversight of third-party content; manual actions delist portions of sites. Since 2026-08-30 the effect differs inside the EEA.
  — primary: https://developers.google.com/search/blog/2026/08/update-site-reputation-policy (2026-08)
  — secondary: https://searchengineland.com/google-site-reputation-abuse-policy-now-includes-first-party-involvement-or-oversight-of-content-448432
- **Back button hijacking** — new policy announced 2026-04-13, enforced from 2026-06-15, under malicious practices. Google notes it often comes from third-party ad libraries. Not an issue for us today; re-check if we ever add ad scripts.
  — primary: https://developers.google.com/search/blog/2026/04/back-button-hijacking
- **Expired domain abuse** — not relevant to us today; noted for completeness.

## 4. Structured data — what still earns anything

- **FAQ rich results are gone.** Deprecated 2026-05-07; Google removed the documentation on 2026-06-15. FAQPage markup no longer produces a rich result. An FAQ *section* is still worth writing (it answers real "People also ask" queries and is quotable by AI answers) — just don't expect SERP decoration.
  — primary: https://developers.google.com/search/updates (2026-05-08 and 2026-06-15 entries)
- **HowTo rich results** were, to my recollection, removed in 2023 — *not verified against a source this refresh*. Don't build for them, but confirm before telling the user.
- Keep structured data **matching visible content** — Google lists this among AI-feature best practices.
  — primary: https://developers.google.com/search/docs/appearance/ai-features
- Still active and relevant to a blog: `Article`/`BlogPosting` (author, datePublished, dateModified), `BreadcrumbList`, `Organization`/`Person` for entity clarity — these are in Google's current 25-feature rich-results gallery, which no longer lists FAQ or HowTo.
  — primary: https://developers.google.com/search/docs/appearance/structured-data/search-gallery
- **Schema does not measurably help AI citation.** A controlled test of 1,885 pages that added JSON-LD vs ~4,000 matched controls: AI Overviews −4.6%, AI Mode +2.4%, ChatGPT +2.2% — the last two within noise. Observationally AI-cited pages carry JSON-LD ~3× more often, which is correlation, not effect. Add `Article` markup for rich-result eligibility and author clarity, not as an AI play.
  — secondary: https://ahrefs.com/blog/schema-ai-citations/ (2026)

## 5. Ranking updates worth knowing

- 2026 confirmed updates: **March 2026 spam update** (03-24), **March 2026 core update** (03-27, 12 days), **May 2026 core update** (05-21, 12 days), spam updates in **June, August and September 2026**. No core update announced between 2026-06-01 and 2026-10-03.
  — primary: https://status.search.google.com/products/rGHU1u87FJnkP6W2GwMi/history
  — secondary (commentary on March): https://searchengineland.com/march-2026-google-core-update-what-changed-474397
- Core updates reward site-level quality signals; the recovery path is better content and real authority, not tweaks.

## 6. Answer-engine optimisation (AEO)

See `aeo.md` in this folder — it holds the AI-citation research, crawler/user-agent table, and measurement options, kept separate because it changes fastest.

---

## How this maps to our code

| Knowledge | Where it's enforced |
|---|---|
| No keyword stuffing; density 0.5–2.5% | `seoReport()` in `apps/cms/src/lib/agent.ts` |
| Cite regulators/official sites, never aggregators | draft prompt in `agent.ts` |
| No invented statistics, anecdotes or quotes | `STYLE` in `agent.ts` |
| FAQ section from real "People also ask" | outline prompt in `agent.ts` |
| Publish spread over time, never 100 at once | scheduler in `AgentBoard.tsx` |
| Dead external links stripped | `checkLinks()` in `agent.ts` |
| Topic clusters (pillar + supporting, interlinked) | `cluster` flag on seeds; `clusterSiblings()` in `agent.ts`; pillar-first scheduling in `AgentBoard.tsx` |
| One verbatim quote from an official source | draft prompt in `agent.ts` |

## Open questions / unverified

- **Resolved 2026-10-03:** `Article` schema shows no measurable AI-citation effect (§4). AI-assistant referrals *are* identifiable — GA4 has a native "AI Assistant" channel group for ChatGPT/Gemini/Claude/Copilot/Grok — but Google AI Overviews and AI Mode clicks remain indistinguishable from ordinary organic. Preferred sources is **domain/subdomain only**, so pft.craftedbyteja.com is eligible and a subdirectory blog would not be; whether it helps a small site is still unverified.
- Whether the Generative AI performance report shows anything at our (currently zero) impression volume.
- Whether HowTo rich results were removed in 2023 — stated from memory above, not yet verified at a source.

## Changelog

- **2026-10-03** — File created; `aeo.md` added from a research pass. Corrected my own wrong claim that AI traffic isn't broken out in Search Console (impressions are, since 2026-08-31). Added Google's generative-AI optimisation guide, the back-button-hijacking policy, the full 2026 update list, and the schema/AI-citation evidence. Spam-policy wording quoted directly from the source after an initial citation was written from a search snippet. Verified Google's AI-features guidance, helpful-content criteria, FAQ deprecation, llms.txt position, site reputation policy change, March 2026 core update.
