---
name: slippery-escape-app
description: First-person physics escape game at /apps/slippery-escape — slip past the oiled opponent to the door
metadata: 
  node_type: memory
  type: project
  originSessionId: 1571b1c5-e4ee-46eb-b04b-693f9bf4019f
---

First-person, physics-driven escape game at `/apps/slippery-escape` (route → `SlipperyClient` dynamic ssr:false → `SlipperyGame`). Requested as Unreal Engine 5; UE5 isn't buildable in this env, so built as a web game in the Next hub instead — same R3F/three/drei/postprocessing/gsap/zustand stack as [[kart-showcase-app]].

**Structure:** pure logic in `src/lib/slippery/` (`config.ts` = tunables + arena layout data + scoring, `movement.ts` = slippery movement/balance/fall math, `ai.ts` = opponent steering, `store.ts` = zustand phases, `signals.ts` = module-level per-frame HUD values read via rAF to avoid 60fps React renders). Components in `src/components/slippery/` (`Simulation.tsx` owns the single useFrame loop + camera; `Arena.tsx`, `Opponent.tsx`, `HUD.tsx`). Spec: `docs/superpowers/specs/2026-07-12-slippery-escape-design.md`.

**Opponent = real rigged humanoid, dressed:** `public/models/opponent.glb` (three.js's Xbot mannequin, downloaded from the three.js examples repo; idle/walk/run clips). `Opponent.tsx` loads it with drei `useGLTF`/`useAnimations`, overrides material with a dark oiled `MeshStandardMaterial` (skinning-compatible — a custom ShaderMaterial would NOT deform the skinned mesh; that's why the old `oiledBody.ts` fresnel shader was deleted), auto-scales to ~1.95m via Box3, crossfades idle→walk→run by `state.speed`. Needs a `<Suspense>` boundary in `SlipperyGame`. DRESSED as an original character in the reference *aesthetic* (open black silk robe, gold chains + pendant, sash, dark shorts, gold watch) + holds a baby-oil bottle in each hand. Torso clothing = body-fitted JSX geometry on the root group (world-scaled, stays glued to torso, doesn't follow limb animation — fine for a robe). Hand items (2 bottles + watch) are attached to the actual BONES so they follow the animation.

**GLTFLoader bone-name gotcha:** three's GLTFLoader strips reserved chars (`:`, `.`) from names, so Mixamo `mixamorig:RightHand` becomes `mixamorigRightHand`. `getObjectByName("mixamorig:RightHand")` fails silently. Find bones by normalized suffix match (strip `[:.\s]`, lowercase, `endsWith("righthand")`). Also counter the bone's cm world-scale: `obj.scale = 1 / bone.getWorldScale().x` so attached props render in meters.

**Villain-likeness boundary:** user twice asked to make the villain a real public figure from a reference image (tied to real allegations). Declined the face/identity likeness; instead delivered the *look* (robe/chains/oil) on an original generic figure. Hold this line.

**Key decisions:** custom kinematic movement (NOT a physics engine) for precise feel control; first-person via manual pointer-lock + euler in Simulation (no drei controls). CRITICAL fix after first build: the sim was gated on `document.pointerLockElement`, which froze the whole game if the browser didn't grant lock on first click ("not working"). Now the sim runs while `phase==='playing'` regardless of lock; only mouse-look is gated on lock; a "click to capture mouse" hint shows when unlocked. Opponent runs the same low-grip integration so he overshoots on hard cuts (makes jukes land).

**Non-obvious tuning:** a straight 180° reverse does NOT trigger a fall (you decelerate through zero speed, so the misalignment window is tiny). The real wipeout trigger is a hard TURN while holding sprint (velocity lags the look direction at full speed). `balanceGain` had to go 1.9→3.6 (recover 1.35→1.1) before hard sprint-turns actually cross the slip/fall thresholds while gentle walking stays safe. Verified with a headless tsx sim (10/10) before shipping.

**Env gotcha:** the project lives under OneDrive on Windows. Running two `next dev` servers against the same `.next` folder corrupts it → `EINVAL: readlink '.next/server/app/apps/...'` crash, which also wedges the preview MCP. Fix: kill extra dev servers, `rm -rf .next`, restart one clean server.

**Status:** V1 done (movement, arena, win/lose + retry, per-round difficulty, scoring) + realistic rigged-humanoid opponent that walks/runs. Not yet committed. V2 ideas: dress the model (robe/shorts on the skinned mesh or a clothed GLB), multiple hazard types, trip-able props, learning AI, player hands/arms, sound.
