---
name: finish-and-verify-feedback
description: "Owner wants features actually finished and verified in their real setup (live site, their browser), not \"done locally, want me to push?\" repeated"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: b86d56a9-b135-4cc6-860b-a28b4c4fdc4e
  modified: 2026-09-18T23:51:19.498Z
---

When the owner asks for a feature in a hub app, finish it end to end — including the push/deploy
they obviously need to use it — and verify it the way THEY use it (live site, their browser, their
PC), not only a local preview or a manual script run.

**Why:** 2026-09-18, Game Creator: I asked "can I push?" three times while they kept asking "is it
done", then told them Play worked because the handler ran from a terminal — but clicking it in
their browser still did nothing. They called out that I say a lot and they have to repeat
themselves.

**How to apply:** say plainly what is and isn't usable yet in one line; when the ask clearly
implies deploying, deploy and confirm the deployment status instead of asking again; test the
actual click path (browser → site → PC), not a shortcut. Related: [[game-creator-app]].
