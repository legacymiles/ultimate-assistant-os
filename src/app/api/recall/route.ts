import { NextResponse } from "next/server";
import { callerIsMember } from "@/lib/recall/lists/session";

// POST /api/recall
// Stages:
//   "link"     — fetch a URL and return { title, text } (no AI key required)
//   "classify" — propose { title, summary, folderPath, tags } for a capture
//   "agent"    — answer a question from candidate items + propose actions
// classify/agent prefer the AI Gateway and return null when no key is set, so
// the client falls back to its (richer) local heuristics. Never throws.

export const runtime = "nodejs";
export const maxDuration = 60;

const GATEWAY = "https://ai-gateway.vercel.sh/v1/chat/completions";

interface Candidate {
  id: string;
  title: string;
  summary: string;
  body: string;
  /** Text read out of the file/page itself (PDF contents, described image). */
  extract?: string;
  kind?: string;
  folder: string;
  tags: string[];
}

interface FolderRef {
  id: string;
  path: string;
}

interface EventRef {
  id: string;
  title: string;
  date: string;
  time: string | null;
  location: string | null;
  notes: string | null;
}

interface PersonRef {
  id: string;
  name: string;
  role: string;
}

/**
 * Family members get the Lists board and nothing else, so the RAG side refuses
 * them here rather than only hiding the UI.
 */
async function memberBlocked(): Promise<NextResponse | null> {
  return (await callerIsMember())
    ? NextResponse.json({ error: "This part of Recall is not shared." }, { status: 403 })
    : null;
}

export async function POST(req: Request) {
  const blocked = await memberBlocked();
  if (blocked) return blocked;

  let body: {
    stage?: string;
    url?: string;
    content?: string;
    kind?: string;
    folderPaths?: string[];
    existingTags?: string[];
    question?: string;
    candidates?: Candidate[];
    folders?: FolderRef[];
    today?: string;
    events?: EventRef[];
    people?: PersonRef[];
    photoCategories?: string[];
    pendingPhotos?: number;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const apiKey = process.env.AI_GATEWAY_API_KEY;

  switch (body.stage) {
    case "link":
      return NextResponse.json(await fetchLink(body.url ?? ""));

    case "classify": {
      if (!apiKey || !body.content) return NextResponse.json({ classification: null });
      try {
        const classification = await classifyWithLLM(body, apiKey);
        return NextResponse.json({ classification });
      } catch (err) {
        console.error("Recall classify failed, using client heuristic:", err);
        return NextResponse.json({ classification: null });
      }
    }

    case "agent": {
      if (!apiKey || !body.question) return NextResponse.json({ reply: null });
      try {
        const reply = await agentWithLLM(body, apiKey);
        return NextResponse.json({ reply });
      } catch (err) {
        console.error("Recall agent failed, using client heuristic:", err);
        return NextResponse.json({ reply: null });
      }
    }

    default:
      return NextResponse.json({ error: "unknown stage" }, { status: 400 });
  }
}

// ----- Stage: link ---------------------------------------------------------

async function fetchLink(rawUrl: string): Promise<{ title: string; text: string }> {
  const url = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; RecallBot/1.0)" },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return { title: hostname(url), text: url };
    const html = await res.text();
    const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    const title = (titleMatch?.[1] ?? hostname(url)).trim();
    const text = stripHtml(html).slice(0, 5000);
    return { title, text: text || url };
  } catch {
    return { title: hostname(url), text: url };
  }
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#\d+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ----- Gateway helper ------------------------------------------------------

