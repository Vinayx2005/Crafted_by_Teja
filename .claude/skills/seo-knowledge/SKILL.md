---
name: seo-knowledge
description: Current, source-backed SEO and AEO (answer-engine) knowledge for the craftedbyteja blogs, plus how to keep it current. Load before writing or tuning blog content, blog-agent prompts, SEO checks, structured data, sitemaps/robots, or when answering any ranking/traffic/AI-citation question for pft.craftedbyteja.com or craftedbyteja.com.
---

# SEO / AEO knowledge

Read `knowledge.md` (classic SEO, Google policy, structured data), `aeo.md`
(getting cited by AI answer engines) and `workflow.md` (the working method:
intent, clusters, on-page, links, measurement) before acting. They carry dated sources;
prefer them over recalled SEO advice, which goes stale fast and is mostly
agency folklore.

## Using it

1. **Read all three files first.** Check each file's "Last full refresh" date. If it is more than ~6 weeks old, say so and offer `/seo-refresh` before giving confident advice.
2. **Cite the date and source** when you tell the user something matters ("Google deprecated FAQ rich results in May 2026 — source in knowledge.md"). It lets them check you.
3. **Never invent a technique.** If it is not in these files and not verifiable right now, say it is unverified. SEO is full of confident nonsense; the files exist so we don't add to it.
4. **Changes land in code, not just prose.** The "How this maps to our code" table in `knowledge.md` lists where each rule is enforced in `apps/cms/src/lib/agent.ts`. When knowledge changes, update the enforcing code (or the table) in the same change — knowledge nobody applies is waste.

## Keeping it current

`/seo-refresh` does the update (all three files). It:

- re-reads the primary sources (Google Search Central updates feed and blog, the AI-features and helpful-content pages, spam policies, major AI-crawler docs),
- appends anything new to the right file with date + URL,
- corrects or deletes claims that are now wrong (delete, don't hedge),
- adds a dated changelog entry, and
- lists which of our code rules should change as a result.

Run it monthly, or whenever a core update or AI-search change is in the news.

## Standing rules that don't change

These hold regardless of algorithm churn, so apply them even if the files are stale:

- Trust and first-hand experience beat volume. One post with original data beats fifty rewrites.
- Publish at a human pace; "extensive automation across many topics" is Google's own named warning sign.
- A real named author with verifiable credentials matters most in money topics (YMYL).
- Keyword stuffing, invented statistics and faked dates are the fastest ways to lose a finance site.
- Nobody can guarantee a #1 ranking. Don't imply otherwise to the user.
