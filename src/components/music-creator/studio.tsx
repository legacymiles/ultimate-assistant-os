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
  ensureVoiceOnServer,
  fileUrl,
  runJob,
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
}

const StudioContext = createContext<StudioValue | null>(null);

export function useStudio(): StudioValue {
  const value = useContext(StudioContext);
  if (!value) throw new Error("useStudio must be used inside <StudioProvider>");
  return value;
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
  const abort = useRef<AbortController | null>(null);

  // Local first, then whatever the synced copy settles on.
  useRemotePull(PROJECTS_KEY, () => setProjects(loadProjects()));
  useRemotePull(VOICES_KEY, () => setVoices(loadVoices()));

  const refreshServer = useCallback(() => {
    setChecking(true);
    void checkServer().then((state) => {
      setServer(state);
      setChecking(false);
    });
  }, []);

  useEffect(() => refreshServer(), [refreshServer]);

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

  /** File a finished or failed take on its project. */
  const fileRender = useCallback(
    (projectId: string, render: Render) => {
      setProjects((prev) => {
        const next = prev.map((p) =>
          p.id === projectId ? { ...p, renders: [render, ...p.renders], updated: Date.now() } : p,
        );
        saveProjects(next);
        return next;
      });
      return render;
    },
    [],
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
        const { jobId, job } = await runJob(path, body, {
          signal: controller.signal,
          onProgress: (j: Job) =>
            setRunning({ projectId, label, stage: j.stage || j.status, progress: j.progress ?? 0, jobId }),
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
