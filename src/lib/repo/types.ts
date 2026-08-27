import type {
  Feature,
  KnowledgeEntry,
  KnowledgeKind,
  Project,
  ProjectFile,
  Version,
} from "../types";

export interface NewProjectInput {
  name: string;
  one_liner?: string;
  overview?: string;
  detailed?: string;
}

export interface ProjectMetaPatch {
  name?: string;
  one_liner?: string;
  overview?: string;
  detailed?: string;
}

export interface NewVersionInput {
  number: string;
  summary?: string;
}

export interface NewKnowledgeInput {
  kind: KnowledgeKind;
  title: string;
  content: string;
  attachment?: {
    name: string;
    type: string;
    size: number;
    /** Local mode: data URL to persist. Supabase mode: the blob to upload. */
    dataUrl?: string;
    blob?: Blob;
  } | null;
}

export interface NewFileInput {
  name: string;
  type: string;
  size: number;
  /** Local mode: data URL. Supabase mode: the File blob to upload. */
  dataUrl?: string;
  blob?: Blob;
}

// A backend-agnostic data access contract. Both the localStorage repo and the
// Supabase repo implement this, so the UI never knows which is active.
export interface Repo {
  readonly kind: "local" | "supabase";

  getProjects(): Promise<Project[]>;

  createProject(input: NewProjectInput): Promise<Project>;
  updateProjectMeta(id: string, patch: ProjectMetaPatch): Promise<void>;
  deleteProject(id: string): Promise<void>;

  /** Replace the full feature set for a project (used by manual edits + AI apply). */
  setFeatures(projectId: string, features: Feature[]): Promise<void>;

  addVersion(projectId: string, input: NewVersionInput): Promise<Version>;
  updateVersion(versionId: string, patch: Partial<NewVersionInput>): Promise<void>;
  deleteVersion(versionId: string): Promise<void>;

  addFile(versionId: string, input: NewFileInput): Promise<ProjectFile>;
  deleteFile(fileId: string): Promise<void>;

  addKnowledge(projectId: string, input: NewKnowledgeInput): Promise<KnowledgeEntry>;
  deleteKnowledge(id: string): Promise<void>;

  /** Touch updated_at — called after AI regeneration etc. */
  touchProject(id: string): Promise<void>;
}
