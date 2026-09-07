"use client";

// ---------------------------------------------------------------------------
// The studio's state and every action the screens can take.
//
// One context, one project at a time. Screens never call the routes or the
// repo directly; they call these actions, which persist through the repo and
// keep the generation queue honest. Keeping it here means the storyboard, the
// inspector and the timeline all see the same take the moment it lands.
// ---------------------------------------------------------------------------

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  audioDuration,
  breakdown as breakdownStage,
  buildPrompt,
  describeReference,
  develop as developStage,
  importReference,
  renderShot,
  retake as retakeStage,
} from "@/lib/auteur/client";
import { hueFor, templateById } from "@/lib/auteur/constants";
import { composeH3Prompt } from "@/lib/auteur/director/h3prompt";
import { applyPatch } from "@/lib/auteur/director/retake";
import { deleteMedia, putMedia } from "@/lib/auteur/media";
import {
  KEY,
  activeTake,
  allShots,
  blankProject,
  blankTake,
  deleteProject as repoDelete,
  findShot,
  loadProjects,
  saveProject,
  updateShot,
} from "@/lib/auteur/repo";
import type {
  DirectorEngine,
  Project,
  Reference,
  ReferenceKind,
  ReferenceScope,
  Scene,
  Shot,
  ShotTake,
} from "@/lib/auteur/types";
import { useRemotePull } from "@/lib/sync/useSync";
import { uid } from "@/lib/utils";

export type View = "home" | "project";
export type Tab = "director" | "storyboard" | "timeline" | "assets";

export interface Toast {
  id: string;
  text: string;
  tone: "info" | "ok" | "warn";
}

export type Progress = "uploading" | "queued" | "generating" | "downloading";

export interface Studio {
  projects: Project[];
  project: Project | null;
  view: View;
  tab: Tab;
  selectedShotId: string | null;
  /** shotId → what its render is doing right now. */
  busy: Record<string, Progress>;
  /** Stage names currently running the director ("develop", "breakdown", "prompt:<id>", "retake:<id>"). */
  working: Set<string>;
  engine: DirectorEngine | null;
  resolution: "768P" | "2K";
  toasts: Toast[];

  // navigation
  openProject: (id: string) => void;
  goHome: () => void;
  setTab: (t: Tab) => void;
  selectShot: (id: string | null) => void;
  setResolution: (r: "768P" | "2K") => void;

  // projects
  createProject: (seed: Partial<Project>, files: { file: File; kind?: ReferenceKind }[]) => Promise<void>;
  deleteProject: (id: string) => void;
  update: (fn: (p: Project) => Project) => void;

  // director
  runDevelop: () => Promise<void>;
  runBreakdown: () => Promise<void>;
  runPrompt: (shotId: string) => Promise<void>;
  runRetake: (shotId: string, instruction: string) => Promise<void>;

  // shots
  patchShot: (shotId: string, fn: (s: Shot) => Shot) => void;
  moveShot: (shotId: string, toSceneId: string, toIndex: number) => void;
  duplicateShot: (shotId: string) => void;
  deleteShot: (shotId: string) => void;
  addShot: (sceneId: string) => void;
  setActiveTake: (shotId: string, takeId: string) => void;
  deleteTake: (shotId: string, takeId: string) => void;

  // generation
  generate: (shotId: string, opts?: { retakeNote?: string }) => Promise<void>;
  generateAll: () => Promise<void>;
  cancel: (shotId: string) => void;

  // references
  addReferences: (files: File[], scope: ReferenceScope, kind?: ReferenceKind) => Promise<void>;
  updateReference: (id: string, patch: Partial<Reference>) => void;
  removeReference: (id: string) => void;
  describe: (id: string) => Promise<void>;
  setAudio: (file: File | null) => Promise<void>;

  toast: (text: string, tone?: Toast["tone"]) => void;
}

const Ctx = createContext<Studio | null>(null);

export function useStudio(): Studio {
  const s = useContext(Ctx);
  if (!s) throw new Error("useStudio outside StudioProvider");
  return s;
}

