---
name: practical-places-directory
description: "Errand/utility places (cheap appliances, phone accessories, flea markets) live in the Dashboard's \"Explore places\" folder, per-city subfolders — NOT in Friends Night Out"
metadata: 
  node_type: memory
  type: project
  originSessionId: 26d67bba-604b-47d8-b7a4-b5680017c516
  modified: 2026-09-19T15:34:30.924Z
---

Decided 2026-09-19. The owner keeps a **practical city directory**: useful, not fun
places, e.g. the cheapest appliance store, the best phone-accessory warehouse,
flea markets. It is a folder named **"City Explore Directory"** (renamed from "Explore places" 2026-09-19 to avoid clashing with FNO's tab) in the Dashboard app
(`/apps/dashboard`, Folders tab), with one subfolder per city. The owner fills it.

**These places do NOT go in Friends Night Out.** FNO's "Explore places" tab (v2
spec `docs/superpowers/specs/2026-09-19-friends-night-out-social-design.md`) is for
fun / date / night-out places. Same name, different thing.

**Why:** the owner wants many of these places without cluttering the fun app.

**How to apply:**
- Never seed FNO's catalogue or sections with stores or errand spots.
- Anything saved as a practical place goes into the Dashboard folder under its city.
- If asked to "add a place", check which kind it is first. If it is ambiguous, ask.
- Keep it simple: a plain folder, not a new app. Build more only if the owner asks.

Related: [[dashboard-app]], [[friends-night-out-app]]
