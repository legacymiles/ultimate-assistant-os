import { describe, expect, it } from "vitest";
import {
  approve,
  auditCapabilities,
  auditDecisionPoints,
  auditMemories,
  auditRail,
  auditSecurity,
  auditVault,
  byPriority,
  coerceImproveState,
  collectProposals,
  describeCollected,
  dismiss,
  emptyImproveState,
  renderSpec,
  restore,
  snooze,
  specName,
  STALE_TAB_DAYS,
  type AuditInput,
  type Proposal,
} from "./improve";
import { decisionPointFacts } from "./decisionPoints";

const NOW = Date.parse("2026-10-02T12:00:00.000Z");
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

const input = (patch: Partial<AuditInput> = {}): AuditInput => ({
  now: NOW,
  rail: [],
  vault: null,
  memories: { total: 0, untagged: 0, bySource: {}, undecided: 0 },
  security: {
    plaintextCredentials: 0,
    ungatedRoutes: [],
    bridgePaired: true,
    bridgeTokenAgeDays: 1,
    publicShareLinks: 0,
  },
  toolFailures: [],
  missingKeys: [],
  ...patch,
});

const tab = (id: string, lastOpenedAt: string | null, itemCount: number | null = null) => ({
  id,
  label: id,
  lastOpenedAt,
  itemCount,
});

describe("the evidence-or-silence rule", () => {
  it("files nothing at all for a healthy system", () => {
    // A panel of plausible generic advice is worse than an empty one, because
    // it trains the owner to stop reading it.
    const collected = collectProposals(input(), emptyImproveState());
    expect(collected.proposals).toEqual([]);
    expect(describeCollected(collected)).toContain("found nothing worth raising");
  });

  it("gives every proposal it does file something concrete to point at", () => {
    const collected = collectProposals(
      input({
        rail: [tab("studio", daysAgo(40)), tab("inbox", daysAgo(50))],
        security: { ...input().security, ungatedRoutes: ["/apps/new-jarvis"], plaintextCredentials: 12 },
        toolFailures: [{ tool: "browser_click", failures: 7, lastError: "ref went stale" }],
      }),
      emptyImproveState(),
    );
    expect(collected.proposals.length).toBeGreaterThan(0);
    for (const p of collected.proposals) {
      expect(p.evidence.length).toBeGreaterThan(0);
      expect(p.title.length).toBeGreaterThan(0);
      expect(p.how.length).toBeGreaterThan(0);
    }
  });
});

describe("auditRail — fewer side tabs", () => {
  it("proposes folding away tabs that have not been opened in three weeks", () => {
    const found = auditRail(input({ rail: [tab("a", daysAgo(STALE_TAB_DAYS + 1)), tab("b", daysAgo(1))] }));
    expect(found).toHaveLength(1);
    expect(found[0].title).toContain("1 unused tab");
    expect(found[0].evidence[0]).toContain("22 days ago");
  });

  it("leaves a tab used yesterday alone", () => {
    expect(auditRail(input({ rail: [tab("a", daysAgo(1))] }))).toEqual([]);
  });

  it("reports never-opened separately from not-lately, because they mean different things", () => {
    // One is a habit; the other may be a surface the owner does not know exists.
    const found = auditRail(input({ rail: [tab("a", null), tab("b", null), tab("c", null)] }));
    expect(found.some((p) => p.title.includes("never been opened"))).toBe(true);
  });

  it("does not make a fuss about one or two never-opened tabs", () => {
    const found = auditRail(input({ rail: [tab("a", null), tab("b", null)] }));
    expect(found.some((p) => p.title.includes("never been opened"))).toBe(false);
  });

  it("flags an empty tab, because it reads as broken rather than unused", () => {
    const found = auditRail(input({ rail: [tab("lists", daysAgo(1), 0)] }));
    expect(found.some((p) => p.id.startsWith("ia:empty-tabs"))).toBe(true);
  });

  it("does not treat an unknowable count as empty", () => {
    expect(auditRail(input({ rail: [tab("console", daysAgo(1), null)] }))).toEqual([]);
  });
});

