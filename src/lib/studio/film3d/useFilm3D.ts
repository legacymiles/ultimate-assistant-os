"use client";

// ---------------------------------------------------------------------------
// 3D Animation Flow's state: one draft kept on this device (a reload never
// loses a half-made film), the pictures, the stage, and the film it became.
//
// Two ways to make the film, both from the same draft:
//   • Make it here — the browser renders the MP4 itself (encode.ts), files it
//     with the owner's films and uploads it so it plays on every device.
//   • Send to my PC — an In Queue request carrying the exact film; Claude Code
//     on the PC renders it in HD with the threejs-film-story skill.
// Progress of a PC job is read live from In Queue, never stored here.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadLocal, saveLocal } from "@/lib/sync/appState";
import { shrinkImage, useRequests } from "@/lib/new-jarvis/useRequests";
import type { FinishedRequest, QueueRequest } from "@/lib/new-jarvis/requests";
import { samplePalette } from "../kids-flow/palette";
import {
  DEFAULT_STORY,
  blankDraft,
  briefText,
  checkPlan,
  coerceBeats,
  coerceHero,
  defaultHero,
  filmOf,
  fromPrompt,
  heroFromPalette,
  type Beat3D,
  type Film3DDraft,
  type Hero3D,
} from "./plan";

export interface Film3DSeed {
  text: string;
  keywords: string[];
  images: string[];
  nonce: number;
}

export const FILM3D_FOLDER = "flow:film-3d";
const KEY = "jarvis.film3d.v1";

export type Stage = "character" | "story" | "board" | "render" | "watch";
export const STAGES: { id: Stage; label: string }[] = [
  { id: "character", label: "Character" },
  { id: "story", label: "Story" },
  { id: "board", label: "Storyboard" },
  { id: "render", label: "Render" },
  { id: "watch", label: "Watch" },
];

interface Saved {
  draft: Film3DDraft;
  images: string[];
  palette: string[];
  stage: Stage;
  jobId?: string;
}

export type Film =
  | { kind: "open"; id: string; title: string; at: string; request: QueueRequest }
  | { kind: "done"; id: string; title: string; at: string; finished: FinishedRequest };

export interface LocalRender {
  phase: "rendering" | "uploading" | "done" | "error";
  progress: number;
  label: string;
  url?: string;
  size?: string;
  method?: string;
  /** The film's request id, once filed. */
  id?: string;
  error?: string;
}

function titleOf(text: string): string {
  return text.split("\n")[0].replace(/^TITLE:\s*/, "").slice(0, 80) || "Untitled film";
}

function restore(): Saved {
  const s = loadLocal<Saved | null>(KEY, null);
  const blank = blankDraft();
  if (!s?.draft) return { draft: blank, images: [], palette: [], stage: "character" };
  return {
    ...s,
    palette: s.palette ?? [],
    draft: { ...blank, ...s.draft, hero: { ...defaultHero(), ...s.draft.hero } },
  };
}

