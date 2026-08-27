// ---------------------------------------------------------------------------
// Recall — the "suggest & confirm" classifier.
// Proposes { title, summary, folderPath, tags } for a freshly captured item.
// Prefers the AI Gateway (via /api/recall) and always falls back to a local
// heuristic taxonomy so capture works with zero keys and zero network.
// ---------------------------------------------------------------------------

import type { Classification, Folder, ItemKind } from "./types";

interface Rule {
  /** Root folder these keywords file into. */
  folder: string;
  keywords: string[];
  /** Optional deeper placement when a sub-keyword also matches. */
  subs?: { name: string; keywords: string[] }[];
  /** Tags to seed when this rule wins. */
  tags?: string[];
}

// Ordered by specificity — the first rule that matches wins its folder.
const TAXONOMY: Rule[] = [
  {
    folder: "Game Dev",
    keywords: [
      "game dev", "gamedev", "game development", "unity", "unreal", "godot",
      "game engine", "gameplay", "level design", "sprite", "shader graph",
      "blender", "playtest", "roguelike", "platformer",
    ],
    subs: [
      { name: "Engines", keywords: ["unity", "unreal", "godot", "game engine", "engine"] },
      { name: "Art & Assets", keywords: ["blender", "sprite", "texture", "3d model", "rigging"] },
    ],
    tags: ["game-dev"],
  },
  {
    folder: "AI & Models",
    keywords: [
      "ai model", "llm", "gpt", "claude", "gemini", "open source model", "openai",
      "diffusion", "stable diffusion", "flux", "video model", "sora", "runway",
      "seedance", "hunyuan", "wan 2", "embedding", "hugging face", "huggingface",
      "machine learning", "neural", "fine-tune", "fine tune", "dataset", "inference",
    ],
    subs: [
      { name: "Video Models", keywords: ["video model", "sora", "runway", "seedance", "hunyuan", "wan 2", "kling", "text-to-video", "text to video"] },
      { name: "Image Models", keywords: ["diffusion", "stable diffusion", "flux", "midjourney", "text-to-image", "text to image"] },
      { name: "LLMs", keywords: ["llm", "gpt", "claude", "gemini", "qwen", "llama", "mistral"] },
    ],
    tags: ["ai"],
  },
  {
    folder: "Dev Tools",
    keywords: [
      "cli", "sdk", "npm package", "library", "framework", "github", "open source",
      "open-source", "developer tool", "vscode", "api", "self-host", "self host",
      "docker", "extension", "plugin",
    ],
    tags: ["tools"],
  },
  {
    folder: "Web Dev",
    keywords: [
      "react", "next.js", "nextjs", "tailwind", "typescript", "javascript",
      "frontend", "webgl", "three.js", "threejs", "css", "vercel", "supabase",
    ],
    tags: ["web-dev"],
  },
  {
    folder: "Cooking",
    keywords: [
      "recipe", "cook", "bake", "baking", "ingredient", "meal", "dish", "kitchen",
      "cuisine", "roast", "marinade", "sauce", "dinner", "breakfast",
    ],
    tags: ["cooking"],
  },
  {
    folder: "Restaurants",
    keywords: [
      "restaurant", "cafe", "eatery", "menu", "reservation", "diner", "brunch spot",
      "bar", "bistro", "food truck", "ate at", "michelin",
    ],
    tags: ["restaurants"],
  },
  {
    folder: "Ideas",
    keywords: ["idea", "startup", "business", "side project", "product idea", "concept for"],
    tags: ["idea"],
  },
];

/** Curated keywords promoted to tags whenever they appear anywhere in the text. */
const TAG_HINTS = [
  "unity", "unreal", "godot", "shader", "blender",
  "llm", "gpt", "claude", "gemini", "diffusion", "embedding", "video-model",
  "react", "nextjs", "tailwind", "typescript", "webgl", "supabase", "vercel",
  "recipe", "restaurant", "pasta", "chicken", "vegan", "dessert",
  "open-source", "cli", "api", "sdk", "github", "docker",
];

const STOP = new Set([
  "the", "a", "an", "and", "or", "but", "for", "to", "of", "in", "on", "at",
  "is", "are", "was", "with", "this", "that", "it", "im", "i'm", "now", "so",
  "instead", "using", "use", "about", "want", "wanting", "thinking", "like",
]);

function normalize(s: string): string {
  return s.toLowerCase();
}

