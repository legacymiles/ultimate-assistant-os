"use client";

// ---------------------------------------------------------------------------
// Music Creator — the studio's shared state.
//
// One context holds the things every tool needs and nothing a tool could own
// itself: the project list, the Voice Library, whether the GPU server is there,
// and the render queue. A tool reads this, renders its own interface, and keeps
// its own working state in `project.data`.
//
// `render()` lives here rather than in each tool on purpose. Every tool submits
// the same YuE2 request in the end, and a shared submit path means one place
// decides what a failed render looks like, one place records a take, and a tool
// author cannot accidentally invent a different behaviour for a dead server.
// ---------------------------------------------------------------------------

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useRemotePull } from "@/lib/sync/useSync";
import {
  checkServer,
  ensureServer,
  ensureVoiceOnServer,
  fileUrl,
  runJob,
  saveToLibrary,
} from "@/lib/music-creator/client";
import {
  PROJECTS_KEY,
  VOICES_KEY,
  loadProjects,
  loadVoices,
  newProject,
  saveProjects,
  saveVoices,
} from "@/lib/music-creator/store";
import type { Job, Project, Render, RenderKind, ServerState, SongRequest, VoiceProfile } from "@/lib/music-creator/types";

export type View =
  | { kind: "home" }
  | { kind: "tool"; toolId: string; projectId: string }
  | { kind: "projects" }
  | { kind: "voices" };

/** A render in flight, keyed by project so two tools can work at once. */
export interface Running {
  projectId: string;
  label: string;
  stage: string;
  progress: number;
  jobId?: string;
}

interface StudioValue {
  projects: Project[];
  voices: VoiceProfile[];
  server: ServerState | null;
  checkingServer: boolean;
  refreshServer: () => void;
  view: View;
  go: (view: View) => void;
  /** Start a new project in a tool, optionally pre-filled (e.g. with a voice). */
  openTool: (toolId: string, patch?: Partial<Project>) => void;
  openProject: (project: Project) => void;
  updateProject: (id: string, patch: Partial<Project>) => void;
  /**
   * Update against the project as it is NOW, not as it was when the caller
   * rendered. Writing lyrics takes seconds and the model answers after them, so
   * a patch built from a stale copy would quietly revert whatever was typed
   * while it was thinking. Anything landing after an `await` must use this.
   */
  patchProject: (id: string, patch: (current: Project) => Partial<Project>) => void;
  deleteProject: (id: string) => void;
  duplicateProject: (id: string) => void;
  saveVoice: (voice: VoiceProfile) => void;
  deleteVoice: (id: string) => void;
  renameVoice: (id: string, name: string) => void;
  running: Running | null;
  /** Render a song with YuE2 and file the take on the project. */
  render: (projectId: string, request: SongRequest, label?: string) => Promise<Render | null>;
  /** Perform text in a saved voice with AuK. Speech only — it cannot sing. */
  speak: (
    projectId: string,
    input: { voice: VoiceProfile; text: string; instruction?: string; seconds?: number; flash?: boolean },
    label?: string,
  ) => Promise<Render | null>;
  /** Run any other job kind and file the result the same way. */
  runAndFile: (
    projectId: string,
    kind: RenderKind,
    path: "jobs/transcribe" | "jobs/separate",
    body: unknown,
    label: string,
  ) => Promise<Render | null>;
  cancelWatch: () => void;
  fileUrl: typeof fileUrl;
  /** File a take a tool produced itself (e.g. a mix) — it is saved to the library like any other. */
  addRender: (projectId: string, render: Render) => Render;
  /**
   * Save a take that is still only on the GPU server into the account's
   * library, waking the GPU if it is asleep. For takes made before saving
   * existed, or whose automatic save failed.
   */
  saveTake: (projectId: string, renderId: string) => Promise<void>;
  /** Render ids currently being copied into the library. */
  saving: ReadonlySet<string>;
}

const StudioContext = createContext<StudioValue | null>(null);

export function useStudio(): StudioValue {
  const value = useContext(StudioContext);
  if (!value) throw new Error("useStudio must be used inside <StudioProvider>");
  return value;
}

/**
 * Opening a tool creates a project straight away, so every visit used to
 * leave an empty "Untitled" behind. A project nobody typed in (never updated
 * since it was created) and that has no takes is dropped as soon as the user
 * leaves it. Anything edited is kept as a draft.
 */
