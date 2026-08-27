import { NextResponse } from "next/server";

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
  folder: string;
  tags: string[];
}

export async function POST(req: Request) {
  let body: {
    stage?: string;
    url?: string;
    content?: string;
    kind?: string;
    folderPaths?: string[];
    existingTags?: string[];
    question?: string;
    candidates?: Candidate[];
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
  body: { question?: string; candidates?: Candidate[]; folderPaths?: string[] },
  apiKey: string,
) {
  const candidates = body.candidates ?? [];
  const system =
    "You are the user's personal knowledge assistant (RAG over their own saved " +
    "notes). Answer the question USING ONLY the provided candidate items; cite the " +
    "ids you used. If the notes don't cover it, say so plainly — never invent facts. " +
    "Be concise and direct.\n\n" +
    "You may ALSO propose actions to organise the knowledge base, but ONLY when the " +
    "user clearly asks you to (e.g. 'tidy these', 'make a folder', 'tag this'). Every " +
    "action is shown to the user for confirmation before it runs — never assume it " +
    "happened. Allowed actions:\n" +
    '  {"type":"create_folder","path":string[]}\n' +
    '  {"type":"move_item","itemId":string,"path":string[]}\n' +
    '  {"type":"add_tags","itemId":string,"tags":string[]}\n' +
    '  {"type":"remove_tags","itemId":string,"tags":string[]}\n' +
    '  {"type":"create_note","title":string,"body":string,"path":string[],"tags":string[]}\n' +
    "Use itemId values only from the candidates. Respond ONLY with minified JSON: " +
    '{"answer":string,"citations":string[],"actions":object[]}. Use [] when there are no actions.';
  const candidateBlock = candidates
    .map(
      (c) =>
        `[${c.id}] ${c.title} (folder: ${c.folder}; tags: ${c.tags.join(", ") || "none"})\n${c.summary || c.body.slice(0, 200)}`,
    )
    .join("\n\n");
  const user =
    `FOLDER TREE:\n${(body.folderPaths ?? []).join("\n") || "(none)"}\n\n` +
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
