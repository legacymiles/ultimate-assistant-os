---
name: higgsfield-models-skill
description: Owner's rule — any mention of Higgsfield → use the higgsfield-models skill (muapi.ai via Open-Generative-AI route, MUAPI_API_KEY), never a Higgsfield account/MCP
metadata:
  type: feedback
---
Whenever a repo/prompt/skill/video mentions Higgsfield models, use the `higgsfield-models` skill (~/.claude/skills/higgsfield-models). It swaps Higgsfield for muapi.ai, the backend of github.com/Anil-matcha/Open-Generative-AI (the owner calls this their "unofficial" API-key route). CLI: scripts/muapi.mjs (models/upload/gen/poll). Key MUAPI_API_KEY in hub .env.local (blank line added 2026-09-19). Higgsfield Soul/DoP are NOT on muapi, so substitute and tell the owner.

**Why:** Owner asked 2026-09-19; they pay per generation through muapi instead of a Higgsfield subscription.
**How to apply:** Global rule is also in ~/.claude/CLAUDE.md. real-estate-reveal's video-models.md points to it. Confirm before batches of more than about 5 paid videos. Related: [[real-estate-reveal-skill]], [[h3-scroll-world-skill]].
