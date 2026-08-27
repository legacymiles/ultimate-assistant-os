"use client";
// Leader-line callouts. Each sits at its part's *exploded* anchor and fades in
// (with a small stagger) when its region is hovered or the part is isolated —
// the igloo.inc technical-annotation look, repurposed as name + spec.

import { Html } from "@react-three/drei";
import { PARTS, anchorOf } from "@/lib/kart/parts";
import { useKart } from "@/lib/kart/store";
import styles from "./kart.module.css";

export function Annotations() {
  const hoveredRegion = useKart((s) => s.hoveredRegion);
  const isolated = useKart((s) => s.isolated);

  // Which parts get a callout right now, in a stable order for staggering.
  const activeIds = PARTS.filter((p) =>
    isolated ? isolated === p.id : hoveredRegion === p.region,
  ).map((p) => p.id);

  return (
    <>
      {PARTS.map((p) => {
        const on = activeIds.includes(p.id);
        const order = activeIds.indexOf(p.id);
        return (
          <Html
            key={p.id}
            position={anchorOf(p)}
            center={false}
            occlude={false}
            pointerEvents="none"
            zIndexRange={[15, 0]}
            style={{ pointerEvents: "none" }}
          >
            <div
              className={styles.callout}
              data-on={on}
              style={{ transitionDelay: on ? `${order * 45}ms` : "0ms" }}
            >
              <span className={styles.node} />
              <span className={styles.cName}>{p.name}</span>
              <span className={styles.cSpec}>{p.spec}</span>
              {!isolated && <span className={styles.cHint}>click to isolate</span>}
            </div>
          </Html>
        );
      })}
    </>
  );
}