export function useFilm3D() {
  const [saved, setSaved] = useState<Saved>(restore);
  const [planning, setPlanning] = useState<null | "plan" | "hero">(null);
  const [planNote, setPlanNote] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [local, setLocal] = useState<LocalRender | null>(null);
  const abort = useRef<AbortController | null>(null);
  const requests = useRequests();
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    saveLocal(KEY, saved);
  }, [saved]);

  const patch = useCallback((p: Partial<Film3DDraft>) => setSaved((s) => ({ ...s, draft: { ...s.draft, ...p } })), []);
  const patchHero = useCallback((p: Partial<Hero3D>) => setSaved((s) => ({ ...s, draft: { ...s.draft, hero: { ...s.draft.hero, ...p } } })), []);
  const setBeats = useCallback((beats: Beat3D[]) => setSaved((s) => ({ ...s, draft: { ...s.draft, beats } })), []);
  const go = useCallback((stage: Stage) => setSaved((s) => ({ ...s, stage })), []);

  const callPlanner = useCallback(async (d: Film3DDraft, pictures: string[], heroOnly: boolean) => {
    const res = await fetch("/api/studio/film3d/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ story: d.story, name: d.hero.name, length: d.length, moods: d.moods, hero: d.hero, image: pictures[0] ?? "", heroOnly }),
    });
    return (await res.json()) as { hero?: unknown; beats?: unknown[]; note?: string; error?: string; source?: string };
  }, []);

  /** The picture → the hero's colours, hair, clothes and signature item. */
  const readPicture = useCallback(
    async (pictures?: string[]) => {
      const pics = pictures ?? saved.images;
      if (!pics.length) return;
      setPlanning("hero");
      setPlanNote(null);
      try {
        const data = await callPlanner(saved.draft, pics, true);
        if (data.error) setPlanNote(data.error);
        else if (data.source === "ai") {
          setSaved((s) => ({ ...s, draft: { ...s.draft, hero: coerceHero(data.hero, s.draft.hero) } }));
          setPlanNote(null);
        } else {
          // No AI to read it: dress them from the colours measured in the picture.
          const palette = await samplePalette(pics[0]).catch(() => [] as string[]);
          setSaved((s) => ({ ...s, draft: { ...s.draft, hero: heroFromPalette(palette, s.draft.hero) } }));
          setPlanNote(data.note ?? null);
        }
      } catch {
        setPlanNote("Couldn't reach Jarvis to read the picture. Set the colours from the swatches instead.");
      } finally {
        setPlanning(null);
      }
    },
    [saved.images, saved.draft, callPlanner],
  );

  const planWith = useCallback(
    async (d: Film3DDraft, pictures: string[]) => {
      setPlanning("plan");
      setPlanNote(null);
      try {
        const data = await callPlanner(d, pictures, false);
        if (data.error) {
          setPlanNote(data.error);
          return;
        }
        const beats = coerceBeats(data.beats, d.length);
        setSaved((s) => ({
          ...s,
          stage: "board",
          draft: {
            ...s.draft,
            beats: beats.length ? beats : s.draft.beats,
            hero: pictures.length && data.source === "ai" ? coerceHero(data.hero, s.draft.hero) : s.draft.hero,
          },
        }));
        setPlanNote(data.note ?? null);
      } catch {
        setPlanNote("Couldn't reach Jarvis to write the storyboard. Check your connection and try again.");
      } finally {
        setPlanning(null);
      }
    },
    [callPlanner],
  );

  const plan = useCallback(() => planWith(saved.draft, saved.images), [planWith, saved.draft, saved.images]);

  /** New pictures in: shrink, sample their colours, and read them into the hero. */
  const addPictures = useCallback(
    async (files: (File | Blob)[]) => {
      const shrunk = (await Promise.all(files.slice(0, 4).map((f) => shrinkImage(f).catch(() => null)))).filter((x): x is string => Boolean(x));
      if (!shrunk.length) return;
      const palette = await samplePalette(shrunk[0]).catch(() => [] as string[]);
      setSaved((s) => ({ ...s, images: shrunk, palette }));
      await readPicture(shrunk);
    },
    [readPicture],
  );

  /** The Studio composer's prompt (and pictures) → a fresh film, storyboard written at once. */
  const startFromPrompt = useCallback(
    async (seed: Film3DSeed) => {
      const read = fromPrompt(seed.text, seed.keywords);
      const shrunk = (
        await Promise.all(
          seed.images.slice(0, 4).map(async (src) => {
            try {
              return await shrinkImage(await (await fetch(src)).blob());
            } catch {
              return null;
            }
          }),
        )
      ).filter((x): x is string => Boolean(x));
      const prev = saved;
      const newHero = shrunk.length > 0;
      const palette = newHero ? await samplePalette(shrunk[0]).catch(() => [] as string[]) : prev.palette;
      const dressed = newHero ? heroFromPalette(palette, prev.draft.hero) : prev.draft.hero;
      const hero: Hero3D = { ...dressed, ...(read.name ? { name: read.name } : {}) };
      const draft: Film3DDraft = {
        ...blankDraft(),
        look: read.look ?? prev.draft.look,
        aspect: read.aspect ?? prev.draft.aspect,
        words: read.words ?? prev.draft.words,
        length: read.length ?? prev.draft.length,
        moods: read.moods,
        story: read.story || (newHero || !prev.draft.story ? DEFAULT_STORY : prev.draft.story),
        hero,
      };
      if (!read.story && !read.name && !newHero) {
        setSaved({ ...prev, stage: prev.draft.beats.length || prev.jobId ? prev.stage : "character" });
        return;
      }
      const images = newHero ? shrunk : prev.images;
      setSaved({ draft, images, palette, stage: "board" });
      await planWith(draft, images);
    },
    [saved, planWith],
  );

  const film = useMemo(() => filmOf(saved.draft), [saved.draft]);
  const problems = useMemo(() => checkPlan(saved.draft), [saved.draft]);

  /** "Send to my PC (HD)": the exact film becomes one In Queue request. */
  const send = useCallback(async () => {
    setSending(true);
    setSendError(null);
    const title = saved.draft.title.trim() || `${saved.draft.hero.name || "Our hero"}'s story`;
    const text = briefText({ ...saved.draft, title });
    const added = await requests.add(FILM3D_FOLDER, text, saved.images.slice(0, 2));
    setSending(false);
    if (added[0]) setSaved((s) => ({ ...s, jobId: added[0].id, stage: "render", draft: { ...s.draft, title } }));
    else setSendError(requests.error ?? "That exact film is already in the queue.");
  }, [saved.draft, saved.images, requests]);

  /** "Make it here": render in this browser, then file + upload it with the films. */
  const renderHere = useCallback(
    async (short: 720 | 1080) => {
      abort.current?.abort();
      const ctrl = new AbortController();
      abort.current = ctrl;
      const title = saved.draft.title.trim() || `${saved.draft.hero.name || "Our hero"}'s story`;
      const draft = { ...saved.draft, title };
      setSaved((s) => ({ ...s, draft: { ...s.draft, title } }));
      setLocal({ phase: "rendering", progress: 0, label: "Composing the music…" });
      let url: string | undefined;
      try {
        const { renderFilmToMp4 } = await import("./encode");
        const r = await renderFilmToMp4(filmOf(draft), {
          short,
          signal: ctrl.signal,
          onProgress: (p) =>
            setLocal((l) => ({
              ...(l ?? { phase: "rendering" }),
              phase: "rendering",
              progress: p.stage === "music" ? 0.02 : p.stage === "finishing" ? 0.98 : 0.02 + 0.96 * (p.done / Math.max(1, p.total)),
              label: p.stage === "music" ? "Composing the music…" : p.stage === "finishing" ? "Finishing the file…" : `Drawing frame ${Math.round(p.done)} of ${Math.round(p.total)}`,
            })),
        });
        url = URL.createObjectURL(r.blob);
        const size = `${(r.blob.size / 1e6).toFixed(1)} MB`;
        setLocal({ phase: "uploading", progress: 1, label: "Saving it to your films…", url, size, method: r.method });

        const text = `${briefText(draft)}\nRENDERED: in the browser, ${r.width}×${r.height}, ${new Date().toISOString()}`;
        const start = await fetch("/api/studio/film3d/video", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "start", text }) });
        const s = (await start.json()) as { id?: string; url?: string; local?: boolean; error?: string };
        if (!start.ok || !s.id) {
          setLocal({ phase: "done", progress: 1, label: s.error ?? "Made — but it's only on this device (not signed in).", url, size, method: r.method });
          setSaved((st) => ({ ...st, stage: "watch", jobId: undefined }));
          return;
        }
        let ok: boolean;
        if (s.url) {
          const put = await fetch(s.url, { method: "PUT", headers: { "Content-Type": "video/mp4", "x-upsert": "true" }, body: r.blob });
          ok = put.ok;
        } else {
          const form = new FormData();
          form.set("id", s.id);
          form.set("file", r.blob, `${s.id}.mp4`);
          ok = (await fetch("/api/studio/film3d/video", { method: "POST", body: form })).ok;
        }
        if (!ok) {
          setLocal({ phase: "done", progress: 1, id: s.id, url, size, method: r.method, label: "Made, but the upload failed — it's here to download, and your PC will render it in HD the next time it works the queue." });
          setSaved((st) => ({ ...st, stage: "watch", jobId: s.id }));
          return;
        }
        await fetch("/api/studio/film3d/video", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ op: "done", id: s.id, result: `Rendered in the browser · ${r.width}×${r.height} · ${r.seconds.toFixed(0)} s · ${size}` }),
        });
        setLocal({ phase: "done", progress: 1, id: s.id, url, size, method: r.method, label: "Saved to your films — it plays on every device." });
        setSaved((st) => ({ ...st, stage: "watch", jobId: s.id }));
      } catch (e) {
        if ((e as Error)?.name === "AbortError") setLocal(null);
        else setLocal({ phase: "error", progress: 0, label: "", url, error: (e as Error)?.message || "The render stopped." });
      }
    },
    [saved.draft],
  );

  const cancelRender = useCallback(() => abort.current?.abort(), []);

  const newStory = useCallback(() => {
    setLocal(null);
    setSaved((s) => ({
      draft: { ...blankDraft(), hero: s.draft.hero, look: s.draft.look, aspect: s.draft.aspect },
      images: s.images,
      palette: s.palette,
      stage: "story",
    }));
  }, []);

  const films: Film[] = useMemo(() => {
    const open: Film[] = requests.doc.requests
      .filter((r) => r.folder === FILM3D_FOLDER)
      .map((r) => ({ kind: "open", id: r.id, title: titleOf(r.text), at: r.createdAt, request: r }));
    const done: Film[] = requests.doc.finished
      .filter((f) => f.folder === FILM3D_FOLDER)
      .map((f) => ({ kind: "done", id: f.id, title: titleOf(f.text), at: f.doneAt, finished: f }));
    return [...open, ...done].sort((a, b) => b.at.localeCompare(a.at));
  }, [requests.doc]);

  const job = films.find((f) => f.id === saved.jobId) ?? null;

  return {
    draft: saved.draft,
    images: saved.images,
    palette: saved.palette,
    stage: saved.stage,
    jobId: saved.jobId,
    film,
    job,
    films,
    requests,
    patch,
    patchHero,
    setBeats,
    setImages: (images: string[]) => setSaved((s) => ({ ...s, images })),
    go,
    plan,
    readPicture,
    addPictures,
    startFromPrompt,
    planning,
    planNote,
    problems,
    send,
    sending,
    sendError,
    renderHere,
    cancelRender,
    local,
    newStory,
    openFilm: (id: string) => setSaved((s) => ({ ...s, jobId: id, stage: "watch" })),
  };
}

export type Film3DFlow = ReturnType<typeof useFilm3D>;
