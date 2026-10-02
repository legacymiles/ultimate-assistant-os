"use client";

// ---------------------------------------------------------------------------
// Assembling what the auditors are allowed to see, and recording the owner's
// answers.
//
// The auditors themselves are pure and tested; this hook is the untestable
// half — the fetches, the device-local usage counters, and the synced record of
// what was dismissed. Keeping the split means every judgement the system makes
// about itself is checkable without a browser.
//
// Two storage decisions worth knowing:
//
//   decisions are SYNCED, under their own key rather than inside the Jarvis
//   blob. Dismissing an idea on a laptop should stay dismissed on a phone, and
//   its own key means it can be wiped without taking anything else with it.
//
//   usage counters are DEVICE-LOCAL and never synced. A phone that never opens
//   Studio must not teach the auditor that the laptop never opens Studio —
//   that would turn a real signal into a confident lie.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useState } from "react";
import { loadLocal, saveLocal, saveSynced } from "@/lib/sync/appState";
import { useRemotePull } from "@/lib/sync/useSync";
import {
  approve as approveIn,
  coerceImproveState,
  collectProposals,
  describeCollected,
  dismiss as dismissIn,
  emptyImproveState,
  renderSpec,
  snooze as snoozeIn,
  specName,
  type AuditInput,
  type Collected,
  type ImproveState,
  type Proposal,
  type RailUse,
  type VaultFacts,
} from "./improve";
import type { JarvisStore } from "@/lib/jarvis/types";
import type { VaultGraph } from "@/lib/jarvis/graph/types";
import { orphans, owedNotes } from "@/lib/jarvis/vault/resolve";

export const IMPROVE_KEY = "jarvis-improve";
export const USAGE_KEY = "jarvis-usage";

/** What this device has actually been used for. Never synced. */
export interface Usage {
  /** Rail id → ISO of the last time it was opened here. */
  opened: Record<string, string>;
  /** Tool name → how many times it has failed, and the last reason. */
  failures: Record<string, { count: number; last: string }>;
}

function emptyUsage(): Usage {
  return { opened: {}, failures: {} };
}

export function loadUsage(): Usage {
  const raw = loadLocal<Partial<Usage>>(USAGE_KEY, emptyUsage());
  return {
    opened: raw.opened && typeof raw.opened === "object" ? raw.opened : {},
    failures: raw.failures && typeof raw.failures === "object" ? raw.failures : {},
  };
}

/** Record that a rail entry was opened. Called by the shell on every tab change. */
export function noteOpened(id: string): void {
  const usage = loadUsage();
  usage.opened[id] = new Date().toISOString();
  saveLocal(USAGE_KEY, usage);
}

/** Record that a tool failed. Called by the runner, so "this keeps failing" is measured and not guessed. */
export function noteFailure(tool: string, message: string): void {
  const usage = loadUsage();
  const existing = usage.failures[tool];
  usage.failures[tool] = { count: (existing?.count ?? 0) + 1, last: message.slice(0, 400) };
  saveLocal(USAGE_KEY, usage);
}

export interface UseImprove {
  collected: Collected;
  summary: string;
  state: ImproveState;
  approve: (p: Proposal) => void;
  snooze: (p: Proposal) => void;
  dismiss: (p: Proposal) => void;
  /** A sentence when the audit could not run at all, else null. */
  unavailable: string | null;
}

export interface ImproveInputs {
  store: JarvisStore | null;
  graph: VaultGraph;
  pendingCaptures: number;
  /** Every rail entry, so "never opened" can be told from "not in the rail". */
  rail: { id: string; label: string; itemCount?: number | null }[];
  bridgePaired: boolean;
  /** Routes holding the owner's data that have no password gate. */
  ungatedRoutes: string[];
  /** How many saved logins are stored readable. */
  plaintextCredentials: number;
  /** Keys that are not set, with what degrades without each. */
  missingKeys: { name: string; feature: string }[];
}

