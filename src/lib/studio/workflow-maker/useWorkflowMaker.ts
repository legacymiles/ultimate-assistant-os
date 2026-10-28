"use client";

// ---------------------------------------------------------------------------
// Workflow Maker's state: the request, what it learns from (frames of the
// video, the pictures), the blueprint the owner edits, and the build job it
// became. Kept on this device (frames thinned to fit), progress read live from
// In Queue.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadLocal, saveLocal } from "@/lib/sync/appState";
import { useRequests } from "@/lib/new-jarvis/useRequests";
import type { FinishedRequest, QueueRequest } from "@/lib/new-jarvis/requests";
import type { Attachment } from "@/lib/jarvis/chatImages";
import { forWire, keyframesOf, prepare, type PreparedMedia } from "@/lib/app-builder/media";
import { queueRequestText } from "../queueText";
import {
  MAKER_FOLDER,
  buildBrief,
  checkBlueprint,
  draftBlueprint,
  type AgentKit,
  type Blueprint,
  type BpSlot,
  type BpStage,
  type MakeKind,
} from "./blueprint";

export interface MakerSeed {
  text: string;
  attachments: Attachment[];
  nonce: number;
}

const KEY = "jarvis.workflow-maker.v1";

interface Saved {
  request: string;
  /** Thumbs + a few frames per item (enough to show and to send as key frames). */
  media: PreparedMedia[];
  blueprint: Blueprint | null;
  engine?: "ai" | "offline";
  notice?: string;
  view: "design" | "job";
  jobId?: string;
}

export type Build =
  | { kind: "open"; id: string; title: string; at: string; request: QueueRequest }
  | { kind: "done"; id: string; title: string; at: string; finished: FinishedRequest };

const titleOf = (text: string) => text.split("\n")[0].replace(/^WORKFLOW:\s*/, "").slice(0, 80) || "Workflow";

/** What is kept on the device: the thumb and up to 3 frames each, no sound (local storage is small). */
const keep = (m: PreparedMedia): PreparedMedia => {
  if (m.frames.length <= 3) return { ...m, sound: undefined };
  const idx = [0, 1, 2].map((i) => Math.round((i * (m.frames.length - 1)) / 2));
  return { ...m, sound: undefined, frames: idx.map((i) => m.frames[i]), times: m.times ? idx.map((i) => m.times![i]) : undefined };
};

