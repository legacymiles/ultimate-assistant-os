"use client";

// ---------------------------------------------------------------------------
// Custom Video Swap's state: one draft kept on this device (a reload never
// loses the cast or the world), the clip itself for this session (a video is
// far too big for local storage — after a reload it asks for the clip again),
// and the queue job it became. Progress and the finished video are read live
// from In Queue, never faked with a timer.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadLocal, saveLocal } from "@/lib/sync/appState";
import { shrinkImage, useRequests } from "@/lib/new-jarvis/useRequests";
import type { FinishedRequest, QueueRequest } from "@/lib/new-jarvis/requests";
import type { Attachment } from "@/lib/jarvis/chatImages";
import { queueRequestText } from "../queueText";
import {
  MAX_PEOPLE,
  SWAP_FOLDER,
  blankDraft,
  blankPerson,
  briefText,
  checkSwap,
  draftFromPrompt,
  isMarked,
  pictures,
  pipeline,
  placeUploads,
  titleFor,
  totalMinutes,
  type ClipMeta,
  type SwapDraft,
  type SwapPerson,
  type SwapScene,
} from "./plan";
import { clipMeta, cropAround, frameAt, postWithProgress, putWithProgress } from "./frame";

/** What the Studio composer hands over when the card is sent. */
export interface SwapSeed {
  text: string;
  attachments: Attachment[];
  nonce: number;
}

const KEY = "jarvis.video-swap.v1";

interface Saved {
  draft: SwapDraft;
  /** The marked frame (JPEG data URL), so the cast row keeps its picture. */
  still: string;
  meta: ClipMeta | null;
  view: "compose" | "job";
  jobId?: string;
}

export type Swap =
  | { kind: "open"; id: string; title: string; at: string; request: QueueRequest }
  | { kind: "done"; id: string; title: string; at: string; finished: FinishedRequest };

export type SendPhase = { step: "filing" | "uploading" | "linking"; progress: number } | null;

function titleOf(text: string): string {
  return text.split("\n")[0].replace(/^CUSTOM VIDEO SWAP — /, "").slice(0, 80) || "Video swap";
}

async function toPicture(src: string): Promise<string> {
  return shrinkImage(await (await fetch(src)).blob(), 1024, 0.84);
}

