"use client";

// ---------------------------------------------------------------------------
// V1 ⇄ V2, docked.
//
// Same convention as the hub carousel: `?v=2` selects the new surface and
// nothing about V1 changes. The toggle is rendered by both, in the same fixed
// place, so switching never moves the control that switched it — which is V1's
// own rule about the design-skill dropdown, kept here.
//
// A plain <a>, not a router push: the two surfaces are different enough that a
// full navigation is the honest thing, and it guarantees V2's canvas is torn
// down rather than left running behind V1.
// ---------------------------------------------------------------------------

export function VersionToggle({ current }: { current: 1 | 2 }) {
  return (
    <nav className="rdx-ver" aria-label="Redesigner version">
      <a
        href="/apps/website-redesigner"
        data-on={current === 1 ? "yes" : "no"}
        aria-current={current === 1 ? "page" : undefined}
      >
        V1
      </a>
      <a
        href="/apps/website-redesigner?v=2"
        data-on={current === 2 ? "yes" : "no"}
        aria-current={current === 2 ? "page" : undefined}
      >
        V2
      </a>
      <style>{`
        .rdx-ver {
          /* Bottom RIGHT, not centre: centred it sat squarely on top of V2's
             own primary action, and a version switch must never be the thing
             you hit when you meant to run a build. */
          position: fixed;
          right: 16px;
          bottom: 16px;
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
          padding: 7px 15px;
          color: #8a939e;
          text-decoration: none;
          transition: background 160ms, color 160ms;
        }
        .rdx-ver a:hover { color: #dfe5ec; }
        .rdx-ver a[data-on="yes"] {
          background: rgba(79, 216, 232, 0.14);
          color: #4fd8e8;
        }
      `}</style>
    </nav>
  );
}