export function StudioProvider({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [view, setView] = useState<View>("home");
  const [tab, setTab] = useState<Tab>("director");
  const [selectedShotId, setSelectedShotId] = useState<string | null>(null);
  const [busy, setBusy] = useState<Record<string, Progress>>({});
  const [working, setWorking] = useState<Set<string>>(new Set());
  const [engine, setEngine] = useState<DirectorEngine | null>(null);
  const [resolution, setResolution] = useState<"768P" | "2K">("768P");
  const [toasts, setToasts] = useState<Toast[]>([]);

  const project = useMemo(() => projects.find((p) => p.id === projectId) ?? null, [projects, projectId]);

  // The latest project is needed inside long async actions (a render can
  // take minutes), and two writes can land in the same tick, before React
  // has re-rendered. So the ref is the source of truth for writers: every
  // commit updates it synchronously, and state follows.
  const projectsRef = useRef(projects);
  const commit = useCallback((list: Project[]) => {
    projectsRef.current = list;
    setProjects(list);
  }, []);
  // Same reasoning for which project is open: an action started right after
  // createProject must see the new id before React has rendered it.
  const projectIdRef = useRef<string | null>(null);
  const selectProject = useCallback((id: string | null) => {
    projectIdRef.current = id;
    setProjectId(id);
  }, []);
  const current = useCallback(() => projectsRef.current.find((p) => p.id === projectIdRef.current) ?? null, []);

  const aborters = useRef(new Map<string, AbortController>());

  useEffect(() => {
    commit(loadProjects());
  }, [commit]);
  useRemotePull(KEY, () => commit(loadProjects()));

  const toast = useCallback((text: string, tone: Toast["tone"] = "info") => {
    const id = uid("t");
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);

  const mark = useCallback((key: string, on: boolean) => {
    setWorking((w) => {
      const n = new Set(w);
      if (on) n.add(key);
      else n.delete(key);
      return n;
    });
  }, []);

  /** Persist a change to the current project and refresh the list. */
  const update = useCallback(
    (fn: (p: Project) => Project) => {
      const p = current();
      if (!p) return;
      commit(saveProject(fn(p)));
    },
    [current, commit],
  );

  // ----- navigation ---------------------------------------------------------

  const openProject = useCallback((id: string) => {
    selectProject(id);
    setView("project");
    const p = projectsRef.current.find((x) => x.id === id);
    setTab(p && p.scenes.length ? "storyboard" : "director");
    setSelectedShotId(p?.scenes[0]?.shots[0]?.id ?? null);
  }, [selectProject]);

  const goHome = useCallback(() => {
    setView("home");
    selectProject(null);
    setSelectedShotId(null);
  }, [selectProject]);

  // ----- references -----------------------------------------------------------

  const describeById = useCallback(
    async (id: string) => {
      const p = current();
      const ref = p?.references.find((r) => r.id === id);
      if (!ref) return;
      const d = await describeReference(ref);
      if (!d) return;
      update((pp) => ({
        ...pp,
        references: pp.references.map((r) =>
          r.id === id
            ? {
                ...r,
                description: r.description.trim() ? r.description : d.description,
                described: true,
                tags: r.tags.length ? r.tags : d.tags,
                kind: r.kind === "image" ? d.suggestedKind : r.kind,
              }
            : r,
        ),
      }));
    },
    [current, update],
  );

  const addReferences = useCallback(
    async (files: File[], scope: ReferenceScope, kind?: ReferenceKind) => {
      const made: Reference[] = [];
      for (const f of files) made.push(await importReference(f, scope, kind));
      update((p) => ({ ...p, references: [...p.references, ...made] }));
      // Vision descriptions arrive after the cards are already on screen.
      for (const r of made) void describeById(r.id);
    },
    [update, describeById],
  );

  const updateReference = useCallback(
    (id: string, patch: Partial<Reference>) =>
      update((p) => ({ ...p, references: p.references.map((r) => (r.id === id ? { ...r, ...patch } : r)) })),
    [update],
  );

  const removeReference = useCallback(
    (id: string) => {
      const p = current();
      const ref = p?.references.find((r) => r.id === id);
      if (ref?.mediaId) void deleteMedia(ref.mediaId);
      update((pp) => ({
        ...pp,
        references: pp.references.filter((r) => r.id !== id),
        characters: pp.characters.map((c) => ({ ...c, referenceIds: c.referenceIds.filter((x) => x !== id) })),
        worlds: pp.worlds.map((w) => ({ ...w, referenceIds: w.referenceIds.filter((x) => x !== id) })),
        style: pp.style ? { ...pp.style, referenceIds: pp.style.referenceIds.filter((x) => x !== id) } : null,
        scenes: pp.scenes.map((s) => ({
          ...s,
          shots: s.shots.map((sh) => ({ ...sh, referenceIds: sh.referenceIds.filter((x) => x !== id) })),
        })),
      }));
    },
    [current, update],
  );

  const setAudio = useCallback(
    async (file: File | null) => {
      const p = current();
      if (p?.audio?.mediaId) void deleteMedia(p.audio.mediaId);
      if (!file) {
        update((pp) => ({ ...pp, audio: null }));
        return;
      }
      const mediaId = await putMedia(file);
      if (!mediaId) {
        toast("Could not store the audio in this browser", "warn");
        return;
      }
      const durationSec = await audioDuration(mediaId);
      update((pp) => ({ ...pp, audio: { name: file.name, mime: file.type, mediaId, durationSec } }));
    },
    [current, update, toast],
  );

  // ----- projects -----------------------------------------------------------

  const createProject = useCallback(
    async (seed: Partial<Project>, files: { file: File; kind?: ReferenceKind }[]) => {
      const p = blankProject(seed);
      const refs: Reference[] = [];
      for (const { file, kind } of files) refs.push(await importReference(file, { level: "project" }, kind));
      const withRefs = { ...p, references: refs, title: seed.title || titleFromIdea(p.idea) };
      commit(saveProject(withRefs));
      selectProject(withRefs.id);
      setView("project");
      setTab("director");
      setSelectedShotId(null);
      // Describe references in the background, then let the director run.
      for (const r of refs) void describeById(r.id);
    },
    [describeById, commit, selectProject],
  );

  const deleteProject = useCallback(
    (id: string) => {
      const p = projectsRef.current.find((x) => x.id === id);
      for (const r of p?.references ?? []) if (r.mediaId) void deleteMedia(r.mediaId);
      for (const { shot } of p ? allShots(p) : []) for (const t of shot.takes) if (t.mediaId) void deleteMedia(t.mediaId);
      if (p?.audio?.mediaId) void deleteMedia(p.audio.mediaId);
      commit(repoDelete(id));
      if (projectId === id) goHome();
    },
    [projectId, goHome, commit],
  );

  // ----- director -----------------------------------------------------------

  const runDevelop = useCallback(async () => {
    const p = current();
    if (!p) return;
    mark("develop", true);
    try {
      const { development, engine: e } = await developStage(p);
      setEngine(e);
      update((pp) => ({
        ...pp,
        title: development.title || pp.title,
        concept: development.concept,
        characters: development.characters,
        worlds: development.worlds,
        style: development.style,
        status: "developed",
      }));
      toast(e === "ai" ? "The Director developed your idea" : "Developed offline — add an AI key for a richer plan", e === "ai" ? "ok" : "info");
    } finally {
      mark("develop", false);
    }
  }, [current, mark, update, toast]);

  const runBreakdown = useCallback(async () => {
    const p = current();
    if (!p) return;
    mark("breakdown", true);
    try {
      const { scenes, engine: e } = await breakdownStage(p);
      setEngine(e);
      // Compose every shot's prompt right away so the board is inspectable.
      const withPrompts: Scene[] = scenes.map((sc) => ({
        ...sc,
        shots: sc.shots.map((sh) => ({ ...sh, prompt: composeH3Prompt({ ...p, scenes }, sc, sh) })),
      }));
      update((pp) => ({ ...pp, scenes: withPrompts, status: "boarded" }));
      setTab("storyboard");
      setSelectedShotId(withPrompts[0]?.shots[0]?.id ?? null);
      const n = withPrompts.reduce((a, s) => a + s.shots.length, 0);
      toast(`${n} shots on the board across ${withPrompts.length} scenes`, "ok");
    } finally {
      mark("breakdown", false);
    }
  }, [current, mark, update, toast]);

  const runPrompt = useCallback(
    async (shotId: string) => {
      const p = current();
      if (!p) return;
      mark(`prompt:${shotId}`, true);
      try {
        const { prompt, engine: e } = await buildPrompt(p, shotId);
        setEngine(e);
        update((pp) => updateShot(pp, shotId, (s) => ({ ...s, prompt, promptEdited: false })));
      } finally {
        mark(`prompt:${shotId}`, false);
      }
    },
    [current, mark, update],
  );

  // ----- shots ----------------------------------------------------------------

  /** Recompose a shot's prompt from its fields unless the user hand-edited it. */
  const recompose = (p: Project, shotId: string): Project => {
    const hit = findShot(p, shotId);
    if (!hit || hit.shot.promptEdited) return p;
    return updateShot(p, shotId, (s) => ({ ...s, prompt: composeH3Prompt(p, hit.scene, s) }));
  };

  const patchShot = useCallback(
    (shotId: string, fn: (s: Shot) => Shot) => update((p) => recompose(updateShot(p, shotId, fn), shotId)),
    [update],
  );

  const moveShot = useCallback(
    (shotId: string, toSceneId: string, toIndex: number) =>
      update((p) => {
        const hit = findShot(p, shotId);
        if (!hit) return p;
        const scenes = p.scenes.map((s) => ({ ...s, shots: s.shots.filter((sh) => sh.id !== shotId) }));
        const target = scenes.find((s) => s.id === toSceneId);
        if (!target) return p;
        const moved = { ...hit.shot, worldId: hit.shot.worldId ?? target.worldId };
        target.shots.splice(Math.max(0, Math.min(toIndex, target.shots.length)), 0, moved);
        return { ...p, scenes };
      }),
    [update],
  );

  const duplicateShot = useCallback(
    (shotId: string) =>
      update((p) => {
        const scenes = p.scenes.map((s) => {
          const i = s.shots.findIndex((sh) => sh.id === shotId);
          if (i < 0) return s;
          const src = s.shots[i];
          const copy: Shot = { ...src, id: uid("sht"), title: `${src.title} (alt)`, takes: [], activeTakeId: null };
          const shots = [...s.shots];
          shots.splice(i + 1, 0, copy);
          return { ...s, shots };
        });
        return { ...p, scenes };
      }),
    [update],
  );

  const deleteShot = useCallback(
    (shotId: string) => {
      const p = current();
      const hit = p ? findShot(p, shotId) : null;
      for (const t of hit?.shot.takes ?? []) if (t.mediaId) void deleteMedia(t.mediaId);
      update((pp) => ({ ...pp, scenes: pp.scenes.map((s) => ({ ...s, shots: s.shots.filter((sh) => sh.id !== shotId) })) }));
      setSelectedShotId((sel) => (sel === shotId ? null : sel));
    },
    [current, update],
  );

  const addShot = useCallback(
    (sceneId: string) =>
      update((p) => {
        const scene = p.scenes.find((s) => s.id === sceneId);
        if (!scene) return p;
        const template = templateById(p.templateId);
        const last = scene.shots[scene.shots.length - 1];
        const shot: Shot = {
          id: uid("sht"),
          title: `${scene.title} — new shot`,
          description: "",
          action: "",
          camera: last?.camera ?? { angle: "eye level", movement: "push in", framing: "medium", lens: "35mm" },
          lighting: last?.lighting ?? "",
          expression: "",
          dialogue: "",
          characterIds: scene.characterIds,
          worldId: scene.worldId,
          durationSec: template.shotSec,
          referenceIds: [],
          continuity: last ? "same wardrobe, location and light as the previous shot" : "",
          prompt: { text: "", cameraLine: "", soundscape: "", music: "", references: [], notes: "" },
          promptEdited: false,
          takes: [],
          activeTakeId: null,
        };
        const next = { ...p, scenes: p.scenes.map((s) => (s.id === sceneId ? { ...s, shots: [...s.shots, shot] } : s)) };
        setSelectedShotId(shot.id);
        return recompose(next, shot.id);
      }),
    [update],
  );

  const setActiveTake = useCallback(
    (shotId: string, takeId: string) => update((p) => updateShot(p, shotId, (s) => ({ ...s, activeTakeId: takeId }))),
    [update],
  );

  const deleteTake = useCallback(
    (shotId: string, takeId: string) => {
      const p = current();
      const t = p ? findShot(p, shotId)?.shot.takes.find((x) => x.id === takeId) : null;
      if (t?.mediaId) void deleteMedia(t.mediaId);
      update((pp) =>
        updateShot(pp, shotId, (s) => {
          const takes = s.takes.filter((x) => x.id !== takeId);
          return { ...s, takes, activeTakeId: s.activeTakeId === takeId ? takes[takes.length - 1]?.id ?? null : s.activeTakeId };
        }),
      );
    },
    [current, update],
  );

  // ----- generation -----------------------------------------------------------

  const generate = useCallback(
    async (shotId: string, opts: { retakeNote?: string } = {}) => {
      const p0 = current();
      if (!p0) return;
      const hit = findShot(p0, shotId);
      if (!hit) return;
      if (aborters.current.has(shotId)) return; // already rendering

      // The prompt to render: whatever the shot holds, composed if empty.
      const prompt = hit.shot.prompt.text.trim() ? hit.shot.prompt : composeH3Prompt(p0, hit.scene, hit.shot);
      const take: ShotTake = blankTake(prompt.text, hueFor(p0), opts.retakeNote);
      update((p) => updateShot(p, shotId, (s) => ({ ...s, prompt, takes: [...s.takes, take], activeTakeId: take.id })));

      const ac = new AbortController();
      aborters.current.set(shotId, ac);
      setBusy((b) => ({ ...b, [shotId]: "uploading" }));
      const setTake = (patch: Partial<ShotTake>) =>
        update((p) => updateShot(p, shotId, (s) => ({ ...s, takes: s.takes.map((t) => (t.id === take.id ? { ...t, ...patch } : t)) })));

      try {
        setTake({ status: "generating" });
        const outcome = await renderShot(p0, hit.shot, prompt, {
          resolution,
          signal: ac.signal,
          onProgress: (state) => setBusy((b) => ({ ...b, [shotId]: state })),
        });
        if (outcome.error) {
          setTake({ status: "error", engine: outcome.engine, error: outcome.error });
          toast(`Shot failed: ${outcome.error}`, "warn");
          return;
        }
        if (outcome.blob) {
          const mediaId = await putMedia(outcome.blob);
          setTake({ status: "done", engine: "minimax", mediaId: mediaId ?? undefined, error: mediaId ? undefined : "Rendered, but could not be stored" });
          toast("Shot rendered with MiniMax H3", "ok");
        } else {
          setTake({ status: "done", engine: "placeholder", error: undefined });
        }
      } finally {
        aborters.current.delete(shotId);
        setBusy((b) => {
          const n = { ...b };
          delete n[shotId];
          return n;
        });
      }
    },
    [current, update, resolution, toast],
  );

  const generateAll = useCallback(async () => {
    const p = current();
    if (!p) return;
    const pending = allShots(p).filter(({ shot }) => activeTake(shot)?.status !== "done" && !aborters.current.has(shot.id));
    if (!pending.length) {
      toast("Every shot already has a take", "info");
      return;
    }
    // Two at a time: fast enough to feel parallel, gentle on rate limits.
    const queue = [...pending];
    const worker = async () => {
      while (queue.length) {
        const next = queue.shift();
        if (next) await generate(next.shot.id);
      }
    };
    await Promise.all([worker(), worker()]);
  }, [current, generate, toast]);

  const cancel = useCallback((shotId: string) => {
    aborters.current.get(shotId)?.abort();
  }, []);

  const runRetake = useCallback(
    async (shotId: string, instruction: string) => {
      const p = current();
      if (!p) return;
      mark(`retake:${shotId}`, true);
      try {
        const { patch, engine: e } = await retakeStage(p, shotId, instruction);
        setEngine(e);
        // Apply the patch to the shot's fields, recompose with any wardrobe
        // override, and render that as a new take. The old take stays.
        let next = p;
        next = updateShot(next, shotId, (s) => applyPatch(s, patch));
        const hit = findShot(next, shotId)!;
        const prompt = composeH3Prompt(next, hit.scene, hit.shot, { characterOverrides: patch.characterOverrides });
        next = updateShot(next, shotId, (s) => ({ ...s, prompt, promptEdited: false }));
        commit(saveProject(next));
        toast(`Retake: ${patch.summary}`, "ok");
        await generate(shotId, { retakeNote: patch.summary || instruction });
      } finally {
        mark(`retake:${shotId}`, false);
      }
    },
    [current, mark, generate, toast, commit],
  );

  const value: Studio = {
    projects,
    project,
    view,
    tab,
    selectedShotId,
    busy,
    working,
    engine,
    resolution,
    toasts,
    openProject,
    goHome,
    setTab,
    selectShot: setSelectedShotId,
    setResolution,
    createProject,
    deleteProject,
    update,
    runDevelop,
    runBreakdown,
    runPrompt,
    runRetake,
    patchShot,
    moveShot,
    duplicateShot,
    deleteShot,
    addShot,
    setActiveTake,
    deleteTake,
    generate,
    generateAll,
    cancel,
    addReferences,
    updateReference,
    removeReference,
    describe: describeById,
    setAudio,
    toast,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

function titleFromIdea(idea: string): string {
  const cleaned = idea
    .replace(/^\s*(please\s+)?(create|make|generate|produce|write|shoot|film)\s+(me\s+)?(a|an|the)?\s*/i, "")
    .trim();
  const words = cleaned.split(/\s+/).slice(0, 5).join(" ");
  return words ? words.charAt(0).toUpperCase() + words.slice(1).replace(/[.,;:]$/, "") : "Untitled";
}
