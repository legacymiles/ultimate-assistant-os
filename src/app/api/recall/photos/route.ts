import { NextResponse } from "next/server";
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

function systemPrompt(legend: LegendEntry[], today: string, folders: string[], tags: string[]): string {
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
    '{"route":"people"|"info"|"event","title":string,"caption":string,"text":string,' +
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
    "  tags       — short, lowercase, hyphenated."
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
          content: systemPrompt(legend, today, body.folderPaths ?? [], body.existingTags ?? []),
        },
        { role: "user", content },
      ],
    }),
    signal: AbortSignal.timeout(55_000),
  });
  if (!res.ok) throw new Error(`Gateway ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const raw = String(data?.choices?.[0]?.message?.content ?? "");
  return normalize(JSON.parse(raw), legend);
}

/** Slot numbers back to person ids; every field clamped to something usable. */
function normalize(p: Record<string, unknown>, legend: LegendEntry[]) {
  const bySlot = new Map(legend.map((l) => [l.slot, l.personId]));
  const route = ["people", "info", "event"].includes(String(p?.route))
    ? (p.route as "people" | "info" | "event")
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
    engine: "ai" as const,
  };
}
