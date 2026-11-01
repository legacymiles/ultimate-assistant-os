---
name: preview-icon-skill
description: "Video grid icons for the hub — OpenRouter still + ffmpeg motion (free) or H3 on the owner's RunPod endpoint; \"depict the verb, not the screen\""
metadata: 
  node_type: memory
  type: reference
  originSessionId: 7cae4aac-9b86-4ef0-95b2-c7ac8599760b
  modified: 2026-09-20T15:46:58.506Z
---

`~/.claude/skills/preview-icon/` — the owner's skill for the looping video grid icons replacing the
CSS `iconStyle` icons on the hub. Modelled on the openart.ai / magiclight.ai tool grids.

**The rule that defines it: depict the verb, not the screen.** Never generate a fake UI — generated
text is mush and it isn't the real product. Show the transformation the app performs, as a physical
event. Five archetypes decide the shot: Transformation, Accumulation, Interrogation, Emission,
Inhabitation. All 31 live apps already have hand-written subjects in `references/overrides.json`.

**Architecture: still + motion, produced separately.**
- Still → OpenRouter `google/gemini-3.1-flash-image` (same route as Image Studio). Pennies, seconds.
- Motion → **ffmpeg** (free) for Inhabitation/Interrogation/Transformation, or **H3 on the owner's
  RunPod endpoint** (~$0.023/5s clip) for Accumulation/Emission, which need genuinely new imagery.
- `plan.mjs` and `finish.mjs` are backend-agnostic; only `render.mjs` knows the provider.

Decision-relevant facts established the hard way:
- **OpenRouter has NO video models.** Verified against its model API: 447 models, output modalities
  are only text/image/audio. Do not go looking again.
- **H3 is only expensive hosted.** The owner's own RunPod endpoint is $0.023/clip warm vs MiniMax's
  $0.41 — all 31 icons ≈ $0.75. Their `runpod/h3-worker/` is built, smoke-tested and measured.
- muapi / Higgsfield rejected by the owner. `wide-trace/open-higgsfield` is a studio **UI**, not a
  provider — no endpoint, expects a Higgsfield `id:secret` key, no programmatic entry point.
- **ffmpeg makes free motion, not free video** — it only moves pixels that already exist. Seamless
  loop = periodic motion over the exact 3.0s window `finish.mjs` cuts (sine, 72 frames @ 24fps).
- ffmpeg is NOT installed on this PC; the skill vendors `ffmpeg-static`/`ffprobe-static`.
- `catalog.ts` is CRLF — normalise before block-splitting it.
- Hub icon is square (`AnimatedIcon` uses `width: size, height: size`), so one 512×512 asset serves
  v1, v2 and v3. Owner's constraint: **icon videos stay identical across all hub versions.**
- `previewIcon` does not exist on `CatalogProject` yet; add it when the first real icon lands.

**Verified end to end**: `music-creator` icon shipped at 512×512, 2.5s, seamless loop, 76KB + 12KB
poster, from a Gemini still with ffmpeg push-in motion. Caveat: music-creator is an Emission
archetype, so the free tier undersells it — the rings don't actually bloom.

Still to spec: **hub v3** — hover-to-play grid with mouse-driven vertical drift. Agreed to design
separately once real icons exist. See [[hub-v2-carousel]], [[ultimate-assistant-os-portfolio]],
[[comfyui-local-pinokio]].
