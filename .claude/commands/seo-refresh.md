Refresh the SEO/AEO knowledge base at `.claude/skills/seo-knowledge/` from primary sources.

Scope: $ARGUMENTS (if empty, refresh everything.)

## 1. Read what we already believe

Read `knowledge.md` and `aeo.md`, and note each file's "Last full refresh" date. Everything after that date is what you're looking for.

## 2. Check the primary sources

Fetch these before any search engine results or blog posts:

- https://developers.google.com/search/updates — the documentation-changes feed. This is the highest-signal source; read every entry newer than our last refresh.
- https://developers.google.com/search/blog — announcements, core updates, policy changes.
- https://developers.google.com/search/docs/appearance/ai-features — AI Overviews / AI Mode guidance.
- https://developers.google.com/search/docs/fundamentals/creating-helpful-content — quality and AI-content criteria.
- https://developers.google.com/search/docs/essentials/spam-policies — scaled content abuse, site reputation abuse.
- https://developers.google.com/search/docs/crawling-indexing/overview-google-crawlers — crawler and user-agent changes.
- AI-crawler publisher docs for the engines that send citations: OpenAI (OAI-SearchBot / ChatGPT-User / GPTBot), Anthropic (ClaudeBot / Claude-SearchBot / Claude-User), Perplexity, and Bing/Copilot.

Then, only to catch things the docs haven't covered, search recent reporting (Search Engine Land, Search Engine Roundtable, and data-backed studies). Mark everything from these as secondary.

## 3. Update the files

For each genuinely new or changed fact:

- Add it under the right heading as one line plus `— primary:` or `— secondary:` with the URL and the date you checked.
- **Delete claims that are now wrong.** Don't soften them, don't keep them "for history" — a knowledge base full of hedged, outdated lines is worse than a short accurate one. The changelog records what changed.
- Move anything you could not verify into "Open questions / unverified".
- Keep both files tight. If a section stops earning its space, cut it.
- Update "Last full refresh" and add one dated changelog entry summarising the real changes (not "reviewed sources").

## 4. Say what should change in our code

The payoff is content that follows current rules, not a tidy document. Check the "How this maps to our code" table in `knowledge.md` against `apps/cms/src/lib/agent.ts` (prompts, `STYLE`, `seoReport`) and report:

- rules that should be added, reworded, or removed in the agent's prompts;
- SEO checks that are now wrong (e.g. a check for a deprecated feature);
- anything in the sites themselves (sitemaps, robots, structured data, author markup) that should change.

Propose these as concrete edits. Apply them only if the user asks, except for a factual correction to a stale rule, which you should fix and report.

## 5. Report

Short summary: what changed, what it means for our blogs, and which code edits you recommend. If nothing meaningful changed, say exactly that — "no substantive changes since <date>" is a good outcome, not a failure. Never pad the files to look productive.
