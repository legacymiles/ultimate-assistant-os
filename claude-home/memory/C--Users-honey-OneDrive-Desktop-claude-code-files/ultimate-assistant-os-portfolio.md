---
name: ultimate-assistant-os-portfolio
description: "Ultimate Assistant OS (this Next.js repo) IS the user's portfolio — the one hub showcasing all their websites and apps"
metadata: 
  node_type: memory
  type: project
  originSessionId: bfe65104-6916-4b3a-b678-ae8ceaa53e2f
  modified: 2026-08-14T19:34:58.380Z
---

**Direction correction (2026-08-14):** The **Ultimate Assistant OS** repo (`C:\Users\honey\OneDrive\Desktop\claude code files`, Next.js App Router) is **the user's portfolio** — the single hub that showcases *all* their websites and apps. This **reverses** the older [[portfolio-repo]] plan (which had pod-play-connect as the portfolio with the OS embedded inside it). Everything the user builds should live here as a hub app.

The hub's single source of truth is `src/lib/catalog.ts` (`PROJECTS[]`). Each entry renders a tile; `appUrl` = an internal `/apps/<slug>` route, `externalUrl` (no `appUrl`) = a tile that opens/embeds an external app. Add an app = add a catalog object + build its `/apps/<slug>` route.

Apps consolidated here on 2026-08-14: [[blueprint-app]] (rebranded **Prompt Architect**, `/apps/prompt-architect`), [[website-redesigner-app]] (`/apps/website-redesigner`), and **Pod Play Connect** as an `externalUrl` showcase tile (still its own [[portfolio-repo]] Vite app; the tile currently points at `http://localhost:8080` — swap for the deployed URL).

**User rule (2026-09-07, stated explicitly):** every app the user asks for goes into this portfolio hub unless they say otherwise — register it in `src/lib/catalog.ts`, never as a separate repo/site.
