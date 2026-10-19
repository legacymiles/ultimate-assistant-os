"use client";

// ---------------------------------------------------------------------------
// The Kids Animation Flow's state: one draft, kept on this device so a reload
// never loses a half-made story, plus the queue job it became once sent.
//
// The job's progress is NOT stored here — it is read live from In Queue
// (useRequests), so "working on it", the agent's notes, the result line and
// the finished video all arrive by themselves as the PC does the work.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadLocal, saveLocal } from "@/lib/sync/appState";
import { useRequests } from "@/lib/new-jarvis/useRequests";
import type { FinishedRequest, QueueRequest } from "@/lib/new-jarvis/requests";
import { queueRequestText } from "../queueText";
import {
  blankDraft,
  briefText,
  checkPlan,
  coercePlan,
  type Beat,
  type CharacterSheet,
  type KidsFlowDraft,
} from "./plan";

export const KIDS_FOLDER = "flow:animate-my-character";
const KEY = "jarvis.kids-flow.v1";

export type Stage = "character" | "story" | "board" | "render" | "watch";
export const STAGES: { id: Stage; label: string }[] = [
  { id: "character", label: "Character" },
  { id: "story", label: "Story" },
  { id: "board", label: "Storyboard" },
  { id: "render", label: "Render" },
  { id: "watch", label: "Watch" },
];

interface Saved {
  draft: KidsFlowDraft;
  images: string[];
  stage: Stage;
  /** The queue request this draft became, once sent. */
  jobId?: string;
}

/** One film in the side list: still in the queue, or finished. */
export type Film =
  | { kind: "open"; id: string; title: string; at: string; request: QueueRequest }
  | { kind: "done"; id: string; title: string; at: string; finished: FinishedRequest };

function titleOf(text: string): string {
  return text.split("\n")[0].replace(/^TITLE:\s*/, "").slice(0, 80) || "Untitled story";
}

export function useKidsFlow() {
  const [saved, setSaved] = useState<Saved>(() => {
    const s = loadLocal<Saved | null>(KEY, null);
    return s && s.draft ? { ...s, draft: { ...blankDraft(), ...s.draft, sheet: { ...blankDraft().sheet, ...s.draft.sheet } } } : { draft: blankDraft(), images: [], stage: "character" };
  });
  const [planning, setPlanning] = useState(false);
  const [planNote, setPlanNote] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const requests = useRequests();
  const first = useRef(true);

  // Saved on every change; a quota error just means this device keeps less.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    saveLocal(KEY, saved);
  }, [saved]);

  const patch = useCallback((p: Partial<KidsFlowDraft>) => setSaved((s) => ({ ...s, draft: { ...s.draft, ...p } })), []);
  const patchSheet = useCallback(
    (p: Partial<CharacterSheet>) => setSaved((s) => ({ ...s, draft: { ...s.draft, sheet: { ...s.draft.sheet, ...p } } })),
    [],
  );
  const setBeats = useCallback((beats: Beat[]) => setSaved((s) => ({ ...s, draft: { ...s.draft, beats } })), []);
  const setImages = useCallback((images: string[]) => setSaved((s) => ({ ...s, images })), []);
  const go = useCallback((stage: Stage) => setSaved((s) => ({ ...s, stage })), []);

  /** "Write the plan": the AI reads the picture and the story; the starter plan if it can't. */
  const plan = useCallback(async () => {
    setPlanning(true);
    setPlanNote(null);
    const d = saved.draft;
    try {
      const res = await fetch("/api/studio/kids-flow/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          story: d.story,
          name: d.sheet.name,
          shape: d.shape,
          length: d.length,
          moods: d.moods,
          mode: d.mode,
          image: saved.images[0] ?? "",
        }),
      });
      const data = (await res.json()) as { sheet?: Partial<CharacterSheet>; beats?: unknown[]; note?: string; error?: string };
      if (!res.ok) {
        setPlanNote(data.error ?? "Couldn't write the plan.");
        return;
      }
      const coerced = coercePlan({ beats: data.beats }, d.length);
      setSaved((s) => ({
        ...s,
        stage: "board",
        draft: {
          ...s.draft,
          beats: coerced?.beats ?? s.draft.beats,
          // The AI fills what it saw; anything the owner already typed wins.
          sheet: Object.fromEntries(
            Object.entries({ ...s.draft.sheet }).map(([k, v]) => [
              k,
              typeof v === "string" && !v.trim() && typeof data.sheet?.[k as keyof CharacterSheet] === "string"
                ? (data.sheet![k as keyof CharacterSheet] as string)
                : v,
            ]),
          ) as unknown as CharacterSheet,
        },
      }));
      setPlanNote(data.note ?? null);
    } catch {
      setPlanNote("Couldn't reach Jarvis to write the plan. Check your connection and try again.");
    } finally {
      setPlanning(false);
    }
  }, [saved.draft, saved.images]);

  const brief = useMemo(() => briefText(saved.draft), [saved.draft]);
  const problems = useMemo(() => checkPlan(saved.draft), [saved.draft]);

  /** "Send to my PC": the brief and the pictures become one In Queue request. */
  const send = useCallback(async () => {
    setSending(true);
    setSendError(null);
    const title = saved.draft.title.trim() || `${saved.draft.sheet.name || "Our hero"}'s story`;
    const text = queueRequestText({ folder: KIDS_FOLDER, title, brief: briefText({ ...saved.draft, title }) });
    const added = await requests.add(KIDS_FOLDER, text, saved.images.slice(0, 4));
    setSending(false);
    if (added[0]) {
      setSaved((s) => ({ ...s, jobId: added[0].id, stage: "render", draft: { ...s.draft, title } }));
    } else {
      setSendError(requests.error ?? "That exact story is already in the queue.");
    }
  }, [saved.draft, saved.images, requests]);

  /** Start the next story, keeping the character (the thing worth reusing). */
  const newStory = useCallback(() => {
    setSaved((s) => ({
      draft: { ...blankDraft(), sheet: s.draft.sheet, mode: s.draft.mode, look: s.draft.look, aspect: s.draft.aspect },
      images: s.images,
      stage: "story",
    }));
  }, []);

  const films: Film[] = useMemo(() => {
    const open: Film[] = requests.doc.requests
      .filter((r) => r.folder === KIDS_FOLDER)
      .map((r) => ({ kind: "open", id: r.id, title: titleOf(r.text), at: r.createdAt, request: r }));
    const done: Film[] = requests.doc.finished
      .filter((f) => f.folder === KIDS_FOLDER)
      .map((f) => ({ kind: "done", id: f.id, title: titleOf(f.text), at: f.doneAt, finished: f }));
    return [...open, ...done].sort((a, b) => b.at.localeCompare(a.at));
  }, [requests.doc]);

  const job = films.find((f) => f.id === saved.jobId) ?? null;

  return {
    draft: saved.draft,
    images: saved.images,
    stage: saved.stage,
    jobId: saved.jobId,
    job,
    films,
    requests,
    patch,
    patchSheet,
    setBeats,
    setImages,
    go,
    plan,
    planning,
    planNote,
    brief,
    problems,
    send,
    sending,
    sendError,
    newStory,
    openFilm: (id: string) => setSaved((s) => ({ ...s, jobId: id, stage: "watch" })),
  };
}

export type KidsFlow = ReturnType<typeof useKidsFlow>;
