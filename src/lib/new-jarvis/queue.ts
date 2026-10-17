// ---------------------------------------------------------------------------
// In Queue — one ledger of every app, workflow and skill the owner has built,
// each with a state: finished, or started and unproven.
//
// The hard part is not the table, it is being honest about the state. There is
// no field anywhere in this repo that says "this is done", so the state has to
// be DERIVED from evidence that actually exists — a page on disk, a test file,
// rendered card art, a verification named in a SKILL.md — and the derivation
// has to show its working, because a board that silently guesses wrong is
// worse than no board. Every row carries the evidence it was judged on.
//
// And the owner always outranks it. One click on the pip is their verdict, it
// is stored, and the row says so. The guess is a starting position, never an
// argument.
// ---------------------------------------------------------------------------

/** `task` = a priority the owner pinned (see tasks.ts); it always sorts first. */
export type QueueKind = "task" | "app" | "workflow" | "skill";

/**
 * Green or amber. There is deliberately no third state: a thing is either
 * finished or it is in the queue, and "sort of" is what a queue is for.
 */
export type QueueState = "done" | "wip";

/** One checkable claim about an item, and whether it holds. */
export interface Evidence {
  label: string;
  met: boolean;
}

/**
 * Raw facts about one item, gathered where they can actually be seen — the
 * catalog and the workflow table are imported, the file-system ones come from
 * the queue route. Nothing here is a judgement.
 */
export interface QueueSignals {
  /** app: catalog says `coming-soon`. */
  comingSoon?: boolean;
  /** app: `src/app/apps/<slug>/page.tsx` exists. */
  hasPage?: boolean;
  /** app: how many `*.test.ts` files its lib folder holds. */
  testFiles?: number;
  /** app: how many `it(` / `test(` cases across them. */
  tests?: number;
  /** app: still on the hub rather than folded into Jarvis. */
  onHub?: boolean;

  /** workflow: a rendered card still or preview clip exists. */
  hasArt?: boolean;
  /** workflow: a director's brief was written for it. */
  hasBrief?: boolean;
  /** workflow: named in at least one Studio conversation on this device. */
  everUsed?: boolean;

  /** skill: lines in its SKILL.md. */
  bodyLines?: number;
  /** skill: files under `references/`. */
  references?: number;
  /** skill: mirrored into repo `skills/`, so it survives a deploy. */
  mirrored?: boolean;
  /**
   * skill: a verification named in the body — a gauntlet score, a round count,
   * a "verified against". The one signal that means it was actually RUN.
   */
  proof?: string;
  /** skill / app: unfinished markers found in the text. */
  flags?: string[];

  /** task: written off as finished in tasks.ts. */
  done?: boolean;
  /** task: 1 = top. */
  priority?: number;
}

export interface QueueFact {
  /**
   * `app:jarvis`, `flow:ugc-ad`, `skill:h3-prompt`. Stable, because it is the
   * key the owner's own verdict is filed under.
   */
  id: string;
  kind: QueueKind;
  name: string;
  blurb: string;
  /** Category for an app, medium for a workflow, origin for a skill. */
  group: string;
  /** Where to go to use it, when there is somewhere. */
  href?: string;
  signals: QueueSignals;
}

/**
 * What the owner has put on one row. The two halves are independent on
 * purpose: a note is a reminder of what is left, which is just as worth
 * keeping on a row whose state you are happy to let the evidence decide. They
 * used to be one field, and the result was that "go back to tracking the
 * evidence" could not be expressed without throwing the note away.
 */
export interface QueueVerdict {
  /** Absent = let the evidence decide. Present = the owner's verdict, which wins. */
  state?: QueueState;
  /** A line the owner typed about what is left to do. */
  note?: string;
  at: string;
}

export type QueueVerdicts = Record<string, QueueVerdict>;

export interface QueueRow extends QueueFact {
  state: QueueState;
  /** The state the evidence argues for, whatever the owner said. */
  derived: QueueState;
  /** True when `state` is the owner's click rather than the derivation. */
  byHand: boolean;
  /** One sentence: why this state. Reads as a reason, not a label. */
  why: string;
  evidence: Evidence[];
  note?: string;
}

export const QUEUE_STORE_KEY = "nj.queue.v1";

