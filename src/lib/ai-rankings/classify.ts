// ---------------------------------------------------------------------------
// The Board — filing a record automatically.
//
// Shared by the API route and its offline fallback. The heuristic is not a
// stand-in for the model: it is what runs when there is no AI_GATEWAY_API_KEY,
// which is the default on a fresh clone, so it has to produce something worth
// accepting on its own.
//
// Nothing here writes to the record. A suggestion is returned to the UI and the
// user applies it — filing that happens behind your back is worse than filing
// you have to confirm.
// ---------------------------------------------------------------------------

import type { Access, ApiKey, Hosting } from "./types";

export interface Suggestion {
  group: string;
  category: string;
  summary: string;
  tags: string[];
  access: Access;
  openSource: boolean;
  hosting: Hosting;
  apiKey: ApiKey;
  pricingNote?: string;
  /**
   * Things this tool can do, phrased the way the board already phrases them.
   *
   * The point of the whole feature: "first-last frame", "extend a clip",
   * "cinematic output" are what actually separates two video models, and having
   * to remember and type them for every new tool is the tedious part. These are
   * offered one by one for the user to accept, never written automatically.
   */
  features: string[];
  /** Where the answer came from, so the UI can say so honestly. */
  source: "ai" | "heuristic";
}

/** Keyword → (group, category). First match wins, so order matters. */
const RULES: [RegExp, string, string][] = [
  [/\b(llm|chatbot|assistant|gpt|claude|gemini|mistral|qwen|deepseek)\b/, "AI", "LLM"],
  // Before the image rule: "image-to-video" is a video model, and a plain
  // `image` match would file every one of them under Image.
  [/\b(image|img|text|txt) ?to ?video\b|\bvideo (model|generat)/, "AI", "Video"],
  [/\b(image|diffusion|txt2img|text-to-image|midjourney|flux|inpaint)\b/, "AI", "Image"],
  [/\b(video|txt2vid|runway|kling|sora|veo)\b/, "AI", "Video"],
  [/\b(music|song|suno|udio|riff|audio generation)\b/, "AI", "Music"],
  [/\b(voice|tts|speech|clone|narration|whisper)\b/, "AI", "Voice"],
  [/\b(agent|coding agent|copilot|cursor|cline|aider|codex)\b/, "AI", "Agent Coding"],
  [/\b(3d|mesh|gaussian|nerf|blender)\b/, "AI", "3D"],
  [/\b(gateway|inference|replicate|openrouter|ollama|huggingface|hugging face)\b/, "AI", "Tools"],
  [/\b(editor|ide|vim|vscode|jetbrains)\b/, "Dev", "Editors"],
  [/\b(deploy|hosting|serverless|vercel|netlify|railway|fly\.io)\b/, "Dev", "Platforms"],
  [/\b(database|postgres|sqlite|redis|supabase|firebase|backend)\b/, "Dev", "Backend"],
  [/\b(docker|kubernetes|terraform|dns|cdn|proxy|infra)\b/, "Dev", "Infra"],
  [/\b(api client|http client|postman|curl|cli|terminal)\b/, "Dev", "Utilities"],
  [/\b(figma|sketch|ui design|wireframe|prototyp)\b/, "Design", "UI Design"],
  [/\b(vector|illustrat|svg|affinity)\b/, "Design", "Vector"],
  [/\b(diagram|whiteboard|flowchart|excalidraw|mermaid)\b/, "Design", "Diagrams"],
  [/\b(notes?|markdown|wiki|obsidian|notion|zettel)\b/, "Productivity", "Notes"],
  [/\b(launcher|spotlight|raycast|alfred)\b/, "Productivity", "Launchers"],
  [/\b(sync|backup|dropbox|syncthing)\b/, "Productivity", "Sync"],
  [/\b(video editing|premiere|resolve|capcut|timeline)\b/, "Media", "Video Editing"],
  [/\b(screen ?capture|streaming|obs|recording)\b/, "Media", "Capture"],
  [/\b(daw|audacity|mixing|mastering|audio edit)\b/, "Media", "Audio Editing"],
  [/\b(password|vault|bitwarden|1password)\b/, "Security", "Passwords"],
  [/\b(vpn|wireguard|tailscale|firewall|network)\b/, "Security", "Networking"],
  [/\b(trading|broker|metatrader|mql|forex|candlestick|chart)\b/, "Trading", "Charting"],
];

const TAG_RULES: [RegExp, string][] = [
  [/\bopen[- ]?(source|weights?|model)\b/, "open-source"],
  [/\bself[- ]?host|local(ly)?|offline\b/, "local"],
  [/\bvision|multimodal|image input\b/, "vision"],
  [/\blong[- ]context\b/, "long-context"],
  [/\bapi\b/, "api"],
  [/\bcli|terminal\b/, "terminal"],
  [/\brealtime|real[- ]time|low[- ]latency\b/, "realtime"],
  [/\bfree tier|freemium\b/, "free-tier"],
  [/\bcollaborat/, "collaboration"],
  [/\bplugin|extension/, "extensions"],
];

/**
 * Keyword → a feature phrased as a capability.
 *
 * Deliberately written the way you'd say it out loud, because these become
 * rows in the record's feature list and the sidebar's feature index — and an
 * index reading "img2vid" next to "image to video" is a broken index.
 */
