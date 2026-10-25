import { normalizeCampaigns } from "@/lib/money-agents/logic";
import { aiReady, askJson, fail, readBody } from "@/lib/money-agents/server/ai";
import { parseDdgResults, type SearchHit } from "@/lib/new-jarvis/web";

export const runtime = "nodejs";
export const maxDuration = 90;

// POST { niche? } → { campaigns, hits, by, warning? }
//
// Finds paid clipping campaigns (pay per 1,000 views) on the open web, then
// has the AI pull out the ones that are real campaign pages with a rate. The
// raw search hits come back too, so nothing is hidden when the AI is unsure.
// Every campaign still needs the owner to open it and join — this never signs
// up for anything.

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

async function ddg(q: string): Promise<SearchHit[]> {
  try {
    const res = await fetch("https://html.duckduckgo.com/html/", {
      method: "POST",
      headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded", "Accept-Language": "en-US,en;q=0.9" },
      body: new URLSearchParams({ q }).toString(),
      signal: AbortSignal.timeout(12_000),
    });
    return res.ok ? parseDdgResults(await res.text(), 10) : [];
  } catch {
    return [];
  }
}

export async function POST(req: Request) {
  const b = (await readBody(req)) ?? {};
  const niche = String(b.niche ?? "").trim().slice(0, 120);
  const year = new Date().getFullYear();
  const queries = [
    `clipping campaign pay per 1000 views ${niche} ${year}`.trim(),
    `whop content rewards clipping campaign ${niche}`.trim(),
    `get paid to clip videos campaign CPM ${year}`,
  ];
  const lists = await Promise.all(queries.map(ddg));
  const seen = new Set<string>();
  const hits: SearchHit[] = [];
  for (const h of lists.flat()) {
    if (seen.has(h.url)) continue;
    seen.add(h.url);
    hits.push(h);
  }
  if (!hits.length) {
    return Response.json({
      campaigns: [],
      hits: [],
      by: "none",
      warning: "The web search didn't answer just now. Try again in a minute, or add a campaign by pasting its link.",
    });
  }
  if (!aiReady()) {
    return Response.json({
      campaigns: [],
      hits: hits.slice(0, 15),
      by: "search",
      warning: "No AI key is set, so here are the raw search results. Open one, and add it with its link and rate.",
    });
  }
  try {
    const raw = await askJson(
      "You find real, currently running paid clipping campaigns (creators get paid per 1,000 views for posting clips of a " +
        "brand's or creator's content). You only list a result when it is a campaign page or a marketplace listing for one — " +
        "never a blog post about clipping in general. You never invent a rate: 0 when the result doesn't state one. Respond ONLY with minified JSON.",
      [
        niche ? `The owner clips for this niche: ${niche}.` : "",
        `Search results:`,
        ...hits.slice(0, 30).map((h, i) => `${i + 1}. ${h.title} — ${h.url}\n   ${h.snippet}`),
        `Return the campaigns: name, brand (who pays), url (from the results only), ratePer1k (dollars per 1,000 views, number), platforms (tiktok/instagram/youtube/x), notes (budget, minimums, deadline if stated).`,
        `JSON: {"campaigns":[{"name":"","brand":"","url":"","ratePer1k":0,"platforms":[],"notes":""}]}`,
      ]
        .filter(Boolean)
        .join("\n"),
      0.2,
    );
    const allowed = new Set(hits.map((h) => h.url));
    const campaigns = normalizeCampaigns(raw).filter((c) => allowed.has(c.url));
    return Response.json({ campaigns, hits: hits.slice(0, 15), by: "ai" });
  } catch (err) {
    console.error("[money-agents/campaigns] AI failed:", err);
    return Response.json({ campaigns: [], hits: hits.slice(0, 15), by: "search", warning: "The AI step failed — here are the raw search results." });
  }
}
