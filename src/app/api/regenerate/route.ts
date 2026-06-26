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

  const apiKey = process.env.AI_GATEWAY_API_KEY;
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
    "You are an expert software Project Analyst. You read a project's entire " +
    "history — its knowledge inbox (notes, ideas, bug reports, AI chats, brain " +
    "dumps), version summaries and existing features — and produce a single, " +
    "coherent, up-to-date picture of the project. You decide where information " +
    "belongs: CORE features define what the project fundamentally is; SUPPORTING " +
    "features are enhancements, refinements, visual upgrades, bug fixes and " +
    "quality-of-life improvements. You detect what changed: new features, changed " +
    "features, improvements, bug fixes and documentation gaps. " +
    "Respond ONLY with minified JSON matching the requested schema. No prose.";

  const schema = `{
  "one_liner": string (<= 140 chars),
  "overview": string (2-4 plain-English sentences),
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
  lines.push(`Current overview: ${project.overview || "(none)"}`);

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
