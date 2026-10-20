"use client";

// ---------------------------------------------------------------------------
// App Builder — state on this device, synced to the owner's other devices.
//
// Projects live under one synced key (src/lib/sync/appState.ts): localStorage
// is the read path, so the page never waits on the network; the same blob is
// pushed to Supabase so a project started on the phone continues on the PC
// (checklist D3). Recordings are NOT in that blob — their frames go up to the
// agent once, and only a thumbnail per source plus four key frames (for the
// In Queue hand-off) are kept. Every agent call goes through `call`, which
// times out and turns any failure into a plain-English line (R3, R5).
//
// Jarvis chat (and Camera Autopilot through it) hands requests in with
// `handToAppBuilder` (./fromChat): the project arrives `pending`, its media in
// the IndexedDB inbox, and this hook starts it the moment App Builder opens.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadLocal, saveSynced } from "@/lib/sync/appState";
import { useRemotePull } from "@/lib/sync/useSync";
import { sendToBoard } from "@/lib/new-jarvis/board";
import {
  applyOps,
  bestGuesses,
  chatMsg,
  featureTickets,
  mergeProjects,
  mergeTeardown,
  newId,
  newProject,
} from "./engine";
import { noteBuildInReview, postToQueue, QUEUE_FOLDER } from "./queue";
import { dropMedia, getMedia } from "./inbox";
import { forWire, keyframesOf, type PreparedMedia } from "./media";
import type { Answers, BuilderProject, Feature, FeatureOp, MediaSource, Question, Teardown, Understanding } from "./types";

export const STORE_KEY = "app-builder:v1";
export { QUEUE_FOLDER };

export interface Store {
  projects: BuilderProject[];
  currentId: string | null;
}

const EMPTY: Store = { projects: [], currentId: null };

export function readStore(): Store {
  const s = loadLocal<Store>(STORE_KEY, EMPTY);
  return { projects: mergeProjects(Array.isArray(s?.projects) ? s.projects : []), currentId: s?.currentId ?? null };
}

export function writeStore(next: Store): Store {
  const clean = { ...next, projects: mergeProjects(next.projects).slice(0, 60) };
  saveSynced(STORE_KEY, clean);
  return clean;
}

async function call<T>(body: Record<string, unknown>, timeoutMs = 95_000): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch("/api/app-builder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const data = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) {
      throw new Error(
        data.error ||
          (res.status === 401
            ? "Sign in to Jarvis to use App Builder."
            : res.status === 413
              ? "Those attachments are too big together. Try a shorter clip or fewer pictures."
              : "The super agent didn't answer. Try again in a moment."),
      );
    }
    return data;
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw new Error("The super agent took too long. Try again — your work is saved.");
    if (e instanceof TypeError) throw new Error("Couldn't reach Jarvis. Check your connection — your work is saved.");
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** What's kept about an attachment once it has been sent: a thumbnail and the facts. */
export function sourcesOf(media: PreparedMedia[], now = new Date()): MediaSource[] {
  return media.map((m) => ({
    id: m.id || newId("src_"),
    kind: m.kind,
    name: m.name,
    thumb: m.thumb,
    duration: m.duration,
    frames: m.frames.length,
    hasSound: Boolean(m.sound),
    at: now.toISOString(),
  }));
}

export type Busy = null | "interview" | "features" | "chat" | "queue" | "board";

interface StartReply {
  understanding: Understanding;
  intro: string;
  questions: Question[];
  teardown?: Teardown;
  notice?: string;
}