/** Words in a SKILL.md or an overview that mean "not finished". */
const UNFINISHED = [
  "todo",
  "tbd",
  "wip",
  "work in progress",
  "not yet tested",
  "untested",
  "unverified",
  "not verified",
  "needs testing",
  "experimental",
  "placeholder",
  "coming soon",
];

/**
 * Markers that mean a skill was actually RUN and the result judged — the only
 * honest evidence that a prompt-shaped artefact works, since a skill cannot
 * have a unit test. The matched phrase is kept so the row can quote it.
 *
 * Every pattern demands a MEASUREMENT, and that is the whole design. A skill
 * file is mostly instructions, and an instruction telling the reader to verify
 * something looks exactly like a record of someone having verified it: a first
 * pass on the owner's real skills read "verify with screenshots" and "Verified
 * on small phone, large phone and tablet" as proof, and marked a skill green
 * because it told you to do the thing it had never had done to it.
 *
 * Requiring a number next to the claim separates the two, because a record
 * carries a result and an instruction does not — "Verified against its model
 * API: 447 models" against "verified with screenshots". It costs some true
 * positives ("Verified by downloading four real reels" spells its number) and
 * that trade is deliberate: a missed one shows as amber, which the owner
 * corrects with a single click, while a false green is a lie the board tells
 * them and they have no reason to go and check.
 */
const PROOF = [
  // Past tense, and only past tense. A skill that TEACHES the gauntlet says
  // "gauntlet"; one that has been through it says "gauntleted".
  /\bgauntleted\b[^.\n]{0,60}/i,
  /\bfinal\s+(?:score\s+)?\d(?:\.\d)?(?:\s*\/\s*10)?/i,
  /\bscored\s+\d(?:\.\d)?\s*(?:\/|out of)\s*10\b/i,
  /\b\d+\s+rounds?\b[^.\n]{0,30}\b(?:critic|gauntlet|builder)\b/i,
  // `\b\d` and not `\b\d+\b`: a trailing boundary rules out a number welded to
  // its unit, and "VERIFIED on 24GB" is exactly the shape a real measurement
  // takes. The number itself may carry dots and commas — a version, a date, a
  // decimal — so it is consumed before the sentence-ending dot is honoured,
  // which is what stops "verified in 0.8s" being quoted back as "verified in
  // 0".
  /\bverified\b[^.\n]{0,60}?\b\d[\d.,:-]*[^.\n]{0,24}/i,
  /\bshipped\s+and\s+verified\b/i,
];

/** Any unfinished markers in a blob of text, de-duped. */
export function flagsIn(text: string): string[] {
  const hits = new Set<string>();
  for (const word of UNFINISHED) {
    // Word-ish boundaries, so "draftsman" is not a draft and "experimental
    // design" still is.
    const re = new RegExp(`(^|[^a-z])${word.replace(/ /g, "\\s+")}([^a-z]|$)`, "i");
    if (re.test(text)) hits.add(word);
  }
  return [...hits];
}

/** The verification a skill's own text claims, or undefined. */
export function proofIn(text: string): string | undefined {
  for (const re of PROOF) {
    const m = re.exec(text);
    if (m) return m[0].trim().replace(/\s+/g, " ").slice(0, 80);
  }
  return undefined;
}

/**
 * The evidence an item is judged on, in the order it should be read.
 *
 * Each kind gets its own list because the kinds are not comparable: an app can
 * have tests and a skill cannot, a workflow can have card art and an app has
 * no such thing. Pretending one checklist fits all three is how a board starts
 * lying.
 */
export function evidenceFor(fact: QueueFact): Evidence[] {
  const s = fact.signals;
  if (fact.kind === "task") return [{ label: "Done", met: s.done === true }];
  if (fact.kind === "app") {
    return [
      { label: "Has a page", met: s.hasPage === true },
      { label: "Shipped, not coming-soon", met: s.comingSoon !== true },
      { label: `Tested — ${s.tests ?? 0} cases`, met: (s.testFiles ?? 0) > 0 },
      { label: "No unfinished markers", met: (s.flags?.length ?? 0) === 0 },
    ];
  }
  if (fact.kind === "workflow") {
    return [
      { label: "Brief written", met: s.hasBrief === true },
      { label: "Card art rendered", met: s.hasArt === true },
      { label: "Run at least once", met: s.everUsed === true },
    ];
  }
  return [
    { label: `Written out — ${s.bodyLines ?? 0} lines`, met: (s.bodyLines ?? 0) >= 40 },
    { label: s.proof ? `Proven — ${s.proof}` : "Proven by a run", met: Boolean(s.proof) },
    { label: "Survives a deploy", met: s.mirrored === true },
    { label: "No unfinished markers", met: (s.flags?.length ?? 0) === 0 },
  ];
}

