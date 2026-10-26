"use client";

// ---------------------------------------------------------------------------
// Moving between sections of a studio home from inside one of them.
//
// A section's component does not know which home it is mounted in, and should
// not have to. It asks; the home that is on screen answers by switching
// sections in place (no navigation, so nothing else on the page is thrown
// away). If no home answers — the section was opened on its own somewhere —
// the fallback address is followed instead, so the button still works.
// ---------------------------------------------------------------------------

export const GO_EVENT = "studio-home:go";

export interface GoDetail {
  section: string;
  /** Extra query parameters the next section reads on mount (e.g. `idea`). */
  params?: Record<string, string>;
}

export function goToSection(section: string, params: Record<string, string> = {}, fallbackHref?: string) {
  const ev = new CustomEvent<GoDetail>(GO_EVENT, { detail: { section, params }, cancelable: true });
  const handled = !window.dispatchEvent(ev);
  if (!handled && fallbackHref) window.location.assign(fallbackHref);
}
