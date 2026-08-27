# Slippery Escape — V1 Design

**Date:** 2026-07-12
**Route:** `/apps/slippery-escape`
**Stack:** Next.js App Router + React Three Fiber + three + drei + @react-three/postprocessing + gsap + zustand (all already installed)

## Concept

First-person, physics-driven escape game. The player spawns in a cavernous oiled-up
bathroom. A glistening opponent stands between the player and the glowing **EXIT**.
Movement has momentum and low traction — the whole game is reading the floor and the
opponent, committing to a juke, and trying not to wipe out. Core loop is ~15–30s:
**spawn → juke → escape or fall → instant retry.** The target emotion is
"I almost had it — one more try."

## Platform decision

Requested in Unreal Engine 5. UE5 cannot be authored/compiled/run from this
environment (no install, GUI-editor driven). Built instead as a real, playable web
game in the existing Next.js hub, matching the user's `/apps/*` interactive apps.

## Movement model (the core)

Custom kinematic model (no physics-engine dependency — precise control over "feel"):

- **Velocity + low friction.** Input accelerates toward look direction; oil bleeds
  velocity off slowly → glide/overshoot.
- **Grip vs. speed.** Walking, momentum snaps to intended direction quickly (control).
  Sprinting, it lags — turn hard and the body keeps sliding the old way. That mismatch
  is the core skill.
- **Balance meter (mostly invisible).** Fills from `speed × turn-sharpness` and from
  heavy-oil patches. Thresholds: **Small Slip** (stumble, speed loss, camera dip) →
  **Medium Fall** (camera spin, forced slide, slow recover) → **Full Fall** (prone
  ~1.2s, helpless — usual way you get caught).

## Camera feel

Procedural + gsap: walk head-bob, heavier sprint bob + FOV kick, roll/tilt into turns,
screen shake as balance destabilizes, spin on medium falls, whip-to-floor on full fall.
First-person only (hands in V2).

## Opponent

Original stylized "oiled bruiser" — hulking primitive-built figure with a wet, rim-lit
glistening body shader. **Not** a likeness of the person in the reference image; the
image sets the *vibe* only. V1 AI:

- Chases with **intercept prediction** (aims ahead of player velocity).
- Also on the oil → overshoots on hard cuts. This makes jukes work + creates comedy.
- Slightly slower top speed than player sprint → escape always possible but pressured.
- Biases toward guarding the door lane. (Pattern-learning AI is V2.)

Catch = opponent capsule overlaps player → lose.

## Arena

One big stylized hall (~16m × 30m). Reflective wet-tile floor (drei
`MeshReflectorMaterial`), rows of stalls, sink+mirror wall, showers, clawfoot tubs
(reference nod), benches, lockers, counters. Glowing **EXIT** sign on the far wall
behind the opponent so the "it's right there" tension reads instantly. A handful of
collidable obstacles create juke geometry.

## Win / lose / score

- **Reach door** → escape flash, score tally, next round harder (opponent a hair
  faster, a bit more oil).
- **Caught** → slapstick prone + "GOTCHA" → instant retry (R), same round.
- **Score:** escape +1000, no-fall multiplier, fast-escape bonus, near-miss +100,
  perfect-juke +250. HUD tracks round, run timer, score, opponent-distance tension.

## Architecture

```
src/app/apps/slippery-escape/page.tsx     → route (server) → SlipperyClient
src/app/apps/slippery-escape/SlipperyClient.tsx → 'use client', dynamic ssr:false
src/components/slippery/
  SlipperyGame.tsx   → Canvas + HUD orchestration
  Arena.tsx          → bathroom environment (renders from arena data)
  Opponent.tsx       → AI character (visual; transform driven by sim ref)
  Simulation.tsx     → owns useFrame: input, movement step, AI step, camera, collisions
  HUD.tsx            → DOM overlays (menu / playing / won / lost)
src/lib/slippery/
  config.ts          → all tunables + round scaling + arena layout data
  movement.ts        → pure movement + balance + fall math (isolated, testable)
  ai.ts              → pure steering math (intercept + door-guard)
  store.ts           → zustand: phase, round, score, stats, attemptId, actions
  signals.ts         → module-level mutable per-frame HUD values (no re-render/frame)
src/shaders/oiledBody.ts → wet fresnel rim shader for the opponent
```

- Movement/AI math are pure functions in `lib` so feel is tunable in one place.
- Discrete state (menu/playing/won/lost, score) in zustand; per-frame HUD values pushed
  through `signals` and read via rAF to avoid per-frame React re-renders.
- Arena layout (bounds, obstacles, door, spawns, oil patches) is single-source data in
  `config.ts`, consumed by both `Arena` visuals and `Simulation` collision.
- Pointer-lock loss / tab blur auto-pause. Deltas clamped to dodge zero-delta NaN.

## Not in V1 (later)

Multiple hazard types, trip-able props, learning AI, hands/arms, sound, extra game
modes. V1 = the addictive core loop only.
