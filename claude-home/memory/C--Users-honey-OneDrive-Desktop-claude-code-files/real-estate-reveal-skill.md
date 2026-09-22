---
name: real-estate-reveal-skill
description: "Custom web-design skill at ~/.claude/skills/real-estate-reveal — listing photos → scroll-scrubbed cinematic property film site; master prompt transcribed from YouTube lGFJ-jt4hhU; video-model order is a placeholder awaiting the owner's model hierarchy"
metadata: 
  node_type: memory
  type: project
  originSessionId: c1b92931-273f-43bf-a263-ed0a3485e737
  modified: 2026-09-18T20:27:38.323Z
---

Built 2026-09-18 from YouTube lGFJ-jt4hhU, a Lovable + Higgsfield MCP luxury real estate build.
- `references/source-prompt.md`: the video's master prompt, read off the screen frame by frame. It is complete.
- `references/master-template.md`: the universal version. Slots, route blocks A–D, and `{{VIDEO_ENGINE}}` in place of hardcoded Higgsfield.
- `templates/estate-film.html`: a tested engine. Lenis + GSAP, scroll→currentTime, crossfades between chained clips.
- `scripts/prep-clips.mjs`: short-GOP re-encode, poster + last frame, `--kenburns` no-key fallback.

The owner said NOT to require the Higgsfield MCP. They plan to set up a **hierarchy of image/video models**. When that happens, update the "Order" table in `references/video-models.md` (currently Seedance 2 → MiniMax H3 → Higgsfield → RunPod → stills fallback).

**Why:** the video's approach hardcodes one vendor. The owner wants model choice centralised later.
**How to apply:** if the owner defines the model hierarchy, update this skill's video-models.md along with the other video apps ([[seedance-studio-app]], [[auteur-app]]).

Gotchas found while testing:
- The hidden Claude browser pane throttles rAF, so scrub screenshots come out stale or blank. Verify with Playwright headless instead.
- ffmpeg is not on PATH on this PC. `pip install imageio-ffmpeg` provides a binary. yt-dlp is in ~/.claude/mcp/bin.
- The design-skill sync hook auto-added the skill to the Website Redesigner roster ([[website-redesigner-app]]).
