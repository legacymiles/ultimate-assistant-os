import { NextResponse } from "next/server";
import {
  DEFAULT_SKILLS,
  heuristicRedesign,
  normalizeUrl,
  scrapeUrl,
  str,
  toStrArr,
  type DesignSkill,
  type Direction,
  type RedesignResult,
  type ReqBody,
  type Scrape,
} from "@/lib/redesigner/engine";

export const runtime = "nodejs";
export const maxDuration = 60;

const GATEWAY = "https://ai-gateway.vercel.sh/v1/chat/completions";

// POST /api/redesign
// Body: { url, description?, ownSite?, sourcePath?, skills? }
// Fetches + analyzes the page, then returns an analysis + 3 redesign directions,
// each with a functionality-preserving build prompt. Prefers the AI Gateway and
// falls back to the offline heuristic on missing key or error.
export async function POST(req: Request) {
  let body: ReqBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const url = normalizeUrl(body.url);
  if (!url) return NextResponse.json({ error: "A valid http(s) URL is required" }, { status: 400 });

  let scrape: Scrape;
  try {
    scrape = await scrapeUrl(url);
  } catch (err) {
    return NextResponse.json(
      { error: `Could not fetch that URL: ${(err as Error).message}` },
      { status: 502 },
    );
  }

  const skills = Array.isArray(body.skills) && body.skills.length ? body.skills : DEFAULT_SKILLS;
  const apiKey = process.env.AI_GATEWAY_API_KEY;

  if (!apiKey) {
    return NextResponse.json(heuristicRedesign(url, scrape, skills, body));
  }
  try {
    const result = await aiRedesign(url, scrape, skills, body, apiKey);
    return NextResponse.json(result);
  } catch (err) {
    console.error("AI redesign failed, using heuristic:", err);
    return NextResponse.json(heuristicRedesign(url, scrape, skills, body));
  }
}

// ----- AI path ---------------------------------------------------------------

async function aiRedesign(
  url: string,
  scrape: Scrape,
  skills: DesignSkill[],
  body: ReqBody,
  apiKey: string,
): Promise<RedesignResult> {
  const model = process.env.AI_MODEL || "anthropic/claude-sonnet-4-6";

  const system =
    "You are a senior brand + web design director. You redesign the LOOK of an " +
    "existing website while keeping its FUNCTIONALITY identical. You are given a " +
    "scrape of a real page. Produce (1) a short analysis and a functionality " +
    "inventory to preserve, and (2) exactly 3 DISTINCT redesign directions that " +
    "span restrained → expressive → experimental. Each direction is driven by one " +
    "of the provided design skills and names a real, fetchable reference site to " +
    "beat. For each direction, also write a complete, paste-ready build prompt for " +
    "an autonomous coding agent (like Claude Code) that: leads with the exact " +
    "functionality to preserve, specifies the new design tokens, invokes the " +
    "driving skill by name, and sets the reference site as the quality bar. " +
    (body.ownSite
      ? `This is the user's OWN site${body.sourcePath ? ` at source path "${body.sourcePath}"` : ""} — the prompt must say to EDIT the existing source, preserve all logic/handlers/API calls/routes, and restyle only.`
      : "This is an EXTERNAL site — the prompt must say to recreate the front-end and the listed behaviors under the new design (their backend cannot be reproduced).") +
    " Use the site's REAL content, never lorem ipsum. Respond ONLY with minified " +
    "JSON matching this schema:\n" +
    `{"summary":string,"functionality":[{"kind":string,"label":string,"detail":string}],` +
    `"directions":[{"name":string,"pitch":string,"drivingSkill":string,` +
    `"palette":[string],"typography":{"heading":string,"body":string},` +
    `"layout":string,"motion":string,"referenceBar":string,"buildPrompt":string}]}`;

  const user = [
    `URL: ${url}`,
    body.description ? `User note: ${body.description}` : "",
    `Title: ${scrape.title}`,
    `Meta description: ${scrape.description || "(none)"}`,
    `Headings: ${scrape.headings.join(" | ") || "(none)"}`,
    `Nav: ${scrape.navItems.join(", ") || "(none)"}`,
    `CTAs: ${scrape.ctas.join(", ") || "(none)"}`,
    `Detected colors: ${scrape.colors.join(", ") || "(none)"}`,
    `Detected functionality: ${JSON.stringify(scrape.functionality)}`,
    scrape.confidence === "low"
      ? "NOTE: the scrape was thin (likely a JS-rendered SPA) — lean on the URL, title and user note."
      : "",
    "",
    "Design skills available to drive directions:",
    ...skills.map((s) => `- ${s.name}: ${s.description}`),
  ].filter(Boolean).join("\n");

  const content = await callGateway(apiKey, model, system, user);
  const parsed = JSON.parse(content);

  const directions: Direction[] = (Array.isArray(parsed?.directions) ? parsed.directions : [])
    .slice(0, 3)
    .map((d: Record<string, unknown>, i: number) => ({
      id: `dir-${i}`,
      name: str(d?.name) || `Direction ${i + 1}`,
      pitch: str(d?.pitch),
      drivingSkill: str(d?.drivingSkill) || skills[0]?.name || "interactive-web-studio",
      palette: toStrArr(d?.palette, 6),
      typography: {
        heading: str((d?.typography as Record<string, unknown>)?.heading) || "Modern serif display",
        body: str((d?.typography as Record<string, unknown>)?.body) || "Clean grotesque",
      },
      layout: str(d?.layout),
      motion: str(d?.motion),
      referenceBar: str(d?.referenceBar),
      buildPrompt: str(d?.buildPrompt),
    }))
    .filter((d: Direction) => d.name && d.buildPrompt);

  if (!directions.length) throw new Error("no directions returned");

  const functionality =
    Array.isArray(parsed?.functionality) && parsed.functionality.length
      ? parsed.functionality
          .map((f: Record<string, unknown>) => ({
            kind: str(f?.kind) || "other",
            label: str(f?.label),
            detail: str(f?.detail),
          }))
          .filter((f: { label: string }) => f.label)
      : scrape.functionality;

  return {
    analysis: {
      url,
      title: scrape.title,
      summary: str(parsed?.summary) || scrape.description || scrape.title,
      functionality,
      confidence: scrape.confidence,
    },
    directions,
    engine: "ai",
  };
}

async function callGateway(apiKey: string, model: string, system: string, user: string): Promise<string> {
  const res = await fetch(GATEWAY, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      temperature: 0.5,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
    signal: AbortSignal.timeout(50_000),
  });
  if (!res.ok) throw new Error(`Gateway ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return String(data?.choices?.[0]?.message?.content ?? "");
}
