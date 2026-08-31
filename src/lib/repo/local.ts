import { PROJECTS } from "../catalog";
import { backfillEnrichment, catalogToProject, seedProjects } from "../seed";
import type { Feature, Project, ProjectFile, Version } from "../types";
import { nowIso, uid } from "../utils";
import type {
  NewFileInput,
  NewKnowledgeInput,
  NewProjectInput,
  NewVersionInput,
  ProjectMetaPatch,
  Repo,
} from "./types";

const KEY = "projects-timeline:v1";
// Tracks which catalog slugs have already been auto-seeded so we never
// re-add a project the user has deleted, but new catalog entries from
// future deploys still get pulled in.
const SEEN_KEY = "projects-timeline:v1:seeded-slugs";

// localStorage-backed repository. Default backend — the app is fully usable
// with zero configuration; data persists in the browser.
export class LocalRepo implements Repo {
  readonly kind = "local" as const;

  private load(): Project[] {
    if (typeof window === "undefined") return [];
    try {
      const raw = window.localStorage.getItem(KEY);

      // First-ever load: seed every catalog project and remember we did so.
      if (!raw) {
        const seeded = seedProjects();
        this.save(seeded);
        window.localStorage.setItem(
          SEEN_KEY,
          JSON.stringify(seeded.map((p) => p.catalog_slug).filter(Boolean)),
        );
        return seeded;
      }

      const projects = JSON.parse(raw) as Project[];

      // Merge in any *new* catalog entries (e.g. apps added in a later deploy)
      // without disturbing projects the user has already edited or deleted.
      const seenRaw = window.localStorage.getItem(SEEN_KEY);
      const seen = new Set<string>(seenRaw ? (JSON.parse(seenRaw) as string[]) : []);
      // Backfill for legacy data that pre-dated SEEN_KEY: treat existing
      // catalog-linked projects as already seeded.
      if (!seenRaw) {
        for (const p of projects) if (p.catalog_slug) seen.add(p.catalog_slug);
      }

      const newOnes: Project[] = [];
      for (const c of PROJECTS) {
        if (!seen.has(c.slug)) {
          newOnes.push(catalogToProject(c));
          seen.add(c.slug);
        }
      }

      window.localStorage.setItem(SEEN_KEY, JSON.stringify([...seen]));

      const next = newOnes.length ? [...newOnes, ...projects] : projects;

      // Projects seeded before their rich writeup existed are still empty
      // shells. Fill them in — but only while they are untouched, so nothing
      // the user has written is ever overwritten.
      const backfilled = backfillEnrichment(next);

      if (newOnes.length || backfilled) {
        this.save(next);
      }
      return next;
    } catch {
      return seedProjects();
    }
  }

  private save(projects: Project[]) {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(KEY, JSON.stringify(projects));
  }

  private mutate<T>(fn: (projects: Project[]) => T): T {
    const projects = this.load();
    const result = fn(projects);
    this.save(projects);
    return result;
  }

  private find(projects: Project[], id: string): Project {
    const p = projects.find((x) => x.id === id);
    if (!p) throw new Error(`Project ${id} not found`);
    return p;
  }

  async getProjects(): Promise<Project[]> {
    return this.load().sort(
      (a, b) => +new Date(b.updated_at) - +new Date(a.updated_at),
    );
  }

  async createProject(input: NewProjectInput): Promise<Project> {
    return this.mutate((projects) => {
      const ts = nowIso();
      const project: Project = {
        id: uid("proj"),
        name: input.name,
        one_liner: input.one_liner ?? "",
        overview: input.overview ?? "",
        detailed: input.detailed ?? "",
        created_at: ts,
        updated_at: ts,
        features: [],
        versions: [],
        knowledge: [],
      };
      projects.push(project);
      return project;
    });
  }

  async updateProjectMeta(id: string, patch: ProjectMetaPatch): Promise<void> {
    this.mutate((projects) => {
      const p = this.find(projects, id);
      if (patch.name !== undefined) p.name = patch.name;
      if (patch.one_liner !== undefined) p.one_liner = patch.one_liner;
      if (patch.overview !== undefined) p.overview = patch.overview;
      if (patch.detailed !== undefined) p.detailed = patch.detailed;
      p.updated_at = nowIso();
    });
  }

