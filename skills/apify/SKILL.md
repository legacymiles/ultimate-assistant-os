---
name: apify
description: Scrape real data from sites Claude can't read on its own — Instagram, TikTok, Facebook, Google Maps, Amazon, Reddit, any website — using Apify's thousands of ready-made scrapers through the Apify MCP server. Use for lead lists (e.g. businesses with no website), finding places on Google Maps (asphalt millings plants, dump sites, recycling yards), pulling social posts and follower counts, prices, reviews, or turning results into a spreadsheet. This skill connects the MCP if it isn't connected yet. Nicknames: apify, scraper, scrape this, web scraping, lead list, google maps scrape, instagram scrape.
metadata:
  category: Scraping, Data, Lead Generation
  nicknames: apify, scraper, scrape this, web scraping, lead list, google maps scrape, instagram scrape
  source: https://github.com/apify/apify-mcp-server
---

# Apify — ready-made scrapers for any site

## 1. Connect it (do this yourself)

Check whether Apify tools are already available (tool names containing `apify`, e.g.
`search-actors`, `call-actor`). If not:

- **Claude Code (PC / VPS):**
  ```bash
  claude mcp add --transport http --scope user apify https://mcp.apify.com
  ```
  The first use opens Apify's sign-in in the browser (OAuth). A free Apify account gives
  about $5 of usage credit a month. If OAuth isn't possible (headless VPS), use the owner's
  Apify token instead, which they paste themselves:
  `claude mcp add --transport http --scope user apify https://mcp.apify.com --header "Authorization: Bearer $APIFY_TOKEN"`
  (token from apify.com › Settings › API & Integrations). Never print the token.
- **claude.ai or Jarvis:** add a custom connector with the URL `https://mcp.apify.com`.
- Then restart the session (or `/mcp`) so the tools load.

## 2. Use it

1. Turn the request into a data job: what records, which fields, how many, from where.
2. `search-actors` to find the right scraper (e.g. "google maps", "instagram profile",
   "tiktok", "website content crawler"). Prefer official/popular Actors with good ratings.
3. Check the Actor's input schema and **pricing** before running. Say the expected cost in
   one line if it isn't free or the run is large; keep first runs small (10–50 results).
4. `call-actor`, then read the dataset. Clean it: dedupe, drop empty rows, newest first.
5. Deliver as a table the owner can use (a Sheets artifact, CSV, or straight into the Jarvis
   app that needs it). Include the source link for each row.

## Examples

- "Bakeries in Columbus on Instagram with no website in their bio" → Instagram search/profile
  Actor → filter bio for missing links → sheet with handle, followers, bio, link.
- "Asphalt millings plants and places that take dumping within 30 miles" → Google Maps
  scraper with several searches (asphalt millings, concrete recycling, landfill, transfer
  station) → name, type, address, phone, lat/lng, hours → feeds the Jarvis map finder.
- "Local businesses with no website" → Google Maps scraper → keep rows where website is
  empty → pitch list for client sites.

## Rules

- Public data only; respect each site's terms and people's privacy. No scraping private
  profiles or personal contact details for spam.
- Never hide costs: per-result Actors can add up.
