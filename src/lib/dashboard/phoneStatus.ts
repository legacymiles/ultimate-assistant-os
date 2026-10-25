// ---------------------------------------------------------------------------
// What the iPhone has been doing, in one line Camera Autopilot can show.
//
// "iPhone hasn't sent a photo yet" used to be the only thing Jarvis could say,
// whatever was actually wrong: an old link (every send refused), a Shortcut
// that runs but finds no new photos, a Shortcut that sends something that
// isn't a photo, or a Shortcut that never runs at all. Each of those needs a
// different fix, so the server now remembers each kind of contact and the
// newest one decides the line. Pure, so the rules are tested.
// ---------------------------------------------------------------------------

export interface PhoneSignals {
  /** The phone last sent photos (accepted or already-seen). */
  lastPush: number | null;
  /** The Shortcut last asked where to start (the bookmark) or reported its photos. */
  lastCheckIn: number | null;
  /** A send this account's phone made that was turned away, and why. */
  problem: { at: number; message: string } | null;
  /** The phone used an out-of-date link. */
  refusedAt: number | null;
}

export const NO_SIGNALS: PhoneSignals = { lastPush: null, lastCheckIn: null, problem: null, refusedAt: null };

export interface PhoneLine {
  text: string;
  /** Something the owner needs to fix (shown as a warning). */
  warn: boolean;
}

/** A check-in this close to a send is the same run, not "found nothing". */
const SAME_RUN_MS = 5 * 60_000;

export function phoneLine(s: PhoneSignals, since: (t: number) => string): PhoneLine {
  const push = s.lastPush ?? 0;
  const checkIn = s.lastCheckIn ?? 0;
  const problem = s.problem?.at ?? 0;
  const refused = s.refusedAt ?? 0;
  const newest = Math.max(push, checkIn, problem, refused);

  if (!newest) return { text: "iPhone hasn't sent a photo yet", warn: false };

  if (refused === newest) {
    return {
      text: `your iPhone tried ${since(refused)} with an old link — tap 🔗 iPhone setup, make a new link and paste it into every URL block in the Shortcut`,
      warn: true,
    };
  }
  if (problem === newest && s.problem) {
    return { text: `your iPhone tried ${since(problem)}: ${s.problem.message}`, warn: true };
  }
  if (checkIn === newest && checkIn - push > SAME_RUN_MS) {
    const last = push ? ` (last photo ${since(push)})` : "";
    return {
      text: `your iPhone checked in ${since(checkIn)} but found no new photos to send${last}`,
      warn: !push,
    };
  }
  return { text: `last photo from iPhone ${since(push || checkIn)}`, warn: false };
}

/** The server's ISO strings → numbers, ignoring anything unreadable. */
export function readSignals(d: {
  lastPush?: string | null;
  lastCheckIn?: string | null;
  problem?: { at?: string; message?: string } | null;
  refusedAt?: string | null;
}): PhoneSignals {
  const t = (iso?: string | null) => {
    const n = iso ? Date.parse(iso) : NaN;
    return Number.isNaN(n) ? null : n;
  };
  const pAt = t(d.problem?.at);
  return {
    lastPush: t(d.lastPush),
    lastCheckIn: t(d.lastCheckIn),
    problem: pAt && d.problem?.message ? { at: pAt, message: d.problem.message } : null,
    refusedAt: t(d.refusedAt),
  };
}
