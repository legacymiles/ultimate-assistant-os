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
  /** The last "these are the photos still on my phone" report. */
  sweep?: { at: number; checked: number; removed: number } | null;
  /** The phone used an out-of-date link. */
  refusedAt: number | null;
  /** Which of the Shortcut's links was refused, when known. */
  refusedWhere?: string | null;
  /** The refused send the owner can take as their iPhone with one tap (its time), or null. */
  adoptable?: string | null;
}

export const NO_SIGNALS: PhoneSignals = { lastPush: null, lastCheckIn: null, problem: null, refusedAt: null };

/** The Shortcut's URL blocks, as the owner sees them. */
const WHERE: Record<string, string> = {
  bookmark: "the top URL block (above Find Photos)",
  photo: "the URL block inside the Repeat",
  "still-on-phone": "the last URL block (still on my phone)",
};

export interface PhoneLine {
  text: string;
  /** Something the owner needs to fix (shown as a warning). */
  warn: boolean;
}

/** A check-in this close to a send is the same run, not "found nothing". */
const SAME_RUN_MS = 5 * 60_000;

/**
 * A report of fewer than this many photos still on the phone is read as a
 * broken Shortcut rather than an empty camera roll.
 *
 * It is the same shape that emptied the queue once: Combine Text wired to one
 * photo instead of the list reports a single name, which taken literally
 * means every other photo was deleted. prune refuses it, and this is how the
 * owner finds out rather than seeing a cheerful line and no deletions.
 */
const THIN_REPORT = 3;

export interface SweepReport extends PhoneLine {
  at: number;
}

/**
 * The last "still on my phone" report as a line of its own.
 *
 * phoneLine can only ever be one string, and it is the widget's subtitle —
 * which a queue with photos in it replaces outright, so on the one account
 * that most needs this (photos always waiting) the report was never on
 * screen. Camera Autopilot gives this its own row instead, and unlike the
 * subtitle it is kept however old it is: `since` dates it, and "yesterday" is
 * the answer to "did my clean-up run?" just as much as "just now" is.
 */
export function sweepReport(s: PhoneSignals, since: (t: number) => string): SweepReport | null {
  const r = s.sweep;
  if (!r) return null;
  if (r.checked < THIN_REPORT) {
    const n = r.checked === 1 ? "1 photo" : `${r.checked} photos`;
    return {
      at: r.at,
      warn: true,
      text: `Your phone reported only ${n} still on it ${since(r.at)} — the clean-up's Combine Text isn't picking up the names, so nothing was deleted.`,
    };
  }
  return {
    at: r.at,
    warn: false,
    text: r.removed
      ? `Phone checked ${since(r.at)} · ${r.checked} photos still on it · ${r.removed} deleted here`
      : `Phone checked ${since(r.at)} · ${r.checked} photos still on it · nothing to delete`,
  };
}

export function phoneLine(s: PhoneSignals, since: (t: number) => string): PhoneLine {
  const push = s.lastPush ?? 0;
  const checkIn = s.lastCheckIn ?? 0;
  const problem = s.problem?.at ?? 0;
  const refused = s.refusedAt ?? 0;
  const newest = Math.max(push, checkIn, problem, refused);

  if (!newest) return { text: "iPhone hasn't sent a photo yet", warn: false };

  if (refused === newest) {
    const block = s.refusedWhere ? WHERE[s.refusedWhere] : undefined;
    return {
      text: block
        ? `your iPhone tried ${since(refused)} with an old link in ${block} — paste your link from 🔗 iPhone setup there`
        : `your iPhone tried ${since(refused)} with an old link — tap 🔗 iPhone setup, make a new link and paste it into every URL block in the Shortcut`,
      warn: true,
    };
  }
  if (problem === newest && s.problem) {
    return { text: `your iPhone tried ${since(problem)}: ${s.problem.message}`, warn: true };
  }
  // Only the report from the newest run is worth a line; an older one is
  // describing a camera roll that has moved on.
  const report = s.sweep && newest - s.sweep.at < SAME_RUN_MS ? s.sweep : null;
  if (report && report.checked < THIN_REPORT) {
    const n = report.checked === 1 ? "1 photo" : `${report.checked} photos`;
    return {
      text: `your iPhone reported only ${n} still on it ${since(report.at)} — the clean-up's Combine Text isn't picking up the names, so nothing was deleted`,
      warn: true,
    };
  }
  const tail = report
    ? report.removed
      ? ` · ${report.checked} still on the phone, ${report.removed} deleted here`
      : ` · ${report.checked} still on the phone, nothing to delete`
    : "";

  if (checkIn === newest && checkIn - push > SAME_RUN_MS) {
    const last = push ? ` (last photo ${since(push)})` : "";
    return {
      text: `your iPhone checked in ${since(checkIn)} but found no new photos to send${last}${tail}`,
      warn: !push,
    };
  }
  return { text: `last photo from iPhone ${since(push || checkIn)}${tail}`, warn: false };
}

/** The server's ISO strings → numbers, ignoring anything unreadable. */
export function readSignals(d: {
  lastPush?: string | null;
  lastCheckIn?: string | null;
  problem?: { at?: string; message?: string } | null;
  sweep?: { at?: string; checked?: number; removed?: number } | null;
  refusedAt?: string | null;
  refusedWhere?: string | null;
  adoptable?: string | null;
}): PhoneSignals {
  const t = (iso?: string | null) => {
    const n = iso ? Date.parse(iso) : NaN;
    return Number.isNaN(n) ? null : n;
  };
  const pAt = t(d.problem?.at);
  const sAt = t(d.sweep?.at);
  return {
    lastPush: t(d.lastPush),
    lastCheckIn: t(d.lastCheckIn),
    problem: pAt && d.problem?.message ? { at: pAt, message: d.problem.message } : null,
    sweep: sAt ? { at: sAt, checked: Number(d.sweep?.checked) || 0, removed: Number(d.sweep?.removed) || 0 } : null,
    refusedAt: t(d.refusedAt),
    refusedWhere: d.refusedWhere ?? null,
    adoptable: d.adoptable ?? null,
  };
}