  async deleteProject(id: string): Promise<void> {
    this.mutate((projects) => {
      const idx = projects.findIndex((p) => p.id === id);
      if (idx >= 0) projects.splice(idx, 1);
    });
  }

  async setFeatures(projectId: string, features: Feature[]): Promise<void> {
    this.mutate((projects) => {
      const p = this.find(projects, projectId);
      p.features = features.map((f) => ({ ...f, project_id: projectId }));
      p.updated_at = nowIso();
    });
  }

  async addVersion(projectId: string, input: NewVersionInput): Promise<Version> {
    return this.mutate((projects) => {
      const p = this.find(projects, projectId);
      const version: Version = {
        id: uid("v"),
        project_id: projectId,
        number: input.number,
        summary: input.summary ?? "",
        created_at: nowIso(),
        files: [],
      };
      p.versions.push(version);
      p.updated_at = nowIso();
      return version;
    });
  }

  async updateVersion(versionId: string, patch: Partial<NewVersionInput>): Promise<void> {
    this.mutate((projects) => {
      for (const p of projects) {
        const v = p.versions.find((x) => x.id === versionId);
        if (v) {
          if (patch.number !== undefined) v.number = patch.number;
          if (patch.summary !== undefined) v.summary = patch.summary;
          p.updated_at = nowIso();
          return;
        }
      }
    });
  }

  async deleteVersion(versionId: string): Promise<void> {
    this.mutate((projects) => {
      for (const p of projects) {
        const idx = p.versions.findIndex((x) => x.id === versionId);
        if (idx >= 0) {
          p.versions.splice(idx, 1);
          p.updated_at = nowIso();
          return;
        }
      }
    });
  }

  async addFile(versionId: string, input: NewFileInput): Promise<ProjectFile> {
    return this.mutate((projects) => {
      for (const p of projects) {
        const v = p.versions.find((x) => x.id === versionId);
        if (v) {
          const file: ProjectFile = {
            id: uid("file"),
            version_id: versionId,
            name: input.name,
            type: input.type,
            size: input.size,
            url: input.dataUrl,
            created_at: nowIso(),
          };
          v.files.push(file);
          p.updated_at = nowIso();
          return file;
        }
      }
      throw new Error(`Version ${versionId} not found`);
    });
  }

  async deleteFile(fileId: string): Promise<void> {
    this.mutate((projects) => {
      for (const p of projects) {
        for (const v of p.versions) {
          const idx = v.files.findIndex((f) => f.id === fileId);
          if (idx >= 0) {
            v.files.splice(idx, 1);
            p.updated_at = nowIso();
            return;
          }
        }
      }
    });
  }

  async addKnowledge(projectId: string, input: NewKnowledgeInput) {
    return this.mutate((projects) => {
      const p = this.find(projects, projectId);
      const entry = {
        id: uid("k"),
        project_id: projectId,
        kind: input.kind,
        title: input.title,
        content: input.content,
        created_at: nowIso(),
        attachment: input.attachment
          ? {
              name: input.attachment.name,
              type: input.attachment.type,
              size: input.attachment.size,
              url: input.attachment.dataUrl,
            }
          : null,
      };
      p.knowledge.push(entry);
      p.updated_at = nowIso();
      return entry;
    });
  }

  async deleteKnowledge(id: string): Promise<void> {
    this.mutate((projects) => {
      for (const p of projects) {
        const idx = p.knowledge.findIndex((k) => k.id === id);
        if (idx >= 0) {
          p.knowledge.splice(idx, 1);
          p.updated_at = nowIso();
          return;
        }
      }
    });
  }

  async touchProject(id: string): Promise<void> {
    this.mutate((projects) => {
      const p = projects.find((x) => x.id === id);
      if (p) p.updated_at = nowIso();
    });
  }
}
