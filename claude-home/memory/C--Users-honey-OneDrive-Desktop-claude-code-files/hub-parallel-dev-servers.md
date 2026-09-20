---
name: hub-parallel-dev-servers
description: "Two dev servers sharing the hub's .next dir corrupt it; run a second one with a separate distDir"
metadata: 
  node_type: memory
  type: project
  originSessionId: fbcc301e-6832-411f-90bc-effb5358c386
  modified: 2026-07-21T16:16:10.378Z
---

In the Assistant OS hub (`C:\Users\honey\OneDrive\Desktop\claude code files`) the user often has **another chat's `npm run dev` already running on port 3000**. Starting a second dev server that shares the same `.next` directory corrupts it — both servers then fail, the new one crashing on startup with `EINVAL: invalid argument, readlink '...\.next\server\app\icon.svg\route.js'` and the existing one returning bare **500 Internal Server Error** on every route (including routes that were previously fine). `preview_start` dies silently the same way and disappears from `preview_list`.

**Why:** OneDrive-synced folder + two Next dev processes writing the same build output.

**How to apply:** before blaming your own code, check `netstat -ano | grep LISTENING | grep :3000`. To verify a change without disturbing the other session, temporarily add `distDir: process.env.NEXT_DIST_DIR || ".next"` to `next.config.mjs`, run `NEXT_DIST_DIR=.next-verify npm run dev -- -p 3211`, drive it with the Playwright MCP tools, then revert `next.config.mjs` **and `tsconfig.json`** (Next auto-rewrites the tsconfig `include` to add the custom dist dir) and delete `.next-verify`. `npx tsc --noEmit` also works for a quick check — ignore the pre-existing errors from the nested `item-storm-arena/` project.
