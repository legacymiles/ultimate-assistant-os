// ---------------------------------------------------------------------------
// Inspire's AI: Prompt DNA, Reverse Prompt, Enhance and Translate.
//
// Each function has an offline twin so the app keeps working with no key, and
// says so (`offline: true`) instead of pretending. Model answers are parsed as
// JSON, validated, and fall back to the offline result when they come back
// malformed — a bad model reply never reaches the screen as an error.
// ---------------------------------------------------------------------------

import "server-only";

import sharp from "sharp";
import { aiConfigured } from "@/lib/ai/provider";
import { REWRITE_MODEL } from "@/lib/image-studio/agents";
import { extractResult, type Part } from "@/lib/image-studio/prompt";
import { chat } from "@/lib/image-studio/server";
import { CHIP_CATEGORIES } from "../taxonomy";
import { extractChips, sanitizeChips } from "../extract";
import { recommend, translateIdea } from "../discover";
import type { Chip } from "../types";

const MODEL = () => process.env.IMAGE_STUDIO_INSPIRE_MODEL || process.env.IMAGE_STUDIO_REWRITE_MODEL || REWRITE_MODEL;

const CATEGORY_LIST = CHIP_CATEGORIES.map((c) => `${c.id} (${c.label})`).join(", ");

const CHIP_RULES = `Chips are the meaningful visual ingredients of an image prompt — the words that actually change the picture: the subject or character, wardrobe, accessories, pose, scene, environment/background, camera and lens, lighting, art style and rendering technique, typography, composition, colour palette, textures and detail level, visual effects, and mood.
Never make a chip out of filler ("a", "beautiful", "masterpiece", "8k", "trending on artstation").
Keep each chip short (1–5 words), in the prompt's own wording where possible.
Split a leading style adjective from its noun when both carry meaning: "futuristic cyberpunk warrior" → "futuristic" (style) + "cyberpunk warrior" (character).
category must be one of: ${CATEGORY_LIST}.
why is ONE short sentence (under 16 words) saying what the ingredient contributes to the image.`;

/** First JSON object or array in a model reply, or null. */
export function parseJsonLoose(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  for (const [open, close] of [
    ["{", "}"],
    ["[", "]"],
  ]) {
    const a = body.indexOf(open);
    const b = body.lastIndexOf(close);
    if (a >= 0 && b > a) {
      try {
        return JSON.parse(body.slice(a, b + 1));
      } catch {
        /* try the other shape */
      }
    }
  }
  return null;
}

async function ask(system: string, user: string | Part[], maxTokens = 1400, temperature = 0.3): Promise<string> {
  const json = await chat(
    MODEL(),
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    { temperature, max_tokens: maxTokens },
    90_000,
  );
  return extractResult(json).text;
}

export interface ChipResult {
  chips: Chip[];
  offline?: boolean;
  warning?: string;
}

// ----- Prompt DNA ------------------------------------------------------------

export async function aiExtract(prompt: string): Promise<ChipResult> {
  const offline = extractChips(prompt);
  if (!aiConfigured()) return { chips: offline, offline: true };
  try {
    const text = await ask(
      `You break AI image prompts into their visual ingredients.\n${CHIP_RULES}\nAnswer with JSON only: {"chips":[{"text":"…","category":"…","why":"…"}]} in the order they appear in the prompt. 6–16 chips.`,
      prompt,
    );
    const parsed = parseJsonLoose(text) as { chips?: unknown } | null;
    const chips = sanitizeChips(parsed?.chips, 18);
    if (chips.length < 2) throw new Error("too few chips");
    return { chips };
  } catch (err) {
    console.error("[inspire] extract failed:", err);
    return { chips: offline, warning: "The AI didn't answer, so the built-in extractor picked these." };
  }
}

// ----- Reverse Prompt --------------------------------------------------------

export interface ReverseAnalysis {
  subject?: string;
  details?: string;
  clothing?: string;
  pose?: string;
  background?: string;
  camera?: string;
  lighting?: string;
  palette?: string;
  style?: string;
  textures?: string;
  composition?: string;
  mood?: string;
}

