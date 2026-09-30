"use client";

// ---------------------------------------------------------------------------
// Photos — the video branch.
//
// A camera roll is not only photographs, and a video is the one thing in it
// that NOTHING here can read: no vision model accepts video, so there is no
// triage to run, nothing to caption, and no destination to propose. That single
// fact decides the whole shape of this module.
//
// So videos do not go through the review queue. A queue exists because a
// machine guessed where a picture belongs and a human has to agree; here the
// human already said where it goes by choosing the folder, and a review step
// would be a confirmation dialog with no question in it. Videos are stored and
// filed in one move.
//
// Everything else is deliberately the SAME machinery photos use: the bytes go
// to IndexedDB, the record is an ordinary Dashboard item in an ordinary folder
// under Photos › Videos, so search, the folder workspace, the assistant and
// the Drive backup all work on them for free (backup already uploads any item
// with a fileId — see lib/dashboard/driveBackup/plan.ts).
//
// The poster frame is the one piece of real work. A tile with a filename on it
// is unrecognisable; a tile with the first real frame of the clip on it is the
// video. It is grabbed in the browser off a <video> element, so it costs no
// key, no upload and no GPU.
// ---------------------------------------------------------------------------

import { uid } from "../../utils";
import { categorize, deleteFile, MAX_FILE_BYTES, putFile } from "../files";
import { createItem, deleteItem, ensureFolderPath, getData, updateFolder } from "../store";
import type { Item, RecallData } from "../types";
import { PHOTOS_ROOT } from "./types";

/** The one folder every video lives under, as a child of the Photos root. */
export const VIDEOS_ROOT = "Videos";

/** Photos › Videos, the path the folder helpers take. */
export const VIDEOS_PATH = [PHOTOS_ROOT, VIDEOS_ROOT];

/**
 * How big a poster frame is allowed to be.
 *
 * Posters ride in `attachment.url`, which lives in localStorage with its ~5MB
 * ceiling, the same as photo thumbnails. 320px on the long edge at q0.7 is
 * ~20KB — a hundred clips of poster is ~2MB, which fits, and the tile is only
 * ever drawn at a couple of hundred pixels anyway.
 */
const POSTER_MAX_DIM = 320;
const POSTER_QUALITY = 0.7;

/**
 * Where in the clip to grab the poster from.
 *
 * Not frame zero: a great many videos open on black, a fade-up or a slate, and
 * a wall of black tiles is worse than no posters at all. A second and a bit in
 * clears the usual fade while staying early enough to be the thing the clip is
 * about — 10% of a six-second clip does not, which is how the first version of
 * this shipped a black tile for exactly the case it was written to avoid.
 */
export function posterTime(duration: number): number {
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  if (duration <= 1.5) return duration / 2;
  return Math.min(Math.max(duration * 0.15, 1.2), 3);
}

/** Second attempt, when the first frame came back as good as black. */
export function retryPosterTime(duration: number): number | null {
  if (!Number.isFinite(duration) || duration <= 2) return null;
  return Math.min(duration * 0.4, 8);
}

/**
 * Is this frame effectively black?
 *
 * A fade-up longer than the first guess, a title card, a lens cap: all of them
 * produce a tile that says nothing. One luminance average over the poster is
 * enough to know, and it costs a single pass over a 320px image.
 */
export function isBlankFrame(pixels: ArrayLike<number>): boolean {
  if (!pixels.length) return false;
  let sum = 0;
  let count = 0;
  // Every 40th pixel: 4 channels × a stride of 10 pixels. Plenty for an average.
  for (let i = 0; i < pixels.length; i += 40) {
    sum += 0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2];
    count++;
  }
  return count > 0 && sum / count < 10;
}

// ----- facts about a file --------------------------------------------------

export function isVideoFile(file: { name: string; type?: string }): boolean {
  return categorize(file.name, file.type ?? "") === "video";
}

/** Is this filed item a video? Reads what was written at import, then the name. */
export function isVideoItem(item: Item): boolean {
  const att = item.attachment;
  if (!att) return false;
  if (att.category === "video") return true;
  return categorize(att.name || item.title, att.type || "") === "video";
}

/** "0:07" · "4:31" · "1:02:03" — never "0:7", never a bare seconds count. */
export function formatDuration(seconds: number | undefined | null): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "—";
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
}

