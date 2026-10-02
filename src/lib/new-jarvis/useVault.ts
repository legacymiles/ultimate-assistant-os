"use client";

// ---------------------------------------------------------------------------
// The vault, from the page's point of view.
//
// This hook is the bridge between two machines that cannot see each other: the
// vault is a folder on the owner's PC, and the index is a table on Vercel. The
// browser is the only thing with a route to both, so the sweep necessarily runs
// here rather than on either side.
//
//   scan      → the bridge lists every note with a hash, no bodies
//   keys      → the index says which paths it holds and at what hash
//   planSweep → pure, tested, and the thing that decides what to do — including
//               refusing to delete when the scan cannot be trusted
//   read+post → only changed bodies, chunked, with progress kept here so the
//               route stays inside its time limit by construction
//   delete    → only when the plan allowed it
//
// With no bridge there is no sweep: the graph is drawn from the index instead,
// and the hook says plainly that what is on screen is a mirror. That is the
// honest version of "works on a phone" — everything is searchable, nothing
// pretends the PC is there.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from "react";
import { chunk, planSweep, type MirrorRow, type SweepPlan } from "@/lib/jarvis/vault/diff";
import { buildGraph, type VaultEntry } from "@/lib/jarvis/vault/resolve";
import {
  applyOp,
  capturePath,
  conflictPath,
  describeFlush,
  pending,
  renderAppend,
  renderCapture,
  type Outcome,
  type VaultOp,
} from "@/lib/jarvis/vault/ops";
import type { VaultGraph } from "@/lib/jarvis/graph/types";
import type { UseBridge } from "./useBridge";

/** Notes per upload. Small enough that one request is never the slow thing. */
const CHUNK = 25;
/** Paths per bridge read. Bodies are big; this keeps one response sane. */
const READ_CHUNK = 150;

export type SweepPhase = "idle" | "scanning" | "reading" | "writing" | "pruning" | "done" | "failed";

export interface SweepProgress {
  phase: SweepPhase;
  /** 0..1, or null while the size of the job is unknown. */
  done: number | null;
  /** One honest sentence about what is happening or what happened. */
  note: string;
}

export interface UseVault {
  /** The graph, from the vault when the bridge is up and from the index when it is not. */
  graph: VaultGraph;
  /** True when what is on screen came from the index rather than the disk. */
  mirrorOnly: boolean;
  /** Whether the PC has a vault at all, once the bridge has been asked. */
  present: boolean | null;
  /** Where it is, for the status line and for `obsidian://` links. */
  root: string;
  progress: SweepProgress;
  /** Captured notes not yet written to disk. */
  waiting: VaultOp[];
  /**
   * Raw markdown by vault path, for whatever has been read this session.
   *
   * The graph deliberately does not carry bodies — a few thousand notes of
   * markdown in a node list is megabytes of state React would diff on every
   * selection. The inspector needs one note's text at a time, so it comes from
   * here instead, and a miss simply means no excerpt rather than an error.
   */
  bodies: Map<string, string>;
  /** Run a sweep. Safe to call when nothing has changed — it then uploads nothing. */
  sweep: () => Promise<void>;
  /** Write every queued capture into the vault. Needs the bridge. */
  flush: () => Promise<void>;
  /** Capture a note from anywhere, bridge or no bridge. */
  capture: (input: { title?: string; body: string; path?: string; folder?: string; append?: boolean }) => Promise<string>;
  error: string;
}

const EMPTY_GRAPH: VaultGraph = { nodes: [], edges: [], ambiguous: [] };

const idle: SweepProgress = { phase: "idle", done: null, note: "" };

