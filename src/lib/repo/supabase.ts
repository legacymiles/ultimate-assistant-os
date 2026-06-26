import type { SupabaseClient } from "@supabase/supabase-js";
import { FILES_BUCKET } from "../supabase/config";
import type { Feature, Project, ProjectFile, Version } from "../types";
import type {
  NewFileInput,
  NewKnowledgeInput,
  NewProjectInput,
  NewVersionInput,
  ProjectMetaPatch,
  Repo,
} from "./types";

// Supabase-backed repository. Activated automatically when Supabase env vars
// are present. All rows are scoped to the authenticated user via RLS
// (see /supabase/schema.sql).
export class SupabaseRepo implements Repo {
  readonly kind = "supabase" as const;

  constructor(private db: SupabaseClient) {}

  private async userId(): Promise<string> {
    const { data } = await this.db.auth.getUser();
    if (!data.user) throw new Error("Not authenticated");
    return data.user.id;
  }

  async getProjects(): Promise<Project[]> {
    const { data, error } = await this.db
      .from("projects")
      .select(
        `id, user_id, name, one_liner, overview, created_at, updated_at,
         features ( id, project_id, title, description, "group", created_at ),
         versions (
           id, project_id, number, summary, created_at,
           files ( id, version_id, name, type, size, url, created_at )
         ),
         knowledge_entries ( id, project_id, kind, title, content, created_at, attachment )`,
      )
      .order("updated_at", { ascending: false });

    if (error) throw error;

    return (data ?? []).map((row: Record<string, unknown>): Project => {
      const versions = ((row.versions as Version[]) ?? [])
        .map((v) => ({ ...v, files: (v.files ?? []) as ProjectFile[] }))
        .sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at));
      const knowledge = ((row.knowledge_entries as Project["knowledge"]) ?? []).sort(
        (a, b) => +new Date(a.created_at) - +new Date(b.created_at),
      );
      return {
        id: row.id as string,
        user_id: row.user_id as string,
        name: row.name as string,
        one_liner: (row.one_liner as string) ?? "",
        overview: (row.overview as string) ?? "",
        created_at: row.created_at as string,
        updated_at: row.updated_at as string,
        features: ((row.features as Feature[]) ?? []) as Feature[],
        versions,
        knowledge,
      };
    });
  }

  async createProject(input: NewProjectInput): Promise<Project> {
    const user_id = await this.userId();
    const { data, error } = await this.db
      .from("projects")
      .insert({
        user_id,
        name: input.name,
        one_liner: input.one_liner ?? "",
        overview: input.overview ?? "",
      })
      .select()
      .single();
    if (error) throw error;
    return { ...(data as Project), features: [], versions: [], knowledge: [] };
  }

  async updateProjectMeta(id: string, patch: ProjectMetaPatch): Promise<void> {
    const { error } = await this.db
      .from("projects")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw error;
  }

  async deleteProject(id: string): Promise<void> {
    const { error } = await this.db.from("projects").delete().eq("id", id);
    if (error) throw error;
  }

  async setFeatures(projectId: string, features: Feature[]): Promise<void> {
    // Replace all features for the project transactionally-ish: delete then insert.
    const del = await this.db.from("features").delete().eq("project_id", projectId);
    if (del.error) throw del.error;
    if (features.length) {
      const rows = features.map((f) => ({
        project_id: projectId,
        title: f.title,
        description: f.description,
        group: f.group,
      }));
      const ins = await this.db.from("features").insert(rows);
      if (ins.error) throw ins.error;
    }
    await this.touchProject(projectId);
  }

  async addVersion(projectId: string, input: NewVersionInput): Promise<Version> {
    const { data, error } = await this.db
      .from("versions")
      .insert({ project_id: projectId, number: input.number, summary: input.summary ?? "" })
      .select()
      .single();
    if (error) throw error;
    await this.touchProject(projectId);
    return { ...(data as Version), files: [] };
  }

  async updateVersion(versionId: string, patch: Partial<NewVersionInput>): Promise<void> {
    const { error } = await this.db.from("versions").update(patch).eq("id", versionId);
    if (error) throw error;
  }

  async deleteVersion(versionId: string): Promise<void> {
    const { error } = await this.db.from("versions").delete().eq("id", versionId);
    if (error) throw error;
  }

  async addFile(versionId: string, input: NewFileInput): Promise<ProjectFile> {
    let url: string | undefined;
    if (input.blob) {
      const path = `${versionId}/${Date.now()}-${input.name}`;
      const up = await this.db.storage.from(FILES_BUCKET).upload(path, input.blob, {
        upsert: false,
        contentType: input.type || "application/octet-stream",
      });
      if (up.error) throw up.error;
      url = path;
    }
    const { data, error } = await this.db
      .from("files")
      .insert({
        version_id: versionId,
        name: input.name,
        type: input.type,
        size: input.size,
        url,
      })
      .select()
      .single();
    if (error) throw error;
    return data as ProjectFile;
  }

  async deleteFile(fileId: string): Promise<void> {
    const { data: file } = await this.db
      .from("files")
      .select("url")
      .eq("id", fileId)
      .single();
    if (file?.url) {
      await this.db.storage.from(FILES_BUCKET).remove([file.url as string]);
    }
    const { error } = await this.db.from("files").delete().eq("id", fileId);
    if (error) throw error;
  }

  async addKnowledge(projectId: string, input: NewKnowledgeInput) {
    let attachment: Record<string, unknown> | null = null;
    if (input.attachment) {
      let url: string | undefined;
      if (input.attachment.blob) {
        const path = `knowledge/${projectId}/${Date.now()}-${input.attachment.name}`;
        const up = await this.db.storage
          .from(FILES_BUCKET)
          .upload(path, input.attachment.blob, {
            upsert: false,
            contentType: input.attachment.type || "application/octet-stream",
          });
        if (up.error) throw up.error;
        url = path;
      }
      attachment = {
        name: input.attachment.name,
        type: input.attachment.type,
        size: input.attachment.size,
        url,
      };
    }

    const { data, error } = await this.db
      .from("knowledge_entries")
      .insert({
        project_id: projectId,
        kind: input.kind,
        title: input.title,
        content: input.content,
        attachment,
      })
      .select()
      .single();
    if (error) throw error;
    await this.touchProject(projectId);
    return data as Project["knowledge"][number];
  }

  async deleteKnowledge(id: string): Promise<void> {
    const { error } = await this.db.from("knowledge_entries").delete().eq("id", id);
    if (error) throw error;
  }

  async touchProject(id: string): Promise<void> {
    await this.db
      .from("projects")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", id);
  }
}