const FEATURE_RULES: [RegExp, string][] = [
  [/\bfirst[- ]?(and[- ])?last frame|start and end frame|keyframe/, "First/last frame control"],
  [/\bextend|continue (a |the )?(clip|video)|longer clips?\b/, "Extend an existing clip"],
  [/\bimage[- ]to[- ]video|img2vid|animate (a |an )?(still|image|photo)/, "Image to video"],
  [/\btext[- ]to[- ]video|txt2vid/, "Text to video"],
  [/\bcinematic|film ?look|filmic/, "Cinematic look"],
  [/\bcamera (control|move|motion)|dolly|orbit shot/, "Camera control"],
  [/\blip ?sync|talking head/, "Lipsync"],
  [/\bnative audio|synchronised (sound|audio)|sound effects\b/, "Generates its own audio"],
  [/\bmulti[- ]?shot|scene sequence/, "Multi-shot sequences"],
  [/\bcharacter consistency|same character|keeps the subject/, "Character consistency"],
  [/\binpaint|outpaint|generative fill|edit(ing)? by prompt/, "Prompt-based editing"],
  [/\btext in image|typography|legible text/, "Readable text in the image"],
  [/\bupscal|super[- ]resolution|enhance/, "Upscaling"],
  [/\bvector|svg\b/, "Vector output"],
  [/\bstem|separate tracks|instrumental and vocal/, "Stem separation"],
  [/\bvoice clon|zero[- ]shot voice/, "Voice cloning"],
  [/\btranscri|subtitle|caption/, "Transcription / captions"],
  [/\bcommercial(ly)? (safe|licen)|royalty[- ]free/, "Cleared for commercial use"],
  [/\bfine[- ]?tun|lora\b|train your own/, "Fine-tunable"],
  [/\bbatch|bulk\b/, "Batch processing"],
  [/\breal[- ]?time|instant preview/, "Realtime preview"],
];

/**
 * A best guess from the text alone. Deliberately conservative: when nothing
 * matches it files to Unfiled rather than inventing a section, because a wrong
 * confident answer costs more to undo than an obvious blank.
 */
export function heuristicSuggestion(input: {
  name: string;
  url?: string;
  summary?: string;
  notes?: string;
}): Suggestion {
  const raw = `${input.name} ${input.url ?? ""} ${input.summary ?? ""} ${input.notes ?? ""}`
    .toLowerCase();
  // Punctuation is flattened so "text-to-video" and "text to video" both match
  // — but that also destroys hostnames, so URL tests run against `raw`.
  const blob = raw.replace(/[_/.-]+/g, " ");

  let group = "Unfiled";
  let category = "Unfiled";
  for (const [re, g, c] of RULES) {
    if (re.test(blob)) {
      group = g;
      category = c;
      break;
    }
  }

  const tags: string[] = [];
  for (const [re, tag] of TAG_RULES) if (re.test(blob) && !tags.includes(tag)) tags.push(tag);

  const features: string[] = [];
  for (const [re, feature] of FEATURE_RULES) {
    if (re.test(blob) && !features.includes(feature)) features.push(feature);
  }

  // A GitHub or Hugging Face home page is the strongest open-source signal
  // there is, and it only survives in `raw` — the normalised blob has eaten
  // the dot in the hostname.
  const openSource =
    /\bopen[- ]?(source|weights?|model)\b|\b(gpl|mit licen|apache licen)\b/.test(blob) ||
    /github\.com|gitlab\.com|huggingface\.co/.test(raw);
  const selfHost = /\bself[- ]?host|local(ly)?|desktop|offline|docker\b/.test(blob);
  const hosting: Hosting = selfHost ? (/\bcloud|hosted|saas\b/.test(blob) ? "both" : "self-host") : "hosted";

  let access: Access = "freemium";
  if (/\bfree( and open| forever)?\b/.test(blob) && !/\bfree tier|free plan\b/.test(blob)) {
    access = "free";
  }
  if (/\bsubscription|per month|\/mo|paid only|no free\b/.test(blob)) access = "paid";
  if (openSource && selfHost) access = "free";

  const apiKey: ApiKey = /\bapi key|token|bearer\b/.test(blob)
    ? "required"
    : /\bapi\b/.test(blob)
      ? "optional"
      : "none";

  return {
    group,
    category,
    summary: input.summary?.trim() || "",
    tags: tags.slice(0, 6),
    access,
    openSource,
    hosting,
    apiKey,
    features: features.slice(0, 8),
    source: "heuristic",
  };
}

/** Coerce whatever the model returned into a Suggestion we can trust. */
export function coerceSuggestion(raw: unknown, fallback: Suggestion): Suggestion {
  const r = (raw ?? {}) as Record<string, unknown>;
  const str = (v: unknown, or: string) => (typeof v === "string" && v.trim() ? v.trim() : or);
  const oneOf = <T extends string>(v: unknown, allowed: readonly T[], or: T): T =>
    allowed.includes(v as T) ? (v as T) : or;

  return {
    group: str(r.group, fallback.group),
    category: str(r.category, fallback.category),
    summary: str(r.summary, fallback.summary).slice(0, 200),
    tags: Array.isArray(r.tags)
      ? r.tags.map(String).map((t) => t.trim().toLowerCase()).filter(Boolean).slice(0, 8)
      : fallback.tags,
    // Features keep their capitalisation — they are read as sentences in the
    // record panel, not as machine tags.
    features: Array.isArray(r.features)
      ? r.features.map(String).map((f) => f.trim()).filter(Boolean).slice(0, 10)
      : fallback.features,
    access: oneOf(r.access, ["free", "freemium", "paid"] as const, fallback.access),
    openSource: typeof r.openSource === "boolean" ? r.openSource : fallback.openSource,
    hosting: oneOf(r.hosting, ["hosted", "self-host", "both"] as const, fallback.hosting),
    apiKey: oneOf(r.apiKey, ["required", "optional", "none"] as const, fallback.apiKey),
    pricingNote: typeof r.pricingNote === "string" ? r.pricingNote.slice(0, 120) : undefined,
    source: "ai",
  };
}
