// ---------------------------------------------------------------------------
// Jarvis auditing itself.
//
// The owner asked for a system that comes up with its own ideas about how to
// improve itself, and named the kinds of idea they meant: fewer side tabs and
// a more minimal UI, security concerns, organisational changes, and new
// capabilities worth having. Those are the auditor families below.
//
// Two rules shape the whole module.
//
//   1. PROPOSE ONLY. Nothing here applies anything. Approving a proposal
//      writes a spec for a build session to pick up; it never edits config,
//      data or UI. That was the owner's explicit choice, and it is why this
//      file has no side effects at all.
//
//   2. EVIDENCE OR SILENCE. Every proposal carries the concrete facts that
//      produced it. An auditor that cannot name what it saw does not file
//      anything — a panel of plausible-sounding generic advice is worse than
//      an empty one, because it trains the owner to stop reading it.
//
// Ids are deterministic, exactly as `updates.ts` makes them, so dismissing a
// proposal dismisses it for good rather than until the next recount.
// ---------------------------------------------------------------------------

export type ProposalKind =
  /** Information architecture: too many tabs, a surface nobody opens, two places showing one thing. */
  | "ia"
  /** A way the system is less safe than the owner would assume. */
  | "security"
  /** The owner's own data drifting: orphans, duplicates, things referred to and never written. */
  | "hygiene"
  /** Something the system cannot do, or tried and failed to do. */
  | "capability";

export type Risk = "none" | "low" | "medium" | "high";

export type Effort = "minutes" | "hours" | "a session";

export interface Proposal {
  /** Deterministic, so a dismissal sticks. */
  id: string;
  kind: ProposalKind;
  title: string;
  /** Why this is worth doing, in the owner's terms rather than the system's. */
  why: string;
  /** What would actually change. Concrete enough to become a spec. */
  how: string;
  risk: Risk;
  effort: Effort;
  /** The facts behind it. Never empty — an auditor with nothing to point at files nothing. */
  evidence: string[];
}

export interface ImproveState {
  /** Ids the owner said no to. Never raised again. */
  dismissed: string[];
  /** Id → ISO date it may come back. */
  snoozed: Record<string, string>;
  /** Ids the owner approved, so the panel can show what is in flight. */
  approved: string[];
}

export function emptyImproveState(): ImproveState {
  return { dismissed: [], snoozed: {}, approved: [] };
}

const REMEMBER = 300;

function tail(list: string[]): string[] {
  return list.length > REMEMBER ? list.slice(list.length - REMEMBER) : list;
}

/** Repair a half-written or older blob rather than throwing. */
export function coerceImproveState(raw: unknown): ImproveState {
  const r = (raw ?? {}) as Partial<ImproveState>;
  const snoozed: Record<string, string> = {};
  if (r.snoozed && typeof r.snoozed === "object") {
    for (const [id, until] of Object.entries(r.snoozed)) {
      if (typeof id === "string" && typeof until === "string" && !Number.isNaN(Date.parse(until))) snoozed[id] = until;
    }
  }
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  return { dismissed: tail(strings(r.dismissed)), snoozed, approved: tail(strings(r.approved)) };
}

// --- what the auditors are shown -------------------------------------------

/**
 * Everything the auditors read, as plain data.
 *
 * Deliberately a flat shape rather than the live stores: the auditors stay
 * pure and testable, and assembling this is the hook's job. It also means an
 * auditor cannot quietly start depending on something it was not given.
 */
export interface AuditInput {
  now: number;
  /** One per rail entry, with how long since it was last opened on this device. */
  rail: RailUse[];
  vault: VaultFacts | null;
  memories: MemoryFacts;
  security: SecurityFacts;
  /** Tools the agent called that failed, per tool. */
  toolFailures: ToolFailure[];
  /** Keys that are not set, and what degrades without them. */
  missingKeys: { name: string; feature: string }[];
}

