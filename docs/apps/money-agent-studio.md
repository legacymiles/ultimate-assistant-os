# Money Agent Studio

Route: `/apps/money-agent-studio` · Category: Video · Live

Record reviewed: never — seeded from the edit log on 2026-11-13

> **This file is the truth about this app.** Read it before changing the app and update it in the
> same commit. Everything above the "From the code" block is written by hand and kept; that block
> is rewritten from the code by `npm run apps:records`, and `npm run check:records` (part of
> `npm run verify`) fails when it is stale. Edit prompt: `npm run change-it -- money-agent-studio "what to change"`.

## What it does

Standing agents whose only job is income from video. A Clipper takes a podcast, stream or long YouTube video and finds the moments people share — timestamped, scored, with the on-screen hook and a ready caption — read from the video's own captions, a pasted transcript, or by an AI watching it. A Faceless channel pitches topics for its niche, writes a retention-first script line by line with what goes on screen, and has it made as a voiced explainer. A Campaign clipper works a paid clipping campaign: the web is searched for live ones, its rate per 1,000 views, minimums, budget and rules ride with every clip. Your PC makes the files through In Queue (link-to-video, ffmpeg, burned captions, faceless-explainer), each one comes back to Approve, and nothing posts until you say yes — then it lands in Personas Studio, ready or scheduled on the persona's own accounts. A conveyor shows the whole pipeline from Idea to Posted; Earnings puts the money that arrived next to what the views say it should be, per agent and per video, and all of it shows in Financial Bible's Money Plays room. Its Radar tab is the market side: this week's news read for the most lucrative plays (big IPOs, CPI/jobs/Fed releases, gold, crypto adoption) with why each could pay, how it loses, how you'd actually get in and whether you're early or late; a release calendar; smart companies by margin, dividend and growth; and a move bot that alerts on big moves and scores what following its catches would have paid.

## Features

_Seeded from this app's edit log. Rewrite it into plain features the next time the app is edited, then set Record reviewed._

- **Agents that clip, run faceless channels and work paid campaigns — you approve, Personas Studio posts**
- **Radar tab — opportunity feed, release calendar, smart companies and a move-alert bot** — New first tab in Money Agent Studio. This week's market news (Google News, DuckDuckGo fallback) read by the AI with a desk trader's rules: why each play could pay, how it loses, how a regular person …

## Must keep working

_The flows a user would notice breaking. Sign-in, data rules, routes and keys are listed from the code below by themselves._

## Requested, not built yet

_Nothing waiting._

<!-- code:start -->
## From the code

_Rewritten by `npm run apps:records` from the source — do not edit by hand. `npm run check:records` fails when it is out of date._

### Where it lives

- Page `/apps/money-agent-studio` — owner's sign-in

### Sign-in & who can use it

- _No sign-in code of its own; the hub middleware decides access (see routes below)._

### Server routes

- _None._

### Data & database rules

- _No database, storage or saved data of its own._

### Keys & outside services

- _None._

### Tests

- _None yet._
<!-- code:end -->
