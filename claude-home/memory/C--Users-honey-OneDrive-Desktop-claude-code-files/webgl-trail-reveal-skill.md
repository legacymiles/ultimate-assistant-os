---
name: webgl-trail-reveal-skill
description: New custom skill at ~/.claude/skills/webgl-trail-reveal for the Unicorn Studio-style mouse-trail image reveal technique
metadata: 
  node_type: memory
  type: reference
  originSessionId: 6b684e4c-8988-4266-807f-a4532306f0f1
---

Created `~/.claude/skills/webgl-trail-reveal/` (SKILL.md + references/technique.md) per the user's explicit request to make this a reusable skill, not a one-off. Trigger it whenever a request mentions "image reveal," "hover to reveal," "scanning effect," "unicorn.studio," or two images where one is hidden under the other and revealed by mouse movement.

Core technique it documents: ring-buffer trail mask (24 aged pointer positions, GLSL `max()` over falloff*  (1-age)), thin RGB-channel-split + UV-jitter distortion band at the mask boundary, trail holds then eases closed. Explicitly warns against the common mistake (a spotlight/blob at the current cursor position, which reads as a cheap hover glow, not a scan). Companion skill to `interactive-web-studio` (that one owns page/section composition; this one owns the reveal shader mechanic). See [[ember-reveal-app]] for the first real build using it.