export function useVideoSwap() {
  const [saved, setSaved] = useState<Saved>(() => {
    const s = loadLocal<Saved | null>(KEY, null);
    return s?.draft
      ? { ...s, draft: { ...blankDraft(), ...s.draft, scene: { ...blankDraft().scene, ...s.draft.scene } } }
      : { draft: blankDraft(), still: "", meta: null, view: "compose" };
  });
  const [clip, setClipState] = useState<{ file: File; url: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<SendPhase>(null);
  const requests = useRequests();
  const first = useRef(true);
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    saveLocal(KEY, saved);
  }, [saved]);

  useEffect(() => () => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
  }, []);

  const draft = saved.draft;
  const meta = saved.meta;

  const patch = useCallback((p: Partial<SwapDraft>) => setSaved((s) => ({ ...s, draft: { ...s.draft, ...p } })), []);
  const patchScene = useCallback(
    (p: Partial<SwapScene>) => setSaved((s) => ({ ...s, draft: { ...s.draft, scene: { ...s.draft.scene, ...p } } })),
    [],
  );
  const patchPerson = useCallback(
    (id: string, p: Partial<SwapPerson>) =>
      setSaved((s) => ({ ...s, draft: { ...s.draft, people: s.draft.people.map((x) => (x.id === id ? { ...x, ...p } : x)) } })),
    [],
  );

  /** Grab the still at `t` for marking people. */
  const grab = useCallback(async (url: string, t: number) => {
    try {
      const still = await frameAt(url, t);
      setSaved((s) => ({ ...s, still, draft: { ...s.draft, frameAt: t } }));
      return still;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't read the clip.");
      return "";
    }
  }, []);

  const setClip = useCallback(
    async (file: File | null) => {
      setError(null);
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
      if (!file) {
        setClipState(null);
        setSaved((s) => ({ ...s, meta: null, still: "", draft: { ...s.draft, trim: null, people: s.draft.people.map((p) => ({ ...p, x: -1, y: -1, crop: "" })) } }));
        return;
      }
      if (!file.type.startsWith("video/")) {
        setError(`${file.name} isn't a video.`);
        return;
      }
      const url = URL.createObjectURL(file);
      urlRef.current = url;
      setBusy("Reading the clip…");
      try {
        const m = await clipMeta(file, url);
        setClipState({ file, url });
        const t = Math.min(1, m.duration / 3);
        // Same clip back after a reload: keep the marks. A new clip: marks no longer point at anyone.
        const same = saved.meta && saved.meta.name === m.name && saved.meta.size === m.size;
        setSaved((s) => ({
          ...s,
          meta: m,
          draft: same
            ? s.draft
            : { ...s.draft, frameAt: t, trim: null, people: s.draft.people.map((p) => ({ ...p, x: -1, y: -1, crop: "" })) },
        }));
        await grab(url, same ? saved.draft.frameAt : t);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't read the clip.");
        URL.revokeObjectURL(url);
        urlRef.current = null;
      } finally {
        setBusy(null);
      }
    },
    [grab, saved.meta, saved.draft.frameAt],
  );

  /** Move the marking frame: every mark on the old frame is cleared (they may have moved). */
  const markFrame = useCallback(
    async (t: number) => {
      if (!clip) return;
      setSaved((s) => ({ ...s, draft: { ...s.draft, people: s.draft.people.map((p) => ({ ...p, x: -1, y: -1, crop: "" })) } }));
      await grab(clip.url, t);
    },
    [clip, grab],
  );

  /**
   * A tap on the still. Near an existing mark → move it. Otherwise it marks the
   * first person still waiting for a mark, or adds a new person.
   */
  const tap = useCallback(
    async (x: number, y: number) => {
      if (!saved.still) return;
      const crop = await cropAround(saved.still, x, y).catch(() => "");
      setSaved((s) => {
        const people = [...s.draft.people];
        const near = people.findIndex((p) => isMarked(p) && Math.hypot(p.x - x, p.y - y) < 0.08);
        const free = people.findIndex((p) => !isMarked(p));
        if (near >= 0) people[near] = { ...people[near], x, y, crop };
        else if (free >= 0) people[free] = { ...people[free], x, y, crop };
        else if (people.length < MAX_PEOPLE) people.push({ ...blankPerson(), x, y, crop });
        return { ...s, draft: { ...s.draft, people } };
      });
    },
    [saved.still],
  );

  const addPerson = useCallback(
    () => setSaved((s) => (s.draft.people.length >= MAX_PEOPLE ? s : { ...s, draft: { ...s.draft, people: [...s.draft.people, blankPerson()] } })),
    [],
  );
  const addPersonWithImage = useCallback(async (file: File | Blob) => {
    try {
      const image = await shrinkImage(file, 1024, 0.84);
      setSaved((s) =>
        s.draft.people.length >= MAX_PEOPLE ? s : { ...s, draft: { ...s.draft, people: [...s.draft.people, blankPerson(image)] } },
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't read that picture.");
    }
  }, []);
  const removePerson = useCallback(
    (id: string) => setSaved((s) => ({ ...s, draft: { ...s.draft, people: s.draft.people.filter((p) => p.id !== id) } })),
    [],
  );
  const unmark = useCallback((id: string) => patchPerson(id, { x: -1, y: -1, crop: "" }), [patchPerson]);

  const setPersonImage = useCallback(
    async (id: string, file: File | Blob) => {
      try {
        patchPerson(id, { image: await shrinkImage(file, 1024, 0.84) });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't read that picture.");
      }
    },
    [patchPerson],
  );
  const setSceneImage = useCallback(
    async (file: File | Blob | null) => {
      if (!file) return patchScene({ image: "" });
      try {
        patchScene({ image: await shrinkImage(file, 1280, 0.84), mode: "replace" });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't read that picture.");
      }
    },
    [patchScene],
  );

  /** The Studio composer's line and uploads → a fresh swap with everything in its slot. */
  const startFromSeed = useCallback(
    async (seed: SwapSeed) => {
      // Just the card, nothing typed or attached: open the swap where it was.
      if (!seed.text.trim() && !seed.attachments.length) return;
      const kinds = seed.attachments.map((a) => a.kind);
      const place = placeUploads(kinds, seed.text);
      const pick = async (i: number) => toPicture(seed.attachments[i].full).catch(() => "");
      const characters = (await Promise.all(place.characters.map(pick))).filter(Boolean);
      const background = place.background !== null ? await pick(place.background) : null;
      const fresh = draftFromPrompt(seed.text, characters, background);
      const clipFile = place.clip !== null ? seed.attachments[place.clip].file : undefined;
      // A new line with no clip keeps the clip and marks already here.
      setSaved((s) => ({
        ...s,
        view: "compose",
        jobId: undefined,
        draft: clipFile || !s.meta ? fresh : { ...fresh, frameAt: s.draft.frameAt },
        ...(clipFile ? { still: "", meta: null } : {}),
      }));
      if (clipFile) await setClip(clipFile);
    },
    [setClip],
  );

  const problems = useMemo(() => checkSwap(draft, meta), [draft, meta]);
  const stages = useMemo(() => pipeline(draft, meta), [draft, meta]);
  const minutes = useMemo(() => totalMinutes(draft, meta), [draft, meta]);

  /** "Make it": file the job, upload the clip, then point the job at it. */
  const send = useCallback(async () => {
    setError(null);
    if (!clip || !meta) return setError("Add the driving video first.");
    if (problems.length) return setError(problems[0]);
    const title = titleFor(draft);
    const text = queueRequestText({ folder: SWAP_FOLDER, title, brief: briefText({ ...draft, title }, meta) });
    const images = pictures(draft).map((p) => p.src);
    setPhase({ step: "filing", progress: 0 });
    try {
      const start = await fetch("/api/studio/video-swap/job", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op: "start", text, images }),
      });
      const s = (await start.json().catch(() => ({}))) as { id?: string; url?: string; local?: boolean; error?: string };
      if (!start.ok || !s.id) throw new Error(s.error ?? "In Queue didn't take the swap.");
      setPhase({ step: "uploading", progress: 0 });
      const onProgress = (p: number) => setPhase({ step: "uploading", progress: p });
      let ok: boolean;
      if (s.url) {
        ok = await putWithProgress(s.url, clip.file, clip.file.type, onProgress);
      } else {
        const form = new FormData();
        form.set("id", s.id);
        form.set("file", clip.file, clip.file.name || `${s.id}.mp4`);
        ok = await postWithProgress("/api/studio/video-swap/job", form, onProgress);
      }
      if (!ok) {
        await fetch("/api/studio/video-swap/job", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "cancel", id: s.id }) });
        throw new Error("The clip didn't upload. Check your connection and press Make it again.");
      }
      setPhase({ step: "linking", progress: 1 });
      const ready = await fetch("/api/studio/video-swap/job", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op: "ready", id: s.id }),
      });
      if (!ready.ok) {
        const r = (await ready.json().catch(() => ({}))) as { error?: string };
        throw new Error(r.error ?? "The clip uploaded but couldn't be attached.");
      }
      await requests.refresh();
      setSaved((st) => ({ ...st, view: "job", jobId: s.id, draft: { ...st.draft, title } }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't send the swap.");
    } finally {
      setPhase(null);
    }
  }, [clip, meta, problems, draft, requests]);

  const swaps: Swap[] = useMemo(() => {
    const open: Swap[] = requests.doc.requests
      .filter((r) => r.folder === SWAP_FOLDER)
      .map((r) => ({ kind: "open", id: r.id, title: titleOf(r.text), at: r.createdAt, request: r }));
    const done: Swap[] = requests.doc.finished
      .filter((f) => f.folder === SWAP_FOLDER)
      .map((f) => ({ kind: "done", id: f.id, title: titleOf(f.text), at: f.doneAt, finished: f }));
    return [...open, ...done].sort((a, b) => b.at.localeCompare(a.at));
  }, [requests.doc]);

  const job = swaps.find((s) => s.id === saved.jobId) ?? null;

  const newSwap = useCallback(() => {
    setSaved((s) => ({ ...s, view: "compose", jobId: undefined, draft: { ...blankDraft(), people: s.draft.people.map((p) => ({ ...p, x: -1, y: -1, crop: "" })), scene: s.draft.scene } }));
    void setClip(null);
  }, [setClip]);

  return {
    draft,
    meta,
    clip,
    still: saved.still,
    view: saved.view,
    job,
    swaps,
    requests,
    busy,
    error,
    setError,
    phase,
    problems,
    stages,
    minutes,
    patch,
    patchScene,
    patchPerson,
    setClip,
    markFrame,
    tap,
    addPerson,
    addPersonWithImage,
    removePerson,
    unmark,
    setPersonImage,
    setSceneImage,
    startFromSeed,
    send,
    newSwap,
    openSwap: (id: string) => setSaved((s) => ({ ...s, view: "job", jobId: id })),
    backToCompose: () => setSaved((s) => ({ ...s, view: "compose" })),
  };
}

export type VideoSwap = ReturnType<typeof useVideoSwap>;
