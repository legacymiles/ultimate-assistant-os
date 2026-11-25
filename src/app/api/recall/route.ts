import { NextResponse } from "next/server";
import { aiEndpoint, aiFetch, DEFAULT_MODEL } from "@/lib/ai/provider";
import { callerIsMember } from "@/lib/recall/lists/session";
import { isModelId } from "@/lib/new-jarvis/chatModels";
import {
  buildAgentPrompt,
  parseAgentJson,
  type AgentPromptInput,
  type Candidate,
  type EventRef,
  type FolderRef,
  type PersonRef,
  type ProfileRef,
} from "@/lib/recall/agentPrompt";

// POST /api/recall
// Stages:
//   "link"     — fetch a URL and return { title, text } (no AI key required)
//   "classify" — propose { title, summary, folderPath, tags } for a capture
//   "agent"    — answer a question from candidate items + propose actions
// classify/agent prefer the AI Gateway and return null when no key is set, so
// the client falls back to its (richer) local heuristics. Never throws.

export const runtime = "nodejs";
export const maxDuration = 120;

// Endpoint + key come from the shared provider picker (OpenRouter, else
// the Vercel gateway). Both speak the same OpenAI-compatible shape.

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
    /** The shared Jarvis model pick (an OpenRouter/OrcaRouter id). "" = hub default. */
    model?: string;
    outline?: AgentPromptInput["outline"];
    outlineOmitted?: number;
    history?: AgentPromptInput["history"];
    finalPass?: boolean;
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
      if (!body.question) return NextResponse.json({ reply: null, error: "Ask something first." });
      // No key on THIS server is a different problem from a failed call, and
      // the client says so differently — the old code reported every failure
      // (a timeout, a model error) as "AI is off", which sent the owner hunting
      // for a key they had already set.
      if (!apiKey) return NextResponse.json({ reply: null, noKey: true });
      const model = isModelId(body.model) ? body.model : "";
      try {
        const reply = await agentWithLLM(body, model);
        return NextResponse.json({ reply, model: model || process.env.AI_MODEL || DEFAULT_MODEL });
      } catch (err) {
        console.error("Recall agent failed:", err);
        return NextResponse.json({ reply: null, error: plainAgentError(err) });
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

async function callGateway(
  apiKey: string,
  system: string,
  user: string,
  opts: { model?: string; timeoutMs?: number } = {},
): Promise<string> {
  const endpoint = aiEndpoint();
  if (!endpoint) throw new Error("No AI provider configured");
  const model = opts.model || process.env.AI_MODEL || DEFAULT_MODEL;
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
    signal: AbortSignal.timeout(opts.timeoutMs ?? 45_000),
  });
  if (!res.ok) throw new Error(`Gateway ${res.status}: ${(await res.text()).slice(0, 300)}`);
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

/** A sentence the owner can act on, never a stack. */
function plainAgentError(err: unknown): string {
  const t = err instanceof Error ? err.message : String(err);
  if (/TimeoutError|aborted|timeout/i.test(t)) return "The model took too long to answer. Try again, or pick a faster model in the model menu.";
  if (/402|credit|insufficient/i.test(t)) return "The AI account is out of credit. Top it up, or switch the model menu to Claude · my subscription.";
  if (/401|403|unauthor|invalid.*key/i.test(t)) return "The AI key on this server was refused. Check OPENROUTER_API_KEY / AI_GATEWAY_API_KEY.";
  if (/429|rate/i.test(t)) return "The model is rate-limited right now. Try again in a minute or pick another model.";
  if (/404|not a valid model|no endpoints/i.test(t)) return "That model isn't available. Pick another one in the model menu.";
  if (/JSON|Unexpected token/i.test(t)) return "The model answered in the wrong format. Try again, or pick a stronger model.";
  return `The model call failed: ${t.slice(0, 160)}`;
}

async function agentWithLLM(body: AgentPromptInput, model: string) {
  const { system, user } = buildAgentPrompt(body);
  const content = await callGateway("", system, user, { model, timeoutMs: 100_000 });
  const p = parseAgentJson(content);
  if (!p) throw new Error("Model reply was not JSON");
  return { ...p, engine: "ai" as const };
}
