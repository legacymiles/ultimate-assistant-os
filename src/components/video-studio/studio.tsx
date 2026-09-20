"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as api from "@/lib/video-studio/client";
import type { MethodCard, RunnerState } from "@/lib/video-studio/client";
import { emptyBrief } from "@/lib/video-studio/brief";
import { ACTIVE_STATUSES, type ProductionPlan, type Project, type VideoBrief } from "@/lib/video-studio/types";

// ---------------------------------------------------------------------------
// One hook holds the whole studio.
//
// The flow is deliberately linear — prompt → method → plan → generate →
// preview — and `view` is the only thing that moves through it. Everything
// else is either loaded once (methods, projects) or belongs to the project
// currently open.
// ---------------------------------------------------------------------------

export type View = "home" | "brief" | "method" | "plan" | "workspace" | "integrations";

export function useStudio() {
  const [view, setView] = useState<View>("home");
  const [methods, setMethods] = useState<MethodCard[]>([]);
  const [runner, setRunner] = useState<RunnerState>({ hasToken: false, lastSeen: null, online: false });
  const [projects, setProjects] = useState<Project[]>([]);

  const [brief, setBrief] = useState<VideoBrief>(emptyBrief);
  const [mode, setMode] = useState<"manual" | "director">("manual");
  const [methodId, setMethodId] = useState<string>("");
  const [plan, setPlan] = useState<ProductionPlan | null>(null);

  const [project, setProject] = useState<Project | null>(null);
  const [versions, setVersions] = useState<Project[]>([]);

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshMethods = useCallback(async () => {
    try {
      const { methods, runner } = await api.loadMethods();
      setMethods(methods);
      setRunner(runner);
    } catch (err) {
      setError(message(err));
    }
  }, []);

  const refreshProjects = useCallback(async () => {
    try {
      setProjects((await api.loadProjects()).projects);
    } catch (err) {
      setError(message(err));
    }
  }, []);

  useEffect(() => {
    void refreshMethods();
    void refreshProjects();
  }, [refreshMethods, refreshProjects]);

  // Capability can change while the app is open — the runner starts, a key is
  // added — so the cards re-check every 20 seconds rather than going stale.
  useEffect(() => {
    const timer = setInterval(() => void refreshMethods(), 20_000);
    return () => clearInterval(timer);
  }, [refreshMethods]);

  // ----- the live project -----------------------------------------------
  //
  // Polling a rendering project is also what DRIVES it: the server advances
  // the run one step per read. Stopping the poll stops the spend.
  const openId = project?.id ?? null;
  const active = project ? ACTIVE_STATUSES.includes(project.status) : false;
  const polling = useRef(false);

  const pull = useCallback(async (id: string) => {
    if (polling.current) return;
    polling.current = true;
    try {
      const { project, versions } = await api.loadProject(id);
      setProject(project);
      setVersions(versions);
    } catch (err) {
      setError(message(err));
    } finally {
      polling.current = false;
    }
  }, []);

  useEffect(() => {
    if (!openId || !active) return;
    const timer = setInterval(() => void pull(openId), 3000);
    return () => clearInterval(timer);
  }, [openId, active, pull]);

  // ----- actions ---------------------------------------------------------

  const guard = useCallback(async <T,>(label: string, fn: () => Promise<T>): Promise<T | null> => {
    setBusy(label);
    setError(null);
    try {
      return await fn();
    } catch (err) {
      setError(message(err));
      return null;
    } finally {
      setBusy(null);
    }
  }, []);

  const startNew = useCallback(() => {
    setBrief(emptyBrief());
    setMode("manual");
    setMethodId("");
    setPlan(null);
    setProject(null);
    setVersions([]);
    setError(null);
    setView("brief");
  }, []);

  const chooseMethod = useCallback(
    async (id: string, nextMode: "manual" | "director") => {
      setMethodId(id);
      setMode(nextMode);
      const result = await guard("Writing the production plan", () => api.makePlan(brief, id, nextMode));
      if (!result) return;
      setPlan(result.plan);
      setView("plan");
    },
    [brief, guard],
  );

  const openProject = useCallback(
    async (id: string) => {
      const result = await guard("Opening", () => api.loadProject(id));
      if (!result) return;
      setProject(result.project);
      setVersions(result.versions);
      setBrief(result.project.brief);
      setPlan(result.project.plan);
      setMethodId(result.project.methodId);
      setMode(result.project.mode);
      setView("workspace");
    },
    [guard],
  );

  /** Approve the plan: save the project if it is new, then start the render. */
  const generate = useCallback(async () => {
    if (!plan) return;
    const result = await guard("Starting the render", async () => {
      const id =
        project?.id ?? (await api.createProject(brief, methodId, mode, plan)).project.id;
      if (project?.id) await api.savePlan(id, plan);
      return api.renderProject(id);
    });
    if (!result) {
      // A refused render still needs the project on screen with the reason.
      await refreshProjects();
      return;
    }
    setProject(result.project);
    setView("workspace");
    void refreshProjects();
    void pull(result.project.id);
  }, [brief, methodId, mode, plan, project, guard, pull, refreshProjects]);

  /** Save the plan without rendering — the "keep my edits" path. */
  const savePlanOnly = useCallback(async () => {
    if (!plan) return;
    const result = await guard("Saving the plan", async () => {
      if (project?.id) return api.savePlan(project.id, plan);
      return api.createProject(brief, methodId, mode, plan);
    });
    if (!result) return;
    setProject(result.project);
    setPlan(result.project.plan);
    void refreshProjects();
  }, [brief, methodId, mode, plan, project, guard, refreshProjects]);

  const regenerateScene = useCallback(
    async (index: number) => {
      if (!project) return;
      const result = await guard(`Re-rendering scene ${index}`, () => api.renderScene(project.id, index));
      if (result) setProject(result.project);
    },
    [project, guard],
  );

  const rerender = useCallback(async () => {
    if (!project) return;
    const result = await guard("Rendering again", () => api.renderProject(project.id));
    if (result) setProject(result.project);
  }, [project, guard]);

  const switchMethod = useCallback(
    async (id: string) => {
      if (!project) return;
      const result = await guard("Changing the method", () => api.changeMethod(project.id, id));
      if (!result) return;
      setProject(result.project);
      setPlan(result.project.plan);
      setMethodId(id);
      setMode(result.project.mode);
      void refreshProjects();
    },
    [project, guard, refreshProjects],
  );

  const duplicate = useCallback(
    async (id: string) => {
      if (!project) return;
      const result = await guard("Duplicating", () => api.duplicateProject(project.id, id));
      if (!result) return;
      await refreshProjects();
      await openProject(result.project.id);
    },
    [project, guard, openProject, refreshProjects],
  );

  const remove = useCallback(
    async (id: string) => {
      await guard("Deleting", () => api.deleteProject(id));
      if (project?.id === id) {
        setProject(null);
        setView("home");
      }
      void refreshProjects();
    },
    [project, guard, refreshProjects],
  );

  return {
    view,
    setView,
    methods,
    runner,
    refreshMethods,
    projects,
    refreshProjects,
    brief,
    setBrief,
    mode,
    setMode,
    methodId,
    setMethodId,
    plan,
    setPlan,
    project,
    versions,
    busy,
    error,
    setError,
    startNew,
    chooseMethod,
    openProject,
    generate,
    savePlanOnly,
    regenerateScene,
    rerender,
    switchMethod,
    duplicate,
    remove,
  };
}

export type Studio = ReturnType<typeof useStudio>;

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