describe("auditSecurity", () => {
  it("raises an ungated route as the highest risk there is", () => {
    const found = auditSecurity(input({ security: { ...input().security, ungatedRoutes: ["/apps/new-jarvis"] } }));
    expect(found[0].risk).toBe("high");
    expect(found[0].evidence[0]).toContain("/apps/new-jarvis");
  });

  it("reports plaintext passwords as a trade to re-decide, not as a bug", () => {
    // Storing them readable was a deliberate, recorded decision — an encrypted
    // vault once lost every login. The auditor must present the trade, not
    // scold the owner for a choice they made on purpose.
    const found = auditSecurity(input({ security: { ...input().security, plaintextCredentials: 9 } }));
    const p = found.find((f) => f.id === "security:plaintext-credentials")!;
    expect(p.why).toContain("deliberate trade");
    expect(p.how).toContain("recovery-key export");
  });

  it("asks for a token rotation only once the token is old", () => {
    const fresh = auditSecurity(input({ security: { ...input().security, bridgeTokenAgeDays: 10 } }));
    const old = auditSecurity(input({ security: { ...input().security, bridgeTokenAgeDays: 200 } }));
    expect(fresh.some((p) => p.id === "security:stale-bridge-token")).toBe(false);
    expect(old.some((p) => p.id === "security:stale-bridge-token")).toBe(true);
  });

  it("says nothing about a token that does not exist", () => {
    const found = auditSecurity(input({ security: { ...input().security, bridgeTokenAgeDays: null, bridgePaired: false } }));
    expect(found.some((p) => p.id === "security:stale-bridge-token")).toBe(false);
  });
});

describe("auditVault", () => {
  const vault = (patch: Partial<NonNullable<AuditInput["vault"]>> = {}) => ({
    notes: 100,
    owed: [],
    orphans: [],
    ambiguous: [],
    pending: 0,
    ...patch,
  });

  it("surfaces the notes the owner keeps linking to and has never written", () => {
    // The best finding the graph produces: not tidying, but the system saying
    // what you keep needing.
    const found = auditVault(input({ vault: vault({ owed: [{ title: "Zone Recovery", referrers: 4 }] }) }));
    expect(found[0].title).toContain("never written");
    expect(found[0].evidence[0]).toContain("Zone Recovery");
    expect(found[0].evidence[0]).toContain("4 times");
  });

  it("ignores a name referred to only once, which is usually a typo", () => {
    expect(auditVault(input({ vault: vault({ owed: [{ title: "Typo", referrers: 1 }] }) }))).toEqual([]);
  });

  it("judges orphans as a proportion, because twelve in two thousand is Tuesday", () => {
    const small = auditVault(input({ vault: vault({ notes: 2000, orphans: Array(12).fill("x.md") }) }));
    const big = auditVault(input({ vault: vault({ notes: 30, orphans: Array(12).fill("x.md") }) }));
    expect(small.some((p) => p.id === "hygiene:orphans")).toBe(false);
    expect(big.some((p) => p.id === "hygiene:orphans")).toBe(true);
  });

  it("does not judge orphans at all in a vault too small to have a shape yet", () => {
    const found = auditVault(input({ vault: vault({ notes: 5, orphans: ["a.md", "b.md", "c.md", "d.md"] }) }));
    expect(found.some((p) => p.id === "hygiene:orphans")).toBe(false);
  });

  it("warns that an ambiguous link was resolved for the owner rather than by them", () => {
    const found = auditVault(
      input({ vault: vault({ ambiguous: [{ target: "Notes", chose: "b/Notes.md", among: ["a/Notes.md", "b/Notes.md"] }] }) }),
    );
    expect(found[0].why).toContain("silently wrong");
  });

  it("says plainly when captured notes are not yet in the one copy that outlives the app", () => {
    const found = auditVault(input({ vault: vault({ pending: 3 }) }));
    const p = found.find((f) => f.id === "capability:pending-captures")!;
    expect(p.title).toContain("3 captured notes");
  });

  it("says nothing when there is no vault at all", () => {
    expect(auditVault(input({ vault: null }))).toEqual([]);
  });
});

describe("auditMemories", () => {
  it("raises untagged memory only once there is enough of it to matter", () => {
    const few = auditMemories(input({ memories: { total: 10, untagged: 9, bySource: {}, undecided: 0 } }));
    const many = auditMemories(input({ memories: { total: 200, untagged: 180, bySource: {}, undecided: 0 } }));
    expect(few).toEqual([]);
    expect(many[0].title).toContain("90%");
  });

  it("points out a queue of undecided proposals, because until you say yes they are not memory", () => {
    const found = auditMemories(input({ memories: { total: 10, untagged: 0, bySource: {}, undecided: 6 } }));
    expect(found[0].why).toContain("not memory");
  });
});