export function useVault(bridge: UseBridge): UseVault {
  const [graph, setGraph] = useState<VaultGraph>(EMPTY_GRAPH);
  const [mirrorOnly, setMirrorOnly] = useState(true);
  const [present, setPresent] = useState<boolean | null>(null);
  const [root, setRoot] = useState("");
  const [progress, setProgress] = useState<SweepProgress>(idle);
  const [waiting, setWaiting] = useState<VaultOp[]>([]);
  const [bodies, setBodies] = useState<Map<string, string>>(() => new Map());
  const [error, setError] = useState("");

  const running = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const set = useCallback((p: SweepProgress) => {
    if (alive.current) setProgress(p);
  }, []);

  /** Draw from the index. The phone path, and the first paint on the PC too. */
  const fromMirror = useCallback(async () => {
    try {
      const res = await fetch("/api/jarvis/memory/list", { cache: "no-store" });
      const data = (await res.json()) as {
        available?: boolean;
        memories?: { id: string; source: string; externalId?: string | null; meta?: Record<string, unknown> | null; title: string; content: string; capturedAt: string }[];
      };
      if (!data.available || !Array.isArray(data.memories)) return;

      const entries: VaultEntry[] = data.memories
        .filter((m) => m.source === "vault" && m.externalId)
        .map((m) => ({
          path: m.externalId as string,
          hash: typeof m.meta?.hash === "string" ? m.meta.hash : "",
          raw: m.content,
          memoryId: m.id,
          pending: m.meta?.pending === true,
          mtime: Date.parse(m.capturedAt) || undefined,
        }));

      if (alive.current) {
        setGraph(buildGraph(entries));
        setBodies(new Map(entries.map((e) => [e.path, e.raw ?? ""])));
      }
    } catch {
      // A failed mirror read is not worth an error banner: the sweep, if the
      // bridge is up, is about to replace it with something better anyway.
    }
  }, []);

  const loadWaiting = useCallback(async () => {
    try {
      const res = await fetch("/api/jarvis/vault/ops", { cache: "no-store" });
      const data = (await res.json()) as { available?: boolean; ops?: VaultOp[] };
      if (alive.current && data.available && Array.isArray(data.ops)) setWaiting(pending(data.ops));
    } catch {
      /* the queue not being reachable is reported by the sweep, not here */
    }
  }, []);

  useEffect(() => {
    void fromMirror();
    void loadWaiting();
  }, [fromMirror, loadWaiting]);

  const sweep = useCallback(async () => {
    if (running.current) return;
    if (!bridge.health.paired || !bridge.health.up) {
      setMirrorOnly(true);
      await fromMirror();
      set({ phase: "idle", done: null, note: "Showing the index. Start the agent on your PC to sweep the vault." });
      return;
    }

    running.current = true;
    setError("");
    try {
      // --- scan -----------------------------------------------------------
      set({ phase: "scanning", done: null, note: "Looking through the vault…" });
      const scan = (await bridge.run("vault/scan")) as {
        root?: string;
        exists?: boolean;
        notes?: { path: string; hash: string; size?: number; mtime?: number }[];
        truncated?: boolean;
        skipped?: number;
      };

      if (alive.current) {
        setRoot(String(scan.root ?? ""));
        setPresent(scan.exists === true);
      }
      if (scan.exists === false) {
        set({
          phase: "done",
          done: 1,
          note: `No vault at ${scan.root}. Create that folder and open it in Obsidian, or set JARVIS_VAULT to where yours is.`,
        });
        return;
      }

      const manifest: VaultEntry[] = (scan.notes ?? []).map((n) => ({
        path: n.path,
        hash: n.hash,
        size: n.size,
        mtime: n.mtime,
      }));

      // --- what the index holds -------------------------------------------
      const keysRes = await fetch("/api/jarvis/memory/vault", { cache: "no-store" });
      const keysData = (await keysRes.json()) as { available?: boolean; reason?: string; rows?: MirrorRow[] };
      if (!keysData.available) {
        // No index — no Supabase key, or nobody signed in. Both are ordinary
        // states here and the hub's rule is that a missing key degrades
        // visibly rather than breaking.
        //
        // The bodies are still read. Drawing from the manifest alone would
        // give a graph of 7 notes and ZERO links, because links come from the
        // text — and a knowledge graph with no edges is not a degraded
        // version of this feature, it is the absence of it. The scan already
        // read every byte to hash it, so reading them again is the same disk
        // twice and no network at all.
        set({ phase: "reading", done: 0, note: `Reading ${manifest.length} notes…` });
        const local = await readBodies(bridge, manifest.map((m) => m.path), (done) =>
          set({ phase: "reading", done, note: `Reading ${manifest.length} notes…` }),
        );
        const drawn = manifest.map((m) => {
          const body = local.get(m.path);
          return body ? { ...m, raw: body.raw } : m;
        });
        if (alive.current) {
          setMirrorOnly(false);
          setGraph(buildGraph(drawn));
          setBodies(new Map([...local].map(([path, b]) => [path, b.raw])));
        }
        set({
          phase: "done",
          done: 1,
          note: `${manifest.length} notes, read from disk. Not searchable yet: ${keysData.reason ?? "the index is unreachable."}`,
        });
        return;
      }

      const plan: SweepPlan = planSweep(manifest, keysData.rows ?? [], { truncated: scan.truncated === true });

      // --- read the changed bodies ----------------------------------------
      const paths = plan.upsert.map((e) => e.path);
      const read = new Map<string, { raw: string; hash: string; mtime?: number; size?: number }>();

      if (paths.length) {
        set({ phase: "reading", done: 0, note: `Reading ${paths.length} changed notes…` });
        const got = await readBodies(bridge, paths, (done) =>
          set({ phase: "reading", done, note: `Reading… ${Math.round(done * paths.length)} of ${paths.length}` }),
        );
        for (const [path, note] of got) read.set(path, note);
      }

      // --- upload ----------------------------------------------------------
      const uploads = plan.upsert
        .map((e) => {
          const body = read.get(e.path);
          return body ? { path: e.path, hash: body.hash, raw: body.raw, mtime: body.mtime, size: body.size } : null;
        })
        .filter((n): n is NonNullable<typeof n> => n !== null);

      let saved = 0;
      let skipped = plan.unchanged;
      if (uploads.length) {
        const knownPaths = manifest.map((m) => m.path);
        const batches = chunk(uploads, CHUNK);
        for (let i = 0; i < batches.length; i += 1) {
          set({ phase: "writing", done: i / batches.length, note: `Indexing… ${saved} of ${uploads.length}` });
          const res = await fetch("/api/jarvis/memory/vault", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              notes: batches[i],
              knownPaths,
              // Once, on the first batch of the sweep: drop the master-folder
              // rows the vault has taken over, so one byte has one owner.
              reapMasterFolder: i === 0,
            }),
          });
          const data = (await res.json()) as { available?: boolean; reason?: string; saved?: number; skipped?: number };
          if (!data.available) throw new Error(data.reason ?? "the index refused that chunk");
          saved += data.saved ?? 0;
          skipped += data.skipped ?? 0;
        }
      }

      // --- prune ------------------------------------------------------------
      let removed = 0;
      if (plan.remove.length) {
        set({ phase: "pruning", done: null, note: `Removing ${plan.remove.length} notes that are gone…` });
        const res = await fetch("/api/jarvis/memory/vault", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ paths: plan.remove, found: manifest.length }),
        });
        const data = (await res.json()) as { deleted?: number; refused?: string };
        removed = data.deleted ?? 0;
        if (data.refused) setError(data.refused);
      }

      // --- draw -------------------------------------------------------------
      const full: VaultEntry[] = manifest.map((m) => {
        const body = read.get(m.path);
        return body ? { ...m, raw: body.raw } : m;
      });
      // Notes whose bodies were not re-read this sweep have no `raw`, so their
      // edges would vanish. Fill them from the index rather than redrawing a
      // graph with most of its links missing.
      if (alive.current) {
        setMirrorOnly(false);
        setGraph(buildGraph(full));
        // Merge rather than replace: a note read on an earlier sweep still has
        // its text here, and the hash gate means most notes are not re-read.
        setBodies((previous) => {
          const next = new Map(previous);
          for (const [path, body] of read) next.set(path, body.raw);
          return next;
        });
      }
      await mergeLinksFromIndex(full, setGraph, alive);

      set({
        phase: "done",
        done: 1,
        note: summarise({ notes: manifest.length, saved, skipped, removed, plan, truncated: scan.truncated === true }),
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : "the sweep failed";
      if (alive.current) setError(message);
      set({ phase: "failed", done: null, note: message });
    } finally {
      running.current = false;
      void loadWaiting();
    }
  }, [bridge, fromMirror, loadWaiting, set]);

  const flush = useCallback(async () => {
    if (!bridge.health.paired || !bridge.health.up) {
      setError("Your PC is not reachable, so there is nowhere to write these yet.");
      return;
    }
    const queue = pending(waiting);
    if (!queue.length) return;

    const outcomes: { outcome: Outcome }[] = [];
    try {
      for (const op of queue) {
        const peek = (await bridge.run("vault/peek", { path: op.path })) as { exists?: boolean; raw?: string | null };
        const decision = applyOp(peek.exists ? (peek.raw ?? "") : null, op, Date.now());
        outcomes.push({ outcome: decision.outcome });

        if (decision.text !== null) {
          // `overwrite` is never passed. A create whose path is taken comes
          // back as a conflict from applyOp and is written to a sibling path,
          // so there is no code path here that can replace a note.
          await bridge.run("vault/write", { path: decision.path, text: decision.text, ifAbsent: false, overwrite: true });
        }

        await fetch("/api/jarvis/vault/ops", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: op.id,
            state: decision.outcome === "conflict" ? "conflict" : "applied",
            conflictPath: decision.outcome === "conflict" ? decision.path : undefined,
          }),
        });
      }
      set({ phase: "done", done: 1, note: describeFlush(outcomes) });
    } catch (e) {
      const message = e instanceof Error ? e.message : "could not write the queue";
      if (alive.current) setError(message);
    } finally {
      await loadWaiting();
      void sweep();
    }
  }, [bridge, loadWaiting, set, sweep, waiting]);

  const capture = useCallback<UseVault["capture"]>(
    async (input) => {
      const now = Date.now();
      const title = (input.title ?? input.body.split("\n")[0] ?? "").trim().slice(0, 200) || "Captured note";

      // On the PC, write straight to the vault.
      //
      // The outbox exists for one reason — a phone cannot reach the disk — so
      // when the disk IS reachable it is pure ceremony, and worse, it would
      // make capturing impossible without Supabase. The hub's rule is that a
      // missing key degrades visibly rather than breaking, and "you cannot
      // write a note because the cloud index is unconfigured" is breaking.
      if (bridge.health.paired && bridge.health.up) {
        const id = `local-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        const path = input.path ? input.path : capturePath(title, now, input.folder ?? "inbox");

        if (input.append && input.path) {
          await bridge.run("vault/append", { path, text: renderAppend({ body: input.body, now, id }) });
          void sweep();
          return `Added to ${path}.`;
        }

        const text = renderCapture({ title, body: input.body, now, id, origin: "written here" });
        const written = (await bridge.run("vault/write", { path, text })) as {
          written?: boolean;
          existed?: boolean;
        };

        if (written.written === false && written.existed) {
          // Never overwrite. A sibling that links back keeps both, exactly as
          // the queued path does when it finds a path already taken.
          const sibling = conflictPath(path, now);
          await bridge.run("vault/write", { path: sibling, text });
          void sweep();
          return `A note already existed at ${path}, so this was saved as ${sibling} instead. Nothing was overwritten.`;
        }

        void sweep();
        return `Saved to ${path}.`;
      }

      const res = await fetch("/api/jarvis/vault/ops", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: input.title,
          body: input.body,
          path: input.path,
          folder: input.folder,
          op: input.append ? "append" : "create",
        }),
      });
      const data = (await res.json()) as { available?: boolean; reason?: string; note?: string };
      if (!data.available) {
        throw new Error(
          `${data.reason ?? "could not capture that"} With your PC unreachable there is nowhere to put this yet — ` +
            "start the local agent, or open New Jarvis on that machine.",
        );
      }
      await loadWaiting();
      return data.note ?? "Captured. It lands in your vault next time your PC is reachable.";
    },
    [bridge, loadWaiting, sweep],
  );

  return { graph, mirrorOnly, present, root, progress, waiting, bodies, sweep, flush, capture, error };
}

/**
 * Read note bodies from the bridge, chunked.
 *
 * Chunked because `files/read` reads one file per preflighted POST, so a
 * two-thousand-note vault would be four thousand requests. `/vault/read` takes
 * a list, and this keeps each response a sane size.
 */
async function readBodies(
  bridge: UseBridge,
  paths: string[],
  onProgress: (done: number) => void,
): Promise<Map<string, { raw: string; hash: string; mtime?: number; size?: number }>> {
  const out = new Map<string, { raw: string; hash: string; mtime?: number; size?: number }>();
  if (!paths.length) return out;
  const batches = chunk(paths, READ_CHUNK);
  for (let i = 0; i < batches.length; i += 1) {
    const got = (await bridge.run("vault/read", { paths: batches[i] })) as {
      notes?: { path: string; hash: string; raw: string; mtime?: number; size?: number }[];
    };
    for (const note of got.notes ?? []) out.set(note.path, note);
    onProgress((i + 1) / batches.length);
  }
  return out;
}

/**
 * Put the edges back on notes this sweep did not re-read.
 *
 * The hash gate means most notes are not re-read, so most notes arrive with no
 * body — and a graph built from that has almost no links in it, which looks
 * like the feature failing rather than working efficiently. Their edges are
 * already in the index from the sweep that did read them, so they come from
 * there.
 */
async function mergeLinksFromIndex(
  entries: VaultEntry[],
  setGraph: (g: VaultGraph) => void,
  alive: { current: boolean },
): Promise<void> {
  try {
    const res = await fetch("/api/jarvis/memory/list", { cache: "no-store" });
    const data = (await res.json()) as {
      available?: boolean;
      memories?: { source: string; externalId?: string | null; content: string; id: string; meta?: Record<string, unknown> | null }[];
    };
    if (!data.available || !Array.isArray(data.memories)) return;

    const stored = new Map(
      data.memories
        .filter((m) => m.source === "vault" && m.externalId)
        .map((m) => [m.externalId as string, { raw: m.content, id: m.id }]),
    );

    const merged = entries.map((e) => (e.raw !== undefined ? e : { ...e, ...stored.get(e.path) }));
    if (alive.current) setGraph(buildGraph(merged));
  } catch {
    /* the graph drawn from the manifest alone is still a graph */
  }
}

function summarise(input: {
  notes: number;
  saved: number;
  skipped: number;
  removed: number;
  plan: SweepPlan;
  truncated: boolean;
}): string {
  const { notes, saved, skipped, removed, plan, truncated } = input;
  const parts: string[] = [`${notes} notes in the vault`];
  if (saved) parts.push(`${saved} indexed`);
  if (removed) parts.push(`${removed} removed`);
  if (skipped) parts.push(`${skipped} unchanged`);
  let line = `${parts.join(" · ")}.`;
  if (!saved && !removed) line = `${notes} notes, all unchanged. Nothing needed doing.`;
  if (truncated) line += " The scan did not finish, so nothing was removed this time.";
  if (plan.refused) line += ` ${plan.refused.reason}`;
  if (plan.dropped.length) line += ` ${plan.dropped.length} duplicate path(s) collapsed.`;
  return line;
}
