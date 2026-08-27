import {
  KNOWLEDGE_KIND_LABELS,
  type AnalystChanges,
  type AnalystFeature,
  type AnalystResult,
  type Project,
} from "./types";

// ---------------------------------------------------------------------------
// AI Project Analyst — offline heuristic engine.
//
// This runs entirely on the server with no external calls. It analyses the
// Knowledge Inbox, version summaries and existing features to detect changes
// and propose updated documentation. When an AI Gateway key is configured the
// API route prefers a real LLM (see /api/regenerate), falling back to this.
//
// It produces TWO levels of documentation:
//   • overview  — a short, skimmable "basic overview" (2-3 sentences)
//   • detailed  — a comprehensive, LOSSLESS "detailed explanation" that keeps
//                 every important thing the user captured, so nothing is lost
//                 even without an AI model available.
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
const IMPROVE_RE = /\b(improve|improved|enhance|enhanced|better|faster|cleaner|optimi[sz]e|refactor|polish|readab|spacing|visual|annotat|label|line|color|colour|ui|ux|smooth|tweak|adjust)\b/i;
const ADD_RE = /\b(add|added|new|introduce|support|implement|create|build|enable|should|feature|pending|button|menu|export|import|integrat)\b/i;
const CHANGE_RE = /\b(change|changed|replace|replaced|update|updated|instead|rename|move|moved|remove|removed|deprecat)\b/i;

// "Core" signals: the fundamental machinery of the project. Deliberately broad,
// with a strong bias toward trading-strategy vocabulary so strategy rules land
// as CORE features rather than being dropped.
const CORE_RE =
  /\b(engine|core|main|primary|system|algorithm|backend|database|auth|model|rule|logic|strateg|setup|entry|entries|enter|exit|exits?|close|open|buy|sell|long|short|stop[- ]?loss|take[- ]?profit|target|trade|trades?|trading|order|orders?|position|lot|risk|reward|signal|indicator|ema|sma|rsi|macd|moving average|timeframe|trend|breakout|break[- ]?out|pullback|retrace|support|resistance|zone|session|london|new ?york|asia|hedge|basket|martingale|grid|scal|swing|pip|point|candle|pattern|confirmation|filter|drawdown|equity|margin|leverage|lot size)\b/i;

// A clause that plainly *describes a capability* even without an action verb
// (common in strategy write-ups, e.g. "entries are taken at the 200 EMA").
function isSubstantive(text: string): boolean {
  const words = text.split(/\s+/).filter((w) => w.length > 2 && !STOPWORDS.has(w.toLowerCase()));
  return words.length >= 3 && text.length >= 12;
}

function titleizePhrase(clause: string): string {
  // Build a concise feature title from the most meaningful words of a clause.
  const words = clause
    .replace(/[^a-zA-Z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !STOPWORDS.has(w.toLowerCase()));
  const keep = words.slice(0, 6);
  if (keep.length === 0) return clause.slice(0, 48);
  const title = keep
    .map((w) => (w.length > 2 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
  return title.length > 64 ? title.slice(0, 61) + "…" : title;
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
    if (!isSubstantive(text)) continue;
    const title = titleizePhrase(text);
    const feature: AnalystFeature = { title, description: text };
    const isCore = CORE_RE.test(text);

    if (BUG_RE.test(text)) {
      changes.bug_fixes.push(title);
      derivedSupport.push(feature);
    } else if (IMPROVE_RE.test(text)) {
      changes.improvements.push(title);
      derivedSupport.push(feature);
    } else if (CHANGE_RE.test(text)) {
      changes.features_changed.push(title);
      (isCore ? derivedCore : derivedSupport).push(feature);
    } else if (ADD_RE.test(text)) {
      changes.features_added.push(title);
      (isCore ? derivedCore : derivedSupport).push(feature);
    } else {
      // Plain descriptive statement of how the project works. In a strategy
      // write-up these are the actual mechanics — keep them, don't drop them.
      (isCore ? derivedCore : derivedSupport).push(feature);
    }
  }

  // Merge existing features with newly derived ones, keeping existing wording.
  const existingCore = project.features
    .filter((f) => f.group === "core")
    .map((f) => ({ title: f.title, description: f.description }));
  const existingSupport = project.features
    .filter((f) => f.group === "supporting")
    .map((f) => ({ title: f.title, description: f.description }));

  const core_features = dedupe([...existingCore, ...derivedCore]).slice(0, 14);
  const supporting_features = dedupe([...existingSupport, ...derivedSupport]).slice(0, 28);

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
  const detailed = buildDetailed(project, core_features, supporting_features);

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
    detailed,
    core_features,
    supporting_features,
    version_summaries,
    changes,
    engine: "heuristic",
  };
}

// The short, skimmable "basic overview" — a couple of sentences, no plumbing.
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
      `At its core it covers ${list(core.map((c) => c.title.toLowerCase()))}.`,
    );
  }
  if (support.length) {
    parts.push(
      `It is rounded out by ${list(support.slice(0, 3).map((c) => c.title.toLowerCase()))}.`,
    );
  }
  return parts.join(" ");
}

// The long-form "detailed explanation". This is intentionally LOSSLESS: it
// folds in every knowledge entry in full, so nothing the user explained is
// ever thrown away — even when no AI model is available to summarise.
function buildDetailed(
  project: Project,
  core: AnalystFeature[],
  support: AnalystFeature[],
): string {
  const L: string[] = [];
  const push = (s = "") => L.push(s);

  push(buildOverview(project, core, support));

  if (core.length) {
    push();
    push("MAIN FEATURES");
    core.forEach((f) => push(`• ${f.title}${f.description ? ` — ${f.description}` : ""}`));
  }

  if (support.length) {
    push();
    push("SUPPORTING FEATURES");
    support.forEach((f) => push(`• ${f.title}${f.description ? ` — ${f.description}` : ""}`));
  }

  // Everything on record — full, verbatim. This is the part that guarantees no
  // detail is lost.
  if (project.knowledge.length) {
    push();
    push("EVERYTHING ON RECORD");
    const chronological = [...project.knowledge].sort(
      (a, b) => +new Date(a.created_at) - +new Date(b.created_at),
    );
    for (const k of chronological) {
      const label = KNOWLEDGE_KIND_LABELS[k.kind] ?? "Note";
      push();
      push(`— ${k.title || label} (${label})`);
      const body = k.content.trim();
      if (body) push(body);
    }
  }

  if (project.versions.length) {
    push();
    push("VERSION HISTORY");
    [...project.versions]
      .sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at))
      .forEach((v) => push(`• v${v.number} — ${v.summary || "No summary."}`));
  }

  return L.join("\n").trim();
}

function list(items: string[]): string {
  const arr = items.slice(0, 4);
  if (arr.length <= 1) return arr[0] ?? "";
  if (arr.length === 2) return `${arr[0]} and ${arr[1]}`;
  return `${arr.slice(0, -1).join(", ")} and ${arr[arr.length - 1]}`;
}