describe("auditCapabilities", () => {
  it("raises a tool that keeps failing, worst first", () => {
    const found = auditCapabilities(
      input({
        toolFailures: [
          { tool: "a", failures: 4, lastError: "x" },
          { tool: "b", failures: 11, lastError: "y" },
          { tool: "ignored", failures: 1, lastError: "z" },
        ],
      }),
    );
    expect(found.map((p) => p.title)).toEqual(["b has failed 11 times", "a has failed 4 times"]);
  });

  it("truncates a huge error rather than putting it all in the panel", () => {
    const found = auditCapabilities(input({ toolFailures: [{ tool: "a", failures: 3, lastError: "e".repeat(500) }] }));
    expect(found[0].evidence[1].length).toBeLessThan(200);
  });

  it("names features that are built and idle for want of a key", () => {
    const found = auditCapabilities(input({ missingKeys: [{ name: "RETELL_API_KEY", feature: "phone calls" }] }));
    expect(found[0].why).toContain("already built");
    expect(found[0].evidence[0]).toContain("RETELL_API_KEY");
  });
});

describe("priority", () => {
  it("puts a security hole above a tidying job, and minutes above a session", () => {
    const p = (patch: Partial<Proposal>): Proposal => ({
      id: "x",
      kind: "hygiene",
      title: "t",
      why: "w",
      how: "h",
      risk: "none",
      effort: "a session",
      evidence: ["e"],
      ...patch,
    });
    const sorted = [
      p({ title: "cheap tidy", risk: "none", effort: "minutes" }),
      p({ title: "big hole", risk: "high", effort: "a session" }),
      p({ title: "quick hole", risk: "high", effort: "minutes" }),
    ].sort(byPriority);
    expect(sorted.map((x) => x.title)).toEqual(["quick hole", "big hole", "cheap tidy"]);
  });
});

describe("the owner's decisions", () => {
  const busy = () =>
    input({
      rail: [tab("a", daysAgo(40))],
      security: { ...input().security, ungatedRoutes: ["/apps/new-jarvis"] },
    });

  it("never raises a dismissed idea again", () => {
    const first = collectProposals(busy(), emptyImproveState());
    const state = dismiss(emptyImproveState(), first.proposals[0].id);
    const second = collectProposals(busy(), state);
    expect(second.proposals.map((p) => p.id)).not.toContain(first.proposals[0].id);
    expect(second.hidden).toBe(1);
  });

  it("brings a snoozed idea back when its date passes", () => {
    const first = collectProposals(busy(), emptyImproveState());
    const id = first.proposals[0].id;
    const state = snooze(emptyImproveState(), id, NOW, 14);

    const soon = collectProposals({ ...busy(), now: NOW + 86_400_000 }, state);
    expect(soon.proposals.map((p) => p.id)).not.toContain(id);

    const later = collectProposals({ ...busy(), now: NOW + 20 * 86_400_000 }, state);
    expect(later.proposals.map((p) => p.id)).toContain(id);
  });

  it("gives an id that is stable across runs, so a dismissal sticks", () => {
    const a = collectProposals(busy(), emptyImproveState()).proposals.map((p) => p.id);
    const b = collectProposals({ ...busy(), now: NOW + 3600_000 }, emptyImproveState()).proposals.map((p) => p.id);
    expect(a).toEqual(b);
  });

  it("changes the id when the facts change, because it is a different finding", () => {
    const one = auditSecurity(input({ security: { ...input().security, ungatedRoutes: ["/a"] } }))[0].id;
    const two = auditSecurity(input({ security: { ...input().security, ungatedRoutes: ["/a", "/b"] } }))[0].id;
    expect(one).not.toBe(two);
  });

  it("clears a snooze when the same idea is dismissed outright", () => {
    const state = dismiss(snooze(emptyImproveState(), "x", NOW), "x");
    expect(state.snoozed.x).toBeUndefined();
    expect(state.dismissed).toContain("x");
  });

  it("can un-dismiss, so a decision is not a trap", () => {
    expect(restore(dismiss(emptyImproveState(), "x"), "x").dismissed).toEqual([]);
  });

  it("records an approval once, however many times it is pressed", () => {
    expect(approve(approve(emptyImproveState(), "x"), "x").approved).toEqual(["x"]);
  });
});

