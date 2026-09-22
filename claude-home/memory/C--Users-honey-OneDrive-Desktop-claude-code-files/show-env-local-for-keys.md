---
name: show-env-local-for-keys
description: "For ANY owner step: open .env.local in VS Code at the exact line and put paste-able SQL on the clipboard yourself, unasked — make it as easy as possible"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 6cb15157-c4f0-4a5b-b3f2-865c78688339
  modified: 2026-09-17T01:41:39.310Z
---

Whenever a feature needs an API key or env var, add a blank placeholder line (e.g. `WINDY_WEBCAMS_API_KEY=`) with a short comment to `.env.local` in the hub repo, then show the user that file at the exact line (link `.env.local:<line>` and open it with the file pane) so they only have to paste the value.

**Why:** the user said (2026-09-16) "always show me the .env.local so i can just put it in faster" — explaining where to put a key was slower than handing them the spot.

**How to apply:** never print or echo existing secret values from .env.local — only grep for the variable name and show the line number. Still mention the matching Vercel env var for production. Related: [[hub-deployment-supabase]].

**Do it without being asked, and do the whole handoff (2026-09-19):** the user had to remind me again — "u should always pull up the env file if u want me to type something in it… i always tell u make this as easy as possible". So for ANY owner step: open `.env.local` in VS Code at the exact line/column (`mcp__ccd_host__open_in_editor`, editor `vscode`), and put any SQL they must paste on the clipboard (`Set-Clipboard`) BEFORE telling them — never just link the file or offer to. One step at a time, fewest clicks.
