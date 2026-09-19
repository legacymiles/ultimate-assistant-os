import { NextResponse } from "next/server";
import { DEFAULT_MODEL, aiKey, aiFetch } from "@/lib/ai/provider";
import { FILING_RULES, FILING_SCHEMA_FIELDS, FILING_SYSTEM, boardContext } from "@/lib/ai-rankings/classify";
import { coerceEntry, describeSite, heuristicEntry } from "@/lib/ai-rankings/analyzeLink";
import type { AnalyzeResult, SiteRead } from "@/lib/ai-rankings/analyzeLink";
import { readSite } from "@/lib/ai-rankings/readSite";
import { firstUrl } from "@/lib/social-import/platform";
import { BlockedUrlError, assertPublic } from "@/lib/social-import/safeFetch";

export const runtime = "nodejs";
export const maxDuration = 60;

// POST /api/ai-rankings/analyze-url
// Body: { url, tree?: Record<group, category[]>, knownFeatures?: string[] }
// Returns an AnalyzeResult: a complete entry built from what the link says
// about itself. Only a link that can't be used at all is an error; a page that
// won't load or a missing AI key still produces an entry, with a warning.
export async function POST(req: Request) {
  let body: { url?: string; tree?: Record<string, string[]>; knownFeatures?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  // Accept a pasted share blurb as well as a bare link, and a link typed
  // without its https://.
  const typed = String(body.url ?? "").trim();
  const raw = firstUrl(typed) ?? typed;
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (!url.hostname.includes(".")) throw new Error("no host");
  } catch {
    return NextResponse.json({ error: "That doesn't look like a link." }, { status: 400 });
  }

  try {
    await assertPublic(url);
  } catch (err) {
    const message = err instanceof BlockedUrlError ? err.message : "That link can't be read.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  let site: SiteRead;
  try {
    site = await readSite(url);
  } catch (err) {
    console.error("ai-rankings analyze-url: reading failed", err);
    const host = url.hostname.replace(/^www\./, "");
    site = {
      url: url.href, source: "page", readPage: false, name: host, title: "", description: "",
      text: "", pricing: [], links: { github: [], huggingface: [], spaces: [], arxiv: [] },
      repo: null, model: null,
    };
  }

  const fallback = heuristicEntry(site);
  const unread = site.readPage
    ? undefined
    : "Couldn't read that page, so this entry is built from the link alone — check the details.";

  const apiKey = aiKey();
  if (!apiKey) {
    return NextResponse.json<AnalyzeResult>({
      entry: fallback,
      warning: unread ?? "No AI key set, so this is a quick keyword guess — check the details.",
    });
  }

  try {
    const user =
      describeSite(site) +
      "\n" +
      boardContext(body.tree ?? {}, body.knownFeatures ?? []) +
      "\nname: the product's own short name as the page uses it (e.g. \"AuK\", not the tagline).\n" +
      "notes: 2-4 plain sentences for the user's own record — what it is, who makes it, what " +
      "stands out, and anything that limits it (hardware needs, waitlist, licence terms, " +
      "archived). No marketing language, no URLs.\n" +
      "pricingNote: short free text like \"$20/mo\", \"credits\", \"free, self-hosted\", or \"\".\n" +
      FILING_RULES +
      `JSON:\n{"name":string,"notes":string,${FILING_SCHEMA_FIELDS}}`;

    const res = await aiFetch({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.AI_MODEL || DEFAULT_MODEL,
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              FILING_SYSTEM +
              " You are given what was just read from a link. Trust it over your memory for " +
              "facts like licence, price and what the tool does.",
          },
          { role: "user", content: user },
        ],
      }),
      signal: AbortSignal.timeout(40_000),
    });
    if (!res.ok) throw new Error(`AI provider ${res.status}`);

    const json = await res.json();
    const text: string = json?.choices?.[0]?.message?.content ?? "{}";
    // Some models wrap JSON in a fence even when asked not to.
    const parsed = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ""));
    return NextResponse.json<AnalyzeResult>({ entry: coerceEntry(parsed, fallback, site), warning: unread });
  } catch (err) {
    console.error("ai-rankings analyze-url: AI failed, using heuristic:", err);
    return NextResponse.json<AnalyzeResult>({
      entry: fallback,
      warning: unread ?? "The AI didn't answer, so this is a quick keyword guess — check the details.",
    });
  }
}
