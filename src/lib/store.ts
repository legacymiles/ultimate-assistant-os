"use client";

import { create } from "zustand";
import { getRepo } from "./repo";
import type {
  NewFileInput,
  NewKnowledgeInput,
  NewProjectInput,
  NewVersionInput,
  ProjectMetaPatch,
} from "./repo/types";
import type { AnalystResult, Feature, Project } from "./types";
import { uid } from "./utils";

interface StoreState {
  projects: Project[];
  selectedId: string | null;
  search: string;
  loading: boolean;
  busy: boolean;
  error: string | null;

  init: () => Promise<void>;
  select: (id: string | null) => void;
  setSearch: (q: string) => void;

  createProject: (input: NewProjectInput) => Promise<void>;
  updateProjectMeta: (id: string, patch: ProjectMetaPatch) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;

  setFeatures: (projectId: string, features: Feature[]) => Promise<void>;

  addVersion: (projectId: string, input: NewVersionInput) => Promise<void>;
  updateVersion: (versionId: string, patch: Partial<NewVersionInput>) => Promise<void>;
  deleteVersion: (versionId: string) => Promise<void>;

  addFile: (versionId: string, input: NewFileInput) => Promise<void>;
  deleteFile: (fileId: string) => Promise<void>;

  addKnowledge: (projectId: string, input: NewKnowledgeInput) => Promise<void>;
  deleteKnowledge: (id: string) => Promise<void>;

  applyAnalystResult: (projectId: string, result: AnalystResult) => Promise<void>;
}

async function reload(set: (p: Partial<StoreState>) => void) {
  const projects = await getRepo().getProjects();
  set({ projects });
}

export const useStore = create<StoreState>((set, get) => ({
  projects: [],
  selectedId: null,
  search: "",
  loading: true,
  busy: false,
  error: null,

  init: async () => {
    set({ loading: true, error: null });
    try {
      const projects = await getRepo().getProjects();
      set({
        projects,
        loading: false,
        selectedId: get().selectedId ?? projects[0]?.id ?? null,
      });
    } catch (e) {
      set({ loading: false, error: errMessage(e) });
    }
  },

  select: (id) => set({ selectedId: id }),
  setSearch: (q) => set({ search: q }),

  createProject: async (input) => {
    await guard(set, async () => {
      const p = await getRepo().createProject(input);
      await reload(set);
      set({ selectedId: p.id });
    });
  },

  updateProjectMeta: async (id, patch) => {
    await guard(set, async () => {
      await getRepo().updateProjectMeta(id, patch);
      await reload(set);
    });
  },

  deleteProject: async (id) => {
    await guard(set, async () => {
      await getRepo().deleteProject(id);
      await reload(set);
      const remaining = get().projects;
      if (get().selectedId === id) {
        set({ selectedId: remaining[0]?.id ?? null });
      }
    });
  },

  setFeatures: async (projectId, features) => {
    await guard(set, async () => {
      await getRepo().setFeatures(projectId, features);
      await reload(set);
    });
  },

  addVersion: async (projectId, input) => {
    await guard(set, async () => {
      await getRepo().addVersion(projectId, input);
      await reload(set);
    });
  },

  updateVersion: async (versionId, patch) => {
    await guard(set, async () => {
      await getRepo().updateVersion(versionId, patch);
      await reload(set);
    });
  },

  deleteVersion: async (versionId) => {
    await guard(set, async () => {
      await getRepo().deleteVersion(versionId);
      await reload(set);
    });
  },

  addFile: async (versionId, input) => {
    await guard(set, async () => {
      await getRepo().addFile(versionId, input);
      await reload(set);
    });
  },

  deleteFile: async (fileId) => {
    await guard(set, async () => {
      await getRepo().deleteFile(fileId);
      await reload(set);
    });
  },

  addKnowledge: async (projectId, input) => {
    await guard(set, async () => {
      await getRepo().addKnowledge(projectId, input);
      await reload(set);
    });
  },

  deleteKnowledge: async (id) => {
    await guard(set, async () => {
      await getRepo().deleteKnowledge(id);
      await reload(set);
    });
  },

  applyAnalystResult: async (projectId, result) => {
    await guard(set, async () => {
      const repo = getRepo();
      const project = get().projects.find((p) => p.id === projectId);
      if (!project) return;

      // 1. Update summary + overview.
      await repo.updateProjectMeta(projectId, {
        one_liner: result.one_liner,
        overview: result.overview,
      });

      // 2. Replace feature sets with the analyst's curated lists.
      const features: Feature[] = [
        ...result.core_features.map((f) => buildFeature(projectId, f, "core")),
        ...result.supporting_features.map((f) =>
          buildFeature(projectId, f, "supporting"),
        ),
      ];
      await repo.setFeatures(projectId, features);

      // 3. Refresh version summaries the analyst rewrote.
      for (const vs of result.version_summaries) {
        const existing = project.versions.find((v) => v.id === vs.version_id);
        if (existing && existing.summary !== vs.summary) {
          await repo.updateVersion(vs.version_id, { summary: vs.summary });
        }
      }

      await repo.touchProject(projectId);
      await reload(set);
    });
  },
}));

function buildFeature(
  projectId: string,
  f: { title: string; description: string },
  group: "core" | "supporting",
): Feature {
  return {
    id: uid("f"),
    project_id: projectId,
    title: f.title,
    description: f.description,
    group,
    created_at: new Date().toISOString(),
  };
}

async function guard(
  set: (p: Partial<StoreState>) => void,
  fn: () => Promise<void>,
) {
  set({ busy: true, error: null });
  try {
    await fn();
  } catch (e) {
    set({ error: errMessage(e) });
  } finally {
    set({ busy: false });
  }
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ----- selectors ----------------------------------------------------------

export function useSelectedProject(): Project | null {
  return useStore((s) => s.projects.find((p) => p.id === s.selectedId) ?? null);
}

export function useFilteredProjects(): Project[] {
  return useStore((s) => {
    const q = s.search.trim().toLowerCase();
    if (!q) return s.projects;
    return s.projects.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.one_liner.toLowerCase().includes(q) ||
        p.overview.toLowerCase().includes(q),
    );
  });
}
