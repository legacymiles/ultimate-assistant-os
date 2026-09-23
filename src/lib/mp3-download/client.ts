"use client";

// ---------------------------------------------------------------------------
// Browser side of the three stages. Thin on purpose: the routes hold the
// knowledge, this holds the fetches and the one piece of DOM trickery a file
// download needs.
// ---------------------------------------------------------------------------

import { downloadName } from "./match";
import type { Candidate, Licence, Track } from "./types";

export interface SourceReport {
  id: string;
  label: string;
  ok: boolean;
  count: number;
  note?: string;
}

export interface YtdlpStatus {
  ok: boolean;
  version: string | null;
  ffmpeg: boolean;
  message: string;
}

export interface HuntResult {
  candidates: Candidate[];
  checked: SourceReport[];
  error?: string;
}

export async function searchSongs(query: string, signal?: AbortSignal): Promise<Track[]> {
  const res = await fetch("/api/mp3-download/search?q=" + encodeURIComponent(query), { signal });
  if (!res.ok) throw new Error("Search failed");
  return ((await res.json()) as { tracks?: Track[] }).tracks ?? [];
}

export async function huntSources(track: Track, signal?: AbortSignal): Promise<HuntResult> {
  const res = await fetch("/api/mp3-download/sources", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ track }),
    signal,
  });
  const data = (await res.json()) as HuntResult;
  return { candidates: data.candidates ?? [], checked: data.checked ?? [], error: data.error };
}

/** The proxy URL that saves this candidate as `Artist - Title.ext`. */
export function fileUrlFor(track: Track, candidate: Candidate): string {
  return (
    "/api/mp3-download/file?url=" +
    encodeURIComponent(candidate.fileUrl) +
    "&name=" +
    encodeURIComponent(downloadName(track, candidate.format))
  );
}

/**
 * Save a URL to disk under a name we choose.
 *
 * A hidden anchor rather than `window.open`, because an anchor click neither
 * steals focus nor trips a popup blocker.
 *
 * The anchor is removed on a later tick, NOT synchronously after the click.
 * Removing it immediately is the classic version of this helper and it is
 * wrong: the download had not committed yet, so the browser lost the
 * `download` attribute and fell back to the last filename it had used — which
 * showed up here as an MP3 saved under a completely unrelated name from
 * months ago. Verified against the real downloads folder, not the UI.
 */
export function saveToDisk(url: string, filename: string): void {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  a.target = "_self";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => a.remove(), 4_000);
}

export async function fetchYtdlpStatus(refresh = false): Promise<YtdlpStatus> {
  const res = await fetch("/api/mp3-download/ytdlp" + (refresh ? "?refresh=1" : ""));
  return (await res.json()) as YtdlpStatus;
}

export interface Saved {
  filename: string;
  bytes: number | null;
}

/** Everything the paste box knows about a link before anything is fetched. */
export interface LinkProbe {
  id: string;
  title: string;
  creator: string;
  siteLabel: string;
  pageUrl: string;
  durationMs: number | null;
  thumbnail: string | null;
  uploaded: string;
  licence: Licence;
  isLive: boolean;
  approxBytes: number | null;
}

export type GrabMode = "audio" | "video";

/** Read a pasted link. Throws with the site's own reason when it will not. */
export async function probeLink(url: string): Promise<LinkProbe> {
  const res = await fetch("/api/mp3-download/link", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url }),
  });
  const data = (await res.json()) as { probe?: LinkProbe; error?: string };
  if (!res.ok || !data.probe) throw new Error(data.error ?? "That link could not be read.");
  return data.probe;
}

interface GrabRequest {
  url: string;
  track?: Track;
  title?: string;
  creator?: string;
  mode?: GrabMode;
}

/**
 * Ask the server to fetch something, then let the browser save it from a URL.
 *
 * Deliberately NOT a blob. A POST's body can only reach disk through
 * URL.createObjectURL, which holds the entire file in the tab's memory; that
 * survived a 6 MB song and silently dropped a 23 MB video — no error, no file,
 * and the page still said "Saved". So the POST only does the work and returns
 * a ticket, and the save is an ordinary GET the browser streams to disk.
 */
async function grab(body: GrabRequest): Promise<Saved> {
  const res = await fetch("/api/mp3-download/ytdlp", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = (await res.json().catch(() => ({}))) as {
    href?: string;
    filename?: string;
    bytes?: number;
    error?: string;
  };
  if (!res.ok || !data.href || !data.filename) {
    throw new Error(data.error ?? "yt-dlp could not fetch that one.");
  }

  saveToDisk(data.href, data.filename);
  return { filename: data.filename, bytes: data.bytes ?? null };
}

/**
 * The source-table path for a directly-hosted file, through the proxy.
 *
 * Two requests on purpose. The first is abandoned the moment its headers
 * arrive — enough to know the source really answers and how big the file is,
 * without pulling a byte of it — and only then does the browser do the real,
 * streamed download. Firing an anchor and assuming it worked is what let a
 * download that never happened be recorded in the library as a grab.
 */
export async function downloadCandidate(track: Track, candidate: Candidate): Promise<Saved> {
  const href = fileUrlFor(track, candidate);
  const filename = downloadName(track, candidate.format);

  const probe = await fetch(href);
  if (!probe.ok) {
    let message = "That file could not be fetched.";
    try {
      message = ((await probe.json()) as { error?: string }).error ?? message;
    } catch {
      // A non-JSON failure body is not worth surfacing raw.
    }
    throw new Error(message);
  }
  const bytes = Number(probe.headers.get("content-length")) || candidate.bytes;
  await probe.body?.cancel().catch(() => undefined);

  saveToDisk(href, filename);
  return { filename, bytes: bytes ?? null };
}

/** The source-table path for a YouTube row: a confirmed track names the file. */
export function downloadViaYtdlp(track: Track, url: string): Promise<Saved> {
  return grab({ url, track, mode: "audio" });
}

/** The paste-box path: the site's own title names the file. */
export function downloadLink(probe: LinkProbe, mode: GrabMode): Promise<Saved> {
  return grab({ url: probe.pageUrl, title: probe.title, creator: probe.creator, mode });
}