/**
 * The state the evidence argues for, and the sentence that says why.
 *
 * The rule per kind is the strictest claim that is still true:
 *
 *   app       — finished when it ships, has a page, and someone wrote a test.
 *               An app with no test is not finished; it is unverified, which
 *               is exactly the amber the owner asked for.
 *   workflow  — a brief alone is a sentence, not a workflow. It counts once
 *               something came OUT of it: rendered card art, or a real run.
 *   skill     — a skill has no tests to pass, so the only honest evidence is
 *               that it was run and judged. Written-out-and-never-run is the
 *               h3 case the owner named by name, and it is amber.
 */
export function deriveState(fact: QueueFact): { state: QueueState; why: string } {
  const s = fact.signals;

  if (fact.kind === "task") {
    return s.done
      ? { state: "done", why: "Marked done." }
      : { state: "wip", why: "You pinned this to the top — it stays here until it's done." };
  }

  if (fact.kind === "app") {
    if (s.comingSoon) return { state: "wip", why: "The catalog still lists it as coming soon." };
    if (s.hasPage === false) return { state: "wip", why: "No page on disk — the route would 404." };
    if ((s.testFiles ?? 0) === 0)
      return { state: "wip", why: "It runs, but nothing tests it, so nothing has verified it." };
    if ((s.flags?.length ?? 0) > 0)
      return { state: "wip", why: `Its own description still says "${s.flags![0]}".` };
    return { state: "done", why: `Shipped, with ${s.tests ?? 0} test cases behind it.` };
  }

  if (fact.kind === "workflow") {
    if (s.hasBrief !== true)
      return { state: "wip", why: "No brief — there is nothing for it to follow." };
    if (s.everUsed) return { state: "done", why: "You have actually run this one." };
    if (s.hasArt)
      return { state: "done", why: "Its card art is rendered, so it has been through the pipeline." };
    return { state: "wip", why: "Brief written, never run and no card art — untried." };
  }

  if ((s.bodyLines ?? 0) < 40)
    return { state: "wip", why: `Only ${s.bodyLines ?? 0} lines written — a stub.` };
  if ((s.flags?.length ?? 0) > 0)
    return { state: "wip", why: `Its own text still says "${s.flags![0]}".` };
  if (!s.proof)
    return { state: "wip", why: "Written, but nothing in it records a run that was judged." };
  if (s.mirrored !== true)
    return { state: "wip", why: "Not committed to repo skills/, so the deployed hub cannot see it." };
  return { state: "done", why: `Proven — ${s.proof}.` };
}

/** Facts + the owner's verdicts → the rows the board renders. */
export function toRows(facts: QueueFact[], verdicts: QueueVerdicts): QueueRow[] {
  return facts.map((fact) => {
    const { state: derived, why } = deriveState(fact);
    const own = verdicts[fact.id];
    const held = own?.state;
    const lower = why.replace(/^./, (c) => c.toLowerCase());
    return {
      ...fact,
      derived,
      state: held ?? derived,
      byHand: held !== undefined,
      why: held === undefined
        ? why
        : held === derived
          ? `You confirmed this. ${why}`
          : `You called it ${held === "done" ? "finished" : "unfinished"} — the evidence says ${lower}`,
      evidence: evidenceFor(fact),
      note: own?.note,
    };
  });
}

export interface QueueFilter {
  /** Free text over name, blurb and group. */
  q: string;
  kinds: QueueKind[];
  /** Empty = both. */
  states: QueueState[];
  /** Only rows the owner has never ruled on. */
  unjudged?: boolean;
}

export const EMPTY_FILTER: QueueFilter = { q: "", kinds: [], states: [] };

/**
 * Case- and punctuation-insensitive, so "gods eye" finds "God's Eye View".
 *
 * Apostrophes are DELETED rather than turned into a space, because a
 * possessive is one word: collapsing them with the rest of the punctuation
 * made "God's" into "god s", and nobody types it that way.
 */
