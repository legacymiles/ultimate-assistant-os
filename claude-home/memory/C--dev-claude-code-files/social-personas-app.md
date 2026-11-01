---
name: social-personas-app
description: "Social Personas at /apps/social-personas — creator persona grid, TikTok/IG/FB accounts (OAuth when keys set, handle+link import otherwise), AI daily ideas + brainstorm that know each account"
metadata: 
  node_type: memory
  type: project
  originSessionId: 8a5b4349-aaac-490f-8bf6-204d47ab8814
  modified: 2026-09-19T13:28:56.169Z
---

Built + deployed 2026-09-19 (commit 18135e1). Grid of personas (e.g. rap music videos, explainers,
baby growth); each has accounts, a post table, a "What the AI knows" brain, daily ideas, brainstorm chat.

- Board = one blob `social-personas:v1` via saveSynced/useRemotePull. In UNPREVIEWABLE (owner data).
- **OAuth tokens never in the blob**: server_docs `social-personas-conn:<id>`, stamped with hub_uid;
  only that uid may sync. Keys TIKTOK_CLIENT_KEY/SECRET, INSTAGRAM_APP_ID/SECRET, FACEBOOK_APP_ID/SECRET
  are NOT set yet — Connect shows a setup panel (redirect URL + env lines). Real connect needs the owner
  to register developer apps; IG needs Business/Creator; FB reads Pages only (not personal profiles).
  OAuth flows are written to the official APIs but **untested against real platforms**.
- Link import reuses [[social-link-import]] understandPost. **OpenRouter refuses video under $1 balance
  (402)**; aiFetch then falls back to the gateway, which 400s "Invalid input" on video_url — so the
  real cause is hidden. understand.ts now adds a trail line saying so; UI toasts it.
- Ideas auto-generate once per local day when a persona is opened; heuristic ideas with no key.
- Chrome's scrollIntoView now returns a Promise — never write `useEffect(() => el.scrollIntoView())`.

Related: [[hub-ai-provider]], [[ai-rankings-app]]
