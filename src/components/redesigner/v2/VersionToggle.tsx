"use client";

// ---------------------------------------------------------------------------
// V1 ⇄ V2 ⇄ Showcase, docked.
//
// Same convention as the hub carousel: `?v=2` selects the new surface and
// nothing about V1 changes; `?v=showcase` is the shelf of app ideas. The toggle
// is rendered by every view, in the same fixed place, so switching never moves
// the control that switched it — which is V1's own rule about the design-skill
// dropdown, kept here.
//
// A plain <a>, not a router push: the surfaces are different enough that a
// full navigation is the honest thing, and it guarantees V2's canvas is torn
// down rather than left running behind V1.
// ---------------------------------------------------------------------------

export type RedesignerView = 1 | 2 | "showcase";

/** Website Redesigner lives inside App Builder now; this is its address there. */
export const REDESIGNER_BASE = "/apps/app-builder?section=redesign";

export function redesignerHref(v: RedesignerView, base = REDESIGNER_BASE): string {
  if (v === 1) return base;
  return `${base}${base.includes("?") ? "&" : "?"}v=${v}`;
}

export function VersionToggle({ current, base = REDESIGNER_BASE }: { current: RedesignerView; base?: string }) {
  const items: { v: RedesignerView; label: string }[] = [
    { v: 1, label: "V1" },
    { v: 2, label: "V2" },
    { v: "showcase", label: "Showcase" },
  ];
  return (
    <nav className="rdx-ver" aria-label="Redesigner view">
      {items.map((it) => (
        <a
          key={String(it.v)}
          href={redesignerHref(it.v, base)}
          data-on={current === it.v ? "yes" : "no"}
          aria-current={current === it.v ? "page" : undefined}
        >
          {it.label}
        </a>
      ))}
      <style>{`
        .rdx-ver {
          /* Bottom RIGHT, not centre: centred it sat squarely on top of V2's
             own primary action, and a version switch must never be the thing
             you hit when you meant to run a build. */
          position: fixed;
          right: 16px;
          bottom: max(16px, env(safe-area-inset-bottom));
          z-index: 40;
          display: flex;
          border: 1px solid rgba(138, 147, 158, 0.28);
          border-radius: 2px;
          background: rgba(8, 11, 14, 0.92);
          backdrop-filter: blur(6px);
          overflow: hidden;
          font-family: var(--font-rdx-mono), ui-monospace, Menlo, monospace;
          font-size: 11px;
          letter-spacing: 0.16em;
        }
        .rdx-ver a {
          padding: 9px 13px;
          color: #8a939e;
          text-decoration: none;
          transition: background 160ms, color 160ms;
        }
        .rdx-ver a:hover { color: #dfe5ec; }
        .rdx-ver a[data-on="yes"] {
          background: rgba(79, 216, 232, 0.14);
          color: #4fd8e8;
        }
        @media (prefers-reduced-motion: reduce) {
          .rdx-ver a { transition: none; }
        }
      `}</style>
    </nav>
  );
}
