import { NextResponse } from "next/server";
import { DESTINATION_ROUTES, destinationPromptBlock } from "@/lib/dashboard/destinations/registry";
import { aiEndpoint, DEFAULT_MODEL } from "@/lib/ai/provider";
import { callerIsMember } from "@/lib/recall/lists/session";

// POST /api/recall/photos
// One vision call that answers three questions about a photo at once:
//   1. Is this INFORMATION, an EVENT, or PEOPLE?
//   2. If people — which of the known faces (from the labelled contact sheet)?
//   3. Whatever else is needed to file it: a title, a caption, any text in it,
//      a folder, tags, and for an event, when and where.
//
// Doing all three in a single call is the point. Split into a route pass and a
// people pass it would cost twice as much, take twice as long, and the two
// passes could disagree with each other about the same picture.
//
// Returns { analysis: null } with no key set, so the client falls back to its
// own (deliberately unconfident) heuristic instead of failing the import.

export const runtime = "nodejs";
export const maxDuration = 60;

// Endpoint + key come from the shared provider picker.

interface LegendEntry {
  slot: number;
  personId: string;
  name: string;
  role: string;
}

interface Body {
  image?: string;
  name?: string;
  sheet?: string | null;
  legend?: LegendEntry[];
  folderPaths?: string[];
  existingTags?: string[];
  today?: string;
  /** The user's own note about what these photos are. */
  instruction?: string;
  /** Set when the user picked where this photo goes; enforced below. */
  forceRoute?: string;
  /** The user's instructions for this photo, followed as instructions. */
  userPrompt?: string;
  /** Existing places by destination id, so a named place resolves to one of them. */
  knownPlaces?: Record<string, string[]>;
}

async function memberBlocked(): Promise<NextResponse | null> {
  return (await callerIsMember())
    ? NextResponse.json({ error: "This part of Recall is not shared." }, { status: 403 })
    : null;
}

export async function POST(req: Request) {
  const blocked = await memberBlocked();
  if (blocked) return blocked;

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const apiKey = aiEndpoint()?.key;
  if (!apiKey || !body.image) return NextResponse.json({ analysis: null });

  try {
    return NextResponse.json({ analysis: await triage(body, apiKey) });
  } catch (err) {
    console.error("Recall photo triage failed:", err);
    return NextResponse.json({ analysis: null });
  }
}

function systemPrompt(
  legend: LegendEntry[],
  today: string,
  folders: string[],
  tags: string[],
  instruction?: string,
  forceRoute?: string,
  userPrompt?: string,
  knownPlaces?: Record<string, string[]>,
): string {
  const roster = legend.length
    ? legend.map((l) => `  ${l.slot} = ${l.name} (${l.role})`).join("\n")
    : "  (nobody has been labelled yet)";

  return (
    "You triage photos from a personal camera roll into someone's second brain. " +
    `Today is ${today}.\n\n` +
    "You get up to two images. The FIRST, when present, is a REFERENCE CONTACT " +
    "SHEET: a labelled grid of the people this user has already named, each tile " +
    "captioned with a slot number and a name. The SECOND is the PHOTO to triage.\n\n" +
    `KNOWN PEOPLE:\n${roster}\n\n` +
    "Decide ONE route:\n" +
    '  "people" — the photo is primarily of a person or people the user knows or ' +
    "cares about (portraits, selfies, family shots, candids).\n" +
    '  "event"  — the photo carries a specific dated commitment: a flyer, an ' +
    "invitation, a save-the-date, a ticket, an appointment card, a screenshot of " +
    "a booking. Only choose this when there is a real thing to put on a calendar.\n" +
    '  "info"   — anything else worth keeping for what it TELLS you: receipts, ' +
    "whiteboards, documents, screenshots, product labels, parking bays, notes.\n\n" +
    "A photo can contain faces and still be \"info\" or \"event\" — route on what " +
    "the photo is FOR, not merely on whether a person is visible.\n\n" +
    "IDENTIFYING PEOPLE — be conservative. Only list a slot number when the face " +
    "genuinely matches that reference tile; a wrong label sends a photo to the " +
    "wrong family folder and the user has to undo it. When unsure, leave them out " +
    "and count them in unknownPeople instead. Give each match a confidence from " +
    "0 to 1 and never report a match below 0.5. Count EVERY distinct person in " +
    "the shot: matched ones in `people`, everyone else in `unknownPeople`.\n\n" +
    `EXISTING FOLDERS (reuse one for an "info" photo whenever it fits; only ` +
    `invent a path when nothing is close):\n${folders.join("\n") || "(none yet)"}\n\n` +
    `EXISTING TAGS:\n${tags.join(", ") || "(none yet)"}\n\n` +
    "Respond ONLY with minified JSON:\n" +
    `{"route":${['"people"','"info"','"event"',...DESTINATION_ROUTES.map((r) => `"${r}"`)].join("|")},"title":string,"caption":string,"text":string,` +
    '"people":[{"slot":number,"confidence":number}],"unknownPeople":number,' +
    '"folderPath":string[],"tags":string[],' +
    '"event":{"title":string,"date":"YYYY-MM-DD"|null,"time":"HH:MM"|null,"location":string}|null}\n' +
    "  title      — a short human name for the photo.\n" +
    "  caption    — one or two factual sentences about what it shows.\n" +
    "  text       — every legible word in the image, verbatim. \"\" when there is none.\n" +
    '  folderPath — only for route "info"; an array from the root, 1–2 levels.\n' +
    '  event      — only for route "event". Resolve relative dates ("this Friday") ' +
    `against ${today}. Use null for date or time when the image truly does not say; ` +
    "never invent one. 24-hour time.\n" +
    "  tags       — short, lowercase, hyphenated." +
    // Generated from the destination registry, so a destination can never be
    // added without the model being told about it.
    destinationPromptBlock() +
    userGuidance(instruction, forceRoute, userPrompt, knownPlaces)
  );
}

