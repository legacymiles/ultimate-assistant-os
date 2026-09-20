---
name: deepseek-harness-local
description: "DeepSeek Harness (dsh) coding agent installed locally at C:/Users/honey/deepseek-harness; web UI on 127.0.0.1:3080; needs user's DeepSeek API key"
metadata: 
  node_type: memory
  type: project
  originSessionId: a64eccba-9aaa-4cbd-9bae-185a15837cfc
  modified: 2026-09-17T02:46:11.710Z
---

Installed 2026-09-16: npm package @deepseek-ai/dsh 0.1.5-rc.1 (developer preview, MIT) in C:/Users/honey/deepseek-harness (NOT in the hub repo). Launcher: Desktop "DeepSeek Harness.cmd" runs `dsh web` from %USERPROFILE%. The UI prints a ?token= URL; the workspace is picked in the UI ("Choose workspace"). On first run it asks for an official DeepSeek API key (the user must enter it). Profiles/config live under $DSH_HOME; other profiles: headless ("dsh --profile headless \"task\""), acp, sdk.

**Why:** the user wanted a local Claude Code-like agent that can read and edit their laptop's files.
**How to apply:** to upgrade, run `npm i @deepseek-ai/dsh@latest` in that folder; don't install it into the hub repo.