function pruneUntouched(list: Project[], keepId?: string): Project[] {
  const next = list.filter((p) => p.id === keepId || p.renders.length > 0 || p.updated !== p.created);
  return next.length === list.length ? list : next;
}

function rid(): string {
  return `r_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function StudioProvider({ children }: { children: React.ReactNode }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [voices, setVoices] = useState<VoiceProfile[]>([]);
  const [view, setView] = useState<View>({ kind: "home" });
  const [server, setServer] = useState<ServerState | null>(null);
  const [checkingServer, setChecking] = useState(true);
  const [running, setRunning] = useState<Running | null>(null);
  const [saving, setSaving] = useState<ReadonlySet<string>>(new Set());
  const savingRef = useRef(new Set<string>());
  const abort = useRef<AbortController | null>(null);

  // Local first, then whatever the synced copy settles on.
  useRemotePull(PROJECTS_KEY, () => {
    const loaded = loadProjects();
    const pruned = pruneUntouched(loaded);
    if (pruned !== loaded) saveProjects(pruned);
    setProjects(pruned);
  });
  useRemotePull(VOICES_KEY, () => setVoices(loadVoices()));

  const refreshServer = useCallback(() => {
    setChecking(true);
    void checkServer().then((state) => {
      setServer(state);
      setChecking(false);
    });
  }, []);

  useEffect(() => refreshServer(), [refreshServer]);

  // Leaving a project nobody touched throws it away (see pruneUntouched).
  const openId = view.kind === "tool" ? view.projectId : undefined;
  useEffect(() => {
    setProjects((prev) => {
      const next = pruneUntouched(prev, openId);
      if (next !== prev) saveProjects(next);
      return next;
    });
  }, [openId]);

  const persistProjects = useCallback((next: Project[]) => {
    setProjects(next);
    saveProjects(next);
  }, []);

  const persistVoices = useCallback((next: VoiceProfile[]) => {
    setVoices(next);
    saveVoices(next);
  }, []);

  const updateProject = useCallback(
    (id: string, patch: Partial<Project>) => {
      setProjects((prev) => {
        const next = prev.map((p) => (p.id === id ? { ...p, ...patch, updated: Date.now() } : p));
        saveProjects(next);
        return next;
      });
    },
    [],
  );

  const patchProject = useCallback((id: string, patch: (current: Project) => Partial<Project>) => {
    setProjects((prev) => {
      const next = prev.map((p) => (p.id === id ? { ...p, ...patch(p), updated: Date.now() } : p));
      saveProjects(next);
      return next;
    });
  }, []);

  const openTool = useCallback(
    (toolId: string, patch?: Partial<Project>) => {
      const project = { ...newProject(toolId), ...patch };
      setProjects((prev) => {
        const next = [project, ...prev];
        saveProjects(next);
        return next;
      });
      setView({ kind: "tool", toolId, projectId: project.id });
    },
    [],
  );

  const openProject = useCallback((project: Project) => {
    setView({ kind: "tool", toolId: project.toolId, projectId: project.id });
  }, []);

  const deleteProject = useCallback(
    (id: string) => {
      persistProjects(projects.filter((p) => p.id !== id));
      setView((v) => (v.kind === "tool" && v.projectId === id ? { kind: "projects" } : v));
    },
    [projects, persistProjects],
  );

  const duplicateProject = useCallback(
    (id: string) => {
      const source = projects.find((p) => p.id === id);
      if (!source) return;
      const copy: Project = {
        ...structuredClone(source),
        id: newProject(source.toolId).id,
        title: `${source.title} copy`,
        created: Date.now(),
        updated: Date.now(),
        // Takes belong to the render they came from, not to a fresh copy.
        renders: [],
      };
      persistProjects([copy, ...projects]);
      setView({ kind: "tool", toolId: copy.toolId, projectId: copy.id });
    },
    [projects, persistProjects],
  );

  const saveVoice = useCallback(
    (voice: VoiceProfile) => {
      setVoices((prev) => {
        const next = prev.some((v) => v.id === voice.id)
          ? prev.map((v) => (v.id === voice.id ? { ...v, ...voice } : v))
          : [voice, ...prev];
        saveVoices(next);
        return next;
      });
    },
    [],
  );

  const deleteVoice = useCallback((id: string) => {
    setVoices((prev) => {
      const next = prev.filter((v) => v.id !== id);
      saveVoices(next);
      return next;
    });
  }, []);

  const renameVoice = useCallback((id: string, name: string) => {
    setVoices((prev) => {
      const next = prev.map((v) => (v.id === id ? { ...v, name } : v));
      saveVoices(next);
      return next;
    });
  }, []);

  const patchRender = useCallback((projectId: string, renderId: string, patch: Partial<Render>) => {
    setProjects((prev) => {
      const next = prev.map((p) =>
        p.id === projectId ? { ...p, renders: p.renders.map((r) => (r.id === renderId ? { ...r, ...patch } : r)) } : p,
      );
      saveProjects(next);
      return next;
    });
  }, []);

  /**
   * Copy a take off the GPU into the account's library. The GPU pod sleeps
   * after 20 idle minutes and a take that only lives there goes silent with
   * it; the library copy plays forever. Never throws — a failure is recorded
   * on the take, which then offers to try again.
   */
  const archive = useCallback(
    async (projectId: string, render: Render) => {
      if (!render.fileId || render.saved || savingRef.current.has(render.id)) return;
      savingRef.current.add(render.id);
      setSaving(new Set(savingRef.current));
      try {
        const saved = await saveToLibrary(render.id, render.fileId);
        patchRender(projectId, render.id, { saved, saveError: undefined });
      } catch (err) {
        patchRender(projectId, render.id, { saveError: (err as Error).message });
      } finally {
        savingRef.current.delete(render.id);
        setSaving(new Set(savingRef.current));
      }
    },
    [patchRender],
  );

  /** File a finished or failed take on its project, and save it to the library. */
  const fileRender = useCallback(
    (projectId: string, render: Render) => {
      setProjects((prev) => {
        const next = prev.map((p) =>
          p.id === projectId ? { ...p, renders: [render, ...p.renders], updated: Date.now() } : p,
        );
        saveProjects(next);
        return next;
      });
      // Straight away, while the GPU is certainly awake.
      if (render.fileId && !render.error) void archive(projectId, render);
      return render;
    },
    [archive],
  );

  // Takes that are still only on the GPU (made before the library existed, or
  // whose save failed) are picked up whenever the GPU is found awake. Never
  // wakes it just for this — that costs money; the take's own button does.
  const projectsRef = useRef(projects);
  useEffect(() => {
    projectsRef.current = projects;
  }, [projects]);
  useEffect(() => {
    if (!server?.reachable) return;
    void (async () => {
      for (const p of projectsRef.current) {
        for (const r of p.renders) {
          if (r.fileId && !r.error && !r.saved) await archive(p.id, r);
        }
      }
    })();
  }, [server?.reachable, archive]);

  const saveTake = useCallback(
    async (projectId: string, renderId: string) => {
      const render = projectsRef.current.find((p) => p.id === projectId)?.renders.find((r) => r.id === renderId);
      if (!render?.fileId || render.saved) return;
      savingRef.current.add(renderId);
      setSaving(new Set(savingRef.current));
      try {
        setServer(await ensureServer());
      } catch (err) {
        patchRender(projectId, renderId, { saveError: (err as Error).message });
        return;
      } finally {
        savingRef.current.delete(renderId);
        setSaving(new Set(savingRef.current));
      }
      await archive(projectId, render);
    },
    [archive, patchRender],
  );

  /** The one place a job is watched, so progress and failure look the same everywhere. */
  const watch = useCallback(
    async (
      projectId: string,
      kind: RenderKind,
      path: "jobs/song" | "jobs/transcribe" | "jobs/speak" | "jobs/separate",
      body: unknown,
      label: string,
    ): Promise<Render | null> => {
      abort.current?.abort();
      const controller = new AbortController();
      abort.current = controller;
      setRunning({ projectId, label, stage: "queued", progress: 0 });

      try {
        // A stopped GPU pod is asleep, not broken: wake it and wait.
        const awake = await ensureServer({
          signal: controller.signal,
          onStage: (stage) => setRunning({ projectId, label, stage, progress: 0 }),
        });
        setServer(awake);
        const { jobId, job } = await runJob(path, body, {
          signal: controller.signal,
          // The id arrives WITH each poll: reading the `jobId` being destructured
          // from this very call threw "before initialization" on the first poll
          // and failed every render.
          onProgress: (j: Job, id: string) =>
            setRunning({ projectId, label, stage: j.stage || j.status, progress: j.progress ?? 0, jobId: id }),
        });
        const result = (job.result ?? {}) as Record<string, unknown>;
        return fileRender(projectId, {
          id: rid(),
          kind,
          label,
          fileId: typeof result.file_id === "string" ? result.file_id : null,
          jobId,
          created: Date.now(),
          meta: result,
        });
      } catch (err) {
        // A watch the user stopped is not a failed render; the job itself is
        // still on the GPU and its id is in `running` until this clears.
        if ((err as Error).name === "AbortError") return null;
        return fileRender(projectId, {
          id: rid(),
          kind,
          label,
          fileId: null,
          jobId: null,
          created: Date.now(),
          error: (err as Error).message,
        });
      } finally {
        if (abort.current === controller) {
          abort.current = null;
          setRunning(null);
        }
      }
    },
    [fileRender],
  );

  const render = useCallback(
    (projectId: string, request: SongRequest, label = "Take") => {
      const body: Record<string, unknown> = {
        id: `mc${projectId.replace(/[^A-Za-z0-9]/g, "").slice(0, 40) || "song"}`,
        style: request.style,
        lyrics: request.lyrics,
        cot: request.cot,
        seed: request.seed,
      };
      if (request.abc) body.abc = request.abc;
      if (typeof request.cfg_scale === "number") body.cfg_scale = request.cfg_scale;
      return watch(projectId, "song", "jobs/song", body, label);
    },
    [watch],
  );

  const speak = useCallback(
    async (
      projectId: string,
      input: { voice: VoiceProfile; text: string; instruction?: string; seconds?: number; flash?: boolean },
      label = "Vocal",
    ) => {
      // The reference clip must be on the GPU box before AuK can use it. The
      // library holds the clip, so a rebuilt or freshly rented server costs one
      // upload here rather than another trip through search and separation.
      let refId: string;
      try {
        setRunning({ projectId, label, stage: "checking the GPU", progress: 0 });
        setServer(
          await ensureServer({ onStage: (stage) => setRunning({ projectId, label, stage, progress: 0 }) }),
        );
        refId = await ensureVoiceOnServer(input.voice);
      } catch (err) {
        return fileRender(projectId, {
          id: rid(),
          kind: "vocal",
          label,
          fileId: null,
          jobId: null,
          created: Date.now(),
          error: (err as Error).message,
        });
      }
      if (refId !== input.voice.serverRefId) saveVoice({ ...input.voice, serverRefId: refId });

      return watch(
        projectId,
        "vocal",
        "jobs/speak",
        {
          voice_ref_id: refId,
          text: input.text,
          instruction: input.instruction ?? "",
          gen_seconds: input.seconds,
          flash: !!input.flash,
        },
        label,
      );
    },
    [watch, fileRender, saveVoice],
  );

  const runAndFile = useCallback(
    (projectId: string, kind: RenderKind, path: "jobs/transcribe" | "jobs/separate", body: unknown, label: string) =>
      watch(projectId, kind, path, body, label),
    [watch],
  );

  const cancelWatch = useCallback(() => {
    abort.current?.abort();
    abort.current = null;
    setRunning(null);
  }, []);

  const value = useMemo<StudioValue>(
    () => ({
      projects,
      voices,
      server,
      checkingServer,
      refreshServer,
      view,
      go: setView,
      openTool,
      openProject,
      updateProject,
      patchProject,
      deleteProject,
      duplicateProject,
      saveVoice,
      deleteVoice,
      renameVoice,
      running,
      render,
      speak,
      runAndFile,
      cancelWatch,
      fileUrl,
      addRender: fileRender,
      saveTake,
      saving,
    }),
    [
      projects,
      voices,
      server,
      checkingServer,
      refreshServer,
      view,
      openTool,
      openProject,
      updateProject,
      patchProject,
      deleteProject,
      duplicateProject,
      saveVoice,
      deleteVoice,
      renameVoice,
      running,
      render,
      speak,
      runAndFile,
      cancelWatch,
      fileRender,
      saveTake,
      saving,
    ],
  );

  return <StudioContext.Provider value={value}>{children}</StudioContext.Provider>;
}

/** The open project, or null when the view is not a tool. */
export function useOpenProject(): Project | null {
  const { view, projects } = useStudio();
  if (view.kind !== "tool") return null;
  return projects.find((p) => p.id === view.projectId) ?? null;
}
