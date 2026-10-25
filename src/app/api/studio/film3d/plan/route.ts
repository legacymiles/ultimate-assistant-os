import { NextResponse } from "next/server";
import { aiFetch, describeFailure, DEFAULT_MODEL } from "@/lib/ai/provider";
import {
  ACCESSORIES,
  BOTTOM_KINDS,
  BUILDS,
  EXPRESSIONS,
  HAIR_STYLES,
  MOVES,
  PATTERNS,
  PROPS,
  SHOTS,
  TIMES,
  TOP_KINDS,
  WORLDS,
  beatCount,
  coerceBeats,
  coerceHero,
  defaultHero,
  draftBeats,
  propFor,
  type Hero3D,
  type Length,
  type Mood,
} from "@/lib/studio/film3d/plan";

// ---------------------------------------------------------------------------
// POST /api/studio/film3d/plan — 3D Animation Flow's "Write the storyboard"
// and "Read my picture".
//
// Looks at the character picture and the story line, and answers in the
// engine's own closed vocabulary (worlds, moves, shots, props…), so whatever
// the model says, the film can draw it. No AI configured, or a bad answer →
// the structural draft from the story line alone, said plainly. Never a dead end.
//
//   { story, name, length, moods[], image?, hero?, heroOnly? } → { hero, beats, source, note? }
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const maxDuration = 60;

const list = (xs: readonly string[]) => xs.join(", ");

const SYSTEM = `You are a 3D animation director planning a short animated film for a toy-figure 3D character, made in code with Three.js.
Return ONLY JSON: {"hero": {...}, "beats": [...]}.

hero — read the character from the picture (if there is one). Use ONLY these values:
  "build": ${list(BUILDS)}
  "skin", "hair", "eyes", "top", "bottom", "shoes", "accent": hex colours like "#c98b5e" sampled from what you see
  "hairStyle": ${list(HAIR_STYLES)}
  "topKind": ${list(TOP_KINDS)}   "pattern": ${list(PATTERNS)}
  "bottomKind": ${list(BOTTOM_KINDS)}
  "accessory": ${list(ACCESSORIES)} (the one item that identifies them; "none" if nothing)
  "accent": the one colour that should mean this character for the whole film
  "notes": one sentence of visible facts (no guesses about age or identity)
  If the picture is a famous copyrighted character (a cartoon or game mascot), set notes to "COPYRIGHTED — ask for an original character" and keep the other values plain.

beats — the story as beats, in order. Each: {"role","seconds","world","time","move","expression","shot","prop","caption","action"}.
  role: hook, problem, journey, rush, silence, payoff, return. EXACTLY one silence (0.5-2 s) right before EXACTLY one payoff; start with a hook, end with a return that is the opening image changed by the story.
  world: ${list(WORLDS.map((w) => w.id))} — a different world for each journey beat, matching the story's places.
  time: ${list(TIMES)} (sunset or night for the ending when the story suits it).
  move: ${list(MOVES)} — run or walk while travelling; reach for the silence; cheer, tumble or dance for the payoff.
  expression: ${list(EXPRESSIONS)}
  shot: ${list(SHOTS.map((s) => s.id))} — wide to open a new world, follow while travelling, low for brave moments, push for the silence, close for feelings.
  prop: ${list(PROPS)} — the thing the hero wants or travels with, the same one in every beat.
  seconds: 2.5-6 for most beats; the silence 0.5-2.
  caption: 0-6 kid-friendly words on screen, or "" (none on the rush or the silence).
  action: one sentence of VISIBLE behaviour, present tense.
Kid-safe: no scary imagery, no real danger.`;

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const story = typeof body?.story === "string" ? body.story.trim().slice(0, 600) : "";
  const name = typeof body?.name === "string" ? body.name.trim().slice(0, 40) : "";
  const length = ([30, 45, 60].includes(Number(body?.length)) ? Number(body?.length) : 45) as Length;
  const moods = (Array.isArray(body?.moods) ? body.moods : []).filter((m): m is Mood => ["cozy", "funny", "adventurous", "gentle"].includes(m as string));
  const image = typeof body?.image === "string" && body.image.startsWith("data:image/") ? body.image : "";
  const heroOnly = body?.heroOnly === true;
  const base: Hero3D = coerceHero(body?.hero, defaultHero(name || "Milo"));
  if (name) base.name = name;
  if (!story && !heroOnly) return NextResponse.json({ error: "Write the story in a line first." }, { status: 400 });
  if (heroOnly && !image) return NextResponse.json({ error: "Add a picture of your character first." }, { status: 400 });

  const fallback = () => (heroOnly ? [] : draftBeats({ story, length, hero: base, moods }));
  const draftNote = (why: string) => NextResponse.json({ hero: base, beats: fallback(), source: "draft", note: why });

  const user = heroOnly
    ? `Read this character into "hero" only. Return {"hero": {...}, "beats": []}. Name: ${base.name}.`
    : [
        `Hero's name: ${base.name}`,
        `Story: ${story}`,
        `Length: ${length} seconds, about ${beatCount(length)} beats.`,
        moods.length ? `Mood: ${moods.join(", ")}` : "",
        image ? "The picture is the hero. Read them carefully into hero." : `No picture — use this hero as given: ${JSON.stringify({ ...base, notes: undefined })}`,
      ]
        .filter(Boolean)
        .join("\n");

  try {
    const res = await aiFetch({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        temperature: 0.6,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: image ? [{ type: "text", text: user }, { type: "image_url", image_url: { url: image } }] : user },
        ],
      }),
      signal: AbortSignal.timeout(50_000),
    });
    if (!res.ok) {
      const why = await describeFailure(res);
      return draftNote(
        res.status === 503
          ? heroOnly
            ? "No AI is set up, so set the colours yourself — the swatches came from your picture."
            : "No AI is set up, so this is a starter storyboard built from your story line. Edit any beat."
          : `The AI couldn't do it (${why.slice(0, 120)}), so this is a starter version you can edit.`,
      );
    }
    const json = await res.json();
    const text: string = json?.choices?.[0]?.message?.content ?? "";
    const parsed = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, "")) as { hero?: unknown; beats?: unknown };
    // Without a picture the owner's hero stands; with one, the model's reading of it.
    const hero = image ? coerceHero(parsed.hero, base) : base;
    hero.name = base.name;
    if (heroOnly) return NextResponse.json({ hero, beats: [], source: "ai" });
    const beats = coerceBeats(parsed.beats, length, propFor(story));
    if (!beats.length) throw new Error("no beats");
    return NextResponse.json({ hero, beats, source: "ai" });
  } catch {
    return draftNote("The AI's answer didn't come through, so this is a starter version from your story line. Edit anything.");
  }
}
