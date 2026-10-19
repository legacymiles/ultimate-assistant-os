"use client";

// ---------------------------------------------------------------------------
// Jarvis chat → App Builder.
//
// The owner's rule: every new app, website, tool, plugin or workflow is made
// through App Builder. So when the super chat is asked to build one — typed,
// spoken, or a Camera Autopilot job carrying its photo or clip — its
// `app_builder` tool calls this, in the owner's tab: the request becomes an
// App Builder project marked `pending` (synced, so it shows on every device),
// the attachments wait in this browser's inbox, and App Builder starts the
// super agent on it the moment it opens.
// ---------------------------------------------------------------------------

import type { ChatMedia } from "@/lib/new-jarvis/chatMedia";
import { newProject } from "./engine";
import { putMedia } from "./inbox";
import { keyframesOf, type PreparedMedia } from "./media";
import { readStore, sourcesOf, writeStore } from "./useAppBuilder";

/** A chat attachment as App Builder's media: its frames (in order) and its sound. */
export function fromChatMedia(m: ChatMedia): PreparedMedia | null {
  const frames = m.parts.flatMap((p) => (p.type === "image_url" ? [p.image_url.url] : []));
  if (!frames.length) return null; // a sound-only recording has nothing to watch
  const sound = m.parts.find((p) => p.type === "input_audio");
  return {
    id: m.id,
    kind: m.kind === "video" ? "video" : "image",
    name: m.name,
    thumb: m.thumb,
    frames,
    ...(sound && sound.type === "input_audio" ? { sound: sound.input_audio.data } : {}),
  };
}

export interface HandOff {
  id: string;
  url: string;
  name: string;
  media: number;
}

export async function handToAppBuilder(input: {
  idea: string;
  media?: ChatMedia[];
  origin?: "chat" | "autopilot";
}): Promise<HandOff> {
  const media = (input.media ?? []).map(fromChatMedia).filter((m): m is PreparedMedia => Boolean(m));
  const idea = input.idea.trim() || (media.length ? "Recreate the app or workflow in this recording" : "");
  if (idea.length < 3) throw new Error("Say what the app should do, in a line or more.");
  const p = {
    ...newProject(idea),
    origin: input.origin ?? "chat",
    pending: true,
    ...(media.length ? { sources: sourcesOf(media), keyframes: keyframesOf(media) } : {}),
  };
  const s = readStore();
  writeStore({ projects: [p, ...s.projects], currentId: p.id });
  const kept = await putMedia(p.id, media);
  return {
    id: p.id,
    url: `/apps/app-builder?p=${encodeURIComponent(p.id)}`,
    name: p.understanding?.name ?? "the app",
    media: kept ? media.length : 0,
  };
}
