---
name: new-dashboard-ai-os
description: "New Dashboard app (/apps/new-dashboard) + ai-os-dashboard skill + root CLAUDE.md/aios/ folder — the AIS-OS \"Four Cs\" AI OS setup built 2026-09-18"
metadata: 
  node_type: memory
  type: project
  originSessionId: 5075b51e-194d-4156-9e58-b331b39fbf70
  modified: 2026-09-18T15:08:20.400Z
---

Built 2026-09-18 from github.com/nateherkai/AIS-OS (MIT, Nate Herk; clone at C:/Users/honey/AIS-OS).

- **App:** "New Dashboard" — SINCE 2026-09-19 this is the Profile tab of [[jarvis-app]] at /apps/jarvis (the old route redirects); it was at /apps/new-dashboard (code: src/{components,lib}/new-dashboard, API /api/new-dashboard/focus). Multi-profile: owner + anyone they onboard. 7-question onboarding (voice samples must be pasted; vague priorities flagged), Four-Cs "setup coverage" score (deliberately NOT the kit's evidence-based /audit score), connections table, capabilities (can pull the owner's ~/.claude/skills via /api/skills/scan), cadence, decisions log, AI "focus this week", export to AIS-OS files + profile JSON, import JSON. Store key `new-dashboard` via saveSynced. In UNPREVIEWABLE. Preview config port 3240.
- **Skill:** ~/.claude/skills/ai-os-dashboard — onboard in chat → same files + importable profile JSON; scripts/install-export.mjs splits an export bundle into a folder; reference/ holds the kit's onboard/audit/grill-me/level-up/link skills.
- **Folder organisation:** root CLAUDE.md is now the routing manual (need → path table, slug→folder mismatches, rules that bite). Personal context lives in aios/ (context/, connections.md, decisions/log.md). aios/context files are DRAFTS written from memory until the owner finishes onboarding and exports.

**Why:** owner wanted the master folder organised so sessions find info faster, and a reusable way to onboard other people onto their own dashboard.
**How to apply:** read CLAUDE.md first in this repo; log decisions to aios/decisions/log.md; never overwrite root CLAUDE.md from an export (use --skip CLAUDE.md). Related: [[dashboard-app]] (a different app — the Recall-based one), [[skills-library-app]].