/** File size for a mono column: "812 KB", "14.2 MB", "1.3 GB". */
export function formatSize(bytes: number | undefined | null): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

/** The clip's length, read back off the item it was written on. */
export function durationOf(item: Item): number | null {
  const raw = item.fields?.duration;
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Total run time of a set of clips, in seconds. Unknown lengths count as 0. */
export function totalDuration(items: Item[]): number {
  return items.reduce((sum, it) => sum + (durationOf(it) ?? 0), 0);
}

export function totalSize(items: Item[]): number {
  return items.reduce((sum, it) => sum + (it.attachment?.size ?? 0), 0);
}

// ----- the folder ----------------------------------------------------------

/** The Videos folder, if it has been made yet. */
export function videosRoot(data: RecallData): { id: string } | null {
  const photos =
    data.folders.find((f) => f.parentId === null && f.role === "photos") ??
    data.folders.find(
      (f) => f.parentId === null && f.name.toLowerCase() === PHOTOS_ROOT.toLowerCase(),
    ) ??
    null;
  if (!photos) return null;
  const found = data.folders.find(
    (f) => f.parentId === photos.id && f.name.toLowerCase() === VIDEOS_ROOT.toLowerCase(),
  );
  return found ? { id: found.id } : null;
}

/**
 * Find or create Photos › Videos.
 *
 * Created by hand (`auto = false`) for the same reason the photo albums are:
 * an auto-generated folder is one the classifier may reorganise, and this one
 * is a fixture of the app.
 */
export function ensureVideosRoot(): { data: RecallData; folderId: string | null } {
  const made = ensureFolderPath(VIDEOS_PATH, false);
  const folder = made.folderId ? made.data.folders.find((f) => f.id === made.folderId) : null;
  // The film icon, so the branch is recognisable on the Folders tab too, where
  // it is an ordinary folder among the others. Set once: an icon the owner
  // later changes by hand is theirs.
  if (folder && !folder.icon) {
    return {
      data: updateFolder(folder.id, {
        name: folder.name,
        description: folder.description,
        icon: "film",
      }),
      folderId: folder.id,
    };
  }
  return made;
}

// ----- the poster ----------------------------------------------------------

export interface VideoProbe {
  poster?: string;
  duration?: number;
  width?: number;
  height?: number;
}

/**
 * Pull one frame and the running time out of a video file, in the browser.
 *
 * Every failure path resolves rather than rejecting. A codec the browser cannot
 * decode (a .mkv, some .avi) must still be importable — it plays in VLC, it is
 * the owner's file, and refusing to store it because we could not draw a
 * thumbnail would be the app deciding which of their videos are real.
 */
export function probeVideo(file: Blob): Promise<VideoProbe> {
  return new Promise((resolve) => {
    if (typeof document === "undefined") return resolve({});
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    let settled = false;

    const finish = (out: VideoProbe) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(url);
      resolve(out);
    };

    // A file the browser will never decode otherwise leaves this promise open
    // for the whole import, and the progress line stops moving with no reason
    // given. Ten seconds, then take what we have.
    const timer = setTimeout(
      () => finish({ duration: Number.isFinite(video.duration) ? video.duration : undefined }),
      10_000,
    );

    /** Set once a black first frame has sent us looking further in. */
    let retried = false;

    const draw = () => {
      try {
        const w = video.videoWidth;
        const h = video.videoHeight;
        if (!w || !h) return finish({ duration: video.duration });
        const scale = Math.min(1, POSTER_MAX_DIM / Math.max(w, h));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(w * scale));
        canvas.height = Math.max(1, Math.round(h * scale));
        const ctx = canvas.getContext("2d");
        if (!ctx) return finish({ duration: video.duration, width: w, height: h });
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        // A black tile is a tile with nothing on it. Look once more, further in,
        // before settling for one.
        if (!retried) {
          const again = retryPosterTime(video.duration);
          if (again != null && isBlankFrame(ctx.getImageData(0, 0, canvas.width, canvas.height).data)) {
            retried = true;
            video.currentTime = again;
            setTimeout(() => !settled && draw(), 1_500);
            return;
          }
        }

        finish({
          poster: canvas.toDataURL("image/jpeg", POSTER_QUALITY),
          duration: Number.isFinite(video.duration) ? video.duration : undefined,
          width: w,
          height: h,
        });
      } catch {
        // A cross-origin or DRM frame taints the canvas. The clip is still fine.
        finish({ duration: Number.isFinite(video.duration) ? video.duration : undefined });
      }
    };

    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;
    video.onerror = () => finish({});
    video.onseeked = draw;
    video.onloadeddata = () => {
      const at = posterTime(video.duration);
      if (at > 0 && Number.isFinite(video.duration)) {
        video.currentTime = at;
        // Some browsers fire no `seeked` for a seek that lands on the current
        // frame; the data is already there, so draw it if nothing arrives.
        setTimeout(() => !settled && draw(), 1_500);
      } else {
        draw();
      }
    };
    video.src = url;
  });
}