/** Derive a short title from the raw content. */
function deriveTitle(content: string, kind: ItemKind): string {
  const firstLine = content.split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? "";
  if (firstLine && firstLine.length <= 80) return stripTrailingPunct(firstLine);
  const sentence = firstLine.split(/(?<=[.!?])\s/)[0] ?? firstLine;
  if (sentence.length <= 80) return stripTrailingPunct(sentence);
  const words = sentence.slice(0, 72).split(" ").slice(0, -1).join(" ");
  return stripTrailingPunct(words) + "…";
}

function stripTrailingPunct(s: string): string {
  return s.replace(/[.,;:\s]+$/, "").trim();
}

function deriveSummary(content: string): string {
  const flat = content.replace(/\s+/g, " ").trim();
  if (flat.length <= 160) return flat;
  return flat.slice(0, 157).replace(/\s\S*$/, "") + "…";
}

function deriveTags(content: string, seed: string[]): string[] {
  const lc = normalize(content);
  const found = new Set<string>(seed);
  for (const hint of TAG_HINTS) {
    if (lc.includes(hint.replace("-", " ")) || lc.includes(hint)) found.add(hint);
  }
  // A couple of salient content words as fallback texture.
  if (found.size < 3) {
    const words = lc
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 4 && !STOP.has(w));
    const freq = new Map<string, number>();
    for (const w of words) freq.set(w, (freq.get(w) ?? 0) + 1);
    [...freq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .forEach(([w]) => found.add(w));
  }
  return [...found].slice(0, 6);
}

/** Match content against the taxonomy, returning a folder path. */
function classifyPath(content: string): { path: string[]; tags: string[] } {
  const lc = normalize(content);
  for (const rule of TAXONOMY) {
    if (rule.keywords.some((k) => lc.includes(k))) {
      const path = [rule.folder];
      const sub = rule.subs?.find((s) => s.keywords.some((k) => lc.includes(k)));
      if (sub) path.push(sub.name);
      return { path, tags: rule.tags ?? [] };
    }
  }
  return { path: ["Inbox"], tags: [] };
}

/**
 * Reuse an existing folder's exact casing when the heuristic proposes a name
 * that already exists (case-insensitively), so we never create near-duplicates.
 */
function reconcileWithExisting(path: string[], folders: Folder[]): string[] {
  const byLower = new Map(folders.map((f) => [f.name.trim().toLowerCase(), f.name]));
  return path.map((seg) => byLower.get(seg.trim().toLowerCase()) ?? seg);
}

export function heuristicClassify(
  content: string,
  kind: ItemKind,
  folders: Folder[],
  urlTitle?: string,
): Classification {
  const { path, tags: seedTags } = classifyPath(content);
  return {
    title: (urlTitle && urlTitle.trim()) || deriveTitle(content, kind),
    summary: deriveSummary(content),
    folderPath: reconcileWithExisting(path, folders),
    tags: deriveTags(content, seedTags),
    engine: "heuristic",
  };
}

/** Existing folder paths as "A › B" strings, for the AI prompt context. */
export function folderPaths(folders: Folder[]): string[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  return folders.map((f) => {
    const parts: string[] = [];
    let cur: Folder | undefined = f;
    const guard = new Set<string>();
    while (cur && !guard.has(cur.id)) {
      guard.add(cur.id);
      parts.unshift(cur.name);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    return parts.join(" › ");
  });
}

/**
 * Classify a captured item. Tries the AI Gateway; on any failure (no key, error,
 * offline) falls back to the richer local heuristic. Never throws.
 */
export async function classifyContent(args: {
  content: string;
  kind: ItemKind;
  folders: Folder[];
  existingTags: string[];
  urlTitle?: string;
}): Promise<Classification> {
  const local = heuristicClassify(args.content, args.kind, args.folders, args.urlTitle);
  try {
    const res = await fetch("/api/recall", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        stage: "classify",
        content: args.content.slice(0, 8000),
        kind: args.kind,
        folderPaths: folderPaths(args.folders),
        existingTags: args.existingTags,
      }),
    });
    if (!res.ok) return local;
    const data = (await res.json()) as { classification?: Classification | null };
    const c = data.classification;
    if (!c || !Array.isArray(c.folderPath) || c.folderPath.length === 0) return local;
    return {
      title: (c.title || local.title).trim(),
      summary: (c.summary || local.summary).trim(),
      folderPath: reconcileWithExisting(c.folderPath.map(String), args.folders),
      tags: Array.from(new Set((c.tags ?? []).map((t) => String(t).toLowerCase().trim()).filter(Boolean))).slice(0, 6),
      engine: "ai",
    };
  } catch {
    return local;
  }
}
