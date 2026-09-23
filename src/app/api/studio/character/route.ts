import { NextResponse } from "next/server";
import { aiEndpoint, aiFetch, DEFAULT_MODEL } from "@/lib/ai/provider";

// POST /api/studio/character
// Several pictures of ONE subject in, one written character sheet out.
//
// Why write it down at all, when the pictures already exist? Because a
// paragraph does three things a face crop cannot:
//
//   1. It can be READ BACK. Recognition is told which features to compare, and
//      "the features that outlast a haircut" is a sentence, not an image.
//   2. It can be PROMPTED WITH. A video model asked for this person in a shot
//      nobody photographed needs a description, not a photo to copy.
//   3. It costs its tokens ONCE. The alternative is attaching six photos of
//      everyone to every request, which is the cost curve the contact sheet
//      exists to avoid.
//
// The whole thing is one call because the sheet has to be internally consistent:
// asked separately, "hair" and "appearance" disagree about the same person.
//
// Returns { sheet: null } with no key set — the caller tells the owner the
// description needs a model, which is honest, rather than inventing one.

export const runtime = "nodejs";
export const maxDuration = 120;

const DATA_URL = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/;

interface Body {
  /** Every picture of this subject the client could find, best first. */
  images?: unknown;
  /** What the owner calls them. Used in the sheet so it reads as theirs. */
  name?: unknown;
  /** "person" writes a face; "thing" writes a vehicle, a room, a product. */
  kind?: unknown;
  /** The owner's own note about them, honoured over anything inferred. */
  notes?: unknown;
}

/**
 * A subject is either somebody or something. The two need different sheets —
 * "distinguishing features" of a truck are dents and a roof rack, not
 * cheekbones — and a photos folder can be either, so the caller says which.
 */
type Kind = "person" | "thing";

const PERSON_PROMPT =
  "You write CHARACTER SHEETS for a private photo library.\n\n" +
  "Every attached image is the SAME person. Look at all of them and describe " +
  "who they actually are, not who they might be. The sheet is used for two " +
  "jobs, so it must be true of them in every photograph:\n" +
  "  1. RECOGNISING them in new pictures from the owner's camera roll.\n" +
  "  2. PROMPTING a video or image model to draw them in a scene that was " +
  "never photographed.\n\n" +
  "Write plainly and specifically, the way a casting director writes. Say " +
  "apparent age range, build and height impression, skin tone, face and jaw " +
  "shape, eyes (colour, set, spacing), brows, nose, mouth and teeth, hair " +
  "(colour, texture, length, how it is usually worn), facial hair, and anything " +
  "permanent: moles, freckles, scars, dimples, glasses they always wear, " +
  "piercings, visible tattoos.\n\n" +
  "`identifiers` is the important field: 3 to 6 short phrases naming ONLY the " +
  "features a photograph cannot change. Bone structure, eye set, nose shape, " +
  "tooth line, ear shape, skin tone, permanent marks. NEVER hair length, " +
  "colour, makeup, clothing or expression there, because those change between " +
  "photographs and a recogniser that leans on them confuses two different " +
  "people.\n\n" +
  "Rules you do not break:\n" +
  "- Describe only what you can see. If the photos never show their full " +
  "height, say nothing about height.\n" +
  "- No guesses about nationality, ethnicity as identity, religion, health, " +
  "wealth or character. Physical description only; skin tone and hair type are " +
  "physical, a life story is not.\n" +
  "- No judgements about how attractive they are.\n" +
  "- If the attached images plainly show DIFFERENT people, say so in `warning` " +
  "and describe the person who appears most often.";

