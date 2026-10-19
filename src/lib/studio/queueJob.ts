"use client";

// ---------------------------------------------------------------------------
// studio_queue — a Studio job that renders on the owner's PC, not here.
//
// Some workflows (Animate my character) are made in code by Claude Code with
// a skill, which the website cannot run. Their last round hands the approved
// brief and the chosen uploads to In Queue; the PC session reads the queue
// through the jarvis-memory connector, renders, and completes the request,
// which takes it off the queue by itself.
// ---------------------------------------------------------------------------

import { MAX_IMAGES } from "@/lib/new-jarvis/requests";
import { shrinkImage } from "@/lib/new-jarvis/useRequests";
import { queueRequestText } from "./queueText";

export async function sendStudioJobToQueue(
  args: Record<string, unknown>,
  uploads: string[],
): Promise<{ ok: boolean; message: string }> {
  const folder = typeof args.folder === "string" && args.folder.startsWith("flow:") ? args.folder : "";
  if (!folder) return { ok: false, message: "That job didn't say which workflow folder it belongs to." };
  const wanted = Array.isArray(args.references)
    ? (args.references as unknown[]).map(Number).filter((n) => Number.isInteger(n) && n >= 1)
    : [];
  const picked = (wanted.length ? wanted.map((n) => uploads[n - 1]).filter(Boolean) : uploads.slice(0, 1)).slice(0, MAX_IMAGES);

  let images: string[];
  try {
    images = await Promise.all(picked.map(async (src) => shrinkImage(await (await fetch(src)).blob())));
  } catch {
    return { ok: false, message: "Couldn't prepare the pictures. Attach the character again and retry." };
  }

  try {
    const res = await fetch("/api/new-jarvis/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "add", folder, text: queueRequestText(args), images, from: "studio" }),
    });
    const data = (await res.json()) as { added?: { id: string }[]; error?: string };
    if (!res.ok) return { ok: false, message: data.error ?? "In Queue didn't accept it." };
    const id = data.added?.[0]?.id;
    return {
      ok: true,
      message: id
        ? `Queued as ${id}. Your PC renders it the next time Claude Code works the queue ("work my Jarvis queue"), and it leaves the queue when the video is done.`
        : "That exact job is already in the queue.",
    };
  } catch {
    return {
      ok: false,
      message: "Couldn't reach In Queue. If you're not signed in, sign in so your PC can see the job.",
    };
  }
}