export function useImprove(inputs: ImproveInputs): UseImprove {
  const [state, setState] = useState<ImproveState>(emptyImproveState);
  const [usage, setUsage] = useState<Usage>(emptyUsage);
  const [now, setNow] = useState(() => Date.now());

  const reload = useCallback(() => {
    setState(coerceImproveState(loadLocal<unknown>(IMPROVE_KEY, emptyImproveState())));
    setUsage(loadUsage());
  }, []);
  useEffect(reload, [reload]);
  useRemotePull(IMPROVE_KEY, reload);

  // A snooze expires on a date, so the audit has to notice time passing.
  // Every few minutes is plenty — this is not a clock.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 300_000);
    return () => clearInterval(timer);
  }, []);

  const commit = useCallback((next: ImproveState) => {
    setState(next);
    saveSynced(IMPROVE_KEY, next);
  }, []);

  const vaultFacts: VaultFacts | null = useMemo(() => {
    const notes = inputs.graph.nodes.filter((n) => n.kind === "note");
    if (!notes.length && !inputs.graph.nodes.length) return null;
    return {
      notes: notes.length,
      owed: owedNotes(inputs.graph, 2).map((g) => ({ title: g.title, referrers: g.referrers })),
      orphans: orphans(inputs.graph).map((n) => n.path ?? n.key),
      ambiguous: inputs.graph.ambiguous.map((a) => ({ target: a.target, chose: a.chose, among: a.among })),
      pending: inputs.pendingCaptures,
    };
  }, [inputs.graph, inputs.pendingCaptures]);

  const audit: AuditInput = useMemo(() => {
    const store = inputs.store;
    const memories = store?.memories ?? [];

    const rail: RailUse[] = inputs.rail.map((t) => ({
      id: t.id,
      label: t.label,
      lastOpenedAt: usage.opened[t.id] ?? null,
      itemCount: t.itemCount ?? null,
    }));

    const bySource: Record<string, number> = {};
    for (const m of memories) bySource[m.source] = (bySource[m.source] ?? 0) + 1;

    return {
      now,
      rail,
      vault: vaultFacts,
      memories: {
        total: memories.length,
        untagged: memories.filter((m) => !m.tags?.length).length,
        bySource,
        undecided: store?.proposals?.length ?? 0,
      },
      security: {
        plaintextCredentials: inputs.plaintextCredentials,
        ungatedRoutes: inputs.ungatedRoutes,
        bridgePaired: inputs.bridgePaired,
        // The bridge's token age is not readable from the page — the token is
        // held in storage without a timestamp. Reporting null is the honest
        // answer rather than inventing an age, and the auditor says nothing
        // about rotation rather than nagging on a guess.
        bridgeTokenAgeDays: null,
        publicShareLinks: 0,
      },
      toolFailures: Object.entries(usage.failures).map(([tool, f]) => ({
        tool,
        failures: f.count,
        lastError: f.last,
      })),
      missingKeys: inputs.missingKeys,
    };
  }, [inputs, now, usage, vaultFacts]);

  const collected = useMemo(() => collectProposals(audit, state), [audit, state]);

  const approve = useCallback(
    (p: Proposal) => {
      commit(approveIn(state, p.id));
      // Approving writes a SPEC and nothing else — the owner's explicit
      // choice. The spec is offered as a download because the page cannot
      // write into the repo, and a build session picks it up from there.
      try {
        const blob = new Blob([renderSpec(p, Date.now())], { type: "text/markdown" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = specName(p, Date.now());
        a.click();
        URL.revokeObjectURL(url);
      } catch {
        // A blocked download must not lose the approval, which is already
        // recorded. The panel shows "spec written" either way.
      }
    },
    [commit, state],
  );

  return {
    collected,
    summary: describeCollected(collected),
    state,
    approve,
    snooze: useCallback((p: Proposal) => commit(snoozeIn(state, p.id, Date.now())), [commit, state]),
    dismiss: useCallback((p: Proposal) => commit(dismissIn(state, p.id)), [commit, state]),
    unavailable: inputs.store ? null : "Waiting for your things to load.",
  };
}
