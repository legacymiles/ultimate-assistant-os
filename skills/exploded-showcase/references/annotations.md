# Annotations & HUD

Two layers of overlay: **leader-line callouts** that pin to 3D points and reveal
part name + spec, and the **corner HUD** chrome. Both are HTML over the canvas —
crisp text beats texture-baked labels and stays accessible/selectable.

## Leader-line callouts

Two viable approaches:

### A. Drei `<Html>` (simplest, good default)

Anchor an HTML label to a 3D point; Drei projects it for you. Add the thin
leader line as a CSS pseudo-element or a small inline SVG.

```tsx
// components/three/Annotation.tsx
'use client';
import { Html } from '@react-three/drei';
import type { PartDef } from '@/lib/parts';

export function Annotation({ def, home, visible }: {
  def: PartDef; home: [number, number, number]; visible: boolean;
}) {
  const anchor: [number, number, number] = [
    home[0] + (def.anchor?.[0] ?? def.explode[0]),
    home[1] + (def.anchor?.[1] ?? def.explode[1]),
    home[2] + (def.anchor?.[2] ?? def.explode[2]),
  ];
  return (
    <Html position={anchor} center distanceFactor={8} zIndexRange={[20, 0]} pointerEvents="none">
      <div data-visible={visible} className="callout">
        <span className="callout__node" />
        <div className="callout__body">
          <span className="callout__name">{def.name}</span>
          <span className="callout__spec">{def.spec}</span>
        </div>
      </div>
    </Html>
  );
}
```

```css
/* the "+" node, the line, and the label — igloo.inc's technical look */
.callout { position: relative; opacity: 0; transform: translateY(6px);
  transition: opacity .35s ease, transform .35s cubic-bezier(.2,.8,.2,1);
  pointer-events: none; white-space: nowrap; }
.callout[data-visible='true'] { opacity: 1; transform: none; }
.callout__node { position: absolute; left: -14px; top: 50%; width: 6px; height: 6px;
  margin-top: -3px; border: 1px solid #cfe8ff; border-radius: 50%;
  box-shadow: 0 0 8px #5ec8ff; }
.callout__node::before { content: ''; position: absolute; left: 6px; top: 50%;
  width: 14px; height: 1px; background: linear-gradient(90deg,#5ec8ff,transparent); }
.callout__name { display: block; font: 600 13px/1.1 'Geist', sans-serif;
  letter-spacing: .04em; color: #fff; text-transform: uppercase; }
.callout__spec { display: block; margin-top: 2px; font: 400 11px/1.3 'Geist Mono', monospace;
  color: #9fb4c7; }
```

Reveal the callouts for the hovered region with a **stagger** (each ~40ms after
the last) so they cascade rather than pop all at once. Drive `visible` from the
same `hoveredRegion`/`isolated` state the parts use.

### B. Manual projection (max control over the line)

If you want leader lines that visibly bend/route (true igloo.inc feel), skip
`<Html>` auto-projection and project the 3D anchor yourself each frame into a
full-screen SVG overlay. Keep a ref list of anchors; in a `useFrame` outside the
canvas won't work, so do it inside a small bridge component:

```tsx
// inside the Canvas: publish screen positions to a store each frame
useFrame(({ camera, size }) => {
  const v = anchorWorld.clone().project(camera);         // NDC -1..1
  const x = (v.x * 0.5 + 0.5) * size.width;
  const y = (-v.y * 0.5 + 0.5) * size.height;
  setScreenPos(def.id, { x, y, behind: v.z > 1 });        // behind = cull
});
```

Then draw `<svg>` leader lines + `<div>` labels in a sibling DOM layer using
those coordinates. More work, but you can route the line (elbow: anchor → out →
along → label) for the real technical-drawing look, and fade labels whose anchor
faces away from camera (`behind`).

**Default to A** unless the user specifically wants routed/animated lines.

## Corner HUD

Never a normal nav. Anchor blocks to the four corners, uppercase monospace, low
opacity, with a hairline. This *is* the brand chrome.

```tsx
// components/hud/CornerHUD.tsx
export function CornerHUD({ title, manifesto, hint }: {
  title: string; manifesto: string; hint: string;
}) {
  return (
    <div className="hud" aria-hidden={false}>
      <div className="hud__tl">
        <h1 className="hud__mark">{title}</h1>
        <p className="hud__fine">// Copyright © {new Date().getFullYear()}</p>
      </div>
      <p className="hud__tr">{manifesto}</p>
      <div className="hud__bl">
        <p className="hud__hint">{hint}</p>
        <button className="hud__sound" aria-label="Toggle sound">◁× Sound: Off</button>
      </div>
    </div>
  );
}
```

```css
.hud { position: fixed; inset: 0; pointer-events: none; z-index: 30;
  font-family: 'Geist Mono', monospace; text-transform: uppercase;
  color: #cfe0ee; mix-blend-mode: difference; }         /* difference = readable over anything */
.hud > * { position: absolute; }
.hud__tl { top: 28px; left: 32px; }
.hud__mark { font: 700 34px/1 'Geist', sans-serif; letter-spacing: -.02em; }
.hud__fine { margin-top: 8px; font-size: 11px; opacity: .6; }
.hud__tr { top: 28px; right: 32px; max-width: 220px; text-align: right; font-size: 11px; line-height: 1.5; opacity: .75; }
.hud__bl { bottom: 28px; left: 32px; display: grid; gap: 10px; }
.hud__hint { font-size: 11px; opacity: .7; }
.hud__sound { pointer-events: auto; background: none; border: 0; color: inherit;
  font: inherit; text-transform: inherit; cursor: pointer; opacity: .7; }
```

`mix-blend-mode: difference` keeps the HUD legible whether it's over a bright
part or the dark stage — it's the trick that makes the chrome feel painted onto
the glass. Give the scroll hint a slow 2px vertical bob to invite the scroll.

## Accessibility

The callouts and HUD are real DOM — good. Ensure each part is also reachable by
keyboard (a visually-hidden button list that sets `hoveredRegion`/`isolated` on
focus), labels meet contrast, and with reduced motion the callouts appear with
opacity only (no travel/stagger).
