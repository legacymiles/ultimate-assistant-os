---
name: openseo
description: Set up and route OpenSEO — real SEO data (keyword volumes, rankings, backlinks, site audits, local SEO, AI-search visibility) for the owner's and clients' sites through the OpenSEO MCP. Connects the MCP if missing, then picks the right OpenSEO skill (seo-audit, keyword-research, local-seo, competitor-analysis, seo-report…). Use when the user says "SEO", "why isn't my site ranking", "audit this site's SEO", "what keywords", or wants an SEO report to sell to a client. Nicknames: openseo, open seo, seo, seo tools, rank my site, seo setup.
metadata:
  category: SEO, Marketing
  nicknames: openseo, open seo, seo, seo tools, rank my site, seo setup
  source: https://github.com/every-app/open-seo
---

# OpenSEO — start here

## 1. Connect it (do this yourself)

Check for OpenSEO tools (names containing `openseo`). If missing:

```bash
claude mcp add --transport http --scope user openseo https://app.openseo.so/mcp
```

The first use asks the owner to sign in to OpenSEO in the browser. The hosted plan's free
trial credits are small and its data lives on OpenSEO's servers. For heavy client use it can be
self-hosted (Cloudflare, free plan) with the owner's own DataForSEO API key, which is cheaper;
see https://github.com/every-app/open-seo/blob/main/docs/SELF_HOSTING_CLOUDFLARE.md. Say the
trade-off in one line; don't self-host unasked.

## 2. Pick the skill

| The ask | Skill |
|---|---|
| New site or client, first time | `seo-project-setup` |
| "Not sure what to do" / explain | `seo-coach` |
| Full health check of a site | `seo-audit` |
| What people search for | `keyword-research`, then `keyword-clustering` |
| Local business (Columbus, "near me", Maps) | `local-seo` |
| Who outranks us and why | `competitor-analysis`, `competitive-landscape` |
| Backlinks to win | `link-prospecting` |
| Showing up in ChatGPT / AI answers | `ai-visibility-audit`, `ai-prompt-research` |
| A report to hand a client | `seo-report` (every workflow saves through it) |

For client sites the deliverable is the `seo-report` page plus the top 3 fixes in plain
English, ordered by impact. Fixes to the owner's own sites can go straight into the code.
