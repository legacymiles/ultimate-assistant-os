import { NextResponse } from "next/server";
import { heuristicBreakdown, heuristicPerformers } from "@/lib/soundprint/heuristics";
import { DEFAULT_MODEL_ID, getModel, isKnownModel } from "@/lib/soundprint/models";
import { PLATFORMS } from "@/lib/soundprint/platforms";
import { providerConfig, providerStatus, type ProviderConfig } from "@/lib/soundprint/providers";
import { detectPerformanceRequest } from "@/lib/soundprint/performers";
import { assemblePrompts } from "@/lib/soundprint/prompt-template";
import { GENRE_FAMILIES } from "@/lib/soundprint/vocabulary";
import {
  SCOPE_HINTS,
  SECTION_LABELS,
  VOCAL_LABELS,
  emptyBreakdown,
  type AnalysisResult,
  type Measured,
  type PerformerSwap,
  type PlatformId,
  type SongBrief,
  type StyleBreakdown,
} from "@/lib/soundprint/types";

export const runtime = "nodejs";
export const maxDuration = 60;

// GET /api/soundprint — which providers are configured, so the picker can say so.
export async function GET() {
  return NextResponse.json(providerStatus());
}

// POST /api/soundprint
// Body: { brief: SongBrief, measured: Measured | null }
// Always falls back to the offline heuristic so the app never dead-ends.
export async function POST(req: Request) {
  let body: { brief?: SongBrief; measured?: Measured | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const brief = body.brief;
  if (!brief || typeof brief.request !== "string") {
    return NextResponse.json({ error: "brief required" }, { status: 400 });
  }
  const measured = body.measured ?? null;

  const platform: PlatformId = "suno";
  const fallback = (notice?: string): AnalysisResult => {
    const breakdown = heuristicBreakdown(brief, measured);
    const performers = heuristicPerformers(brief);
    return {
      breakdown,
      prompts: assemblePrompts(breakdown, brief, platform, performers),
      platform,
      performers,
      engine: "heuristic",
      notice,
    };
  };

  const model = getModel(isKnownModel(brief.modelId) ? brief.modelId : DEFAULT_MODEL_ID);
  const config = providerConfig(model.provider);

  if (!config.key) {
    return NextResponse.json(
      fallback(
        `${model.label} needs ${config.envVar}. Showing an offline draft — the ` +
          `measurements are still real, but the genre breakdown and lyrics need a model.`,
      ),
    );
  }

  try {
    const ai = await analyzeWithLLM(brief, measured, platform, model.id, config);
    return NextResponse.json({ ...ai, platform });
  } catch (err) {
    console.error("Soundprint analysis failed, using heuristic:", err);
    return NextResponse.json(
      fallback(err instanceof Error ? `Model call failed: ${err.message}` : undefined),
    );
  }
}

// ---------------------------------------------------------------------------

const GENRE_REFERENCE = GENRE_FAMILIES.map(
  (f) => `${f.family}: ${f.genres.join(", ")}`,
).join("\n");

function systemPrompt(platformId: PlatformId): string {
  const p = PLATFORMS[platformId];
  return `You are a veteran record producer and A&R with encyclopedic knowledge of popular music — every genre, subgenre, regional scene and production era. You write prompts for AI music generators, and you are exceptional at it.

Your job: take a reference song (or a described sound), plus hard measurements taken from the actual audio, and produce a precise style breakdown and the two fields the user will paste into ${p.name}.

## Non-negotiable rules

1. TRUST THE MEASUREMENTS. Tempo, key, brightness, dynamics and percussion density were computed from the real waveform in the user's browser. Where they contradict your memory of the song, the measurements win — the user may have selected only part of the track, or a live/alternate version.

2. NEVER put an artist, band or producer name in any prompt field. ${p.name} filters them, and they carry less information than description. If the user asks for a named performer to sing it, translate that person into a concrete VOICE PROFILE — range, texture, delivery, treatment — and report it in "performers". Naming the reference song in your reasoning is fine, but it must not appear in the style or lyrics output.

3. BE SPECIFIC. "alternative rock" is weak; "post-grunge, clean chorused arpeggios, 2000s radio-rock mix" is strong. Name real subgenres. Prefer three precise descriptors over ten vague ones.

4. RESPECT THE EXCLUSIONS. If the user says the drums ruined it, the "avoid" list must contain the drums, and the lyric meta-tags must not invite them back.

5. Write in the platform's grammar: comma-separated descriptors for style, [Section] meta-tags for lyrics.

## Genre reference (use these names; you are not limited to them)

${GENRE_REFERENCE}

## Output

Return ONLY a JSON object, no prose, no code fences:

{
  "understood": "one sentence proving you understood the request, including which section and what to leave out",
  "genres": ["2-4 specific subgenres"],
  "moods": ["2-4 mood words"],
  "tempo": "e.g. '76 BPM, slow and unhurried'",
  "key": "e.g. 'B minor, natural minor with sus2 colour'",
  "instrumentation": ["3-6 specific instrument descriptions"],
  "production": ["2-5 mix/production characteristics"],
  "structure": "how the requested section is built",
  "era": "e.g. 'early-2000s radio rock'",
  "vocal": { "range": "", "texture": [], "delivery": [], "effects": [] },
  "adjacent": ["2-3 neighbouring scenes or eras, described not named"],
  "avoid": ["things that must NOT appear"],
  "performers": [{ "name": "the name the user typed", "profile": "a vivid description of how that voice actually sounds — range, texture, delivery, treatment" }],
  "title": "a short evocative song title",
  "lyrics": "the full lyrics with [Section] meta-tags, or \\"\\" for instrumental"
}

Set "vocal" to null for instrumental tracks. Return [] for "performers" when nobody was named.`;
}

function userPrompt(brief: SongBrief, measured: Measured | null, platformId: PlatformId): string {
  const p = PLATFORMS[platformId];
  const lines: string[] = [
    `## The request`,
    brief.request.trim() || "(none given)",
    "",
    `## Reference track`,
    brief.reference.trim() || "(not named — work from the measurements and the request)",
    "",
    `## Target`,
    `Section: ${SECTION_LABELS[brief.section]}`,
    `Scope: ${SCOPE_HINTS[brief.scope]}`,
    `Vocals: ${VOCAL_LABELS[brief.vocals]}`,
    `Platform: ${p.name} (keep lyrics clean — Suno filters strong profanity and adult themes)`,
  ];

  if (measured?.summary) {
    lines.push("", "## Measured from the actual audio (ground truth)", measured.summary);
  } else {
    lines.push(
      "",
      "## No audio supplied",
      "Work from your knowledge of the named track. Say so in 'understood' if you don't know it.",
    );
  }

  const m = brief.manual;
  const chosen = [
    m.genres.length ? `genres: ${m.genres.join(", ")}` : "",
    m.moods.length ? `moods: ${m.moods.join(", ")}` : "",
    m.instruments.length ? `instruments: ${m.instruments.join(", ")}` : "",
    m.production.length ? `production: ${m.production.join(", ")}` : "",
    m.vocalTraits.length ? `vocal: ${m.vocalTraits.join(", ")}` : "",
  ].filter(Boolean);
  if (chosen.length) {
    lines.push("", "## The user also picked these by hand — honour them", chosen.join("\n"));
  }

  const named = detectPerformanceRequest(brief.request);
  if (named.length) {
    lines.push(
      "",
      "## Named performers detected",
      `${named.join(", ")} — translate each into a voice profile. Do not put the names in the output prompts.`,
    );
  }

  return lines.join("\n");
}

interface LLMPayload extends Partial<StyleBreakdown> {
  performers?: PerformerSwap[];
  title?: string;
  lyrics?: string;
}

async function analyzeWithLLM(
  brief: SongBrief,
  measured: Measured | null,
  platform: PlatformId,
  modelId: string,
  config: ProviderConfig,
): Promise<AnalysisResult> {
  const res = await fetch(config.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.key}`,
      "Content-Type": "application/json",
      ...config.headers,
    },
    body: JSON.stringify({
      model: modelId,
      messages: [
        { role: "system", content: systemPrompt(platform) },
        { role: "user", content: userPrompt(brief, measured, platform) },
      ],
      temperature: 0.7,
      max_tokens: 2600,
    }),
  });

  if (!res.ok) {
    throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
  }

  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    error?: { message?: string };
  };
  if (json.error?.message) throw new Error(json.error.message.slice(0, 200));

  const content = json.choices?.[0]?.message?.content ?? "";
  const parsed = parseJson(content);
  if (!parsed) throw new Error("model did not return usable JSON");

  const breakdown = normaliseBreakdown(parsed, brief, measured);
  const performers = (parsed.performers ?? [])
    .filter((p) => p && typeof p.name === "string" && typeof p.profile === "string")
    .slice(0, 4);

  const prompts = assemblePrompts(breakdown, brief, platform, performers, parsed.lyrics);
  if (parsed.title?.trim()) prompts.title = parsed.title.trim();

  return { breakdown, prompts, platform, performers, engine: "ai" };
}

/** Models sometimes wrap JSON in fences or add a sentence — dig it out. */
function parseJson(raw: string): LLMPayload | null {
  const text = raw.trim();
  const candidates = [text];

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) candidates.push(fenced[1]);

  const braced = text.match(/\{[\s\S]*\}/);
  if (braced) candidates.push(braced[0]);

  for (const c of candidates) {
    try {
      const parsed = JSON.parse(c.trim());
      if (parsed && typeof parsed === "object") return parsed as LLMPayload;
    } catch {
      // try the next shape
    }
  }
  return null;
}

function strList(v: unknown, max = 8): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === "string")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, max);
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function normaliseBreakdown(
  parsed: LLMPayload,
  brief: SongBrief,
  measured: Measured | null,
): StyleBreakdown {
  const heur = heuristicBreakdown(brief, measured);
  const rawVocal = parsed.vocal;

  const vocal =
    brief.vocals === "instrumental" || !rawVocal
      ? null
      : {
          range: str(rawVocal.range),
          texture: strList(rawVocal.texture, 5),
          delivery: strList(rawVocal.delivery, 5),
          effects: strList(rawVocal.effects, 4),
        };

  return {
    ...emptyBreakdown(),
    understood: str(parsed.understood) || heur.understood,
    genres: strList(parsed.genres, 5).length ? strList(parsed.genres, 5) : heur.genres,
    moods: strList(parsed.moods, 5).length ? strList(parsed.moods, 5) : heur.moods,
    tempo: str(parsed.tempo) || heur.tempo,
    key: str(parsed.key) || heur.key,
    instrumentation: strList(parsed.instrumentation, 8).length
      ? strList(parsed.instrumentation, 8)
      : heur.instrumentation,
    production: strList(parsed.production, 6).length ? strList(parsed.production, 6) : heur.production,
    structure: str(parsed.structure) || heur.structure,
    era: str(parsed.era),
    vocal,
    adjacent: strList(parsed.adjacent, 4),
    // Never let the model quietly drop an exclusion the user asked for.
    avoid: [...new Set([...strList(parsed.avoid, 8), ...heur.avoid])],
  };
}
