# Scroll → Immersion Transition

The payoff. Scrolling reassembles the exploded object, then flies the camera
*into* it and hands off to a first-person "immersive" mode. Scrolling back up
reverses the whole thing. Scroll is the gear-shift between two worlds.

## The mental model: one scroll timeline, phased

Map a tall scroll container (≈300vh) to a normalized progress `p` in `[0, 1]`
and split it into phases so the two modes never both fight for the camera:

| p range   | phase        | what happens                                                        |
|-----------|--------------|---------------------------------------------------------------------|
| 0.00–0.15 | settle       | any exploded region snaps home; auto-orbit eases to a fixed heading |
| 0.15–0.45 | dive         | camera dollies from orbit distance *into* the driver's-eye point    |
| 0.45–0.55 | handoff      | showcase canvas fades out, immersive canvas fades in (crossfade)    |
| 0.55–1.00 | ride         | first-person: track scrolls by, speed/gear climb, camera leans      |

Reverse is automatic because everything is a pure function of `p`.

## Wiring Lenis + ScrollTrigger

```tsx
// components/SmoothScrollProvider.tsx
'use client';
import { useEffect } from 'react';
import Lenis from 'lenis';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
gsap.registerPlugin(ScrollTrigger);

export function SmoothScrollProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return; // native scroll
    const lenis = new Lenis({ duration: 1.1, smoothWheel: true });
    lenis.on('scroll', ScrollTrigger.update);
    const raf = (t: number) => { lenis.raf(t * 1000); };
    gsap.ticker.add(raf); gsap.ticker.lagSmoothing(0);
    return () => { gsap.ticker.remove(raf); lenis.destroy(); };
  }, []);
  return <>{children}</>;
}
```

Publish `p` to the same store the scenes read (keep it out of React state — write
to a ref/zustand setter to avoid re-rendering the tree every scroll frame):

```tsx
// somewhere client-side, once
useEffect(() => {
  const st = ScrollTrigger.create({
    trigger: '#showcase-scroll', start: 'top top', end: 'bottom bottom', scrub: true,
    onUpdate: (self) => useScene.getState().setProgress(self.progress),
  });
  return () => st.kill();
}, []);
```

## Camera handoff

The `CameraRig` from `stage-and-orbit.md` takes `enabled`. Flip it off once
`p > 0.15` and drive the camera from `p` instead:

```tsx
useFrame(({ camera }) => {
  const p = useScene.getState().progress;
  if (p <= 0.15) return;                       // rig still owns it
  const dive = THREE.MathUtils.clamp((p - 0.15) / 0.30, 0, 1);
  const eased = easeInOutCubic(dive);
  // from orbit start -> driver's eye (tune to your model's cockpit)
  camera.position.lerpVectors(ORBIT_POS, DRIVER_EYE, eased);
  camera.quaternion.slerpQuaternions(ORBIT_QUAT, DRIVER_QUAT, eased);
});
```

## Crossfade the two canvases

Run **two** stacked full-screen layers: the showcase `<Stage>` and the immersive
scene. Cross-fade opacity around `p≈0.5` and toggle `pointer-events`. Only one
renders heavily at a time — set the hidden one's `frameloop="never"` (or unmount
it just past the handoff) so you're never paying for both at 60fps.

## Immersive first-person mode (scroll-driven ride)

Not a playable game — a cinematic ride whose *speed is scroll velocity*. Cheap
and convincing:

- **Endless track:** a few long road/segment meshes recycled forward (move each
  back to the front once it passes the camera), or scroll a UV offset on a long
  ground plane. Add side barriers/pillars flying past for speed reference.
- **Speed lines:** an instanced set of thin streaks, or a fullscreen radial-blur
  shader whose strength = current speed. Streaks stretch along Z with speed.
- **Motion blur / heat:** `@react-three/postprocessing` `MotionBlur`, or fake it
  with a slight afterimage + chromatic aberration that ramps with speed.
- **Camera lean:** bank/roll the camera into gentle turns keyed off a noise
  function of `p`, and add a subtle handheld shake that grows with speed.
- **Live HUD:** speed and gear derived from scroll velocity — see below.

```tsx
// speed from scroll velocity, smoothed
const speed = useRef(0);
useFrame((_, dt) => {
  const v = Math.abs(useScene.getState().velocity);      // set from lenis 'scroll' event
  speed.current = THREE.MathUtils.damp(speed.current, v * K, 3, dt);
  useScene.getState().setKph(Math.round(speed.current));
});
```

```tsx
// components/hud/SpeedHUD.tsx — monospace, big numerals, only visible in ride phase
export function SpeedHUD({ kph, gear, visible }: { kph: number; gear: number; visible: boolean }) {
  return (
    <div className="speedhud" data-visible={visible}>
      <div className="speedhud__kph"><b>{kph}</b><small>KM/H</small></div>
      <div className="speedhud__gear">GEAR <b>{gear}</b></div>
    </div>
  );
}
```

## Reduced motion

Disable Lenis (native scroll), skip the camera dive, and present the two modes as
**two plain stacked sections**: the static exploded object (fully labeled) then a
static hero shot / short looping clip of the first-person view with the HUD
readable. No fly-in, no speed ramp. The story survives with the motion switched
off — that's the bar.
