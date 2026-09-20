---
name: video-analyzer-skill
description: "video-analyzer skill (~/.claude/skills/video-analyzer) + ste-bah/video-analyzer-mcp registered as MCP \"video-analyzer\"; the bundled watch.mjs sends a YouTube URL straight to Gemini via OpenRouter and works without a Google key"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 9caf07ff-9627-4905-b308-901b26d0cf1f
  modified: 2026-09-14T01:55:28.325Z
---

Added 2026-09-13 at the user's request ("add this to my skills").

- **Skill:** `C:\Users\honey\.claude\skills\video-analyzer\SKILL.md` + `scripts/watch.mjs`.
  `node ~/.claude/skills/video-analyzer/scripts/watch.mjs "<youtube url>" "<question>"`
  (`--transcript`, `--json <shape>`, or a local ≤20 MB file). Uses OPENROUTER_API_KEY (env or
  the hub's .env.local) and `google/gemini-3.8-flash`, which accepts a YouTube URL as a
  `video_url` part. A 9-minute video cost ≈ 50k input tokens per question (~1–2¢).
- **MCP server:** cloned to `C:\Users\honey\.claude\mcp\video-analyzer-mcp` (npm installed),
  registered in `~/.claude.json` → `mcpServers.video-analyzer` via `run.cmd`, which prepends
  `~/.claude/mcp/bin` (pinned yt-dlp 2026.08.19, SHA-256 verified) to PATH. It needs
  `GOOGLE_API_KEY` (Google AI Studio) in the user's environment — NOT set as of 2026-09-13,
  so the MCP tools will fail until the user adds it; the script path is the working one.
- Gemini's timestamps are approximate; ask focused follow-up questions rather than one giant one.

Related: [[social-link-import]], [[smart-shot-videos-app]]
