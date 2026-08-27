import { NextResponse } from "next/server";
import {
  heuristicClarify,
  heuristicClarify2,
  heuristicSynthesize,
  suggestQualityBar,
} from "@/lib/blueprint/heuristics";
import { assemblePrompt } from "@/lib/blueprint/prompt-template";
import { routeSkills } from "@/lib/blueprint/skill-router";
import type {
  Brief,
  Clarify2Result,
  ClarifyingQuestion,
  Overview,
  OverviewFeature,
  RecommendedSkill,
} from "@/lib/blueprint/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const GATEWAY = "https://ai-gateway.vercel.sh/v1/chat/completions";

// POST /api/blueprint
// Body: { stage: "clarify" | "synthesize" | "prompt", brief?, overview? }
// Each stage prefers the AI Gateway when AI_GATEWAY_API_KEY is set, and always
// falls back to the offline heuristic on missing key or error.
export async function POST(req: Request) {
  let body: {
    stage?: string;
    brief?: Brief;
    overview?: Overview;
    portable?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const apiKey = process.env.AI_GATEWAY_API_KEY;

  switch (body.stage) {
    case "clarify": {
      const brief = requireBrief(body.brief);
      if (!brief) return badRequest("brief required");
      const fallback = heuristicClarify(brief);
      if (!apiKey) return NextResponse.json(fallback);
      try {
        return NextResponse.json(await clarifyWithLLM(brief, apiKey));
      } catch (err) {
        console.error("Blueprint clarify failed, using heuristic:", err);
        return NextResponse.json(fallback);
      }
    }

    case "clarify2": {
      const brief = requireBrief(body.brief);
      if (!brief) return badRequest("brief required");
      const fallback = heuristicClarify2(brief);
      if (!apiKey) return NextResponse.json(fallback);
      try {
        return NextResponse.json(await clarify2WithLLM(brief, apiKey));
      } catch (err) {
        console.error("Blueprint clarify2 failed, using heuristic:", err);
        return NextResponse.json(fallback);
      }
    }

    case "synthesize": {
      const brief = requireBrief(body.brief);
      if (!brief) return badRequest("brief required");
      const fallback = { ...heuristicSynthesize(brief), engine: "heuristic" as const };
      if (!apiKey) return NextResponse.json(fallback);
      try {
        const ai = await synthesizeWithLLM(brief, apiKey);
        return NextResponse.json({ ...ai, engine: "ai" as const });
      } catch (err) {
        console.error("Blueprint synthesize failed, using heuristic:", err);
        return NextResponse.json(fallback);
      }
    }

    case "prompt": {
      const brief = requireBrief(body.brief);
      const overview = body.overview ? normalizeOverview(body.overview) : undefined;
      if (!brief || !overview) return badRequest("brief and overview required");
      const portable = body.portable === true;
      const fallback = {
        prompt: assemblePrompt(overview, brief, { portable }),
        engine: "heuristic" as const,
      };
      if (!apiKey) return NextResponse.json(fallback);
      try {
        const prompt = await promptWithLLM(overview, brief, apiKey, portable);
        return NextResponse.json({ prompt, engine: "ai" as const });
      } catch (err) {
        console.error("Blueprint prompt failed, using heuristic:", err);
        return NextResponse.json(fallback);
      }
    }

    default:
      return badRequest("unknown stage");
  }
}

function badRequest(msg: string) {
  return NextResponse.json({ error: msg }, { status: 400 });
}

function requireBrief(brief: Brief | undefined): Brief | null {
  if (!brief || typeof brief.idea !== "string") return null;
  return {
    idea: brief.idea,
    kind: brief.kind === "webapp" || brief.kind === "workflow" ? brief.kind : "website",
    audience: typeof brief.audience === "string" ? brief.audience : "",
    answers: Array.isArray(brief.answers) ? brief.answers : [],
    quality_bar: typeof brief.quality_bar === "string" ? brief.quality_bar : undefined,
  };
}

/** Fill in any new Overview fields missing from an older client payload. */
function normalizeOverview(o: Overview): Overview {
  return {
    ...o,
    design_direction: typeof o.design_direction === "string" ? o.design_direction : "",
    quality_bar: typeof o.quality_bar === "string" ? o.quality_bar : "",
    recommended_skills: Array.isArray(o.recommended_skills) ? o.recommended_skills : [],
  };
}

// ----- Gateway helper ------------------------------------------------------

async function callGateway(
  apiKey: string,
  system: string,
  user: string,
  json: boolean,
): Promise<string> {
  const model = process.env.AI_MODEL || "anthropic/claude-sonnet-4-6";
  const res = await fetch(GATEWAY, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.4,
      ...(json ? { response_format: { type: "json_object" } } : {}),
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) throw new Error(`Gateway ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return String(data?.choices?.[0]?.message?.content ?? "");
}

function briefContext(brief: Brief): string {
  const lines = [
    `Type: ${brief.kind}`,
    `Audience: ${brief.audience || "(unspecified)"}`,
    ...(brief.quality_bar ? [`Quality bar to beat: ${brief.quality_bar}`] : []),
    `Idea:\n${brief.idea}`,
  ];
  if (brief.answers.length) {
    lines.push("\nClarifying answers:");
    for (const a of brief.answers) {
      lines.push(`Q: ${a.question}\nA: ${a.answer || "(skipped)"}`);
    }
  }
  return lines.join("\n");
}

// ----- Stage: clarify ------------------------------------------------------

async function clarifyWithLLM(brief: Brief, apiKey: string): Promise<ClarifyingQuestion[]> {
  const system =
    "You are a senior product designer helping turn a raw idea into a buildable " +
    "spec. Ask ONLY the 3–5 highest-leverage clarifying questions needed to " +
    "design it well — the questions whose answers most change what gets built. " +
    "No filler, no yes/no questions. Respond ONLY with minified JSON: " +
    `{"questions":[{"id":string,"question":string,"hint"?:string}]}.`;
  const content = await callGateway(apiKey, system, briefContext(brief), true);
  const parsed = JSON.parse(content);
  const arr = Array.isArray(parsed?.questions) ? parsed.questions : [];
  const out: ClarifyingQuestion[] = arr
    .map((q: Record<string, unknown>, i: number) => ({
      id: String(q?.id ?? `q${i}`),
      question: String(q?.question ?? "").trim(),
      hint: q?.hint ? String(q.hint).trim() : undefined,
    }))
    .filter((q: ClarifyingQuestion) => q.question)
    .slice(0, 5);
  if (!out.length) throw new Error("no questions returned");
  return out;
}

// ----- Stage: clarify (round 2 — follow-ups + the bar) ---------------------

async function clarify2WithLLM(brief: Brief, apiKey: string): Promise<Clarify2Result> {
  const system =
    "You are a senior product designer running the SECOND round of an interview. " +
    "You already have the idea and the first-round answers. Ask 2-3 follow-up " +
    "questions that close the SPECIFIC gaps those answers opened — not generic " +
    "questions. Also propose ONE named quality bar: a real, specific, fetchable " +
    "website to BEAT (e.g. \"linear.app\", \"stripe.com\", \"igloo.inc\") that sits in " +
    "the same category as this idea. Respond ONLY with minified JSON: " +
    `{"questions":[{"id":string,"question":string,"hint"?:string}],"quality_bar":string}.`;
  const content = await callGateway(apiKey, system, briefContext(brief), true);
  const parsed = JSON.parse(content);
  const arr = Array.isArray(parsed?.questions) ? parsed.questions : [];
  const questions: ClarifyingQuestion[] = arr
    .map((q: Record<string, unknown>, i: number) => ({
      id: String(q?.id ?? `f${i}`),
      question: String(q?.question ?? "").trim(),
      hint: q?.hint ? String(q.hint).trim() : undefined,
    }))
    .filter((q: ClarifyingQuestion) => q.question)
    .slice(0, 3);
  const quality_bar = String(parsed?.quality_bar ?? "").trim() || suggestQualityBar(brief);
  if (!questions.length) throw new Error("no follow-up questions returned");
  return { questions, quality_bar };
}

// ----- Stage: synthesize ---------------------------------------------------

async function synthesizeWithLLM(brief: Brief, apiKey: string): Promise<Overview> {
  const system =
    "You are an expert software architect + design director. From the idea and " +
    "answers, produce a clear, structured overview. CORE features define what the " +
    "product fundamentally is (without them it isn't the thing). SUPPORTING features " +
    "are enhancements, polish and quality-of-life. Also give: a one-sentence " +
    "design_direction (the aesthetic/experience target), a quality_bar (a real, " +
    "named, fetchable reference site to beat), and recommended_skills — pick from " +
    "these of the user's own build skills where they fit: interactive-web-studio " +
    "(premium cinematic WebGL interactivity), exploded-showcase (3D product teardown " +
    "hero), webgl-trail-reveal (mouse-trail image reveal), capcut-design (strict " +
    "design-token editor/tool UI), website-redesigner (reskin an existing site). Only " +
    "include skills that genuinely fit; each with a short 'why'. Be concrete and " +
    "concise. Respond ONLY with minified JSON matching this schema:\n" +
    `{"one_liner":string,"purpose":string,"design_direction":string,"quality_bar":string,` +
    `"recommended_skills":[{"skill":string,"why":string}],` +
    `"core_features":[{"title":string,"description":string}],` +
    `"supporting_features":[{"title":string,"description":string}],` +
    `"stack":string[],"open_questions":string[]}`;
  const content = await callGateway(apiKey, system, briefContext(brief), true);
  const p = JSON.parse(content);
  const corpus = `${brief.idea} ${brief.answers.map((a) => a.answer).join(" ")}`;
  const recommended = normalizeSkills(p?.recommended_skills);
  return {
    one_liner: String(p?.one_liner ?? "").trim(),
    purpose: String(p?.purpose ?? "").trim(),
    design_direction: String(p?.design_direction ?? "").trim(),
    // A user-confirmed bar from round 2 always wins over the model's guess.
    quality_bar: (brief.quality_bar ?? "").trim() || String(p?.quality_bar ?? "").trim() || suggestQualityBar(brief),
    recommended_skills: recommended.length ? recommended : routeSkills(corpus, brief.kind),
    core_features: normalizeFeatures(p?.core_features),
    supporting_features: normalizeFeatures(p?.supporting_features),
    stack: toStrArray(p?.stack, 8),
    open_questions: toStrArray(p?.open_questions, 8),
  };
}

// ----- Stage: prompt -------------------------------------------------------

async function promptWithLLM(
  overview: Overview,
  brief: Brief,
  apiKey: string,
  portable: boolean,
): Promise<string> {
  const skillClause = portable
    ? "PORTABLE MODE: do NOT name the user's private skills. In the 'Recommended " +
      "approach' section describe the TECHNIQUE instead (e.g. 'build the hero as an " +
      "immersive WebGL scene'). In the 'Quality gate' section, drop any skill name and " +
      "just say to iterate against the bar with fresh eyes until it clearly beats it."
    : "In a 'Recommended approach' section, tell the agent which of the recommended " +
      "skills to use by name (e.g. 'Use the `interactive-web-studio` skill for the hero'). " +
      "In the 'Quality gate' section, tell it to run the `gauntlet-loop` skill against the " +
      "quality bar until a blind critic picks the work over the bar.";
  const system =
    "You write briefs for an autonomous coding agent (like Claude Code). Turn " +
    "the structured overview into ONE excellent, unambiguous prompt the agent " +
    "can act on. Use clear markdown with these sections in order: an H1 title, " +
    "Objective, 'Design direction & quality bar' (state the direction and name the " +
    "bar to BEAT), 'Recommended approach', Context, Main features (numbered, each " +
    "with a short 'Done when' acceptance line), Supporting features (secondary), " +
    "Tech & constraints, Open questions, a short 'How to work' section (confirm " +
    "understanding and ask about ambiguity before building, main features first), " +
    "and a final 'Quality gate' section. " +
    skillClause +
    " Be specific; do not invent features that aren't implied. Respond ONLY with " +
    `minified JSON: {"prompt":string} where prompt is the full markdown.`;
  const user =
    `${briefContext(brief)}\n\nSTRUCTURED OVERVIEW (JSON):\n${JSON.stringify(overview)}\n\n` +
    `For reference, a deterministic version of the target structure is:\n` +
    assemblePrompt(overview, brief, { portable });
  const content = await callGateway(apiKey, system, user, true);
  const parsed = JSON.parse(content);
  const prompt = String(parsed?.prompt ?? "").trim();
  if (!prompt) throw new Error("empty prompt");
  return prompt;
}

// ----- Normalisers ---------------------------------------------------------

function normalizeFeatures(input: unknown): OverviewFeature[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((f) => ({
      title: String((f as Record<string, unknown>)?.title ?? "").trim(),
      description: String((f as Record<string, unknown>)?.description ?? "").trim(),
    }))
    .filter((f) => f.title)
    .slice(0, 12);
}

function normalizeSkills(input: unknown): RecommendedSkill[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((s) => ({
      skill: String((s as Record<string, unknown>)?.skill ?? "").trim(),
      why: String((s as Record<string, unknown>)?.why ?? "").trim(),
    }))
    .filter((s) => s.skill)
    .slice(0, 4);
}

function toStrArray(input: unknown, max: number): string[] {
  if (!Array.isArray(input)) return [];
  return input.map((x) => String(x).trim()).filter(Boolean).slice(0, max);
}
