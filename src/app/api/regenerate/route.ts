import { NextResponse } from "next/server";
import { heuristicAnalyze } from "@/lib/analyst";
import type { AnalystResult, Project } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

// POST /api/regenerate
// Body: { project: Project }
// Returns: AnalystResult
export async function POST(req: Request) {
  let project: Project;
  try {
    const body = await req.json();
    project = body.project as Project;
    if (!project || !project.id) throw new Error("missing project");
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  // Always compute the heuristic — it's the fallback and a sanity baseline.
  const heuristic = heuristicAnalyze(project);

  // Prefer an explicit AI Gateway key; otherwise fall back to the Vercel OIDC
  // token, which Vercel injects automatically on its deployments. The AI
  // Gateway accepts it as a bearer token, so the AI engine works with zero
  // extra configuration on Vercel. If neither is present (or the call fails),
  // we return the — now lossless — heuristic result.
  const apiKey = process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN;
  if (!apiKey) {
    return NextResponse.json(heuristic);
  }

  try {
    const ai = await analyzeWithLLM(project, apiKey);
    return NextResponse.json(ai);
  } catch (err) {
    console.error("AI Gateway analysis failed, using heuristic:", err);
    return NextResponse.json(heuristic);
  }
}

async function analyzeWithLLM(
  project: Project,
  apiKey: string,
): Promise<AnalystResult> {
  const model = process.env.AI_MODEL || "anthropic/claude-sonnet-4-6";

  const context = buildContext(project);
  const system =
    "You are an expert software/strategy Project Analyst. You read a project's " +
    "entire history — its knowledge inbox (notes, ideas, bug reports, AI chats, " +
    "brain dumps), version summaries and existing features — and produce a " +
    "single, coherent, up-to-date picture of the project.\n\n" +
    "You must produce TWO levels of documentation:\n" +
    "1. overview — a SHORT, skimmable basic overview (2-3 sentences) that says " +
    "what the project is at a glance.\n" +
    "2. detailed — a COMPREHENSIVE, thorough explanation that captures EVERY " +
    "important detail the user has explained: every rule, number, threshold, " +
    "condition, parameter, edge case and decision. This is the definitive " +
    "write-up. It is CRITICAL that you do not omit, generalise away, or lose any " +
    "specific detail present in the source material. Prefer being exhaustive over " +
    "being concise. Use clear paragraphs and, where helpful, headed sections and " +
    "bullet lists (plain text, e.g. lines beginning with '• '). If the project is " +
    "a trading strategy, capture the exact entry rules, exit rules, stop-loss / " +
    "take-profit logic, risk and position sizing, indicators and timeframes, " +
    "filters and confirmations, and any conditions verbatim.\n\n" +
    "You also decide where information belongs: CORE features define what the " +
    "project fundamentally is (for a trading strategy, the actual mechanics — " +
    "entries, exits, risk, signals); SUPPORTING features are enhancements, " +
    "refinements, filters, visual upgrades, bug fixes and quality-of-life " +
    "improvements. Extract a GENEROUS, specific list of both — never leave them " +
    "empty when the source describes them. You also detect what changed: new " +
    "features, changed features, improvements, bug fixes and documentation gaps.\n\n" +
    "Respond ONLY with minified JSON matching the requested schema. No prose.";

  const schema = `{
  "one_liner": string (<= 140 chars),
  "overview": string (SHORT basic overview, 2-3 sentences),
  "detailed": string (LONG, exhaustive detailed explanation capturing every important detail; may contain newlines and bullet lines),
  "core_features": [{ "title": string, "description": string }],
  "supporting_features": [{ "title": string, "description": string }],
  "version_summaries": [{ "version_id": string, "summary": string }],
  "changes": {
    "features_added": string[],
    "features_changed": string[],
    "improvements": string[],
    "bug_fixes": string[],
    "missing_documentation": string[]
  }
}`;

  const versionIds = project.versions.map((v) => v.id);
  const user =
    `PROJECT DATA:\n${context}\n\n` +
    `Return JSON exactly matching this schema (version_summaries must use these ` +
    `version ids: ${JSON.stringify(versionIds)}):\n${schema}`;

  const res = await fetch("https://ai-gateway.vercel.sh/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.3,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
    // Guard against a hung gateway.
    signal: AbortSignal.timeout(45_000),
  });

  if (!res.ok) {
    throw new Error(`Gateway responded ${res.status}: ${await res.text()}`);
  }

  const json = await res.json();
  const content: string = json?.choices?.[0]?.message?.content ?? "";
  const parsed = JSON.parse(content);

  // Normalise and harden the LLM output.
  return {
    one_liner: String(parsed.one_liner ?? project.one_liner ?? ""),
    overview: String(parsed.overview ?? project.overview ?? ""),
    detailed: String(parsed.detailed ?? project.detailed ?? ""),
    core_features: normalizeFeatures(parsed.core_features),
    supporting_features: normalizeFeatures(parsed.supporting_features),
    version_summaries: normalizeVersionSummaries(parsed.version_summaries, versionIds),
    changes: {
      features_added: toStrArray(parsed.changes?.features_added),
      features_changed: toStrArray(parsed.changes?.features_changed),
      improvements: toStrArray(parsed.changes?.improvements),
      bug_fixes: toStrArray(parsed.changes?.bug_fixes),
      missing_documentation: toStrArray(parsed.changes?.missing_documentation),
    },
    engine: "ai",
  };
}

function buildContext(project: Project): string {
  const lines: string[] = [];
  lines.push(`Name: ${project.name}`);
  lines.push(`Current one-liner: ${project.one_liner || "(none)"}`);
  lines.push(`Current basic overview: ${project.overview || "(none)"}`);
  lines.push(`Current detailed explanation: ${project.detailed || "(none)"}`);

  lines.push("\nExisting CORE features:");
  project.features.filter((f) => f.group === "core").forEach((f) =>
    lines.push(`- ${f.title}: ${f.description}`),
  );
  lines.push("\nExisting SUPPORTING features:");
  project.features.filter((f) => f.group === "supporting").forEach((f) =>
    lines.push(`- ${f.title}: ${f.description}`),
  );

  lines.push("\nVersion history (oldest first):");
  project.versions.forEach((v) =>
    lines.push(`- [${v.id}] v${v.number}: ${v.summary}`),
  );

  lines.push("\nKnowledge Inbox (chronological — the project's memory):");
  project.knowledge.forEach((k) =>
    lines.push(`- (${k.kind}) ${k.title}: ${k.content}`),
  );

  return lines.join("\n");
}

function normalizeFeatures(input: unknown): AnalystResult["core_features"] {
  if (!Array.isArray(input)) return [];
  return input
    .map((f) => ({
      title: String((f as Record<string, unknown>)?.title ?? "").trim(),
      description: String((f as Record<string, unknown>)?.description ?? "").trim(),
    }))
    .filter((f) => f.title);
}

function normalizeVersionSummaries(
  input: unknown,
  validIds: string[],
): AnalystResult["version_summaries"] {
  if (!Array.isArray(input)) return [];
  return input
    .map((v) => ({
      version_id: String((v as Record<string, unknown>)?.version_id ?? ""),
      summary: String((v as Record<string, unknown>)?.summary ?? "").trim(),
    }))
    .filter((v) => validIds.includes(v.version_id) && v.summary);
}

function toStrArray(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input.map((x) => String(x)).filter(Boolean).slice(0, 12);
}
