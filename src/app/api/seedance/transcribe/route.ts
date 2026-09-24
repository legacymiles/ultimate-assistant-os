import { NextResponse } from "next/server";
import { aiEndpoint } from "@/lib/ai/provider";

// ---------------------------------------------------------------------------
// Stage 2 — the words, and their times.
//
// This is the only stage that genuinely cannot be measured in the browser, and
// the only one that needs a key. Gemini through OpenRouter is used because it is
// the one route in this hub that actually ACCEPTS audio (verified in the
// music-classified app, 2026-09-13); Claude cannot hear, and the Vercel gateway
// will not serve this. So a missing OPENROUTER_API_KEY is not a failure here —
// it is the instrumental path, and it says so rather than returning nothing.
//
// One chunk per request, because a 40-second 16 kHz mono WAV is ~1.7 MB of
// base64 and Vercel's body cap is 4.5 MB. The client cuts the song, sends the
// chunks, and offsets what comes back; this route only ever knows about one
// stretch of audio and the second it starts at.
//
// TIMINGS ARE APPROXIMATE and the response says so. A listening model reports
// where it thinks a line falls to within a few hundred milliseconds, which is
// right for choosing a cut and wrong for claiming frame-accurate sync. Nothing
// downstream is allowed to pretend otherwise.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const maxDuration = 300;

/** The model that can hear. Overridable so the provider seam is real. */
const LISTEN_MODEL = process.env.SEEDANCE_LISTEN_MODEL || process.env.MUSIC_LISTEN_MODEL || "google/gemini-3.8-flash";

/** ~2.9 MB of base64: comfortably over a 40 s 16 kHz mono clip, under the body cap. */
const MAX_CLIP_CHARS = 3_900_000;

interface Body {
  /** Base64 WAV of one stretch of the track. */
  clip?: string;
  /** Where that stretch starts in the whole song, in seconds. */
  offsetSec?: number;
  /** How long the stretch is, so the model can be told its own clock. */
  durationSec?: number;
  /** What the owner says is in it — a title, a genre, "spoken word". */
  hint?: string;
  /** Lyrics the owner already has: the model then ALIGNS rather than guesses. */
  known?: string;
}

export interface TranscribeLine {
  startSec: number;
  endSec: number;
  text: string;
  words?: { atSec: number; text: string }[];
}

export interface TranscribeResult {
  lines: TranscribeLine[];
  /** True when a model really listened. False = nothing heard, and why. */
  heard: boolean;
  /** Present whenever the caller should tell the owner something. */
  note?: string;
}

const SYSTEM =
  "You transcribe sung and spoken audio and report WHEN each line happens. You reply with JSON only "
  + "— no prose, no code fence. Shape:\n"
  + '{"lines":[{"start":0.0,"end":3.4,"text":"...","words":[{"at":0.1,"text":"I"}]}]}\n'
  + "Rules:\n"
  + "- Times are SECONDS from the start of the audio you were given, as decimals.\n"
  + "- One entry per sung or spoken line, in order, no overlaps.\n"
  + "- `words` is optional; include it when you can place individual words, and leave it out rather "
  + "than spreading words evenly to look precise.\n"
  + "- Transcribe only what is actually there. If a stretch is instrumental, has no intelligible "
  + "words, or is too quiet to make out, return fewer lines or an empty array. NEVER invent plausible "
  + "lyrics to fill a gap, and never repeat a line you already gave to cover silence.\n"
  + "- Keep the words exactly as sung, including repeats and ad-libs. Do not tidy grammar or censor.";

function prompt(body: Body): string {
  const duration = Number(body.durationSec) || 0;
  const lines = [
    `This is a ${duration ? `${duration.toFixed(1)}-second ` : ""}stretch of audio.`,
    "Transcribe the words you can hear and give each line a start and end time in seconds from the "
      + "start of THIS stretch (not from the start of the song).",
  ];
  if (body.hint) lines.push(`Context from the owner: ${String(body.hint).slice(0, 300)}`);
  if (body.known) {
    lines.push(
      "The owner has supplied the real lyrics below. Use them as the source of truth for the WORDS "
        + "and only decide the TIMES — match what you hear to these lines, use their exact wording, and "
        + "leave out any of these lines that are not in this stretch of audio.",
      String(body.known).slice(0, 6000),
    );
  }
  return lines.join("\n");
}

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : NaN;
};

/**
 * The model's JSON, made safe and put on the song's clock.
 *
 * Every line is clamped inside the chunk it came from before the offset is
 * added, because a model that mis-times a line at "95 s" inside a 40-second
 * clip would otherwise land it a minute into the wrong part of the song.
 */
