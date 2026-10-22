// ---------------------------------------------------------------------------
// The audio tab's Shazam: listen to a clip and name the song in it.
//
// AudD (audd.io) fingerprints the audio. It takes a link to the media, so the
// clip is handed over as a short signed link to the saved file, or as the
// file itself when it lives on local disk, or — for an embed-only clip — the
// post's own link.
//
// Works with no key: AudD allows a few lookups a day without one. With
// AUDD_API_TOKEN set (dashboard.audd.io) there is no daily cap. Every failure
// comes back as a plain sentence, never a code.
// ---------------------------------------------------------------------------

import "server-only";

import type { Song } from "../types";

const ENDPOINT = "https://api.audd.io/";

export type Heard = { ok: true; song: Song | null } | { ok: false; error: string; limit?: boolean };

export function auddConfigured(): boolean {
  return !!process.env.AUDD_API_TOKEN;
}

/** Plain-English reason for an AudD error. */
export function auddMessage(code: number, keyed: boolean): { error: string; limit: boolean } {
  // 901: no token and today's free lookups are used up. 902: the token's own limit.
  if (code === 901 || code === 902) {
    return {
      error: keyed
        ? "The song finder's key has used up its lookups. Top it up at dashboard.audd.io."
        : "Today's free song lookups are used up. Add an AudD key (Profile › Connections › Song finder) for unlimited, or try again tomorrow.",
      limit: true,
    };
  }
  if (code === 900) return { error: "The song finder's key isn't right. Check AUDD_API_TOKEN.", limit: false };
  if (code === 300 || code === 400 || code === 500) return { error: "Couldn't hear this clip's audio. It may be silent or too short.", limit: false };
  return { error: "The song finder didn't answer. Try again in a moment.", limit: false };
}

/* eslint-disable @typescript-eslint/no-explicit-any -- AudD's JSON is untyped */
export function readAudd(json: any, keyed: boolean): Heard {
  if (json?.status === "success") {
    const r = json.result;
    if (!r || !r.title) return { ok: true, song: null };
    const link = r.spotify?.external_urls?.spotify || r.apple_music?.url || r.song_link || undefined;
    return { ok: true, song: { title: String(r.title), artist: String(r.artist ?? ""), via: "listen", ...(link ? { link: String(link) } : {}) } };
  }
  const code = Number(json?.error?.error_code) || 0;
  const { error, limit } = auddMessage(code, keyed);
  return { ok: false, error, limit };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Listen to one clip: `url` is a media link AudD can fetch, or `bytes` the file itself. */
export async function listen(input: { url?: string; bytes?: Buffer; contentType?: string }): Promise<Heard> {
  const token = process.env.AUDD_API_TOKEN ?? "";
  const form = new FormData();
  if (token) form.set("api_token", token);
  form.set("return", "spotify,apple_music");
  if (input.bytes) {
    // AudD only needs the opening seconds; keep the upload small.
    const slice = input.bytes.subarray(0, 12_000_000);
    form.set("file", new Blob([new Uint8Array(slice)], { type: input.contentType ?? "video/mp4" }), "clip.mp4");
  } else if (input.url) {
    form.set("url", input.url);
  } else {
    return { ok: false, error: "There's no audio to listen to for this clip." };
  }
  try {
    const res = await fetch(ENDPOINT, { method: "POST", body: form, signal: AbortSignal.timeout(45_000) });
    const json = await res.json().catch(() => null);
    if (!json) return { ok: false, error: "The song finder didn't answer. Try again in a moment." };
    return readAudd(json, !!token);
  } catch {
    return { ok: false, error: "Couldn't reach the song finder. Try again in a moment." };
  }
}