export interface RailUse {
  id: string;
  label: string;
  /** ISO, or null when it has never been opened on this device. */
  lastOpenedAt: string | null;
  /** How many things are in it, where that is knowable. null when it is not. */
  itemCount: number | null;
}

export interface VaultFacts {
  notes: number;
  /** Linked to repeatedly and never written. */
  owed: { title: string; referrers: number }[];
  /** Real notes nothing links to and which link to nothing. */
  orphans: string[];
  /** Links that matched more than one note, so one was picked. */
  ambiguous: { target: string; chose: string; among: string[] }[];
  /** Captured away from the PC and not yet on disk. */
  pending: number;
}

export interface MemoryFacts {
  total: number;
  /** Rows with no tags at all — unsearchable except by words that happen to be in them. */
  untagged: number;
  bySource: Record<string, number>;
  /** Memory proposals the owner has neither accepted nor rejected. */
  undecided: number;
}

export interface SecurityFacts {
  /** Saved logins stored in the clear, synced to the owner's own Supabase row. */
  plaintextCredentials: number;
  /** App routes holding the owner's data with no password gate. */
  ungatedRoutes: string[];
  bridgePaired: boolean;
  /** How old the local agent's token is, in days. null when there is no token. */
  bridgeTokenAgeDays: number | null;
  /** Share links that are reachable by anyone holding the URL. */
  publicShareLinks: number;
}

export interface ToolFailure {
  tool: string;
  failures: number;
  lastError: string;
}

/** A rail entry unopened for this long is a candidate for folding away. */
export const STALE_TAB_DAYS = 21;

/** A token older than this is worth rotating. */
export const STALE_TOKEN_DAYS = 90;

