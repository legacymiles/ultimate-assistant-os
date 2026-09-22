import { NextResponse } from "next/server";
import { DEFAULT_MODEL, aiKey, aiFetch } from "@/lib/ai/provider";
import {
  guessCandidates,
  guessSiteUrl,
  guessSource,
  looksLikeDomain,
  type ResolvedUrl,
} from "@/lib/ai-rankings/siteUrl";

export const runtime = "nodejs";
export const maxDuration = 30;

// POST /api/ai-rankings/site-url
// Body: { name }
// Returns { url, source } and never an error the UI has to handle: with no key
// set, or with the model unreachable, the domain probe answers, and if nothing
// on the network answers the plain .com guess does. An entry in the AI Rankings
// folder must end up with a clickable link on a laptop with no keys and no
// internet, because that is the state the hub promises to work in.

/**
 * Does this URL actually serve something? HEAD first, GET as the fallback.
 * Only used to choose between GUESSED domains — a name the model recognised is
 * trusted without it, because a site can be real and still refuse this server.
 */
async function reachable(url: string, ms = 3500): Promise<boolean> {
  for (const method of ["HEAD", "GET"] as const) {
    try {
      const res = await fetch(url, {
        method,
        redirect: "follow",
        signal: AbortSignal.timeout(ms),
        // Parked domains and CDNs are picky about a bare agent.
        headers: { "user-agent": "Mozilla/5.0 (compatible; UltimateAssistantOS/1.0)" },
      });
      // 4xx still proves a server is there and answering for this host, which
      // is what "the domain exists" means; only 404 on the root is a dead end.
      if (res.status < 400 || (res.status < 500 && res.status !== 404)) return true;
      if (method === "GET") return false;
    } catch {
      if (method === "GET") return false;
    }
  }
  return false;
}

/** The first candidate that answers, probing in order so .com beats .ai. */
async function firstReachable(urls: string[]): Promise<string | null> {
  const checks = urls.map(async (u) => ((await reachable(u)) ? u : null));
  const results = await Promise.all(checks);
  return results.find((u): u is string => Boolean(u)) ?? null;
}

/** What the model answered, kept only if it is a plain site URL. */
function cleanModelUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().replace(/[),.]+$/, "");
  if (!s || /\s/.test(s)) return null;
  const withScheme = /^https?:\/\//i.test(s) ? s : `https://${s}`;
  let host: string;
  try {
    host = new URL(withScheme).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (!looksLikeDomain(host)) return null;
  // A search result is not a homepage; neither is "I don't know" dressed up.
  if (/^(www\.)?(google|bing|duckduckgo|yahoo|baidu)\./.test(host)) return null;
  if (host === "example.com" || host.endsWith(".example.com")) return null;
  return withScheme;
}

const SYSTEM =
  "You map a software product or tool name to its official homepage URL. " +
  "Answer with JSON only. If you are not reasonably sure the product exists " +
  'and you know its real domain, answer {"url":""} — a wrong URL is worse ' +
  "than no URL. Never answer with a search engine link, a Wikipedia link or " +
  "a placeholder domain. Prefer the product's own site; for a GitHub project " +
  "with no site of its own, the repository URL is right.";

export async function POST(req: Request) {
  let body: { name?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const name = (body.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "Give me a name" }, { status: 400 });

  const candidates = guessCandidates(name);
  const fallback: ResolvedUrl = { url: guessSiteUrl(name), source: guessSource(name) };

  // A name that is already a domain or an owner/repo needs no help at all.
  if (fallback.source === "typed" || !candidates.length) return NextResponse.json(fallback);

  // 1. Ask the model — it is the only step that can know a brand.
  if (aiKey()) {
    try {
      const res = await aiFetch({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: process.env.AI_MODEL || DEFAULT_MODEL,
          temperature: 0,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: SYSTEM },
            { role: "user", content: `Name: ${name}\nJSON:\n{"url":"https://…"}` },
          ],
        }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`Gateway ${res.status}`);
      const json = await res.json();
      const parsed = JSON.parse(json?.choices?.[0]?.message?.content ?? "{}");
      // Taken at its word, deliberately. An earlier version only accepted an
      // answer the server could also FETCH, and that was worse: the sites this
      // folder collects sit behind bot protection that refuses a datacentre
      // request, so krea.ai was thrown away and a parked krea.com won the
      // probe instead. Knowing the brand beats being able to reach it; the
      // owner sees the URL in an editable field before it is saved.
      const url = cleanModelUrl(parsed?.url);
      if (url) return NextResponse.json({ url, source: "ai" });
    } catch (err) {
      console.error("ai-rankings site-url lookup failed, probing instead:", err);
    }
  }

  // 2. No key, or a name the model did not recognise — try the obvious domains.
  try {
    const hit = await firstReachable(candidates);
    if (hit) return NextResponse.json({ url: hit, source: "probe" });
  } catch (err) {
    console.error("ai-rankings site-url probe failed:", err);
  }

  // 3. Nothing answered. Hand back the guess anyway, labelled as one.
  return NextResponse.json(fallback);
}
