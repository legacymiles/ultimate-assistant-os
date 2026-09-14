// ---------------------------------------------------------------------------
// Image Studio — prompt assembly and response parsing.
//
// Pure functions only, shared by both routes and the tests. Nothing here
// touches the network, storage or the DOM.
// ---------------------------------------------------------------------------

import type { Aspect, ImageAgent } from "./agents";

export type RefRole = "person" | "style";

export interface RefInput {
  role: RefRole;
  dataUrl: string;
}

export type Part = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

export const MAX_REFS = 6;
export const MAX_PROMPT = 4000;

const ASPECT_RATIO: Record<Aspect, string> = { portrait: "3:4", square: "1:1", landscape: "16:9" };

export function aspectRatio(aspect: Aspect): string {
  return ASPECT_RATIO[aspect];
}

/**
 * Tells the model what each attached image is for, by position. Image models
 * read the images in the order they are attached, so the numbering must match
 * the order of `userContent`.
 */
export function refGuide(refs: RefInput[]): string {
  if (!refs.length) return "";
  const lines = refs.map((r, i) =>
    r.role === "person"
      ? `Image ${i + 1} is a PERSON reference: keep this person's face, age, skin tone, hair and build exactly recognisable.`
      : `Image ${i + 1} is a STYLE reference: borrow its colours, lighting, mood and composition only — do not copy the people in it.`,
  );
  if (!refs.some((r) => r.role === "person")) {
    lines.push("There is NO person reference: invent the people in the scene; do not base anyone on a reference image.");
  }
  return `Reference images:\n${lines.join("\n")}`;
}

export function rewriteSystem(agent: ImageAgent, soften = false): string {
  return [
    agent.brief,
    "",
    "Rewrite the user's request into ONE detailed prompt for an image-generation model that can see the " +
      "attached reference images. Describe subject, action, setting, wardrobe, lighting, camera and lens, " +
      "colour and mood in concrete visible detail. Refer to references by their image number and role: " +
      '"the person from Image 1" ONLY for a PERSON reference, "the colour palette of Image 2" for a STYLE ' +
      "reference. If there is no PERSON reference, describe the subject yourself. 80–180 words, one " +
      "paragraph. Output only the prompt — no title, " +
      "no quotes, no commentary, no markdown.",
    soften
      ? "The previous version was refused by the image model. Keep the idea but make it clearly tasteful " +
        "and safe: fully clothed or fashion-styled adults, no violence against people, no real named people."
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function rewriteUser(prompt: string, refs: RefInput[]): Part[] {
  const text = [`Request: ${prompt.trim()}`, refGuide(refs)].filter(Boolean).join("\n\n");
  return userContent(text, refs);
}

/** The prompt used when nothing rewrote it: the user's words plus the agent's style block. */
export function fallbackPrompt(agent: ImageAgent, prompt: string): string {
  return `${prompt.trim().replace(/[.\s]+$/, "")}. ${agent.styleBlock}`;
}

/** Everything the image model reads as text, for one generation. */
export function generationText(agent: ImageAgent, prompt: string, refs: RefInput[]): string {
  return [
    prompt.trim(),
    refGuide(refs),
    `Aspect ratio ${aspectRatio(agent.aspect)}. Generate one image. No text, captions, watermarks or borders.`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function userContent(text: string, refs: RefInput[]): Part[] {
  return [{ type: "text", text }, ...refs.map((r) => ({ type: "image_url" as const, image_url: { url: r.dataUrl } }))];
}

export interface ExtractedResult {
  image: string | null;
  text: string;
}

/**
 * Reads an OpenRouter chat-completions response with image output. Images
 * arrive as `message.images[].image_url.url` data URLs; some models also put
 * image parts inside `message.content` as an array, so both are checked.
 */
export function extractResult(json: unknown): ExtractedResult {
  const message = (json as { choices?: { message?: Record<string, unknown> }[] })?.choices?.[0]?.message ?? {};
  let image: string | null = null;
  let text = "";

  const images = Array.isArray(message.images) ? message.images : [];
  for (const im of images) {
    const url = (im as { image_url?: { url?: unknown } })?.image_url?.url;
    if (typeof url === "string" && url) {
      image = url;
      break;
    }
  }

  const content = message.content;
  if (typeof content === "string") text = content;
  else if (Array.isArray(content)) {
    for (const part of content as Record<string, unknown>[]) {
      if (part?.type === "text" && typeof part.text === "string") text += part.text;
      const url = (part?.image_url as { url?: unknown } | undefined)?.url;
      if (!image && part?.type === "image_url" && typeof url === "string") image = url;
    }
  }
  return { image, text: text.trim() };
}

/** Removes wrapping quotes or a stray "Prompt:" label a model sometimes adds. */
export function cleanRewrite(text: string): string {
  return text
    .trim()
    .replace(/^```[a-z]*\s*|\s*```$/g, "")
    .replace(/^(prompt|image prompt)\s*:\s*/i, "")
    .replace(/^["“](.*)["”]$/s, "$1")
    .trim();
}

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c] ?? c);
}

/** A stand-in image for offline mode, sized to the agent's aspect. */
export function placeholderImage(agent: ImageAgent, prompt: string, variant = 0): string {
  const [w, h] = agent.aspect === "portrait" ? [768, 1024] : agent.aspect === "square" ? [1024, 1024] : [1024, 576];
  const [h1, h2] = agent.hue;
  const shift = variant * 24;
  const words = prompt.trim().split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if ((line + " " + word).trim().length > 34) {
      lines.push(line.trim());
      line = word;
    } else line += " " + word;
    if (lines.length === 3) break;
  }
  if (lines.length < 3 && line.trim()) lines.push(line.trim());
  const text = lines
    .map((l, i) => `<text x="${w / 2}" y="${h / 2 + 60 + i * 40}" font-family="system-ui,sans-serif" font-size="28" fill="#fff" opacity="0.75" text-anchor="middle">${escapeXml(l)}</text>`)
    .join("");
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="hsl(${(h1 + shift) % 360},60%,38%)"/>` +
    `<stop offset="1" stop-color="hsl(${(h2 + shift) % 360},55%,14%)"/></linearGradient></defs>` +
    `<rect width="${w}" height="${h}" fill="url(#g)"/>` +
    `<text x="${w / 2}" y="${h / 2 - 20}" font-size="96" text-anchor="middle">${agent.icon}</text>` +
    text +
    `<text x="${w / 2}" y="${h - 36}" font-family="system-ui,sans-serif" font-size="22" fill="#fff" opacity="0.5" text-anchor="middle">${escapeXml(agent.name)} · offline preview</text>` +
    `</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