function daysSince(iso: string | null, now: number): number | null {
  if (!iso) return null;
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return null;
  return Math.max(0, (now - at) / 86_400_000);
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

// --- the auditors ----------------------------------------------------------

/**
 * Fewer side tabs, which is the change the owner asked for by name.
 *
 * Two findings, and they are different: a tab nobody opens should be folded
 * into the Toolbox, while a tab that is open but EMPTY is a promise the system
 * is not keeping and should either be filled or removed.
 */
export function auditRail(input: AuditInput): Proposal[] {
  const out: Proposal[] = [];

  const stale = input.rail.filter((t) => {
    const age = daysSince(t.lastOpenedAt, input.now);
    return age !== null && age >= STALE_TAB_DAYS;
  });
  // Never opened at all is reported separately from "not lately": one is a
  // habit, the other may be a surface the owner does not know exists.
  const never = input.rail.filter((t) => t.lastOpenedAt === null);

  if (stale.length) {
    out.push({
      id: `ia:stale-tabs:${stale.map((t) => t.id).sort().join(",")}`,
      kind: "ia",
      title: `Fold ${plural(stale.length, "unused tab")} into the Toolbox`,
      why:
        "Every rail entry costs attention whether or not it is used. These have not been opened in three weeks, " +
        "so they are paying rent on the one surface you look at most.",
      how: `Move ${stale.map((t) => t.label).join(", ")} into the Toolbox group, reachable but not in the way.`,
      risk: "none",
      effort: "minutes",
      evidence: stale.map((t) => {
        const age = daysSince(t.lastOpenedAt, input.now);
        return `${t.label}: last opened ${Math.round(age ?? 0)} days ago`;
      }),
    });
  }

  if (never.length >= 3) {
    out.push({
      id: `ia:never-opened:${never.map((t) => t.id).sort().join(",")}`,
      kind: "ia",
      title: `${never.length} tabs have never been opened on this device`,
      why:
        "Either they do something you do not need, or they do something you do not know they do. " +
        "Both are worth settling, and the answer is different for each.",
      how: "Go through them once. Keep what earns its place, fold the rest away.",
      risk: "none",
      effort: "minutes",
      evidence: never.map((t) => `${t.label}: never opened here`),
    });
  }

  const emptyTabs = input.rail.filter((t) => t.itemCount === 0);
  if (emptyTabs.length) {
    out.push({
      id: `ia:empty-tabs:${emptyTabs.map((t) => t.id).sort().join(",")}`,
      kind: "ia",
      title: `${plural(emptyTabs.length, "tab")} with nothing in ${emptyTabs.length === 1 ? "it" : "them"}`,
      why: "An empty surface reads as something broken rather than something unused, every time you pass it.",
      how: `Either seed ${emptyTabs.map((t) => t.label).join(", ")} with something real, or hide ${
        emptyTabs.length === 1 ? "it" : "them"
      } until there is something to show.`,
      risk: "none",
      effort: "minutes",
      evidence: emptyTabs.map((t) => `${t.label}: 0 items`),
    });
  }

  return out;
}

/**
 * Ways the system is less safe than the owner would assume.
 *
 * Note what this auditor does NOT do: it does not call plaintext credentials a
 * bug. Storing them readable was a deliberate, recorded decision — losing a
 * master password used to lose every login. It reports the exposure and names
 * the trade, so the owner decides again with the facts in front of them.
 */
export function auditSecurity(input: AuditInput): Proposal[] {
  const out: Proposal[] = [];
  const s = input.security;

  if (s.ungatedRoutes.length) {
    out.push({
      id: `security:ungated:${[...s.ungatedRoutes].sort().join(",")}`,
      kind: "security",
      title: `${plural(s.ungatedRoutes.length, "app route")} holding your data has no password gate`,
      why:
        "Setting the app password does not lock these, which is exactly the kind of gap you would never " +
        "find by using the app — it looks protected because its neighbour is.",
      how: `Add the same page-level gate the other apps use to ${s.ungatedRoutes.join(", ")}, and the member redirect with it.`,
      risk: "high",
      effort: "minutes",
      evidence: s.ungatedRoutes.map((r) => `${r}: no gate`),
    });
  }

  if (s.plaintextCredentials > 0) {
    out.push({
      id: "security:plaintext-credentials",
      kind: "security",
      title: `${plural(s.plaintextCredentials, "saved password")} stored in the clear`,
      why:
        "They are readable in your Supabase row and by anything with devtools on an unlocked device. " +
        "This was a deliberate trade — an encrypted vault once lost every login when its master password " +
        "was forgotten — so the question is whether it is still the trade you want.",
      how:
        "Encrypt in the browser under a master password so only ciphertext is ever stored, and force a " +
        "recovery-key export before the vault accepts its first entry, which is what makes the old failure " +
        "survivable. Or keep bank, email and root logins in a real password manager and store only pointers here.",
      risk: "medium",
      effort: "a session",
      evidence: [`${s.plaintextCredentials} credentials with a readable password`],
    });
  }

  const tokenAge = s.bridgeTokenAgeDays;
  if (tokenAge !== null && tokenAge >= STALE_TOKEN_DAYS) {
    out.push({
      id: "security:stale-bridge-token",
      kind: "security",
      title: "The local agent's token is months old",
      why:
        "That token is the only thing standing between any page you visit and a shell on your PC. " +
        "Rotating it costs one click and invalidates anything that captured it.",
      how: "Re-pair the bridge, which mints a fresh token and revokes the old one.",
      risk: "medium",
      effort: "minutes",
      evidence: [`token is ${Math.round(tokenAge)} days old`],
    });
  }

  if (s.publicShareLinks > 0) {
    out.push({
      id: `security:public-links:${s.publicShareLinks}`,
      kind: "security",
      title: `${plural(s.publicShareLinks, "share link")} anyone with the URL can open`,
      why: "A link you made for one person stays open for everyone who ever gets it, including after they stop needing it.",
      how: "Review them and revoke the ones that have done their job.",
      risk: "low",
      effort: "minutes",
      evidence: [`${s.publicShareLinks} active public links`],
    });
  }

  return out;
}

/**
 * The owner's own knowledge drifting.
 *
 * The best finding in here is the one the graph produces for free: a note
 * referred to several times and never written. That is not tidying, it is the
 * system telling the owner what they keep needing.
 */
export function auditVault(input: AuditInput): Proposal[] {
  const vault = input.vault;
  if (!vault) return [];
  const out: Proposal[] = [];

  const owed = vault.owed.filter((g) => g.referrers >= 2).slice(0, 5);
  if (owed.length) {
    out.push({
      id: `hygiene:owed:${owed.map((g) => g.title.toLowerCase()).sort().join(",")}`,
      kind: "hygiene",
      title: `You keep linking to ${plural(owed.length, "note")} you have never written`,
      why:
        "A name you reach for repeatedly is a note you already think exists. Until it does, everything " +
        "pointing at it is a dead end — and these are the ideas your own vault says matter most.",
      how: `Write ${owed.map((g) => `“${g.title}”`).join(", ")}, even as three lines each. The links resolve themselves.`,
      risk: "none",
      effort: "minutes",
      evidence: owed.map((g) => `“${g.title}” referred to ${g.referrers} times, never written`),
    });
  }

  // A proportion, not a count: twelve orphans in twenty notes is a problem and
  // twelve in two thousand is Tuesday.
  if (vault.notes >= 20 && vault.orphans.length / vault.notes > 0.3) {
    out.push({
      id: "hygiene:orphans",
      kind: "hygiene",
      title: `${Math.round((vault.orphans.length / vault.notes) * 100)}% of your notes connect to nothing`,
      why:
        "An unlinked note is only findable if you remember the words in it. The graph cannot help you reach " +
        "it, and neither can following a thought from somewhere nearby — which is the whole point of a vault.",
      how: "Link the biggest orphans into a map-of-content note, or into the topic notes they belong under.",
      risk: "none",
      effort: "hours",
      evidence: [
        `${vault.orphans.length} of ${vault.notes} notes have no links`,
        ...vault.orphans.slice(0, 4).map((p) => `orphan: ${p}`),
      ],
    });
  }

  if (vault.ambiguous.length) {
    const sample = vault.ambiguous.slice(0, 4);
    out.push({
      id: `hygiene:ambiguous:${sample.map((a) => a.target.toLowerCase()).sort().join(",")}`,
      kind: "hygiene",
      title: `${plural(vault.ambiguous.length, "link")} could point at more than one note`,
      why:
        "One was picked for you by a rule, not by you. It is probably right and it is silently wrong " +
        "whenever it is not, which is the worst failure mode a second brain has.",
      how: "Rename the duplicates so each name means one thing, or make the links use full paths.",
      risk: "low",
      effort: "minutes",
      evidence: sample.map((a) => `[[${a.target}]] → ${a.chose} (also matched ${a.among.length - 1} other)`),
    });
  }

  if (vault.pending > 0) {
    out.push({
      id: "capability:pending-captures",
      kind: "capability",
      title: `${plural(vault.pending, "captured note")} ${vault.pending === 1 ? "is" : "are"} not on disk yet`,
      why:
        "They are searchable, but they only exist in the index until your PC is reachable — so they are not " +
        "yet in the one copy that outlives this app.",
      how: "Open New Jarvis on the PC with the local agent running; the queue flushes into the vault on its own.",
      risk: "low",
      effort: "minutes",
      evidence: [`${vault.pending} waiting to be written`],
    });
  }

  return out;
}

/** Memory that exists but cannot be found. */
export function auditMemories(input: AuditInput): Proposal[] {
  const out: Proposal[] = [];
  const m = input.memories;

  if (m.total >= 50 && m.untagged / m.total > 0.5) {
    out.push({
      id: "hygiene:untagged-memories",
      kind: "hygiene",
      title: `${Math.round((m.untagged / m.total) * 100)}% of memories have no tags`,
      why:
        "Search still finds them by their words, but nothing groups them — so you can retrieve a memory " +
        "you half-remember and cannot ask for everything about a subject.",
      how: "Tag in bulk by source, then by the handful of subjects that actually recur.",
      risk: "none",
      effort: "hours",
      evidence: [`${m.untagged} of ${m.total} memories untagged`],
    });
  }

  if (m.undecided >= 5) {
    out.push({
      id: "hygiene:undecided-proposals",
      kind: "hygiene",
      title: `${plural(m.undecided, "thing")} Jarvis offered to remember ${m.undecided === 1 ? "is" : "are"} still waiting`,
      why: "Until you say yes they are not memory, so the next conversation starts without them.",
      how: "Clear the queue on the Memory panel. Rejecting is as useful as accepting — it stops the same offer coming back.",
      risk: "none",
      effort: "minutes",
      evidence: [`${m.undecided} undecided memory proposals`],
    });
  }

  return out;
}

/** Things the system tried and could not do. */
export function auditCapabilities(input: AuditInput): Proposal[] {
  const out: Proposal[] = [];

  const repeated = input.toolFailures.filter((f) => f.failures >= 3).sort((a, b) => b.failures - a.failures);
  for (const failure of repeated.slice(0, 3)) {
    out.push({
      id: `capability:failing-tool:${failure.tool}`,
      kind: "capability",
      title: `${failure.tool} has failed ${failure.failures} times`,
      why:
        "A tool that reliably fails is worse than one that does not exist: the agent keeps choosing it, " +
        "and every attempt costs a round trip and ends in an apology.",
      how: `Fix ${failure.tool}, or take it out of the tool list so the agent stops reaching for it.`,
      risk: "low",
      effort: "hours",
      evidence: [`${failure.failures} failures`, `last error: ${failure.lastError.slice(0, 160)}`],
    });
  }

  if (input.missingKeys.length) {
    out.push({
      id: `capability:missing-keys:${input.missingKeys.map((k) => k.name).sort().join(",")}`,
      kind: "capability",
      title: `${plural(input.missingKeys.length, "feature")} ${
        input.missingKeys.length === 1 ? "is" : "are"
      } switched off for want of a key`,
      why: "Each of these is already built and sitting idle. Nothing needs writing, only a value adding.",
      how: `Add ${input.missingKeys.map((k) => k.name).join(", ")} to .env.local.`,
      risk: "none",
      effort: "minutes",
      evidence: input.missingKeys.map((k) => `${k.name} — ${k.feature}`),
    });
  }

  return out;
}

// --- assembly --------------------------------------------------------------

const RISK_ORDER: Record<Risk, number> = { high: 0, medium: 1, low: 2, none: 3 };
const EFFORT_ORDER: Record<Effort, number> = { minutes: 0, hours: 1, "a session": 2 };

/**
 * Worst-first, then cheapest-first.
 *
 * A security hole above a tidying job, and within a tier the thing that takes
 * minutes above the thing that takes a session — so the top of the list is
 * always both the most worth doing and the most likely to actually get done.
 */
export function byPriority(a: Proposal, b: Proposal): number {
  return (
    RISK_ORDER[a.risk] - RISK_ORDER[b.risk] ||
    EFFORT_ORDER[a.effort] - EFFORT_ORDER[b.effort] ||
    a.title.localeCompare(b.title)
  );
}

export const AUDITORS = [auditRail, auditSecurity, auditVault, auditMemories, auditCapabilities] as const;

export interface Collected {
  proposals: Proposal[];
  /** Raised but hidden, so the panel can offer to show them. */
  hidden: number;
  counts: Record<ProposalKind, number>;
}

/**
 * Run every auditor and apply the owner's decisions.
 *
 * A snoozed proposal comes back when its date passes; a dismissed one never
 * does. Both are checked against the id, which is why ids are built from the
 * facts rather than from a counter.
 */
export function collectProposals(input: AuditInput, state: ImproveState): Collected {
  const dismissed = new Set(state.dismissed);
  const raw = AUDITORS.flatMap((audit) => audit(input));

  // An auditor with nothing to point at files nothing. Enforced here as well as
  // in each auditor, so a future one cannot quietly break the rule.
  const real = raw.filter((p) => p.evidence.length > 0);

  const seen = new Set<string>();
  const proposals: Proposal[] = [];
  let hidden = 0;

  for (const proposal of real) {
    if (seen.has(proposal.id)) continue;
    seen.add(proposal.id);

    if (dismissed.has(proposal.id)) {
      hidden += 1;
      continue;
    }
    const until = state.snoozed[proposal.id];
    if (until && Date.parse(until) > input.now) {
      hidden += 1;
      continue;
    }
    proposals.push(proposal);
  }

  proposals.sort(byPriority);

  const counts = { ia: 0, security: 0, hygiene: 0, capability: 0 } as Record<ProposalKind, number>;
  for (const p of proposals) counts[p.kind] += 1;

  return { proposals, hidden, counts };
}

// --- decisions -------------------------------------------------------------

export function dismiss(state: ImproveState, id: string): ImproveState {
  if (state.dismissed.includes(id)) return state;
  const { [id]: _dropped, ...snoozed } = state.snoozed;
  return { ...state, dismissed: tail([...state.dismissed, id]), snoozed };
}

export function snooze(state: ImproveState, id: string, now: number, days = 14): ImproveState {
  return { ...state, snoozed: { ...state.snoozed, [id]: new Date(now + days * 86_400_000).toISOString() } };
}

export function approve(state: ImproveState, id: string): ImproveState {
  if (state.approved.includes(id)) return state;
  return { ...state, approved: tail([...state.approved, id]) };
}

export function restore(state: ImproveState, id: string): ImproveState {
  const { [id]: _dropped, ...snoozed } = state.snoozed;
  return { ...state, dismissed: state.dismissed.filter((d) => d !== id), snoozed };
}

// --- approving writes a spec, and nothing else -----------------------------

/** A filename-safe stem for a proposal's spec. */
export function specName(proposal: Proposal, now: number): string {
  const day = new Date(now).toISOString().slice(0, 10);
  const stem = proposal.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${day}-${stem || proposal.kind}.md`;
}

/**
 * The spec an approval writes.
 *
 * This is the whole of what "approve" does, by the owner's choice: a document
 * a build session can pick up, carrying the evidence so whoever reads it does
 * not have to rediscover why it was raised.
 */
export function renderSpec(proposal: Proposal, now: number): string {
  return [
    `# ${proposal.title}`,
    "",
    `- **Raised by** Jarvis's self-audit (${proposal.kind})`,
    `- **Approved** ${new Date(now).toISOString()}`,
    `- **Risk** ${proposal.risk} · **Effort** ${proposal.effort}`,
    `- **Proposal id** \`${proposal.id}\``,
    "",
    "## Why",
    "",
    proposal.why,
    "",
    "## What to change",
    "",
    proposal.how,
    "",
    "## Evidence at the time it was raised",
    "",
    ...proposal.evidence.map((e) => `- ${e}`),
    "",
    "---",
    "",
    "_Filed by the self-improvement auditor. Nothing was changed automatically._",
    "",
  ].join("\n");
}

/** A one-line summary for the panel header. */
export function describeCollected(collected: Collected): string {
  const { proposals, counts, hidden } = collected;
  if (!proposals.length) {
    return hidden
      ? `Nothing new. ${hidden} ${hidden === 1 ? "idea is" : "ideas are"} dismissed or snoozed.`
      : "Nothing to suggest — it had a look and found nothing worth raising.";
  }
  const parts: string[] = [];
  if (counts.security) parts.push(`${counts.security} security`);
  if (counts.ia) parts.push(`${counts.ia} layout`);
  if (counts.hygiene) parts.push(`${counts.hygiene} housekeeping`);
  if (counts.capability) parts.push(`${counts.capability} capability`);
  return `${plural(proposals.length, "idea")} — ${parts.join(", ")}.`;
}
