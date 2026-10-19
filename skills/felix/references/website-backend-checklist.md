# Website & app backend checklist

The bar every site and app in this hub, and every client site, is held to before it is called
finished. Felix uses this as the "pro commercial" standard; super-board tickets cite the line
they fix. Each line says how to **check** it, because a box ticked on someone's word is not
checked.

Legend: **Must** = ship-blocker · **Should** = before a client sees it · **Nice** = when there is time.

## 1. Never crash, never confuse

| # | Item | Level | How to check |
|---|---|---|---|
| R1 | Every route has an error boundary (`error.tsx`, plus `global-error.tsx` at the root) | Must | Throw in a page on a preview build: the friendly screen shows, not a white page |
| R2 | Every crash is **logged** — browser errors, unhandled promise rejections, server route failures | Must | Trigger one; it appears in Jarvis › Deck › Site errors within a minute |
| R3 | Errors shown to people are plain English with a next step, never a stack trace or code | Must | Read every error string in the UI; none contains `Error:`, a status code, or JSON |
| R4 | A missing API key or service degrades visibly (a notice), never a 500 | Must | Run with `.env.local` empty: every page loads |
| R5 | Network calls time out and retry once; a slow service shows a spinner with a limit, not forever | Should | Throttle to "Slow 3G": nothing spins longer than its limit |
| R6 | Forms keep what was typed when a submit fails | Should | Kill the network, submit, restore: the text is still there |

## 2. Security

| # | Item | Level | How to check |
|---|---|---|---|
| S1 | No secret in the browser bundle; service keys only server-side | Must | Search the built `.next/static` for `sk-`, `service_role`, `secret` |
| S2 | Every Supabase table has Row Level Security on, with a policy | Must | `select tablename from pg_tables where rowsecurity = false` returns nothing public |
| S3 | Owner/admin routes are gated in middleware, not just hidden in the UI | Must | Call the admin API signed out: 401/403 |
| S4 | Every input is validated on the server (length, type), never trusted from the client | Must | Send an oversized / wrong-type body: a clean 400 |
| S5 | Rate limits on anything that costs money (AI, email, SMS) | Should | Fire 50 requests: later ones are refused politely |
| S6 | Security headers: HTTPS only, `X-Content-Type-Options`, frame rules, a CSP where practical | Should | securityheaders.com grade B or better |

## 3. Data

| # | Item | Level | How to check |
|---|---|---|---|
| D1 | Migrations are additive; destructive ones (DROP/RENAME/TRUNCATE) are labelled `schema` and approved by a human | Must | `grep -iE "drop|rename|truncate" supabase/migrations` — each hit has an approved PR |
| D2 | Backups exist and a restore has been tried once | Should | Point-in-time restore to a scratch project works |
| D3 | Cross-device state syncs (`saveSynced`) and survives a refresh | Should | Change on phone, refresh laptop: same value |
| D4 | Personal data has a delete path | Should | Delete an account: its rows are gone |

## 4. Speed

| # | Item | Level | How to check |
|---|---|---|---|
| P1 | Largest Contentful Paint under 2.5 s on mobile; aim for 1 s | Must | Lighthouse mobile, 3 runs, median |
| P2 | Images sized and modern (`next/image`, AVIF/WebP), heavy 3D/WebGL loaded on demand | Should | Network tab: no image over 300 KB above the fold |
| P3 | No layout jump on load (CLS under 0.1) | Should | Lighthouse CLS |
| P4 | A performance budget is checked on deploy | Nice | Build fails when the budget is broken |

## 5. Seen by people

| # | Item | Level | How to check |
|---|---|---|---|
| U1 | Works at phone width (375 px) with no sideways scroll | Must | Device toolbar at 375 px |
| U2 | Keyboard and screen-reader basics: labels, focus rings, alt text, contrast AA | Must | Lighthouse accessibility ≥ 95; tab through the page |
| U3 | Title, description, social preview image, favicon | Should | Paste the link in a chat app: the preview looks right |
| U4 | Empty states say what to do next; loading states never show raw "undefined" | Should | Visit every page with a new account |
| U5 | Light and dark both readable | Nice | Toggle the OS theme |

## 6. Ship and watch

| # | Item | Level | How to check |
|---|---|---|---|
| O1 | Typecheck and tests run before every deploy | Must | A failing test blocks the Vercel build |
| O2 | Every change goes through a preview deploy before main | Should | Each PR has a Vercel preview link |
| O3 | Uptime is watched and someone is told when the site is down | Should | Uptime check pings `/` every 5 min and alerts |
| O4 | Rollback is one click (previous Vercel deployment) | Should | Promote the previous deployment once, on purpose |
| O5 | Logged errors become tickets automatically (super-collect → board Backlog) | Nice | A new error shows up as a Backlog card after the next collect |

## 7. Client sites — the handoff

| # | Item | Level | How to check |
|---|---|---|---|
| C1 | Domain, DNS and email (SPF/DKIM/DMARC) set up and owned by the client | Must | mxtoolbox.com shows all three passing |
| C2 | Privacy policy, contact page, cookie notice where analytics run | Must | Links in the footer work |
| C3 | Contact forms deliver, and land somewhere the client reads | Must | Send a test; it arrives |
| C4 | The Jarvis error script is on the site, so its crashes reach the owner | Should | `/jarvis-errors.js` loads; a forced error is logged with the client's site name |
| C5 | Analytics installed and the client can see them | Should | One visit shows in the dashboard |
| C6 | Client Review link sent, so edit requests come through Jarvis | Should | The client can open their `?site=` link |
