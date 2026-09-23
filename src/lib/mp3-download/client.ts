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
  /** Read from the host's oEmbed, not yt-dlp: no duration, no stated licence. */
  partial?: boolean;
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

// --- the PC bridge -----------------------------------------------------------
//
// On the deployed site yt-dlp does not exist, so a YouTube grab is handed to
// the runner on the owner's PC instead. The page does not need to know which
// world it is in: `grabAnywhere` uses the local engine when there is one and
// the bridge when there is not.

export interface BridgeInfo {
  hasToken: boolean;
  lastSeen: string | null;
  online: boolean;
  pending: number;
}

export async function fetchBridgeInfo(): Promise<BridgeInfo> {
  const res = await fetch("/api/mp3-download/bridge");
  if (!res.ok) throw new Error("Could not read the bridge status.");
  return (await res.json()) as BridgeInfo;
}

export async function mintRunnerToken(): Promise<string> {
  const res = await fetch("/api/mp3-download/bridge", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ op: "mint" }),
  });
  const data = (await res.json()) as { token?: string; error?: string };
  if (!res.ok || !data.token) throw new Error(data.error ?? "Could not make a token.");
  return data.token;
}

interface JobStatus {
  state: "queued" | "running" | "done" | "failed";
  filename: string;
  bytes: number | null;
  error: string | null;
  href: string | null;
}

/**
 * Queue a grab on the PC and wait for the file.
 *
 * Polling rather than a socket: the whole job usually takes under a minute and
 * a poll survives a phone locking, a tab sleeping and a serverless function
 * that cannot hold a connection open anyway. `onProgress` exists so the page
 * can say "waiting for your PC" instead of spinning silently.
 */
export async function grabViaBridge(
  input: { url: string; mode: GrabMode; title: string; creator: string },
  onProgress?: (state: JobStatus["state"], online: boolean) => void,
): Promise<Saved> {
  const queued = await fetch("/api/mp3-download/bridge", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ op: "queue", ...input }),
  });
  const start = (await queued.json()) as { jobId?: string; online?: boolean; error?: string };
  if (!queued.ok || !start.jobId) throw new Error(start.error ?? "Could not reach your PC.");

  onProgress?.("queued", Boolean(start.online));

  const deadline = Date.now() + 10 * 60_000;
  let seen: JobStatus["state"] = "queued";

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2_000));

    const res = await fetch(`/api/mp3-download/bridge?job=${encodeURIComponent(start.jobId)}`);
    if (!res.ok) throw new Error("That job disappeared.");
    const job = (await res.json()) as JobStatus;

    if (job.state !== seen) {
      seen = job.state;
      onProgress?.(job.state, true);
    }

    if (job.state === "failed") throw new Error(job.error ?? "Your PC could not fetch it.");
    if (job.state === "done" && job.href) {
      saveToDisk(job.href, job.filename);
      return { filename: job.filename, bytes: job.bytes };
    }
  }

  throw new Error("Your PC did not finish in ten minutes. Is the runner still running?");
}

/**
 * Grab a URL whichever way this hub can.
 *
 * Local engine first — it is faster and needs nothing running. Otherwise the
 * bridge. The error when neither is available names both ways out rather than
 * leaving the owner to guess.
 */
export async function grabAnywhere(
  input: { url: string; mode: GrabMode; title: string; creator: string; track?: Track },
  engine: { ok: boolean; message: string } | null,
  bridge: BridgeInfo | null,
  onProgress?: (state: JobStatus["state"], online: boolean) => void,
): Promise<Saved> {
  if (engine?.ok) {
    return grab({
      url: input.url,
      track: input.track,
      title: input.title,
      creator: input.creator,
      mode: input.mode,
    });
  }
  if (bridge?.hasToken) {
    return grabViaBridge(input, onProgress);
  }
  throw new Error(
    (engine?.message ?? "yt-dlp is not available on this server.") +
      " Or set up the PC bridge in the “Your PC” tab and it will fetch this for you.",
  );
}
