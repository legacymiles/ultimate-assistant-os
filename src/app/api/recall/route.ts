import { NextResponse } from "next/server";
import { aiEndpoint, aiFetch, DEFAULT_MODEL } from "@/lib/ai/provider";
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

// Endpoint + key come from the shared provider picker (OpenRouter, else
// the Vercel gateway). Both speak the same OpenAI-compatible shape.

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

interface ProfileRef {
  id: string;
  displayName: string;
  kind: "person" | "business";
  role?: string;
  headline?: string;
  folder: string;
  /** Non-sensitive known values, one "Label: value" per line. */
  details?: string;
  /** Labels still blank — what the assistant should ask about. */
  missing?: string[];
  accounts?: string[];
}

interface ProfileDraftBody {
  description?: string;
  kind?: string | null;
  name?: string | null;
  candidates?: { id: string; title: string; summary?: string; extract?: string }[];
  folderPaths?: string[];
  existingTags?: string[];
  existingProfiles?: { displayName: string; kind: "person" | "business"; role?: string }[];
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
    profiles?: ProfileRef[];
    description?: string;
    name?: string | null;
    existingProfiles?: { displayName: string; kind: "person" | "business"; role?: string }[];
    liveUrl?: string;
    jsonPath?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const apiKey = aiEndpoint()?.key;

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

    case "profile": {
      if (!apiKey || !body.description) return NextResponse.json({ draft: null });
      try {
        const draft = await profileWithLLM(body, apiKey);
        return NextResponse.json({ draft });
      } catch (err) {
        console.error("Recall profile draft failed, using client heuristic:", err);
        return NextResponse.json({ draft: null });
      }
    }

