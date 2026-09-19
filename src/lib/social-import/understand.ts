// ---------------------------------------------------------------------------
// Turning a SocialPost into structured JSON by having a model actually watch it.
//
// The caller supplies the system prompt and the task (including its JSON
// shape); this module supplies the evidence — video, cover image, caption,
// page text — and picks the model that can take it.
//
// Verified 2026-09-13 against OpenRouter:
//   - google/gemini-3.8-flash accepts `video_url` content parts, both a plain
//     YouTube URL and a base64 `data:video/mp4` URL. It hears the audio too.
//     A 54 s TikTok cost ~$0.005; a YouTube Short ~$0.003.
//   - The Vercel AI Gateway's video support was NOT verified, so video is only
//     sent when OpenRouter is the provider. Everything else degrades to
//     caption + cover image through the hub's default model.
//
// Order of attempts, each falling through on failure:
//   1. video (+ caption) through VIDEO_MODEL
//   2. cover image + caption through AI_MODEL
//   3. caption only through AI_MODEL
// ---------------------------------------------------------------------------

import "server-only";

import { DEFAULT_MODEL, aiEndpoint, aiFetch, type AiEndpoint } from "@/lib/ai/provider";
import type { SocialPost } from "./resolve";
import { fetchBytes } from "./safeFetch";

export const VIDEO_MODEL = process.env.AI_VIDEO_MODEL || "google/gemini-3.8-flash";

/** Base64 inflates this by a third; OpenRouter accepted 6 MB comfortably. */
const MAX_VIDEO_BYTES = 20 * 1024 * 1024;
/** Past this a YouTube video is a long-form episode — slow and costly to watch. */
const MAX_VIDEO_SECONDS = 20 * 60;

type Part =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | { type: "video_url"; video_url: { url: string } };

export interface UnderstandRequest {
  post: SocialPost;
  system: string;
  /** What to produce, including the JSON shape. Appended after the post's evidence. */
  task: string;
  /** A `data:video/…` URL the user uploaded directly. */
  uploadDataUrl?: string;
  /** Cover image as a data: URL (see fetchImageDataUrl). */
  imageDataUrl?: string | null;
}

export interface Understanding {
  data: any;
  watchedVideo: boolean;
  sawImage: boolean;
  model: string;
}

export async function understandPost(req: UnderstandRequest): Promise<Understanding> {
  const ep = aiEndpoint();
  if (!ep) throw new Error("No AI provider is configured.");
  const text: Part = { type: "text", text: `${describePost(req.post)}\n\n${req.task}` };

  if (ep.provider === "openrouter") {
    const video = await videoPart(req);
    if (video) {
      try {
        const data = await ask(ep, VIDEO_MODEL, req.system, [text, video]);
        return { data, watchedVideo: true, sawImage: false, model: VIDEO_MODEL };
      } catch (err) {
        console.warn("[social-import] video pass failed, falling back to text:", err);
        // Usually OpenRouter's rule that video needs at least $1 of credit (402);
        // the gateway fallback then rejects video_url, which is the error seen here.
        req.post.trail.push(
          "Couldn't watch the video — the AI provider refused it (OpenRouter needs at least $1 of credit for video), so it was read from the caption and cover.",
        );
      }
    }
  }

  const model = process.env.AI_MODEL || DEFAULT_MODEL;
  if (req.imageDataUrl) {
    try {
      const data = await ask(ep, model, req.system, [text, { type: "image_url", image_url: { url: req.imageDataUrl } }]);
      return { data, watchedVideo: false, sawImage: true, model };
    } catch (err) {
      console.warn("[social-import] image pass failed, falling back to caption only:", err);
    }
  }
  return { data: await ask(ep, model, req.system, [text]), watchedVideo: false, sawImage: false, model };
}

/** The post's text evidence, labelled so the model knows where each part came from. */
export function describePost(p: SocialPost): string {
  const out: string[] = [];
  out.push(`SOURCE: ${p.platform === "upload" ? "a video the user uploaded" : `${p.platform} post ${p.url}`}`);
  if (p.author) out.push(`AUTHOR: ${p.author}`);
  if (p.title && !p.caption.startsWith(p.title)) out.push(`TITLE: ${p.title}`);
  if (p.caption) out.push(`CAPTION / DESCRIPTION:\n${p.caption.slice(0, 6000)}`);
  if (p.pageText) out.push(`PAGE TEXT:\n${p.pageText.slice(0, 10_000)}`);
  for (const l of p.linked) if (l.text) out.push(`LINKED PAGE ${l.url}:\n${l.text}`);
  return out.join("\n\n");
}

async function videoPart(req: UnderstandRequest): Promise<Part | null> {
  if (req.uploadDataUrl?.startsWith("data:video/")) return { type: "video_url", video_url: { url: req.uploadDataUrl } };
  const v = req.post.video;
  if (!v) return null;
  if (req.post.durationSec && req.post.durationSec > MAX_VIDEO_SECONDS) return null;
  if (v.kind === "youtube") return { type: "video_url", video_url: { url: v.url } };

  const got = await fetchBytes(v.url, { maxBytes: MAX_VIDEO_BYTES, timeoutMs: 60_000, accept: "video/*" });
  if (!got) return null;
  const mime = got.type.startsWith("video/") ? got.type : "video/mp4";
  return { type: "video_url", video_url: { url: `data:${mime};base64,${got.bytes.toString("base64")}` } };
}

async function ask(ep: AiEndpoint, model: string, system: string, content: Part[]): Promise<any> {
  const res = await aiFetch({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      temperature: 0.3,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content },
      ],
    }),
    signal: AbortSignal.timeout(170_000),
  });
  if (!res.ok) throw new Error(`${ep.provider} ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = await res.json();
  const reply = json?.choices?.[0]?.message?.content;
  return parseJsonLoose(typeof reply === "string" ? reply : "");
}

export function parseJsonLoose(s: string): any {
  const t = s.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  try {
    return JSON.parse(t);
  } catch {
    const a = t.indexOf("{");
    const b = t.lastIndexOf("}");
    if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
    throw new Error("The model did not return JSON.");
  }
}
