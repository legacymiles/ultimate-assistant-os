"use client";

// A wait with a clock on it.
//
// The super agent's calls take real time — reading an idea, watching a
// recording, designing fourteen features — and the old answer was a word with
// three dots after it. That is the same lie the Build it button used to tell:
// the owner cannot tell a slow call from a stuck one, so they sit there
// wondering whether to press it again.
//
// So every long wait in App Builder says the same three things: what is
// happening, how long it has been, and that it gives up rather than hanging
// (every call in useAppBuilder aborts at 95 s). Checklist R5.

import { useEffect, useState } from "react";

/** The agent's calls abort here, so the wait has a known end. */
const LIMIT = 95;

export function Waiting({ what, since, note }: { what: string; since?: number; note?: string }) {
  const [start] = useState(() => since ?? Date.now());
  const [secs, setSecs] = useState(0);

  useEffect(() => {
    const tick = () => setSecs(Math.floor((Date.now() - start) / 1000));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [start]);

  const slow = secs >= 25;
  return (
    <p className="ab-waiting" role="status" aria-live="polite">
      <span className="ab-pulse" aria-hidden />
      <span className="ab-waiting-what">{what}</span>
      <span className="ab-waiting-clock">
        {secs}s<span aria-hidden> / {LIMIT}s</span>
      </span>
      <span className="ab-waiting-note">
        {note ?? (slow ? `Still going. It stops by itself at ${LIMIT}s rather than hanging — your work is saved either way.` : "Usually 10–30 seconds.")}
      </span>
    </p>
  );
}