export function useWorkflowMaker() {
  const [saved, setSaved] = useState<Saved>(() => {
    const s = loadLocal<Saved | null>(KEY, null);
    if (!s) return { request: "", media: [], blueprint: null, view: "design" };
    // Saves from before agents carry no kind/agent.
    return s.blueprint ? { ...s, blueprint: { ...s.blueprint, kind: s.blueprint.kind ?? "workflow", agent: s.blueprint.agent ?? null } } : s;
  });
  /** Full-resolution media for this session (what the watcher reads). */
  const full = useRef<PreparedMedia[]>([]);
  const [watching, setWatching] = useState(false);
  const [adding, setAdding] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requests = useRequests();
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    saveLocal(KEY, saved);
  }, [saved]);

  const setRequest = useCallback((request: string) => setSaved((s) => ({ ...s, request })), []);
  const patch = useCallback(
    (p: Partial<Blueprint>) => setSaved((s) => (s.blueprint ? { ...s, blueprint: { ...s.blueprint, ...p } } : s)),
    [],
  );
  const patchAgent = useCallback(
    (p: Partial<AgentKit>) =>
      setSaved((s) => (s.blueprint?.agent ? { ...s, blueprint: { ...s.blueprint, agent: { ...s.blueprint.agent, ...p } } } : s)),
    [],
  );
  /** Switch what it makes. Becoming an agent brings a starter kit for its field (kept if one exists). */
  const setKind = useCallback(
    (kind: MakeKind) =>
      setSaved((s) => {
        if (!s.blueprint) return s;
        const bp = s.blueprint;
        const agent = kind === "agent" ? (bp.agent ?? draftBlueprint(`${s.request} ${bp.name} agent`).agent) : bp.agent;
        const home = kind === "agent" ? "agent" : bp.home === "agent" ? (kind === "workflow" ? "studio" : "plugin") : bp.home;
        return { ...s, blueprint: { ...bp, kind, agent, home } };
      }),
    [],
  );
  const patchInput = useCallback(
    (id: string, p: Partial<BpSlot>) =>
      setSaved((s) => (s.blueprint ? { ...s, blueprint: { ...s.blueprint, inputs: s.blueprint.inputs.map((x) => (x.id === id ? { ...x, ...p } : x)) } } : s)),
    [],
  );
  const patchStage = useCallback(
    (id: string, p: Partial<BpStage>) =>
      setSaved((s) => (s.blueprint ? { ...s, blueprint: { ...s.blueprint, stages: s.blueprint.stages.map((x) => (x.id === id ? { ...x, ...p } : x)) } } : s)),
    [],
  );
  const addInput = useCallback(
    () =>
      setSaved((s) =>
        s.blueprint && s.blueprint.inputs.length < 8
          ? { ...s, blueprint: { ...s.blueprint, inputs: [...s.blueprint.inputs, { id: `in${Date.now().toString(36)}`, label: "New input", kind: "text", role: "", required: false }] } }
          : s,
      ),
    [],
  );
  const removeInput = useCallback(
    (id: string) => setSaved((s) => (s.blueprint ? { ...s, blueprint: { ...s.blueprint, inputs: s.blueprint.inputs.filter((x) => x.id !== id) } } : s)),
    [],
  );
  const addStage = useCallback(
    () =>
      setSaved((s) =>
        s.blueprint && s.blueprint.stages.length < 10
          ? { ...s, blueprint: { ...s.blueprint, stages: [...s.blueprint.stages, { id: `st${Date.now().toString(36)}`, label: "New step", engine: "AI", runsOn: "cloud", detail: "", on: true }] } }
          : s,
      ),
    [],
  );
  const moveStage = useCallback(
    (id: string, by: -1 | 1) =>
      setSaved((s) => {
        if (!s.blueprint) return s;
        const list = [...s.blueprint.stages];
        const i = list.findIndex((x) => x.id === id);
        const j = i + by;
        if (i < 0 || j < 0 || j >= list.length) return s;
        [list[i], list[j]] = [list[j], list[i]];
        return { ...s, blueprint: { ...s.blueprint, stages: list } };
      }),
    [],
  );

  const addFiles = useCallback(async (files: File[]) => {
    setError(null);
    setAdding(true);
    const added: PreparedMedia[] = [];
    for (const f of files.slice(0, 6)) {
      try {
        added.push(await prepare(f));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't read that file.");
      }
    }
    full.current = [...full.current, ...added].slice(0, 6);
    setSaved((s) => ({ ...s, media: [...s.media, ...added.map(keep)].slice(0, 6) }));
    setAdding(false);
  }, []);

  const removeMedia = useCallback((id: string) => {
    full.current = full.current.filter((m) => m.id !== id);
    setSaved((s) => ({ ...s, media: s.media.filter((m) => m.id !== id) }));
  }, []);

  /** Watch the media + read the request → a blueprint (AI, or the field template). */
  const watch = useCallback(async (request: string, media: PreparedMedia[]) => {
    setWatching(true);
    setError(null);
    try {
      const wire = forWire(media);
      const res = await fetch("/api/studio/workflow-maker", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request, media: wire.media.map(({ kind, name, frames, times, duration }) => ({ kind, name, frames, times, duration })) }),
      });
      const data = (await res.json().catch(() => ({}))) as { blueprint?: Blueprint; engine?: "ai" | "offline"; notice?: string; error?: string };
      if (!res.ok || !data.blueprint) throw new Error(data.error ?? "Couldn't watch it just now.");
      setSaved((s) => ({ ...s, blueprint: data.blueprint!, engine: data.engine, notice: [data.notice, wire.note].filter(Boolean).join(" ") || undefined, view: "design", jobId: undefined }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't watch it just now.");
      setSaved((s) => (s.blueprint ? s : { ...s, blueprint: draftBlueprint(request, media.map((m) => m.kind)), engine: "offline" }));
    } finally {
      setWatching(false);
    }
  }, []);

  const rewatch = useCallback(() => watch(saved.request, full.current.length ? full.current : saved.media), [watch, saved.request, saved.media]);

  /** The Studio composer's line and uploads → watched straight away. */
  const startFromSeed = useCallback(
    async (seed: MakerSeed) => {
      // Just the card, nothing typed or attached: open it where it was.
      if (!seed.text.replace(/@workflow-maker\b/gi, "").trim() && !seed.attachments.length) return;
      setAdding(true);
      const prepared: PreparedMedia[] = [];
      for (const a of seed.attachments.filter((x) => x.kind !== "audio").slice(0, 6)) {
        try {
          if (a.file) prepared.push(await prepare(a.file));
          else prepared.push(await prepare(new File([await (await fetch(a.full)).blob()], a.name || "picture.jpg", { type: "image/jpeg" })));
        } catch {
          /* unreadable attachment: skipped, the rest still watched */
        }
      }
      setAdding(false);
      full.current = prepared;
      setSaved({ request: seed.text.replace(/@workflow-maker\b/gi, "").trim(), media: prepared.map(keep), blueprint: null, view: "design" });
      await watch(seed.text.replace(/@workflow-maker\b/gi, "").trim(), prepared);
    },
    [watch],
  );

  const problems = useMemo(() => (saved.blueprint ? checkBlueprint(saved.blueprint) : ["Watch the video first."]), [saved.blueprint]);

  /** "Build it": the blueprint and four key frames become one In Queue request for the PC. */
  const send = useCallback(async () => {
    const bp = saved.blueprint;
    if (!bp || problems.length) return;
    setSending(true);
    setError(null);
    const title = `${bp.name} — build it`;
    const text = queueRequestText({ folder: MAKER_FOLDER, title, brief: buildBrief(bp, saved.request) });
    const frames = keyframesOf(saved.media, 4);
    const added = await requests.add(MAKER_FOLDER, text, frames);
    setSending(false);
    if (added[0]) setSaved((s) => ({ ...s, view: "job", jobId: added[0].id }));
    else setError(requests.error ?? "That exact workflow is already waiting in your queue.");
  }, [saved.blueprint, saved.request, saved.media, problems, requests]);

  const builds: Build[] = useMemo(() => {
    const open: Build[] = requests.doc.requests
      .filter((r) => r.folder === MAKER_FOLDER)
      .map((r) => ({ kind: "open", id: r.id, title: titleOf(r.text), at: r.createdAt, request: r }));
    const done: Build[] = requests.doc.finished
      .filter((f) => f.folder === MAKER_FOLDER)
      .map((f) => ({ kind: "done", id: f.id, title: titleOf(f.text), at: f.doneAt, finished: f }));
    return [...open, ...done].sort((a, b) => b.at.localeCompare(a.at));
  }, [requests.doc]);

  return {
    ...saved,
    job: builds.find((b) => b.id === saved.jobId) ?? null,
    builds,
    requests,
    watching,
    adding,
    sending,
    error,
    problems,
    setRequest,
    patch,
    patchAgent,
    setKind,
    patchInput,
    patchStage,
    addInput,
    removeInput,
    addStage,
    moveStage,
    addFiles,
    removeMedia,
    rewatch,
    startFromSeed,
    send,
    openBuild: (id: string) => setSaved((s) => ({ ...s, view: "job", jobId: id })),
    backToDesign: () => setSaved((s) => ({ ...s, view: "design" })),
    reset: () => {
      full.current = [];
      setSaved({ request: "", media: [], blueprint: null, view: "design" });
    },
  };
}

export type WorkflowMakerState = ReturnType<typeof useWorkflowMaker>;