function norm(s: string): string {
  return s.toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

export function filterQueue(rows: QueueRow[], f: QueueFilter): QueueRow[] {
  const terms = norm(f.q).split(" ").filter(Boolean);
  return rows.filter((r) => {
    if (f.kinds.length && !f.kinds.includes(r.kind)) return false;
    if (f.states.length && !f.states.includes(r.state)) return false;
    if (f.unjudged && r.byHand) return false;
    if (!terms.length) return true;
    // Every term must appear somewhere — an AND search, because on a board of
    // 250 rows an OR search is the same as no search at all.
    const hay = norm(`${r.name} ${r.blurb} ${r.group} ${r.id}`);
    return terms.every((t) => hay.includes(t));
  });
}

/**
 * Amber first, then by kind, then by name.
 *
 * The queue is the point of the board, so the thing you have not finished is
 * never below the fold. Within a state, grouping by kind keeps nine apps from
 * being buried under a hundred and fifty workflows.
 */
const KIND_ORDER: QueueKind[] = ["task", "app", "skill", "workflow"];

export function sortQueue(rows: QueueRow[]): QueueRow[] {
  return [...rows].sort((a, b) => {
    if (a.state !== b.state) return a.state === "wip" ? -1 : 1;
    const k = KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind);
    if (k !== 0) return k;
    if (a.kind === "task") return (a.signals.priority ?? 99) - (b.signals.priority ?? 99);
    return a.name.localeCompare(b.name);
  });
}

export interface QueueCounts {
  total: number;
  done: number;
  wip: number;
  byKind: Record<QueueKind, { total: number; done: number; wip: number }>;
}

export function countQueue(rows: QueueRow[]): QueueCounts {
  const blank = () => ({ total: 0, done: 0, wip: 0 });
  const counts: QueueCounts = {
    total: rows.length,
    done: 0,
    wip: 0,
    byKind: { task: blank(), app: blank(), workflow: blank(), skill: blank() },
  };
  for (const r of rows) {
    const k = counts.byKind[r.kind];
    k.total += 1;
    if (r.state === "done") {
      counts.done += 1;
      k.done += 1;
    } else {
      counts.wip += 1;
      k.wip += 1;
    }
  }
  return counts;
}

/** Drop the entry entirely when it would hold neither a state nor a note. */
function prune(verdicts: QueueVerdicts, id: string): QueueVerdicts {
  const v = verdicts[id];
  if (v && v.state === undefined && !v.note) {
    const next = { ...verdicts };
    delete next[id];
    return next;
  }
  return verdicts;
}

/**
 * The owner's click, from either of the two controls that make one.
 *
 * The PIP always sends the opposite state, so it reads as a plain toggle:
 * finished becomes unfinished and back, and both are held by hand. That is the
 * common action and it stays one click.
 *
 * "Back to the evidence", in the opened row, sends the state the row is
 * ALREADY holding — and that is what this function treats as a release, which
 * drops the override so the row starts tracking the derivation again. Keeping
 * the release off the pip is deliberate: a three-step cycle on the one control
 * people click sixty times would make the common action ambiguous, and the
 * release belongs next to the evidence it hands the row back to.
 *
 * A note survives all of it, because what is left to do on a row does not stop
 * being true when you stop arguing about its colour.
 */
export function rule(
  verdicts: QueueVerdicts,
  row: QueueRow,
  state: QueueState,
  now = new Date().toISOString(),
): QueueVerdicts {
  const note = verdicts[row.id]?.note;
  const release = row.byHand && row.state === state;
  const next = { ...verdicts, [row.id]: { state: release ? undefined : state, note, at: now } };
  return prune(next, row.id);
}

/** Change the note; the state override, present or not, is untouched. */
export function annotate(
  verdicts: QueueVerdicts,
  row: QueueRow,
  note: string,
  now = new Date().toISOString(),
): QueueVerdicts {
  const text = note.trim();
  const next = {
    ...verdicts,
    [row.id]: { state: verdicts[row.id]?.state, note: text || undefined, at: now },
  };
  return prune(next, row.id);
}

export const KIND_LABEL: Record<QueueKind, string> = {
  task: "Priorities",
  app: "Apps",
  workflow: "Workflows",
  skill: "Skills",
};