    case "live":
      return NextResponse.json(await fetchLiveValue(body.liveUrl ?? "", body.jsonPath ?? ""));

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
  const endpoint = aiEndpoint();
  if (!endpoint) throw new Error("No AI provider configured");
  const model = process.env.AI_MODEL || DEFAULT_MODEL;
  const res = await aiFetch({
    method: "POST",
    headers: { "Content-Type": "application/json" },
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

// ----- Stage: profile ------------------------------------------------------

const PROFILE_FIELD_TYPES = [
  "text",
  "email",
  "phone",
  "date",
  "ssn",
  "number",
  "money",
  "url",
  "login",
  "secret",
  "note",
] as const;

const PROFILE_ACCOUNT_KINDS = [
  "account",
  "brokerage",
  "retirement",
  "crypto",
  "domain",
  "hosting",
  "saas",
  "subscription",
  "other",
] as const;

async function profileWithLLM(body: ProfileDraftBody, apiKey: string) {
  const system =
    "You are Jarvis, the user's personal assistant. The user pressed Add Profile and " +
    "is telling you who or what to create. Build a profile DRAFT they can review.\n\n" +
    "RULES:\n" +
    "1. Use the RELATED RECORDS the user already has. Cite a record by id in sources " +
    "only when you actually used it. Never invent a fact, a date, a login or a number.\n" +
    "2. A field you do not know is an empty string, not a guess. Include every standard " +
    "field for the kind, even when blank — a visible placeholder is the point.\n" +
    "3. A person needs: Full legal name, Preferred name, Birthday, SSN, Email, Phone, " +
    "Home address, Emergency contact. A business needs: Legal name, EIN, Website / domain, " +
    "Registrar, Hosting, Renewal date, Business email, Phone, Address, Formation date.\n" +
    "4. Accounts are for things with their own numbers: a brokerage/bank account, a domain, " +
    "hosting, a subscription. Include openedDate, renewalDate, login, value, currency and url " +
    "when known. If the text mentions a Trump account, a domain, Cloudflare, or a bank, " +
    "create that account with whatever is known and blanks for the rest. Never include a password.\n" +
    "5. Questions: at most 6, concrete, about the missing fields that matter most. Ask " +
    "\"What is his full legal name?\", not \"Tell me more\".\n" +
    "6. role is one of self, child, partner, relative, friend, client, vendor, other, and only " +
    "for people. Businesses have no role.\n\n" +
    "Respond ONLY with minified JSON:\n" +
    '{"kind":"person"|"business","displayName":string,"role":string|null,"headline":string,' +
    '"summary":string,"confidence":"high"|"medium"|"low",' +
    '"fields":[{"label":string,"value":string,"type":"text"|"email"|"phone"|"date"|"ssn"|"number"|"money"|"url"|"login"|"secret"|"note"}],' +
    '"accounts":[{"label":string,"provider":string,"kind":"account"|"brokerage"|"retirement"|"crypto"|"domain"|"hosting"|"saas"|"subscription"|"other","openedDate":string,"renewalDate":string,"login":string,"value":string,"currency":string,"url":string}],' +
    '"questions":string[],"sources":[{"id":string,"title":string}]}';

  const candidates = (body.candidates ?? [])
    .map((c) => `[${c.id}] ${c.title}\n${(c.summary ?? "").slice(0, 240)}\n${(c.extract ?? "").slice(0, 700)}`)
    .join("\n\n");
  const existing = (body.existingProfiles ?? [])
    .map((p) => `- ${p.displayName} (${p.kind}${p.role ? `, ${p.role}` : ""})`)
    .join("\n");
  const user =
    `WHAT THE USER SAID:\n${body.description ?? ""}\n\n` +
    `KIND THEY PICKED: ${body.kind ?? "decide from the text"}\n` +
    `NAME THEY TYPED: ${body.name ?? "(none)"}\n\n` +
    `EXISTING FOLDERS:\n${(body.folderPaths ?? []).join("\n") || "(none yet)"}\n\n` +
    `EXISTING PROFILES:\n${existing || "(none yet)"}\n\n` +
    `RELATED RECORDS:\n${candidates || "(none found)"}`;

  const content = await callGateway(apiKey, system, user);
  const p = JSON.parse(content) as Record<string, unknown>;
  const fields = Array.isArray(p.fields)
    ? (p.fields as Record<string, unknown>[])
        .map((f) => {
          const type = String(f?.type ?? "text") as (typeof PROFILE_FIELD_TYPES)[number];
          return {
            label: String(f?.label ?? "").trim(),
            value: String(f?.value ?? "").trim(),
            type: PROFILE_FIELD_TYPES.includes(type) ? type : "text",
          };
        })
        .filter((f) => f.label)
        .slice(0, 24)
    : [];
  const accounts = Array.isArray(p.accounts)
    ? (p.accounts as Record<string, unknown>[])
        .map((a) => {
          const kind = String(a?.kind ?? "other") as (typeof PROFILE_ACCOUNT_KINDS)[number];
          return {
            label: String(a?.label ?? "").trim(),
            provider: String(a?.provider ?? "").trim(),
            kind: PROFILE_ACCOUNT_KINDS.includes(kind) ? kind : "other",
            openedDate: String(a?.openedDate ?? "").trim(),
            renewalDate: String(a?.renewalDate ?? "").trim(),
            login: String(a?.login ?? "").trim(),
            value: String(a?.value ?? "").trim(),
            currency: String(a?.currency ?? "USD").trim() || "USD",
            url: String(a?.url ?? "").trim(),
          };
        })
        .filter((a) => a.label)
        .slice(0, 12)
    : [];
  const candidateIds = new Set((body.candidates ?? []).map((c) => c.id));
  const sources = Array.isArray(p.sources)
    ? (p.sources as Record<string, unknown>[])
        .map((s) => ({ id: String(s?.id ?? ""), title: String(s?.title ?? "") }))
        .filter((s) => candidateIds.has(s.id) && s.title)
        .slice(0, 6)
    : [];
  return {
    kind: p.kind === "business" ? "business" : "person",
    displayName: String(p.displayName ?? body.name ?? "").trim(),
    role: typeof p.role === "string" ? p.role : null,
    headline: String(p.headline ?? "").trim(),
    summary: String(p.summary ?? "").trim(),
    confidence: p.confidence === "high" || p.confidence === "medium" ? p.confidence : "low",
    fields,
    accounts,
    questions: Array.isArray(p.questions)
      ? p.questions.map(String).filter(Boolean).slice(0, 6)
      : [],
    sources,
  };
}

// ----- Stage: live value ---------------------------------------------------

/** Keep the read-only connector to public HTTPS; no localhost, no link-local. */
function safeLiveUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (
      host === "localhost" ||
      host.endsWith(".local") ||
      host === "0.0.0.0" ||
      host === "::1" ||
      host.startsWith("127.") ||
      host.startsWith("10.") ||
      host.startsWith("192.168.") ||
      host.startsWith("169.254.") ||
      (host.includes(":") &&
        (host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80"))) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function readJsonPath(value: unknown, path: string): unknown {
  const parts = path.split(".").map((p) => p.trim()).filter(Boolean);
  let cur = value;
  for (const part of parts) {
    if (cur == null) return undefined;
    if (Array.isArray(cur)) {
      const idx = Number(part);
      cur = Number.isInteger(idx) ? cur[idx] : undefined;
    } else if (typeof cur === "object") {
      cur = (cur as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return cur;
}

const LIVE_KEYS = ["value", "balance", "amount", "total", "equity", "price", "renewalPrice", "current"];

function findNumber(value: unknown, depth = 0): number | null {
  if (depth > 5 || value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const cleaned = value.replace(/[$,\s]/g, "");
    if (/^-?\d+(\.\d+)?$/.test(cleaned)) return Number(cleaned);
    return null;
  }
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 20)) {
      const hit = findNumber(item, depth + 1);
      if (hit !== null) return hit;
    }
    return null;
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    for (const key of LIVE_KEYS) if (key in obj) {
      const hit = findNumber(obj[key], depth + 1);
      if (hit !== null) return hit;
    }
    for (const v of Object.values(obj).slice(0, 40)) {
      const hit = findNumber(v, depth + 1);
      if (hit !== null) return hit;
    }
  }
  return null;
}

async function fetchLiveValue(
  rawUrl: string,
  jsonPath: string,
): Promise<{ value: string | null; currency?: string; error?: string; fetchedAt?: string }> {
  const url = safeLiveUrl(rawUrl);
  if (!url) return { value: null, error: "Use a public HTTPS URL (no localhost or private addresses)." };
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    if (!res.ok) return { value: null, error: `Endpoint returned ${res.status}.` };
    const data = (await res.json()) as unknown;
    const picked = jsonPath.trim() ? readJsonPath(data, jsonPath) : data;
    const number = findNumber(picked);
    if (number === null) return { value: null, error: "No number found at that path." };
    const currency =
      jsonPath.trim() && picked && typeof picked === "object"
        ? String((picked as Record<string, unknown>).currency ?? "") || undefined
        : data && typeof data === "object"
          ? String((data as Record<string, unknown>).currency ?? "") || undefined
          : undefined;
    return {
      value: String(number),
      currency,
      fetchedAt: new Date().toISOString(),
    };
  } catch (err) {
    return { value: null, error: err instanceof Error ? err.message : "Could not reach that endpoint." };
  }
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
    profiles?: ProfileRef[];
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
    "You can also see PROFILES — people and businesses the user keeps a card " +
    "for. A profile owns a folder and a folder-note; its fields and accounts are " +
    "listed. Use them for questions like \"what is my son's birthday\" or \"when " +
    "does the domain renew\". Never invent a missing field: if a profile shows a " +
    "blank placeholder, ask for it.\n\n" +
    "You may ALSO propose actions — to reorganise the knowledge base, to put " +
    "something on the calendar, to register a new person, or to create/update a " +
    "profile. EVERY action is shown to the user for explicit confirmation before " +
    "it runs, so never say you have already done something; say what you are " +
    "proposing. Prefer the fewest, largest actions: move_items for a batch rather " +
    "than many move_item. Only propose deletions when the user clearly asked for " +
    "them.\n\n" +
    "WHEN THE USER GIVES YOU FACTS TO KEEP (a purchase, a login, a renewal date, " +
    "a domain) rather than a question: propose create_note with a precise folder " +
    "path and one fact per line, or create_profile for a person/business. Do not " +
    "silently answer and drop the facts. If a detail is missing (renewal date, " +
    "registrar, login), ask for it in the answer and leave a placeholder instead " +
    "of guessing.\n\n" +
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
    '  {"type":"create_profile","kind":"person"|"business","displayName":string,"role"?:string,"fields":[{"label":string,"value":string,"type"?:string}],"accounts":[{"label":string,"provider"?:string,"kind"?:string,"openedDate"?:string,"renewalDate"?:string,"login"?:string,"value"?:string,"currency"?:string,"url"?:string}],"tags"?:string[]}\n' +
    '  {"type":"update_profile_field","profileId":string,"label":string,"value":string}\n' +
    '  {"type":"add_profile_account","profileId":string,"label":string,"provider"?:string,"kind"?:string,"openedDate"?:string,"renewalDate"?:string,"login"?:string,"value"?:string,"currency"?:string,"url"?:string}\n' +
    '  {"type":"delete_profile","profileId":string}\n' +
    "Use itemId values only from the candidates, folderId only from FOLDERS, " +
    "eventId only from CALENDAR, and profileId only from PROFILES. `path` is an array of folder names from the " +
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
  const profileBlock = (body.profiles ?? [])
    .map((p) => {
      const bits = [
        `[${p.id}] ${p.displayName} (${p.kind}${p.role ? `, ${p.role}` : ""}; folder: ${p.folder})`,
        p.headline ? `headline: ${p.headline}` : "",
        p.details ? `details: ${p.details}` : "",
        p.missing?.length ? `MISSING: ${p.missing.join(", ")}` : "",
        p.accounts?.length ? `accounts: ${p.accounts.join("; ")}` : "",
      ].filter(Boolean);
      return bits.join("\n");
    })
    .join("\n\n");
  const user =
    `FOLDERS (id → path):\n${folderBlock || "(none)"}\n\n` +
    `FOLDER TREE:\n${(body.folderPaths ?? []).join("\n") || "(none)"}\n\n` +
    `CALENDAR (upcoming; id → event):\n${eventBlock || "(nothing scheduled)"}\n\n` +
    `KNOWN PEOPLE:\n${peopleBlock || "(nobody labelled yet)"}\n\n` +
    `PHOTO FOLDERS:\n${(body.photoCategories ?? []).join(", ") || "(none)"}\n` +
    `PHOTOS AWAITING REVIEW: ${body.pendingPhotos ?? 0}\n\n` +
    `PROFILES (id → subject):\n${profileBlock || "(no profiles yet)"}\n\n` +
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
