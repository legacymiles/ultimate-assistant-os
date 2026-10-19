import { NextResponse } from "next/server";
import { aiFetch, describeFailure, DEFAULT_MODEL } from "@/lib/ai/provider";
import {
  SHAPES,
  beatCount,
  blankSheet,
  coercePlan,
  draftBeats,
  type Length,
  type Mood,
  type Shape,
} from "@/lib/studio/kids-flow/plan";

// ---------------------------------------------------------------------------
// POST /api/studio/kids-flow/plan — the Storyboard stage's "Write the plan".
//
// Looks at the character picture and the story line and returns a character
// sheet and a beat table. With no AI configured, or when the model fails, it
// returns the structural draft from the story line alone and says so — the
// stage never dead-ends.
//
//   { story, name, shape, length, moods[], mode, image? }  →  { sheet, beats, source, note? }
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const maxDuration = 60;

const SYSTEM = `You are a picture-book author and cut-paper animation director planning a short animated story for kids aged 3-8.
Return ONLY JSON: {"sheet": {...}, "beats": [...]}.

sheet — read the character from the picture (if there is one). Visible facts only, plain words, hex colours where you can see them:
  "age" (e.g. "7", only if it is obvious), "build" (head:body ratio and silhouette), "skin", "hair" (silhouette + colour),
  "eyes" (style), "outfit" (each garment top to bottom with colour and pattern), "signature" (one item that identifies him),
  "heroColor" (the one colour that should mean him for the whole film).
  If the picture is a famous copyrighted character (a cartoon or game mascot), set "outfit" to "COPYRIGHTED — ask for an original character" and leave the rest empty.

beats — the story as beats, in order. Each: {"role", "seconds", "place", "action", "expression", "caption"}.
  role: one of hook, problem, journey, rush, silence, payoff, return. Use EXACTLY one silence (0.5-2 s) right before EXACTLY one payoff, end with a return that is the opening image changed by the story.
  seconds: 2.5-6 for most beats; the silence 0.5-2.
  place: where it happens, one short phrase, a different place for each journey beat.
  action: VISIBLE behaviour only, present tense, one sentence ("leans into the wind, cap pressed down with one hand") — never feelings or psychology.
  expression: one of smile, wow, focus, sad, delight.
  caption: 0-6 kid-friendly words on screen, or "" for none (no caption on the silence or the rush).
Kid-safe: no scary imagery, no real danger.`;

function shapeLine(shape: Shape): string {
  return SHAPES.find((s) => s.id === shape)?.blurb ?? "";
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const story = typeof body?.story === "string" ? body.story.trim().slice(0, 600) : "";
  const name = typeof body?.name === "string" ? body.name.trim().slice(0, 40) : "";
  const length = ([30, 45, 60].includes(Number(body?.length)) ? Number(body?.length) : 45) as Length;
  const shape = (SHAPES.some((s) => s.id === body?.shape) ? body?.shape : "journey") as Shape;
  const moods = (Array.isArray(body?.moods) ? body.moods : []).filter((m): m is Mood =>
    ["cozy", "funny", "adventurous", "gentle"].includes(m as string),
  );
  const image = typeof body?.image === "string" && body.image.startsWith("data:image/") ? body.image : "";
  if (!story) return NextResponse.json({ error: "Write the story in a line first." }, { status: 400 });

  const sheet = blankSheet(name || "Milo");
  const fallback = () => draftBeats({ story, length, sheet, moods });

  const user = [
    `Hero's name: ${name || "(not given — keep 'he')"}`,
    `Story: ${story}`,
    `Story shape: ${shape} — ${shapeLine(shape)}`,
    `Length: ${length} seconds, about ${beatCount(length)} beats.`,
    moods.length ? `Mood: ${moods.join(", ")}` : "",
    image ? "The picture is the hero. Read him carefully into the sheet." : "No picture — leave the sheet's visual fields empty.",
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
          {
            role: "user",
            content: image
              ? [
                  { type: "text", text: user },
                  { type: "image_url", image_url: { url: image } },
                ]
              : user,
          },
        ],
      }),
      signal: AbortSignal.timeout(50_000),
    });
    if (!res.ok) {
      const why = await describeFailure(res);
      return NextResponse.json({
        sheet: {},
        beats: fallback(),
        source: "draft",
        note: res.status === 503
          ? "No AI is set up, so this is a starter plan built from your story line. Edit any beat."
          : `The AI couldn't write it (${why.slice(0, 120)}), so this is a starter plan from your story line.`,
      });
    }
    const json = await res.json();
    const text: string = json?.choices?.[0]?.message?.content ?? "";
    const parsed = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ""));
    const plan = coercePlan(parsed, length);
    if (!plan) throw new Error("no beats");
    return NextResponse.json({ ...plan, source: "ai" });
  } catch {
    return NextResponse.json({
      sheet: {},
      beats: fallback(),
      source: "draft",
      note: "The AI's answer didn't come through, so this is a starter plan from your story line. Edit any beat.",
    });
  }
}
