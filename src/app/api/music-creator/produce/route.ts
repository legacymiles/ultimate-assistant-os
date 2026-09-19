import { DEFAULT_MODEL, aiConfigured, aiFetch } from "@/lib/ai/provider";
import {
  type Draft,
  type LyricsMode,
  type ProduceInput,
  type Production,
  engineerSystem,
  engineerUser,
  fitStyle,
  offlineProduce,
  producerSystem,
  producerUser,
  readDraft,
  readPlan,
  reviseSystem,
  reviseUser,
  runQc,
} from "@/lib/music-creator/producer";

// POST /api/music-creator/produce
// Body: { style, lyrics, lyricsMode, useTaste, title }
// Answers NDJSON, one line per event, so the page can show the pipeline move:
//   {"type":"stage","stage":"producer"|"engineer"|"qc"|"revise","label":...}
//   {"type":"result","production":Production}
//   {"type":"error","error":...}
//
// No GPU. The AI Producer runs on the hub's ordinary text model; with no key
// it falls back to the rule-based producer, labelled as such.

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_INPUT = 12_000;
/** The whole pipeline has to land inside maxDuration, with room to answer. */
const BUDGET_MS = 285_000;
const MODES = new Set<LyricsMode>(["keep", "polish", "write"]);

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }
  const lyrics = String(body.lyrics ?? "");
  const input: ProduceInput = {
    style: String(body.style ?? ""),
    lyrics,
    lyricsMode: MODES.has(body.lyricsMode as LyricsMode) ? (body.lyricsMode as LyricsMode) : lyrics.trim() ? "keep" : "write",
    useTaste: body.useTaste !== false,
    title: typeof body.title === "string" ? body.title : undefined,
  };
  if (!input.style.trim() && !input.lyrics.trim()) {
    return Response.json({ error: "Type a style or idea (or lyrics) first." }, { status: 400 });
  }
  if (input.style.length + input.lyrics.length > MAX_INPUT) {
    return Response.json({ error: "That is too long to produce in one go." }, { status: 413 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: Record<string, unknown>) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      try {
        send({ type: "result", production: await produce(input, send) });
      } catch (err) {
        send({ type: "error", error: (err as Error).message });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" },
  });
}

type Send = (event: Record<string, unknown>) => void;

async function produce(input: ProduceInput, send: Send): Promise<Production> {
  if (!aiConfigured()) {
    send({ type: "stage", stage: "producer", label: "No AI key — the rule-based producer is working" });
    return offlineProduce(input);
  }

  const started = Date.now();
  const left = (cap: number) => Math.max(5_000, Math.min(cap, BUDGET_MS - (Date.now() - started)));

  try {
    send({ type: "stage", stage: "producer", label: "Producer is reading your idea and designing the record" });
    const plan = readPlan(await chat(producerSystem(input.useTaste), producerUser(input), 5000, left(90_000)), input);

    send({
      type: "stage",
      stage: "engineer",
      label:
        input.lyricsMode === "keep" && input.lyrics.trim()
          ? "Prompt engineer is writing the style and direction (your lyrics stay as written)"
          : "Prompt engineer is writing the style, lyrics and direction",
      plan,
    });
    let draft: Draft = readDraft(await chat(engineerSystem(input.lyricsMode), engineerUser(input, plan), 12_000, left(170_000)), input);

    send({ type: "stage", stage: "qc", label: "Quality control" });
    let checks = runQc(input, plan, draft);
    let revisions = 0;
    const failures = checks.filter((c) => !c.pass);
    // A revision is only worth starting if it can finish in time.
    if (failures.length && BUDGET_MS - (Date.now() - started) > 60_000) {
      send({ type: "stage", stage: "revise", label: `Fixing ${failures.length} QC failure${failures.length > 1 ? "s" : ""}: ${failures.map((f) => f.label).join(", ")}` });
      try {
        const revised = readDraft(await chat(reviseSystem(input.lyricsMode), reviseUser(draft, failures, plan), 12_000, left(110_000)), input);
        // Keep the revision only if it is actually better.
        const after = runQc(input, plan, revised);
        if (after.filter((c) => c.pass).length >= checks.filter((c) => c.pass).length) {
          draft = revised;
          checks = after;
          revisions = 1;
        }
      } catch {
        /* the first draft stands; its failures are shown to the user */
      }
    }

    const warnings: string[] = [];
    const fitted = fitStyle(draft.style);
    if (fitted.dropped) {
      warnings.push(`The style was still over 1,000 characters after revision, so ${fitted.dropped} least-important clause${fitted.dropped > 1 ? "s were" : " was"} dropped from the end (never cut mid-clause).`);
      draft = { ...draft, style: fitted.style };
      checks = runQc(input, plan, draft);
    }

    return {
      engine: "ai",
      original: { style: input.style, lyrics: input.lyrics },
      plan,
      ...draft,
      checks,
      revisions,
      warnings,
    };
  } catch (err) {
    const local = offlineProduce(input);
    local.warnings = [`The AI Producer could not be reached (${(err as Error).message}) — this is the rule-based producer's version.`];
    return local;
  }
}

async function chat(system: string, user: string, maxTokens: number, timeoutMs: number): Promise<Record<string, unknown>> {
  const model = process.env.MUSIC_MODEL || process.env.AI_MODEL || DEFAULT_MODEL;
  const res = await aiFetch({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      temperature: 0.8,
      max_tokens: maxTokens,
      // Hidden reasoning counts against max_tokens. Uncapped, it ate a 6,000
      // budget and cut the JSON off mid-arrangement. The plan does the thinking.
      reasoning: { max_tokens: 1500 },
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const choice = data?.choices?.[0];
  const text = String(choice?.message?.content ?? "");
  const parsed = readJson(text);
  if (!parsed) {
    const why = choice?.finish_reason === "length" ? "it ran out of room mid-answer" : `finish: ${choice?.finish_reason ?? "?"}`;
    console.warn(`[music-creator/produce] unusable JSON (${why}, ${text.length} chars): ${text.slice(0, 300)} … ${text.slice(-200)}`);
    throw new Error(`the model did not return usable JSON (${why})`);
  }
  return parsed;
}

function readJson(text: string): Record<string, unknown> | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced ? fenced[1] : text).trim();
  try {
    const parsed = JSON.parse(candidate);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(candidate.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}