const THING_PROMPT =
  "You write REFERENCE SHEETS for a private photo library.\n\n" +
  "Every attached image is the SAME subject — a vehicle, a room, a pet, a " +
  "product, a place. Look at all of them and describe what it actually is. The " +
  "sheet is used for two jobs, so it must be true of it in every photograph:\n" +
  "  1. RECOGNISING it in new pictures from the owner's camera roll.\n" +
  "  2. PROMPTING a video or image model to show it in a scene that was never " +
  "photographed.\n\n" +
  "Say what kind of thing it is, then its form, size impression, colour and " +
  "finish, materials, markings, condition and wear, and any fittings or " +
  "modifications. For an animal, describe breed impression, coat, markings and " +
  "build.\n\n" +
  "`identifiers` is the important field: 3 to 6 short phrases naming ONLY the " +
  "features that stay the same between photographs — shape, colour, badges, a " +
  "specific dent, a pattern. Never the lighting, the weather or where it " +
  "happened to be parked.\n\n" +
  "Describe only what you can see, and never invent a brand, model or price the " +
  "images do not show.";

function systemPrompt(kind: Kind, name: string, notes: string): string {
  const who = name ? `The owner calls this subject "${name}".` : "";
  const note = notes
    ? `The owner's own note about them: "${notes}". Treat it as true and work it in where it fits what you can see.`
    : "";
  return [
    kind === "person" ? PERSON_PROMPT : THING_PROMPT,
    [who, note].filter(Boolean).join(" "),
    "Respond ONLY with minified JSON:\n" +
      '{"appearance":string,"identifiers":string[],"wardrobe":string,"warning":string}\n' +
      "  appearance  — one paragraph, 60-140 words, ready to paste into a prompt. " +
      "Write it as a description of the subject, with no preamble and no name.\n" +
      "  identifiers — 3-6 short phrases, each a feature that does not change " +
      "between photographs.\n" +
      "  wardrobe    — how they usually dress across these photos, one short " +
      'phrase, or "" when the photos disagree or the subject is not a person.\n' +
      '  warning     — "" unless something is wrong with the reference images ' +
      "(they show different subjects, or the face is never clearly visible).",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  // Eight is plenty of angles, and keeps the request inside the body limit.
  const images = (Array.isArray(body.images) ? body.images : [])
    .filter((u): u is string => typeof u === "string" && u.length < 2_000_000 && DATA_URL.test(u))
    .slice(0, 8);
  if (!images.length) {
    return NextResponse.json({ error: "No usable pictures were sent." }, { status: 400 });
  }

  const key = aiEndpoint()?.key;
  if (!key) return NextResponse.json({ sheet: null });

  const kind: Kind = body.kind === "thing" ? "thing" : "person";
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 60) : "";
  const notes = typeof body.notes === "string" ? body.notes.trim().slice(0, 300) : "";
  const model = process.env.AI_VISION_MODEL || process.env.AI_MODEL || DEFAULT_MODEL;

  try {
    const res = await aiFetch({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt(kind, name, notes) },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `${images.length} picture${images.length === 1 ? "" : "s"} of the same subject:`,
              },
              ...images.map((url) => ({ type: "image_url", image_url: { url } })),
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(110_000),
    });
    if (!res.ok) throw new Error(`Gateway ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = await res.json();
    const parsed = JSON.parse(String(data?.choices?.[0]?.message?.content ?? "{}"));

    const appearance = String(parsed?.appearance ?? "").trim().slice(0, 1200);
    if (!appearance) {
      return NextResponse.json({ error: "The model returned no description." }, { status: 502 });
    }
    return NextResponse.json({
      sheet: {
        appearance,
        identifiers: (Array.isArray(parsed?.identifiers) ? parsed.identifiers : [])
          .map((v: unknown) => String(v).trim().replace(/\.$/, ""))
          .filter(Boolean)
          .slice(0, 6),
        wardrobe: String(parsed?.wardrobe ?? "").trim().slice(0, 160) || undefined,
        builtFrom: images.length,
        builtAt: new Date().toISOString(),
      },
      // Surfaced on the card rather than swallowed: "these are two different
      // people" is the single most useful thing this call can discover.
      warning: String(parsed?.warning ?? "").trim().slice(0, 300) || undefined,
      model,
    });
  } catch (err) {
    console.error("Character sheet failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "The description could not be written." },
      { status: 502 },
    );
  }
}
