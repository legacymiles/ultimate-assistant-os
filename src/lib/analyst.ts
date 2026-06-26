import type {
  AnalystChanges,
  AnalystFeature,
  AnalystResult,
  Project,
} from "./types";

// ---------------------------------------------------------------------------
// AI Project Analyst — offline heuristic engine.
//
// This runs entirely on the server with no external calls. It analyses the
// Knowledge Inbox, version summaries and existing features to detect changes
// and propose updated documentation. When an AI Gateway key is configured the
// API route prefers a real LLM (see /api/regenerate), falling back to this.
// ---------------------------------------------------------------------------

interface Clause {
  text: string;
  source: string;
}

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "should", "be", "is", "are", "to",
  "of", "on", "in", "for", "with", "additional", "show", "make", "add", "added",
  "adding", "needs", "need", "want", "would", "like", "this", "that", "it",
  "as", "at", "by", "we", "i", "they", "them", "their", "our", "can", "could",
  "also", "more", "less", "very", "so", "then", "when", "where", "each",
]);

function splitClauses(project: Project): Clause[] {
  const clauses: Clause[] = [];
  const push = (text: string, source: string) => {
    text
      .split(/[.;\n]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 3)
      .forEach((t) => clauses.push({ text: t, source }));
  };
  // Knowledge entries are weighted most heavily — they are the project memory.
  for (const k of project.knowledge) push(`${k.title}. ${k.content}`, k.kind);
  for (const v of project.versions) push(v.summary, `version ${v.number}`);
  return clauses;
}

const BUG_RE = /\b(bug|crash|broke|broken|error|fix|fixed|fails?|failing|wrong|incorrect|overlap)\b/i;
const IMPROVE_RE = /\b(improve|improved|enhance|enhanced|better|faster|cleaner|optimi[sz]e|refactor|polish|readab|spacing|visual|annotat|label|line|color|colour|ui|ux|smooth)\b/i;
const ADD_RE = /\b(add|added|new|introduce|support|implement|create|build|enable|should|feature|pending|button|menu|export|import|integrat)\b/i;
const CHANGE_RE = /\b(change|changed|replace|replaced|update|updated|instead|rename|move|moved|remove|removed|deprecat)\b/i;
const CORE_RE = /\b(engine|core|main|primary|system|trading|basket|algorithm|backend|database|auth|model)\b/i;

function titleizePhrase(clause: string): string {
  // Build a concise feature title from the most meaningful words of a clause.
  const words = clause
    .replace(/[^a-zA-Z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !STOPWORDS.has(w.toLowerCase()));
  const keep = words.slice(0, 5);
  if (keep.length === 0) return clause.slice(0, 48);
  const title = keep
    .map((w) => (w.length > 2 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
  return title.length > 60 ? title.slice(0, 57) + "…" : title;
}

function dedupe(items: AnalystFeature[]): AnalystFeature[] {
  const seen = new Set<string>();
  const out: AnalystFeature[] = [];
  for (const it of items) {
    const key = it.title.toLowerCase().trim();
    if (key && !seen.has(key)) {
      seen.add(key);
      out.push(it);
    }
  }
  return out;
}

export function heuristicAnalyze(project: Project): AnalystResult {
  const clauses = splitClauses(project);

  const changes: AnalystChanges = {
    features_added: [],
    features_changed: [],
    improvements: [],
    bug_fixes: [],
    missing_documentation: [],
  };

  const derivedCore: AnalystFeature[] = [];
  const derivedSupport: AnalystFeature[] = [];

  for (const { text } of clauses) {
    const title = titleizePhrase(text);
    const feature: AnalystFeature = { title, description: text };

    if (BUG_RE.test(text)) {
      changes.bug_fixes.push(title);
      derivedSupport.push(feature);
    } else if (IMPROVE_RE.test(text)) {
      changes.improvements.push(title);
      derivedSupport.push(feature);
    } else if (CHANGE_RE.test(text)) {
      changes.features_changed.push(title);
    } else if (ADD_RE.test(text)) {
      changes.features_added.push(title);
      if (CORE_RE.test(text)) derivedCore.push(feature);
      else derivedSupport.push(feature);
    }
  }

  // Merge existing features with newly derived ones, keeping existing wording.
  const existingCore = project.features
    .filter((f) => f.group === "core")
    .map((f) => ({ title: f.title, description: f.description }));
  const existingSupport = project.features
    .filter((f) => f.group === "supporting")
    .map((f) => ({ title: f.title, description: f.description }));

  const core_features = dedupe([...existingCore, ...derivedCore]).slice(0, 12);
  const supporting_features = dedupe([...existingSupport, ...derivedSupport]).slice(0, 24);

  // Missing documentation: knowledge topics that aren't reflected in features.
  const featureText = [...core_features, ...supporting_features]
    .map((f) => f.title.toLowerCase())
    .join(" ");
  for (const k of project.knowledge) {
    const key = k.title.toLowerCase().split(/\s+/).slice(0, 2).join(" ");
    if (key && !featureText.includes(key.split(" ")[0])) {
      changes.missing_documentation.push(k.title);
    }
  }

  const one_liner =
    project.one_liner ||
    `${project.name} — ${core_features[0]?.title ?? "a project"} and related capabilities.`;

  const overview = buildOverview(project, core_features, supporting_features);

  const version_summaries = project.versions.map((v) => ({
    version_id: v.id,
    summary: v.summary || `Version ${v.number} of ${project.name}.`,
  }));

  // Trim noise from change lists.
  (Object.keys(changes) as (keyof AnalystChanges)[]).forEach((k) => {
    changes[k] = Array.from(new Set(changes[k])).slice(0, 8);
  });

  return {
    one_liner,
    overview,
    core_features,
    supporting_features,
    version_summaries,
    changes,
    engine: "heuristic",
  };
}

function buildOverview(
  project: Project,
  core: AnalystFeature[],
  support: AnalystFeature[],
): string {
  const parts: string[] = [];
  parts.push(
    project.overview ||
      `${project.name} is a project tracked in Projects Timeline.`,
  );
  if (core.length) {
    parts.push(
      `At its core it provides ${list(core.map((c) => c.title.toLowerCase()))}.`,
    );
  }
  if (support.length) {
    parts.push(
      `Supporting work includes ${list(support.slice(0, 4).map((c) => c.title.toLowerCase()))}.`,
    );
  }
  parts.push(
    `It currently has ${project.versions.length} version${project.versions.length === 1 ? "" : "s"} and ${project.knowledge.length} knowledge ${project.knowledge.length === 1 ? "entry" : "entries"} on record.`,
  );
  return parts.join(" ");
}

function list(items: string[]): string {
  const arr = items.slice(0, 4);
  if (arr.length <= 1) return arr[0] ?? "";
  if (arr.length === 2) return `${arr[0]} and ${arr[1]}`;
  return `${arr.slice(0, -1).join(", ")} and ${arr[arr.length - 1]}`;
}