async function callGateway(apiKey: string, system: string, user: string): Promise<string> {
  const model = process.env.AI_MODEL || "anthropic/claude-sonnet-4-6";
  const res = await fetch(GATEWAY, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      temperature: 0.3,
      response_format: { type: "json_object" },
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

// ----- Stage: classify -----------------------------------------------------

async function classifyWithLLM(
  body: { content?: string; folderPaths?: string[]; existingTags?: string[] },
  apiKey: string,
) {
  const system =
    "You file items into a personal knowledge base. Given a captured item and the " +
    "user's EXISTING folder tree and tags, propose where it belongs. REUSE an " +
    "existing folder path when it fits — only invent a new one when nothing " +
    "existing is close. Prefer a shallow path (1–2 levels). Reuse existing tags " +
    "where sensible; keep tags short, lowercase, hyphenated. Respond ONLY with " +
    'minified JSON: {"title":string,"summary":string,"folderPath":string[],"tags":string[]}. ' +
    "folderPath is an array of folder names from root, e.g. [\"Game Dev\",\"Engines\"]. " +
    "summary is one sentence.";
  const user =
    `EXISTING FOLDERS:\n${(body.folderPaths ?? []).join("\n") || "(none yet)"}\n\n` +
    `EXISTING TAGS:\n${(body.existingTags ?? []).join(", ") || "(none yet)"}\n\n` +
    `CAPTURED ITEM:\n${body.content ?? ""}`;
  const content = await callGateway(apiKey, system, user);
  const p = JSON.parse(content);
  const folderPath = Array.isArray(p?.folderPath)
    ? p.folderPath.map((s: unknown) => String(s).trim()).filter(Boolean).slice(0, 3)
    : [];
  return {
    title: String(p?.title ?? "").trim(),
    summary: String(p?.summary ?? "").trim(),
    folderPath: folderPath.length ? folderPath : ["Inbox"],
    tags: Array.isArray(p?.tags)
      ? Array.from(new Set(p.tags.map((t: unknown) => String(t).toLowerCase().trim()).filter(Boolean))).slice(0, 6)
      : [],
    engine: "ai" as const,
  };
}

// ----- Stage: agent --------------------------------------------------------

async function agentWithLLM(
  body: {
    question?: string;
    candidates?: Candidate[];
    folderPaths?: string[];
    folders?: FolderRef[];
    today?: string;
    events?: EventRef[];
    people?: PersonRef[];
    photoCategories?: string[];
    pendingPhotos?: number;
  },
  apiKey: string,
) {
  const candidates = body.candidates ?? [];
  const today = body.today || new Date().toISOString().slice(0, 10);
  const system =
    "You are the user's personal assistant. You can see three things they own: " +
    "their KNOWLEDGE BASE (notes, files, photos and records they have saved), " +
    "their CALENDAR, and the PEOPLE their photo library knows how to recognise. " +
    `Today is ${today}.\n\n` +
    "Answer using ONLY what you are given; cite the item ids you drew on. Each " +
    "candidate may carry an EXTRACT — text read out of the file itself (a " +
    "PDF's contents, a described photo). Treat the extract as the item's real " +
    "content and quote from it when it answers the question. Photos filed by the " +
    "camera roll are ordinary items whose extract describes what is in them, so " +
    "\"find the picture of the receipt\" is answerable the same way anything " +
    "else is. If what you have does not cover it, say so plainly — never invent " +
    "a fact, a date or a person. Be concise and direct, the way a good assistant " +
    "is: lead with the answer, not with a preamble about what you did.\n\n" +
    "You may ALSO propose actions — to reorganise the knowledge base, to put " +
    "something on the calendar, or to register a new person. EVERY action is " +
    "shown to the user for explicit confirmation before it runs, so never say " +
    "you have already done something; say what you are proposing. Prefer the " +
    "fewest, largest actions: move_items for a batch rather than many move_item. " +
    "Only propose deletions when the user clearly asked for them.\n\n" +
    "CALENDAR RULES. Resolve every relative date (\"Friday\", \"next week\", " +
    "\"tomorrow\") against today and emit an absolute YYYY-MM-DD. If the user " +
    "gives no date and none can be inferred, ask for it instead of proposing an " +
    "event — an event on the wrong day is worse than no event. Times are local " +
    "24-hour HH:MM; use null for an all-day event. `reminders` are whole minutes " +
    "before the start (1440 = a day before, 60 = an hour before); default to " +
    "[1440] for a dated commitment and [] for something purely informational.\n\n" +
    "Allowed actions:\n" +
    '  {"type":"create_folder","path":string[]}\n' +
    '  {"type":"move_item","itemId":string,"path":string[]}\n' +
    '  {"type":"move_items","itemIds":string[],"path":string[]}\n' +
    '  {"type":"add_tags","itemId":string,"tags":string[]}\n' +
    '  {"type":"remove_tags","itemId":string,"tags":string[]}\n' +
    '  {"type":"create_note","title":string,"body":string,"path":string[],"tags":string[]}\n' +
    '  {"type":"rename_item","itemId":string,"title":string}\n' +
    '  {"type":"edit_note","itemId":string,"body":string}\n' +
    '  {"type":"rename_folder","folderId":string,"name":string}\n' +
    '  {"type":"move_folder","folderId":string,"path":string[]}\n' +
    '  {"type":"merge_folders","sourceId":string,"targetPath":string[]}\n' +
    '  {"type":"delete_item","itemId":string}\n' +
    '  {"type":"delete_folder","folderId":string}\n' +
    '  {"type":"create_event","title":string,"date":"YYYY-MM-DD","time":"HH:MM"|null,"endTime":"HH:MM"|null,"location":string,"notes":string,"reminders":number[]}\n' +
    '  {"type":"update_event","eventId":string,"title":string,"date":"YYYY-MM-DD","time":"HH:MM"|null,"location":string,"notes":string,"reminders":number[]}\n' +
    '  {"type":"delete_event","eventId":string}\n' +
    '  {"type":"add_person","name":string,"role":"self"|"partner"|"child"|"relative"|"friend"|"other"}\n' +
    "Use itemId values only from the candidates, folderId only from FOLDERS, and " +
    "eventId only from CALENDAR. `path` is an array of folder names from the " +
    "root. Photo folders live under \"Photos\". Respond ONLY with minified " +
    'JSON: {"answer":string,"citations":string[],"actions":object[]}. ' +
    "Use [] when there are no actions.";
  const candidateBlock = candidates
    .map((c) => {
      const head = `[${c.id}] ${c.title} (${c.kind ?? "note"}; folder: ${c.folder}; tags: ${c.tags.join(", ") || "none"})`;
      const own = c.summary || c.body.slice(0, 200);
      const read = c.extract ? `\nEXTRACT: ${c.extract}` : "";
      return `${head}\n${own}${read}`;
    })
    .join("\n\n");
  const folderBlock = (body.folders ?? [])
    .map((f) => `[${f.id}] ${f.path}`)
    .join("\n");
  const eventBlock = (body.events ?? [])
    .map(
      (e) =>
        `[${e.id}] ${e.date}${e.time ? ` ${e.time}` : " (all day)"} — ${e.title}` +
        `${e.location ? ` @ ${e.location}` : ""}${e.notes ? ` — ${e.notes}` : ""}`,
    )
    .join("\n");
  const peopleBlock = (body.people ?? [])
    .map((p) => `[${p.id}] ${p.name} (${p.role})`)
    .join("\n");
  const user =
    `FOLDERS (id → path):\n${folderBlock || "(none)"}\n\n` +
    `FOLDER TREE:\n${(body.folderPaths ?? []).join("\n") || "(none)"}\n\n` +
    `CALENDAR (upcoming; id → event):\n${eventBlock || "(nothing scheduled)"}\n\n` +
    `KNOWN PEOPLE:\n${peopleBlock || "(nobody labelled yet)"}\n\n` +
    `PHOTO FOLDERS:\n${(body.photoCategories ?? []).join(", ") || "(none)"}\n` +
    `PHOTOS AWAITING REVIEW: ${body.pendingPhotos ?? 0}\n\n` +
    `CANDIDATE ITEMS:\n${candidateBlock || "(none saved yet)"}\n\n` +
    `QUESTION:\n${body.question ?? ""}`;
  const content = await callGateway(apiKey, system, user);
  const p = JSON.parse(content);
  return {
    answer: String(p?.answer ?? "").trim(),
    citations: Array.isArray(p?.citations) ? p.citations.map(String) : [],
    actions: Array.isArray(p?.actions) ? p.actions : [],
    engine: "ai" as const,
  };
}
