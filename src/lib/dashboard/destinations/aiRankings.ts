import { addTool } from "@/lib/ai-rankings/store";
import type { Access, ApiKey, Hosting } from "@/lib/ai-rankings/types";
import type { Destination } from "./types";

// ---------------------------------------------------------------------------
// Screenshot of a tool → a record on the AI Rankings board.
//
// The naming rule is the whole point of this destination. A GitHub repo has a
// canonical identifier — `owner/repo` — and that is what the board should be
// keyed by, because it is what the user searches for and what disambiguates two
// tools with the same friendly name.
//
// But a screenshot does not always SHOW that identifier. A landing page might
// say only "ComfyUI". Guessing `comfyanonymous/ComfyUI` from that is usually
// right and occasionally wrong — and a wrong identifier written silently is the
// worst outcome, because the board then looks correct. So the model reports
// whether it READ the identifier or INFERRED it, and an inferred one is flagged
// in the review queue rather than quietly accepted.
// ---------------------------------------------------------------------------

export interface CatalogFields {
  name: string;
  url: string;
  summary: string;
  group: string;
  category: string;
  tags: string[];
  access: Access;
  openSource: boolean;
  hosting: Hosting;
  apiKey: ApiKey;
  pricingNote?: string;
  /** "seen" when the identifier is legible in the image; "inferred" otherwise. */
  nameSource: "seen" | "inferred";
  confidence: number;
}

const ACCESS = new Set(["free", "freemium", "paid"]);
const HOSTING = new Set(["hosted", "self-host", "both"]);
const API_KEY = new Set(["required", "optional", "none"]);

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export const aiRankingsDestination: Destination<CatalogFields> = {
  id: "ai-rankings",
  label: "AI Rankings",
  appSlug: "ai-rankings",

  hint:
    '"catalog" — the photo is a screenshot of a SOFTWARE TOOL worth remembering: ' +
    "a GitHub repository page, a model card, a product landing page, an app " +
    "listing, a pricing page. Route here when the subject is a tool you could " +
    "go and use, not information about the user's own life.",

  fields: [
    {
      name: "name",
      type: "string",
      describe:
        'For a GitHub repository, the identifier EXACTLY as shown — "owner/repo", ' +
        'e.g. "comfyanonymous/ComfyUI". For anything else, the product name. ' +
        "Never invent an owner you cannot see.",
    },
    { name: "url", type: "string", describe: "The URL visible in the image, or \"\"." },
    { name: "summary", type: "string", describe: "One plain sentence: what it is." },
    { name: "group", type: "string", describe: "Top-level section: AI, Dev, Design, Media…" },
    { name: "category", type: "string", describe: "Leaf within the group: Image, Video, Editors…" },
    { name: "tags", type: "string[]", describe: "Capabilities, lowercase-hyphenated. Max 6." },
    { name: "access", type: '"free"|"freemium"|"paid"', describe: "What it costs the user." },
    { name: "openSource", type: "boolean", describe: "Is the code or are the weights open." },
    { name: "hosting", type: '"hosted"|"self-host"|"both"', describe: "Where it runs." },
    { name: "apiKey", type: '"required"|"optional"|"none"', describe: "Does using it need a key." },
    { name: "pricingNote", type: "string", describe: 'Free text like "$20/mo", or "".' },
    {
      name: "nameSource",
      type: '"seen"|"inferred"',
      describe:
        '"seen" ONLY if the identifier is legible in the image. "inferred" if you ' +
        "are supplying it from your own knowledge. Be honest — an inferred name is " +
        "shown to the user for confirmation, not rejected.",
    },
    { name: "confidence", type: "number", describe: "0-1, how sure you are overall." },
  ],

  parse(raw) {
    const r = (raw ?? {}) as Record<string, unknown>;
    const name = str(r.name);
    if (!name) return null;

    const access = str(r.access);
    const hosting = str(r.hosting);
    const apiKey = str(r.apiKey);

    return {
      name,
      url: str(r.url),
      summary: str(r.summary),
      group: str(r.group) || "AI",
      category: str(r.category) || "Uncategorised",
      tags: Array.isArray(r.tags)
        ? Array.from(new Set(r.tags.map((t) => String(t).toLowerCase().trim()).filter(Boolean))).slice(0, 6)
        : [],
      access: (ACCESS.has(access) ? access : "free") as Access,
      openSource: r.openSource === true,
      hosting: (HOSTING.has(hosting) ? hosting : "hosted") as Hosting,
      apiKey: (API_KEY.has(apiKey) ? apiKey : "none") as ApiKey,
      pricingNote: str(r.pricingNote) || undefined,
      nameSource: r.nameSource === "seen" ? "seen" : "inferred",
      confidence: typeof r.confidence === "number" ? r.confidence : 0.5,
    };
  },

  preview(f) {
    const lines = [f.summary].filter(Boolean);
    lines.push(
      [
        f.access,
        f.openSource ? "open source" : "closed",
        f.hosting,
        f.apiKey === "none" ? "no key" : `key ${f.apiKey}`,
      ].join(" · "),
    );
    if (f.tags.length) lines.push(f.tags.join(", "));

    return {
      title: f.name,
      where: `AI Rankings › ${f.group} › ${f.category}`,
      lines,
      unverified:
        f.nameSource === "inferred"
          ? "Name not visible in the photo — check it before approving"
          : undefined,
    };
  },

  commit(f) {
    addTool({
      name: f.name,
      url: f.url,
      summary: f.summary,
      group: f.group,
      category: f.category,
      tags: f.tags,
      access: f.access,
      openSource: f.openSource,
      hosting: f.hosting,
      apiKey: f.apiKey,
      haveKey: false,
      pricingNote: f.pricingNote,
      // Not something a screenshot can establish, and the type documents
      // "unknown" as the honest default rather than a missing value.
      contentRating: "unknown",
      notes: "",
      features: [],
    });
  },
};
