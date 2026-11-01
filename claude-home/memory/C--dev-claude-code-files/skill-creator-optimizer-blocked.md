---
name: skill-creator-optimizer-blocked
description: The skill-creator description-trigger auto-optimizer cannot run in this environment (no anthropic SDK / no API key)
metadata: 
  node_type: memory
  type: reference
  originSessionId: 655c7151-3e98-4d57-b305-556f8e992526
---

The skill-creator description-trigger optimization loop (`scripts/run_loop.py`, `scripts/improve_description.py`) **cannot run in this environment as of 2026-06-28**. Its "propose a better description" step uses the `anthropic` Python SDK directly (`anthropic.Anthropic()`), which requires `ANTHROPIC_API_KEY` — not installed (`ModuleNotFoundError: No module named 'anthropic'`) and no key is set (the Claude Code subscription auth does NOT satisfy the SDK).

The triggering *measurement* half (`scripts/run_eval.py`) works without a key because it drives the `claude` CLI via subprocess, but each query spawns a full nested `claude -p` run, so a 20-query × 3-run pass is ~60 agent invocations (real subscription token cost).

**How to apply:** Don't blindly launch `run_loop.py` here — it will crash fast. To enable the full auto-loop, `pip install anthropic` AND obtain an `ANTHROPIC_API_KEY`. Otherwise offer the user: ship the hand-written description as-is, or run only the CLI measurement and hand-tune. See [[interactive-web-studio-skill]].