describe("approving writes a spec and nothing else", () => {
  const proposal: Proposal = {
    id: "security:ungated:/apps/new-jarvis",
    kind: "security",
    title: "An app route has no password gate",
    why: "Because the gate does not cover it.",
    how: "Add the page-level gate.",
    risk: "high",
    effort: "minutes",
    evidence: ["/apps/new-jarvis: no gate"],
  };

  it("names the spec by date and title", () => {
    expect(specName(proposal, NOW)).toBe("2026-10-02-an-app-route-has-no-password-gate.md");
  });

  it("carries the evidence into the spec, so nobody has to rediscover why", () => {
    const spec = renderSpec(proposal, NOW);
    expect(spec).toContain("# An app route has no password gate");
    expect(spec).toContain("/apps/new-jarvis: no gate");
    expect(spec).toContain(proposal.id);
    expect(spec).toContain("Nothing was changed automatically");
  });

  it("produces a filename-safe stem from an awkward title", () => {
    expect(specName({ ...proposal, title: "50% of notes: connect/to nothing!" }, NOW)).toBe(
      "2026-10-02-50-of-notes-connect-to-nothing.md",
    );
  });
});

describe("coerceImproveState", () => {
  it("repairs a half-written blob instead of throwing", () => {
    const state = coerceImproveState({ dismissed: ["a", 3, null], snoozed: { b: "nonsense", c: "2026-10-09T00:00:00Z" } });
    expect(state.dismissed).toEqual(["a"]);
    expect(state.snoozed).toEqual({ c: "2026-10-09T00:00:00Z" });
    expect(state.approved).toEqual([]);
  });

  it("survives nothing at all", () => {
    expect(coerceImproveState(undefined)).toEqual(emptyImproveState());
    expect(coerceImproveState("not an object")).toEqual(emptyImproveState());
  });
});

describe("describeCollected", () => {
  it("counts by family", () => {
    const collected = collectProposals(
      input({ rail: [tab("a", daysAgo(40))], security: { ...input().security, ungatedRoutes: ["/x"] } }),
      emptyImproveState(),
    );
    const line = describeCollected(collected);
    expect(line).toContain("security");
    expect(line).toContain("layout");
  });

  it("says why it is empty when everything was dismissed, rather than claiming all is well", () => {
    const busy = input({ security: { ...input().security, ungatedRoutes: ["/x"] } });
    const first = collectProposals(busy, emptyImproveState());
    const state = first.proposals.reduce((s, p) => dismiss(s, p.id), emptyImproveState());
    expect(describeCollected(collectProposals(busy, state))).toContain("dismissed or snoozed");
  });
});

describe("auditDecisionPoints", () => {
  const points = decisionPointFacts();

  it("files one proposal per spot not yet using a decision model, with the code location as evidence", () => {
    const found = auditDecisionPoints(input({ decisionPoints: points, decisionKey: true }));
    const open = points.filter((p) => !p.wired);
    expect(found).toHaveLength(open.length);
    expect(found.every((p) => p.evidence.some((e) => e.startsWith("where: src/")))).toBe(true);
    expect(found.some((p) => p.id === "capability:decision-model:notification-urgency")).toBe(true);
    expect(found.some((p) => p.id === "capability:decision-model:chat-triage")).toBe(false);
  });

  it("files nothing for spots already wired", () => {
    const found = auditDecisionPoints(input({ decisionPoints: points, decisionKey: true }));
    expect(found.some((p) => p.id.endsWith(":long-tasks") || p.id.endsWith(":chat-triage"))).toBe(false);
  });

  it("asks for the key only when it is known to be missing", () => {
    expect(auditDecisionPoints(input({ decisionPoints: points, decisionKey: false })).some((p) => p.id.endsWith(":key"))).toBe(true);
    expect(auditDecisionPoints(input({ decisionPoints: points })).some((p) => p.id.endsWith(":key"))).toBe(false);
  });

  it("runs as part of the full audit", () => {
    const { proposals } = collectProposals(input({ decisionPoints: points, decisionKey: true }), emptyImproveState());
    expect(proposals.some((p) => p.id.startsWith("capability:decision-model:"))).toBe(true);
  });
});
