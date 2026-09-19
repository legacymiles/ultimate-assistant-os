import { NextResponse } from "next/server";
import { aiEndpoint, aiFetch, DEFAULT_MODEL } from "@/lib/ai/provider";
import { callerIsMember } from "@/lib/recall/lists/session";

// POST /api/recall/photos/batch
//
// The user's instructions for a whole upload, turned into a plan:
//
//   "make these into a collage"                    -> collage
//   "add 'FOR SALE — 2019 F-150' across the bottom" -> caption, verbatim
//   "put a short quote about hard work on it"       -> caption, written here
//
// This route never sees the pictures and never draws anything. It answers one
// question — what did they mean — and the browser does the drawing on a canvas.
// That keeps the photos on the device, keeps the call cheap, and means a
// missing key degrades the WORDING rather than the feature: the client has its
// own reading of the common phrasings (see lib/recall/photos/batch.ts).
//
// Returns { plan: null } with no key set, which is the client's signal to use
// that local reading.

export const runtime = "nodejs";
export const maxDuration = 30;

interface Body {
  prompt?: string;
  fileNames?: string[];
  fileCount?: number;
}

const LAYOUTS = ["grid", "row", "column"] as const;
const POSITIONS = ["top", "bottom", "center"] as const;
const SIZES = ["small", "medium", "large"] as const;

export async function POST(req: Request) {
  if (await callerIsMember()) {
    return NextResponse.json({ error: "This part of Recall is not shared." }, { status: 403 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const prompt = (body.prompt ?? "").trim().slice(0, 1200);
  const apiKey = aiEndpoint()?.key;
  if (!apiKey || !prompt) return NextResponse.json({ plan: null });

  try {
    return NextResponse.json({ plan: await readPlan(prompt, body, apiKey) });
  } catch (err) {
    console.error("Photo batch instructions failed:", err);
    return NextResponse.json({ plan: null });
  }
}

function systemPrompt(count: number, names: string[]): string {
  return (
    "You turn one plain-English instruction about a batch of photos into a plan a drawing " +
    "program can follow. You cannot see the photos. There are " +
    count +
    " of them" +
    (names.length ? ", named: " + names.join(", ") : "") +
    ".\n\n" +
    "Respond ONLY with minified JSON:\n" +
    '{"collage":{"layout":"grid"|"row"|"column","background":string,"gap":number}|null,' +
    '"caption":{"text":string,"position":"top"|"bottom"|"center","size":"small"|"medium"|"large",' +
    '"color":string,"band":boolean}|null,"title":string,"album":string|null,"note":string,' +
    '"couldNot":string[]}\n\n' +
    '  collage — set it only when they ask for the pictures COMBINED ("collage", "montage", ' +
    '"stitch these together", "one image", "side by side"). null when they just want them ' +
    "filed. A collage of one picture is impossible; use null and say so in couldNot.\n" +
    "  background — a hex colour for the gaps. Dark (#0b0d12) unless they ask otherwise.\n" +
    "  gap — pixels between pictures, 0 to 40. 12 unless they ask for tight or airy.\n" +
    "  caption — the words to burn into the picture, and where. THIS IS WHERE YOU WRITE. " +
    'If they give exact words, use them exactly, punctuation and all. If they ask for "a quote ' +
    'about X" or "something catchy", WRITE it: short, under 90 characters, no quotation marks ' +
    "around it, nothing that claims a fact you were not told — no prices, dates, names, " +
    "measurements or model numbers unless the instruction supplies them. null when they ask " +
    "for no words.\n" +
    "  color — hex for the text. #ffffff unless they ask.\n" +
    "  band — true to put a dark bar behind the words so they stay readable. Default true; " +
    "false only if they ask for the words straight on the photo.\n" +
    "  title — a short name for the finished picture, 2 to 5 words.\n" +
    "  album — the photo folder they named for it, in their own words, or null.\n" +
    "  note — one short line, to them, saying what you did.\n" +
    "  couldNot — short lines for anything they asked that this cannot do. Drawing, erasing, " +
    "cropping to a subject, changing colours, removing backgrounds and cutting people out are " +
    "all beyond it: it can only tile the pictures and put words on them. Say so plainly rather " +
    "than pretending. Empty array when everything was possible."
  );
}

async function readPlan(prompt: string, body: Body, apiKey: string) {
  const count = Math.max(1, Number(body.fileCount ?? body.fileNames?.length ?? 1));
  const model = process.env.AI_MODEL || DEFAULT_MODEL;

  const res = await aiFetch({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      temperature: 0.4,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt(count, (body.fileNames ?? []).slice(0, 40)) },
        { role: "user", content: prompt },
      ],
    }),
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) throw new Error(`Gateway ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return normalize(JSON.parse(String(data?.choices?.[0]?.message?.content ?? "{}")), count);
}

const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(String(v) as T) ? (String(v) as T) : fallback;

/** A hex colour, or the fallback. Anything else would be drawn as black. */
const hex = (v: unknown, fallback: string): string =>
  /^#[0-9a-f]{3,8}$/i.test(String(v)) ? String(v) : fallback;

const lines = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean).slice(0, 4) : [];

function normalize(p: Record<string, unknown>, count: number) {
  const c = p?.collage as Record<string, unknown> | null | undefined;
  const cap = p?.caption as Record<string, unknown> | null | undefined;
  const couldNot = lines(p?.couldNot);

  // A collage of one picture is not a collage. Refusing it here rather than in
  // the canvas is what stops a single photo being re-encoded for no reason and
  // then reported to the user as something that happened.
  const wantsCollage = Boolean(c && typeof c === "object");
  if (wantsCollage && count < 2) couldNot.push("A collage needs more than one picture.");

  const text = String(cap?.text ?? "").trim().slice(0, 200);

  return {
    collage:
      wantsCollage && count >= 2
        ? {
            layout: oneOf(c?.layout, LAYOUTS, "grid"),
            background: hex(c?.background, "#0b0d12"),
            gap: Math.max(0, Math.min(40, Math.round(Number(c?.gap ?? 12)))),
          }
        : null,
    caption: text
      ? {
          text,
          position: oneOf(cap?.position, POSITIONS, "bottom"),
          size: oneOf(cap?.size, SIZES, "medium"),
          color: hex(cap?.color, "#ffffff"),
          band: cap?.band !== false,
        }
      : null,
    title: String(p?.title ?? "").trim().slice(0, 60) || undefined,
    album: typeof p?.album === "string" && p.album.trim() ? p.album.trim().slice(0, 60) : null,
    note: String(p?.note ?? "").trim().slice(0, 200) || undefined,
    couldNot: couldNot.slice(0, 4),
    engine: "ai" as const,
  };
}
