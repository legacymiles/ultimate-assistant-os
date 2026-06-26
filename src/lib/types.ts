// ---------------------------------------------------------------------------
// Domain types for Projects Timeline.
// These mirror the Supabase schema in /supabase/schema.sql but are also used
// by the local (localStorage) repository so the app runs without a backend.
// ---------------------------------------------------------------------------

export type FeatureGroup = "core" | "supporting";

export type KnowledgeKind =
  | "note"
  | "idea"
  | "feature_request"
  | "ai_conversation"
  | "claude_conversation"
  | "chatgpt_conversation"
  | "dev_update"
  | "documentation"
  | "bug_report"
  | "brain_dump";

export interface Feature {
  id: string;
  project_id: string;
  title: string;
  description: string;
  group: FeatureGroup;
  created_at: string;
}

export interface ProjectFile {
  id: string;
  version_id: string;
  name: string;
  /** MIME type or a friendly category like "mq4", "ex4", "zip". */
  type: string;
  size: number;
  /** Object URL / data URL (local mode) or Supabase storage path (prod). */
  url?: string;
  created_at: string;
}

export interface Version {
  id: string;
  project_id: string;
  number: string;
  summary: string;
  created_at: string;
  files: ProjectFile[];
}

export interface KnowledgeAttachment {
  name: string;
  /** MIME type or friendly category. */
  type: string;
  size: number;
  /** Data URL (local mode, images) or Supabase storage path (prod). */
  url?: string;
}

export interface KnowledgeEntry {
  id: string;
  project_id: string;
  kind: KnowledgeKind;
  title: string;
  content: string;
  created_at: string;
  /** Optional source file the entry was summarised from. */
  attachment?: KnowledgeAttachment | null;
}

export interface Project {
  id: string;
  user_id?: string;
  name: string;
  one_liner: string;
  overview: string;
  created_at: string;
  updated_at: string;
  features: Feature[];
  versions: Version[];
  knowledge: KnowledgeEntry[];
}

// ----- AI Project Analyst -------------------------------------------------

export interface AnalystFeature {
  title: string;
  description: string;
}

export interface AnalystChanges {
  features_added: string[];
  features_changed: string[];
  improvements: string[];
  bug_fixes: string[];
  missing_documentation: string[];
}

export interface AnalystResult {
  one_liner: string;
  overview: string;
  core_features: AnalystFeature[];
  supporting_features: AnalystFeature[];
  version_summaries: { version_id: string; summary: string }[];
  changes: AnalystChanges;
  /** "ai" when produced by an LLM, "heuristic" when produced offline. */
  engine: "ai" | "heuristic";
}

export const KNOWLEDGE_KIND_LABELS: Record<KnowledgeKind, string> = {
  note: "Note",
  idea: "Idea",
  feature_request: "Feature Request",
  ai_conversation: "AI Conversation",
  claude_conversation: "Claude Conversation",
  chatgpt_conversation: "ChatGPT Conversation",
  dev_update: "Development Update",
  documentation: "Documentation",
  bug_report: "Bug Report",
  brain_dump: "Brain Dump",
};