export interface ReverseResult {
  prompt: string;
  chips: Chip[];
  analysis: ReverseAnalysis;
  offline?: boolean;
  warning?: string;
}

const REVERSE_SYSTEM = `You write image-generation prompts that recreate a reference image as closely as possible.
Look carefully and describe ONLY what is actually visible. Never invent a brand, a name, text you cannot read, or details hidden from view. If something is unclear, leave it out rather than guess.
Analyse: main subject and identifying details; clothing, accessories and materials; pose and position; background and environment; camera angle, lens feel and framing; lighting direction, quality and intensity; colour palette; art style and rendering technique; textures and small details; composition and spatial relationships; mood and atmosphere.
Then write ONE generation prompt of 60–140 words, ordered: subject → details → setting → style → lighting → camera → colour → mood. Plain comma-separated prose, no labels, no quotation marks, no parameters like --ar.
${CHIP_RULES}
Answer with JSON only:
{"analysis":{"subject":"","details":"","clothing":"","pose":"","background":"","camera":"","lighting":"","palette":"","style":"","textures":"","composition":"","mood":""},"prompt":"…","chips":[{"text":"…","category":"…","why":"…"}]}
Each analysis field is one short sentence, or "" when it does not apply. 8–16 chips, taken from your prompt.`;

/** What can be measured without a vision model: shape, light and colour. */
async function measure(dataUrl: string): Promise<{ orientation: string; palette: string[]; bright: string }> {
  const buf = Buffer.from(dataUrl.split(",")[1] ?? "", "base64");
  const img = sharp(buf);
  const meta = await img.metadata();
  const w = meta.width ?? 1;
  const h = meta.height ?? 1;
  const orientation = w / h > 1.15 ? "landscape" : h / w > 1.15 ? "portrait" : "square";
  const { data } = await sharp(buf).resize(3, 3, { fit: "fill" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const palette = new Set<string>();
  let lum = 0;
  for (let i = 0; i < data.length; i += 3) {
    palette.add(colourName(data[i], data[i + 1], data[i + 2]));
    lum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
  }
  lum /= data.length / 3;
  return { orientation, palette: [...palette].slice(0, 4), bright: lum < 70 ? "dark, low-key" : lum > 185 ? "bright, high-key" : "balanced mid-tone" };
}

export function colourName(r: number, g: number, b: number): string {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max - min < 22) return l < 50 ? "black" : l > 205 ? "white" : "grey";
  let h = 0;
  if (max === r) h = ((g - b) / (max - min)) % 6;
  else if (max === g) h = (b - r) / (max - min) + 2;
  else h = (r - g) / (max - min) + 4;
  h = (h * 60 + 360) % 360;
  const name =
    h < 15 ? "red" : h < 40 ? "orange" : h < 65 ? "yellow" : h < 160 ? "green" : h < 195 ? "teal" : h < 250 ? "blue" : h < 290 ? "purple" : h < 335 ? "magenta" : "red";
  return l < 70 ? `deep ${name}` : l > 190 ? `pale ${name}` : name;
}

export async function aiReverse(images: string[], instructions = "", previous = ""): Promise<ReverseResult> {
  if (!aiConfigured()) {
    const m = await measure(images[0]);
    const prompt = `${m.orientation} image, ${m.bright} exposure, colour palette of ${m.palette.join(", ")}`;
    return {
      prompt,
      chips: [
        { text: `${m.orientation} framing`, category: "composition", why: "Measured from the image's shape." },
        { text: m.bright, category: "lighting", why: "Measured from the image's average brightness." },
        { text: m.palette.join(" and "), category: "color", why: "The dominant colours measured from the image." },
      ],
      analysis: { palette: m.palette.join(", "), composition: `${m.orientation} frame`, lighting: m.bright },
      offline: true,
      warning:
        "Seeing what is in a picture needs an AI vision model, and no AI key is set. This draft only describes what can be measured — shape, brightness and colour. Add OPENROUTER_API_KEY for a full recreation prompt.",
    };
  }
  const user: Part[] = [
    {
      type: "text",
      text: [
        images.length > 1 ? `There are ${images.length} reference images. The first is the main one; use the others only for shared style and subject details.` : "Here is the reference image.",
        previous ? `The previous prompt was:\n${previous}` : "",
        instructions ? `Refine it with these instructions from the user (they win over your own choices): ${instructions}` : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
    },
    ...images.map((url) => ({ type: "image_url" as const, image_url: { url } })),
  ];
  try {
    const text = await ask(REVERSE_SYSTEM, user, 1800, 0.4);
    const parsed = parseJsonLoose(text) as { prompt?: unknown; chips?: unknown; analysis?: Record<string, unknown> } | null;
    const prompt = typeof parsed?.prompt === "string" ? parsed.prompt.replace(/\s+/g, " ").trim() : "";
    if (prompt.length < 30) throw new Error("no prompt");
    const chips = sanitizeChips(parsed?.chips, 18);
    const analysis: ReverseAnalysis = {};
    for (const [k, v] of Object.entries(parsed?.analysis ?? {})) {
      if (typeof v === "string" && v.trim()) (analysis as Record<string, string>)[k] = v.trim().slice(0, 300);
    }
    return { prompt, chips: chips.length >= 3 ? chips : extractChips(prompt), analysis };
  } catch (err) {
    console.error("[inspire] reverse failed:", err);
    throw new Error("The vision model couldn't read that image. Try again, or try a different image.");
  }
}

// ----- Enhance ----------------------------------------------------------------

export interface EnhanceResult {
  prompt: string;
  chips: Chip[];
  added: string[];
  offline?: boolean;
}

export async function aiEnhance(prompt: string, deliverable?: string): Promise<EnhanceResult> {
  const fallback = (): EnhanceResult => {
    const chips = extractChips(prompt);
    const recs = recommend(chips, [], deliverable, 4);
    const added = recs.map((r) => r.text);
    return { prompt: [prompt.replace(/[.,\s]+$/, ""), ...added].join(", "), chips: [...chips, ...recs], added };
  };
  if (!aiConfigured()) return { ...fallback(), offline: true };
  try {
    const text = await ask(
      `You improve AI image prompts while PRESERVING the creator's direction: keep the same subject, idea, style and every specific choice they made. Add only what is missing — lighting, camera, composition, texture, colour, mood — and sharpen vague words into precise visual language. Never change what the picture is of. 50–120 words, comma-separated prose.
Answer with JSON only: {"prompt":"…","added":["each short phrase you added"]}`,
      prompt,
      900,
      0.6,
    );
    const parsed = parseJsonLoose(text) as { prompt?: unknown; added?: unknown } | null;
    const out = typeof parsed?.prompt === "string" ? parsed.prompt.trim() : "";
    if (out.length < prompt.length * 0.6) throw new Error("too short");
    const added = Array.isArray(parsed?.added) ? (parsed!.added as unknown[]).filter((a): a is string => typeof a === "string").slice(0, 12) : [];
    return { prompt: out, chips: extractChips(out), added };
  } catch (err) {
    console.error("[inspire] enhance failed:", err);
    return fallback();
  }
}

// ----- Translate ---------------------------------------------------------------

export async function aiTranslate(idea: string): Promise<ChipResult> {
  const offline = translateIdea(idea);
  if (!aiConfigured()) return { chips: offline, offline: true };
  try {
    const text = await ask(
      `Turn a creative idea written in everyday words into image-prompt building blocks. Infer the visual choices a skilled prompt engineer would make for it — subject, style, lighting, camera, composition, palette, texture, mood — and express each as a short chip.\n${CHIP_RULES}\nAnswer with JSON only: {"chips":[{"text":"…","category":"…","why":"…"}]} — 8–14 chips, subject first.`,
      idea,
      1000,
      0.6,
    );
    const parsed = parseJsonLoose(text) as { chips?: unknown } | null;
    const chips = sanitizeChips(parsed?.chips, 16);
    if (chips.length < 3) throw new Error("too few chips");
    return { chips };
  } catch (err) {
    console.error("[inspire] translate failed:", err);
    return { chips: offline, warning: "The AI didn't answer, so the built-in translator made these." };
  }
}