function cleanLines(raw: unknown, offsetSec: number, durationSec: number): TranscribeLine[] {
  const o = (raw ?? {}) as Record<string, unknown>;
  const list = Array.isArray(o.lines) ? o.lines : Array.isArray(raw) ? raw : [];
  const span = durationSec > 0 ? durationSec : Number.POSITIVE_INFINITY;
  const out: TranscribeLine[] = [];
  for (const item of list.slice(0, 200)) {
    const r = (item ?? {}) as Record<string, unknown>;
    const text = typeof r.text === "string" ? r.text.trim().slice(0, 400) : "";
    if (!text) continue;
    const start = num(r.start ?? r.startSec ?? r.at);
    const end = num(r.end ?? r.endSec);
    if (!Number.isFinite(start) || start < 0 || start > span) continue;
    const startSec = Math.round((offsetSec + Math.min(start, span)) * 100) / 100;
    const endSec =
      Math.round((offsetSec + Math.min(Number.isFinite(end) && end > start ? end : start + 2, span)) * 100) / 100;
    const words = (Array.isArray(r.words) ? r.words : [])
      .slice(0, 60)
      .map((w) => {
        const x = (w ?? {}) as Record<string, unknown>;
        const at = num(x.at ?? x.atSec ?? x.start);
        const t = typeof x.text === "string" ? x.text.trim().slice(0, 60) : "";
        return Number.isFinite(at) && at >= 0 && at <= span && t
          ? { atSec: Math.round((offsetSec + at) * 100) / 100, text: t }
          : null;
      })
      .filter((w): w is { atSec: number; text: string } => Boolean(w));
    out.push({ startSec, endSec, text, ...(words.length ? { words } : {}) });
  }
  return out.sort((a, b) => a.startSec - b.startSec);
}

/** JSON out of a model that may still have wrapped it in a fence. */
function parseJson(text: string): unknown {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  try {
    return JSON.parse(cleaned);
  } catch {
    // The first balanced object in the reply, for a model that prefaced it.
    const from = cleaned.indexOf("{");
    const to = cleaned.lastIndexOf("}");
    if (from >= 0 && to > from) {
      try {
        return JSON.parse(cleaned.slice(from, to + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

// POST /api/seedance/transcribe  { clip (base64 WAV), offsetSec, durationSec, hint?, known? }
export async function POST(req: Request) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body (is the clip too large?)" }, { status: 400 });
  }

  const offsetSec = Math.max(0, num(body.offsetSec) || 0);
  const durationSec = Math.max(0, num(body.durationSec) || 0);
  const clip = typeof body.clip === "string" && body.clip.length <= MAX_CLIP_CHARS ? body.clip : null;

  if (!clip) {
    return NextResponse.json({
      lines: [],
      heard: false,
      note: "That stretch of audio was too large to send for transcription.",
    } satisfies TranscribeResult);
  }

  // Only OpenRouter serves a model that accepts audio here. Saying which key is
  // missing is the difference between a fixable gap and a mystery.
  const endpoint = aiEndpoint();
  if (!endpoint || endpoint.provider !== "openrouter") {
    return NextResponse.json({
      lines: [],
      heard: false,
      note: endpoint
        ? "Transcribing needs OPENROUTER_API_KEY — it is the only provider here that serves a model "
          + "which accepts audio. Paste the lyrics instead, or leave it instrumental."
        : "No AI key is set, so nothing could listen to the track. Paste the lyrics instead, or leave "
          + "it instrumental — the tempo, bar lines, sections and drops were all measured locally and "
          + "are enough to cut to.",
    } satisfies TranscribeResult);
  }

  try {
    const res = await fetch(endpoint.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${endpoint.key}` },
      body: JSON.stringify({
        model: LISTEN_MODEL,
        temperature: 0,
        max_tokens: 8000,
        messages: [
          { role: "system", content: SYSTEM },
          {
            role: "user",
            content: [
              { type: "text", text: prompt(body) },
              { type: "input_audio", input_audio: { data: clip, format: "wav" } },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(280_000),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error("seedance transcribe failed:", res.status, detail.slice(0, 500));
      return NextResponse.json({
        lines: [],
        heard: false,
        note: `The listening model refused that stretch (${res.status}). The timeline is still measured; `
          + "paste the lyrics to get words.",
      } satisfies TranscribeResult);
    }

    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = data.choices?.[0]?.message?.content ?? "";
    const parsed = parseJson(text);
    if (!parsed) {
      return NextResponse.json({
        lines: [],
        heard: false,
        note: "The listening model answered with something that wasn't a transcript. Try again, or "
          + "paste the lyrics.",
      } satisfies TranscribeResult);
    }
    return NextResponse.json({
      lines: cleanLines(parsed, offsetSec, durationSec),
      heard: true,
    } satisfies TranscribeResult);
  } catch (err) {
    console.error("seedance transcribe error:", err);
    return NextResponse.json({
      lines: [],
      heard: false,
      note: "Couldn't reach the listening model. The measured timeline is intact — paste the lyrics, "
        + "or try transcribing again.",
    } satisfies TranscribeResult);
  }
}