// ----- import -------------------------------------------------------------

export interface VideoImportProgress {
  /** 1-based index of the file being worked on. */
  index: number;
  total: number;
  name: string;
  stage: "reading" | "storing";
}

export interface VideoImportOutcome {
  added: number;
  /** Files that were not video at all. */
  skipped: number;
  /** Files that are video but could not be taken, each with the reason. */
  failed: { name: string; reason: string }[];
}

export interface VideoImportArgs {
  files: File[];
  /** The folder to file them in — the open sub-folder, or the Videos root. */
  folderId: string;
  onProgress?: (p: VideoImportProgress) => void;
}

/**
 * Store a batch of videos and file them, in that order.
 *
 * The bytes go to IndexedDB BEFORE the item is created, for the same reason the
 * photo pipeline does it: an item whose blob was never written is a row in the
 * library that plays nothing, which is worse than a clear failure at import.
 */
export async function importVideos(args: VideoImportArgs): Promise<VideoImportOutcome> {
  const out: VideoImportOutcome = { added: 0, skipped: 0, failed: [] };
  const videos = args.files.filter((f) => {
    if (isVideoFile(f)) return true;
    out.skipped++;
    return false;
  });

  for (let i = 0; i < videos.length; i++) {
    const file = videos[i];
    const step = { index: i + 1, total: videos.length, name: file.name };

    if (file.size > MAX_FILE_BYTES) {
      out.failed.push({
        name: file.name,
        reason: `${formatSize(file.size)} — the browser can only hold ${formatSize(MAX_FILE_BYTES)} per file`,
      });
      continue;
    }

    args.onProgress?.({ ...step, stage: "reading" });
    const probe = await probeVideo(file);

    args.onProgress?.({ ...step, stage: "storing" });
    const fileId = uid("blob");
    try {
      await putFile(fileId, file);
    } catch (err) {
      out.failed.push({
        name: file.name,
        reason:
          err instanceof Error && err.message
            ? err.message
            : "this browser would not store the file (private mode blocks it)",
      });
      continue;
    }

    createItem({
      title: titleFrom(file.name),
      body: "",
      summary: [formatDuration(probe.duration ?? null), formatSize(file.size)]
        .filter((s) => s !== "—")
        .join(" · "),
      kind: "file",
      source: "manual",
      folderId: args.folderId,
      tags: ["video"],
      attachment: {
        name: file.name,
        type: file.type || "video/mp4",
        size: file.size,
        url: probe.poster,
        fileId,
        category: "video",
      },
      // Said out loud on the item rather than left blank: video is the one
      // thing the library stores without reading, and the detail modal already
      // renders that status honestly.
      extractStatus: "unsupported",
      fields: {
        ...(probe.duration ? { duration: String(Math.round(probe.duration * 100) / 100) } : {}),
        ...(probe.width && probe.height ? { resolution: `${probe.width}×${probe.height}` } : {}),
      },
    });
    out.added++;
  }

  return out;
}

/** "beach-day-final_v2.MOV" → "beach day final v2". */
export function titleFrom(filename: string): string {
  const base = filename.replace(/\.[a-z0-9]{1,5}$/i, "");
  const words = base.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return words || filename;
}

/** Delete a clip and its bytes together. One without the other leaks. */
export async function deleteVideo(item: Item): Promise<RecallData> {
  if (item.attachment?.fileId) {
    try {
      await deleteFile(item.attachment.fileId);
    } catch {
      // The row must still go. An orphaned blob is reclaimed by pruneOrphans.
    }
  }
  deleteItem(item.id);
  return getData();
}