export function useAppBuilder() {
  const [store, setStore] = useState<Store>(EMPTY);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const storeRef = useRef(store);
  storeRef.current = store;
  const starting = useRef(new Set<string>());

  useEffect(() => {
    const s = readStore();
    // ?p=<id> — a project handed over from Jarvis chat opens straight away.
    const wanted = new URLSearchParams(window.location.search).get("p");
    const next = wanted && s.projects.some((p) => p.id === wanted) ? { ...s, currentId: wanted } : s;
    storeRef.current = next;
    setStore(next);
    setReady(true);
  }, []);
  useRemotePull(STORE_KEY, () => {
    const s = readStore();
    const keep = storeRef.current.currentId;
    const next = { ...s, currentId: keep && s.projects.some((p) => p.id === keep) ? keep : s.currentId };
    storeRef.current = next;
    setStore(next);
  });

  const commit = useCallback((next: Store) => {
    const clean = writeStore(next);
    storeRef.current = clean;
    setStore(clean);
  }, []);

  const current = useMemo(
    () => store.projects.find((p) => p.id === store.currentId) ?? null,
    [store.projects, store.currentId],
  );

  const find = (id: string) => storeRef.current.projects.find((p) => p.id === id);

  /** Change one project; stamps updatedAt. */
  const update = useCallback(
    (id: string, fn: (p: BuilderProject) => BuilderProject) => {
      const s = storeRef.current;
      commit({
        ...s,
        projects: s.projects.map((p) => (p.id === id ? { ...fn(p), updatedAt: new Date().toISOString() } : p)),
      });
    },
    [commit],
  );

  const run = useCallback(async (kind: Busy, fn: () => Promise<void>) => {
    setBusy(kind);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Try again.");
    } finally {
      setBusy(null);
    }
  }, []);

  /**
   * Stage 1 → 2 for a project that exists: read the idea (and watch the
   * recording, when there is one), then ask what it's for.
   */
  const begin = useCallback(
    async (id: string, media: PreparedMedia[]) => {
      const p = find(id);
      if (!p) return;
      const wire = media.length ? forWire(media) : null;
      if (wire?.note) setNotice(wire.note);
      const data = await call<StartReply>(
        wire ? { action: "watch", idea: p.idea, media: wire.media } : { action: "interview", idea: p.idea },
      );
      if (data.notice) setNotice(data.notice);
      update(id, (x) => ({
        ...x,
        stage: "interview",
        pending: false,
        understanding: data.understanding,
        questions: data.questions,
        ...(data.teardown ? { teardown: data.teardown } : {}),
        chat: [...(x.chat.length ? x.chat : [chatMsg("you", x.idea)]), chatMsg("agent", data.intro)],
      }));
      await dropMedia(id);
    },
    [update],
  );

  const start = useCallback(
    (idea: string, media: PreparedMedia[] = []) =>
      run("interview", async () => {
        const p: BuilderProject = {
          ...newProject(idea || (media.length ? "Recreate the app in this recording" : "")),
          origin: "app",
          ...(media.length ? { sources: sourcesOf(media), keyframes: keyframesOf(media) } : {}),
        };
        commit({ projects: [p, ...storeRef.current.projects], currentId: p.id });
        await begin(p.id, media);
      }),
    [begin, commit, run],
  );

  // A project handed over from Jarvis chat starts itself once, on this device.
  useEffect(() => {
    if (!current?.pending || current.stage !== "idea" || busy || starting.current.has(current.id)) return;
    starting.current.add(current.id);
    const id = current.id;
    void run("interview", async () => {
      const media = await getMedia(id);
      if (!media.length && current.sources?.length) {
        setNotice("The recording for this one is on the device you sent it from, so I'm starting from your words. Open it there to have me watch it.");
      }
      await begin(id, media);
    });
  }, [current, busy, begin, run]);

  /** Start (or retry) a project that's waiting at the idea stage. */
  const resume = useCallback(() => {
    const id = storeRef.current.currentId;
    if (!id) return;
    void run("interview", async () => begin(id, await getMedia(id)));
  }, [begin, run]);

  const setAnswer = useCallback(
    (qid: string, value: string | string[]) => {
      if (!current) return;
      update(current.id, (p) => ({ ...p, answers: { ...p.answers, [qid]: value } }));
    },
    [current, update],
  );

  // ----- stage 2 → 3: the feature list ------------------------------------------------
  const design = useCallback(
    (useGuesses = false) =>
      run("features", async () => {
        const p = find(storeRef.current.currentId ?? "");
        if (!p) return;
        const answers: Answers = useGuesses ? bestGuesses(p.questions, p.answers) : p.answers;
        const data = await call<{ understanding: Understanding; features: Feature[]; message: string; teardown?: Teardown | null; notice?: string; engine: "ai" | "offline" }>({
          action: "features",
          idea: p.idea,
          answers,
          ...(p.teardown ? { teardown: p.teardown } : {}),
        });
        setNotice(data.notice ?? null);
        update(p.id, (x) => ({
          ...x,
          stage: "features",
          answers,
          understanding: data.understanding,
          features: data.features,
          engine: data.engine,
          ...(data.teardown ? { teardown: data.teardown } : {}),
          chat: [...x.chat, chatMsg("agent", data.message)],
        }));
      }),
    [run, update],
  );

  // ----- the feature list: buttons and chat change it the same way ---------------------
  const apply = useCallback(
    (ops: FeatureOp[]) => {
      if (!current) return;
      update(current.id, (p) => ({ ...p, features: applyOps(p.features, ops).features }));
    },
    [current, update],
  );

  const say = useCallback(
    (message: string, media: PreparedMedia[] = []) =>
      run("chat", async () => {
        const p = find(storeRef.current.currentId ?? "");
        if (!p || (!message.trim() && !media.length)) return;
        const words = message.trim() || (media.length ? `(attached ${media.length === 1 ? media[0].name : `${media.length} files`})` : "");
        const mine = chatMsg("you", words);
        const wire = media.length ? forWire(media) : null;
        if (wire?.note) setNotice(wire.note);
        update(p.id, (x) => ({
          ...x,
          chat: [...x.chat, mine],
          ...(media.length
            ? { sources: [...sourcesOf(media), ...(x.sources ?? [])].slice(0, 12), keyframes: x.keyframes?.length ? x.keyframes : keyframesOf(media) }
            : {}),
        }));
        const data = await call<{ reply: string; features: Feature[]; changes: string[]; notice?: string; teardown?: Teardown }>({
          action: "chat",
          idea: p.idea,
          understanding: p.understanding,
          features: p.features,
          history: p.chat.slice(-10),
          message: message.trim(),
          ...(p.teardown ? { teardown: p.teardown } : {}),
          ...(wire ? { media: wire.media } : {}),
        });
        if (data.notice) setNotice(data.notice);
        // Apply to the list as it is NOW, so a button pressed while the agent
        // was thinking isn't lost: only features the agent changed or added
        // are taken from its answer.
        update(p.id, (x) => {
          const now = new Map(x.features.map((f) => [f.id, f]));
          const before = new Map(p.features.map((f) => [f.id, f]));
          const merged = data.features.map((f) => {
            const was = before.get(f.id);
            const cur = now.get(f.id);
            const changed = !was || JSON.stringify(was) !== JSON.stringify(f);
            return changed || !cur ? f : cur;
          });
          return {
            ...x,
            features: merged,
            ...(data.teardown ? { teardown: mergeTeardown(x.teardown, data.teardown) } : {}),
            chat: [...x.chat, chatMsg("agent", data.reply, data.changes)],
          };
        });
      }),
    [run, update],
  );

  // ----- hand-off ------------------------------------------------------------------------
  const sendToQueue = useCallback(
    () =>
      run("queue", async () => {
        const p = find(storeRef.current.currentId ?? "");
        if (!p) return;
        const id = await postToQueue(p);
        const noted = p.edit ? await noteBuildInReview(p, id) : false;
        const skills = `${p.teardown ? "video-analyzer, rea (reverse-engineer-anything), " : ""}felix, prompt-enhancer, ${p.understanding?.designSkill ?? "the design skill"}, software-factory and claude-security`;
        update(p.id, (x) => ({
          ...x,
          handoff: { ...x.handoff, at: new Date().toISOString(), queueId: id ?? x.handoff?.queueId },
          chat: [
            ...x.chat,
            chatMsg(
              "agent",
              id && x.edit
                ? `Queued as ${id}. Claude Code builds the ${x.edit.items.length} edit${x.edit.items.length === 1 ? "" : "s"} on ${x.edit.branch} in ${x.edit.repo ?? "the client's repo"}, opens a pull request for you to merge, and posts the preview to ${x.edit.clientName || "the client"}'s review link as ${x.edit.version}${noted ? "" : " (Client Review couldn't be updated — the build still runs)"}.`
                : id
                ? `Queued as ${id} in In Queue › App Builder${x.keyframes?.length ? `, with ${Math.min(4, x.keyframes.length)} frames from the recording` : ""}. Claude Code on your PC or VPS builds it the next time it works the queue ("work my Jarvis queue") — running ${skills}.`
                : "That exact build is already in the queue.",
            ),
          ],
        }));
      }),
    [run, update],
  );

  const sendCards = useCallback(
    () =>
      run("board", async () => {
        const p = find(storeRef.current.currentId ?? "");
        if (!p) return;
        const tickets = featureTickets(p);
        if (!tickets.length) throw new Error("Accept at least one feature first.");
        const already = new Set((p.handoff?.cards ?? []).map((c) => c.title));
        const made: { number: number; url?: string; title: string }[] = [];
        for (const t of tickets) {
          if (already.has(t.title)) continue; // no duplicate cards
          const r = await sendToBoard(t);
          if (!r.ok || !r.number) {
            if (made.length === 0) throw new Error(r.message);
            break;
          }
          made.push({ number: r.number, url: r.url, title: t.title });
        }
        update(p.id, (x) => ({
          ...x,
          handoff: { ...x.handoff, at: new Date().toISOString(), cards: [...(x.handoff?.cards ?? []), ...made] },
          chat: [
            ...x.chat,
            chatMsg(
              "agent",
              made.length
                ? `Filed ${made.length} card${made.length === 1 ? "" : "s"} to Backlog (${made.map((c) => `#${c.number}`).join(", ")}). Move them to Ready when you want the factory to build them — you approve every merge.`
                : "Every accepted feature is already on the board.",
            ),
          ],
        }));
      }),
    [run, update],
  );

  // ----- projects ------------------------------------------------------------------------
  const open = useCallback((id: string | null) => commit({ ...storeRef.current, currentId: id }), [commit]);
  const remove = useCallback(
    (id: string) => {
      const s = storeRef.current;
      commit({ projects: s.projects.filter((p) => p.id !== id), currentId: s.currentId === id ? null : s.currentId });
      void dropMedia(id);
    },
    [commit],
  );
  const rename = useCallback(
    (name: string) => {
      if (!current?.understanding || !name.trim()) return;
      update(current.id, (p) => ({ ...p, understanding: { ...p.understanding!, name: name.trim().slice(0, 48) } }));
    },
    [current, update],
  );

  return {
    ready,
    projects: store.projects,
    current,
    busy,
    error,
    notice,
    clearError: () => setError(null),
    clearNotice: () => setNotice(null),
    start,
    resume,
    setAnswer,
    design,
    apply,
    say,
    sendToQueue,
    sendCards,
    open,
    remove,
    rename,
  };
}