async function triage(body: Body, apiKey: string) {
  const legend = body.legend ?? [];
  const model = process.env.AI_VISION_MODEL || process.env.AI_MODEL || DEFAULT_MODEL;
  const today = body.today || new Date().toISOString().slice(0, 10);

  const content: Record<string, unknown>[] = [];
  if (body.sheet) {
    content.push({ type: "text", text: "REFERENCE CONTACT SHEET (known people):" });
    content.push({ type: "image_url", image_url: { url: body.sheet } });
  }
  content.push({ type: "text", text: `PHOTO TO TRIAGE (filename: ${body.name ?? "photo"}):` });
  content.push({ type: "image_url", image_url: { url: body.image } });

  const res = await fetch(aiEndpoint()!.url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: systemPrompt(
            legend,
            today,
            body.folderPaths ?? [],
            body.existingTags ?? [],
            body.instruction,
            body.forceRoute,
            body.userPrompt,
            body.knownPlaces,
          ),
        },
        { role: "user", content },
      ],
    }),
    signal: AbortSignal.timeout(55_000),
  });
  if (!res.ok) throw new Error(`Gateway ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const raw = String(data?.choices?.[0]?.message?.content ?? "");
  const parsed = JSON.parse(raw);
  const analysis = normalize(parsed, legend);

  // The user's choice of destination is final. The prompt already asks for it,
  // but a model can still answer with its own guess — and the whole point of
  // choosing is that the photo does not end up somewhere else.
  const forced = body.forceRoute;
  if (forced && ["people", "info", "event", ...DESTINATION_ROUTES].includes(forced)) {
    analysis.route = forced;
    const fields = parsed?.[forced];
    analysis.destination =
      fields && typeof fields === "object"
        ? { id: forced, fields: fields as Record<string, unknown> }
        : undefined;
  }
  // Only instructions can ask for these, so they are only read back when given.
  if (body.userPrompt) {
    const album = parsed?.photoAlbum;
    analysis.photoAlbum = typeof album === "string" && album.trim() ? album.trim().slice(0, 60) : null;
    const note = parsed?.agentNote;
    const lines = (v: unknown) =>
      Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean).slice(0, 6) : [];
    analysis.agentNote = { followed: lines(note?.followed), couldNot: lines(note?.couldNot) };
  }
  return analysis;
}

/** Slot numbers back to person ids; every field clamped to something usable. */
function normalize(p: Record<string, unknown>, legend: LegendEntry[]) {
  const bySlot = new Map(legend.map((l) => [l.slot, l.personId]));
  const route = ["people", "info", "event", ...DESTINATION_ROUTES].includes(String(p?.route))
    ? (p.route as string)
    : "info";

  const hits = Array.isArray(p?.people) ? (p.people as Record<string, unknown>[]) : [];
  const people = hits
    .map((h) => ({
      personId: bySlot.get(Number(h?.slot)) ?? "",
      confidence: Math.max(0, Math.min(1, Number(h?.confidence ?? 0))),
    }))
    // The floor is enforced here as well as in the prompt: a model that ignores
    // the instruction must not be able to mislabel someone's family photos.
    .filter((h) => h.personId && h.confidence >= 0.5);

  const seen = new Set<string>();
  const deduped = people.filter((h) => !seen.has(h.personId) && seen.add(h.personId));

  const ev = p?.event as Record<string, unknown> | null | undefined;
  const date = typeof ev?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(ev.date) ? ev.date : null;

  return {
    route,
    title: String(p?.title ?? "").trim() || "Photo",
    caption: String(p?.caption ?? "").trim(),
    text: String(p?.text ?? "").trim() || undefined,
    people: deduped,
    unknownPeople: Math.max(0, Math.min(50, Number(p?.unknownPeople ?? 0))),
    folderPath: Array.isArray(p?.folderPath)
      ? (p.folderPath as unknown[]).map((s) => String(s).trim()).filter(Boolean).slice(0, 3)
      : undefined,
    tags: Array.isArray(p?.tags)
      ? Array.from(
          new Set((p.tags as unknown[]).map((t) => String(t).toLowerCase().trim()).filter(Boolean)),
        ).slice(0, 6)
      : [],
    event:
      route === "event" && ev
        ? {
            title: String(ev.title ?? p?.title ?? "Event").trim() || "Event",
            // A dateless event would land silently on today and be wrong; the
            // review queue asks the user for the date instead.
            date,
            time: typeof ev.time === "string" && /^\d{2}:\d{2}$/.test(ev.time) ? ev.time : null,
            location: String(ev.location ?? "").trim() || undefined,
          }
        : null,
    // The destination's own extracted fields, kept under its id and validated
    // by that destination's parse() rather than here — this route has no idea
    // what an AI Rankings record needs, and should not learn.
    destination:
      typeof p?.[route] === "object" && p[route]
        ? { id: route, fields: p[route] as Record<string, unknown> }
        : undefined,
    photoAlbum: null as string | null,
    agentNote: null as { followed: string[]; couldNot: string[] } | null,
    engine: "ai" as const,
  };
}

/**
 * The user's own steer, appended last so it reads as the final word.
 *
 * Three strengths, on purpose:
 *   - a forced route (an app chip) is an instruction;
 *   - per-photo instructions are instructions too, and may also say where
 *     inside an app the entry goes and what to include or leave out;
 *   - the batch note is guidance only, so "these are all recipes" cannot turn a
 *     photo of a receipt into a recipe.
 * Nothing the user says licenses inventing a fact that is in neither the image
 * nor their message.
 */
function userGuidance(
  instruction?: string,
  forceRoute?: string,
  userPrompt?: string,
  knownPlaces?: Record<string, string[]>,
): string {
  const note = (instruction ?? "").trim().slice(0, 500);
  const prompt = (userPrompt ?? "").trim().slice(0, 1000);
  const parts: string[] = [];
  if (forceRoute) {
    parts.push(
      `The user has decided this photo goes to "${forceRoute}". Use route "${forceRoute}" and ` +
        "fill in every field for it as fully as the image allows.",
    );
  }
  if (prompt) {
    parts.push(
      `The user's instructions for THIS photo: "${prompt}". Follow them exactly. They override your ` +
        "own judgment about which route to use, where the entry is stored inside that app, and what " +
        "to include or leave out. If they name an app or a place, use it. Put any extra detail they " +
        "give into the entry. Never invent a fact that is in neither the image nor these " +
        "instructions: if they ask for something neither supplies, leave it out and say so in " +
        "agentNote.couldNot.",
    );
    parts.push(
      'Also return "photoAlbum": string or null (the Dashboard photo album the user wants the ' +
        "PICTURE itself filed in, only if they asked for one) and " +
        '"agentNote": {"followed": string[], "couldNot": string[]} (short plain-English lines ' +
        "saying what you did because of their instructions, and anything you could not do).",
    );
  }
  if (note) {
    parts.push(
      `The user says about these photos: "${note}". Treat that as strong guidance about what ` +
        "they are and where they belong. Still read the image: if this photo plainly is not " +
        "what the note describes, route it by what it actually is.",
    );
  }
  const places = Object.entries(knownPlaces ?? {}).filter(([, v]) => Array.isArray(v) && v.length);
  if (places.length && (prompt || forceRoute)) {
    parts.push(
      "EXISTING PLACES. When the user names a place, use the existing one that is the same place " +
        "or a close match (spelling, plural, capitalisation), with its exact name. Only use a new " +
        "name when nothing is close.\n" +
        places.map(([k, v]) => `  ${k}: ${v.join("; ")}`).join("\n"),
    );
  }
  return parts.length ? `\n\nUSER GUIDANCE:\n${parts.join("\n")}` : "";
}
