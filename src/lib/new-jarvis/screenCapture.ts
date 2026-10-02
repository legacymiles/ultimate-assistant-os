"use client";

// ---------------------------------------------------------------------------
// Taking one frame of whatever the owner chooses to show.
//
// `getDisplayMedia` rather than the bridge's whole-screen grab, for one reason
// that matters more than convenience: the browser's own picker makes the owner
// choose a tab, a window or a screen, and shows them what they picked. Consent
// is the hard part of a feature like this and the platform already does it
// properly — a silent full-desktop capture from a local agent does not.
//
// Two disciplines in here, both privacy rather than polish:
//
//   ONE FRAME, THEN STOP. The stream is torn down the moment a frame is in
//   hand. A screen share that stays live after the scan is a camera left on,
//   and the browser's own "sharing" indicator is the only thing that would
//   have told the owner.
//
//   NEVER PERSISTED. The frame is a data URL held in a variable, sent once,
//   and dropped. Nothing writes it to a store, and the proposals that come back
//   carry text, not pixels.
// ---------------------------------------------------------------------------

/** Long edge of the frame that gets sent. Matches the document reader's own limit. */
export const MAX_EDGE = 1800;

/** JPEG quality. High enough to read small print, low enough to stay well inside the route's cap. */
export const QUALITY = 0.86;

export interface Capture {
  /** `data:image/jpeg;base64,…` */
  dataUrl: string;
  width: number;
  height: number;
  /** What the owner chose to share, when the browser will say. */
  label: string;
}

export class CaptureError extends Error {
  readonly kind: "unsupported" | "denied" | "failed";
  constructor(kind: CaptureError["kind"], message: string) {
    super(message);
    this.kind = kind;
    this.name = "CaptureError";
  }
}

export function screenCaptureSupported(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getDisplayMedia === "function";
}

/**
 * Scale a frame down so the long edge is at most `MAX_EDGE`.
 *
 * Pure arithmetic, separated from the DOM so the one thing worth asserting —
 * that a 4K screen is never sent at 4K, and that a small window is never
 * blown UP and made blurrier — is testable.
 */
export function fitTo(width: number, height: number, max = MAX_EDGE): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= 0) return { width: 0, height: 0 };
  const scale = Math.min(1, max / longest);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/**
 * Ask for a screen, take one frame, and stop sharing.
 *
 * Resolves with the frame, or throws a `CaptureError` whose `kind` says which
 * sentence the surface should show — "your browser cannot" and "you said no"
 * need different answers, and a single "capture failed" sends the owner
 * looking for a fault that is not there.
 */
export async function captureScreen(): Promise<Capture> {
  if (!screenCaptureSupported()) {
    throw new CaptureError(
      "unsupported",
      "This browser cannot share a screen. Chrome, Edge and Safari on a desktop can; most phones cannot.",
    );
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      // Never ask for audio. Nothing here listens, and asking would put a
      // microphone-shaped permission in front of a feature that reads pixels.
      audio: false,
    });
  } catch (e) {
    const name = e instanceof Error ? e.name : "";
    if (name === "NotAllowedError" || name === "AbortError") {
      throw new CaptureError("denied", "No screen was shared, so there was nothing to read.");
    }
    throw new CaptureError("failed", e instanceof Error ? e.message : "The screen could not be read.");
  }

  const track = stream.getVideoTracks()[0];
  const label = track?.label ?? "";

  try {
    const video = document.createElement("video");
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    await video.play();

    // One frame is not necessarily ready the instant play() resolves; a frame
    // grabbed too early is a black rectangle, which the model then describes
    // as an unreadable document rather than as a timing bug.
    await frameReady(video);

    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) throw new CaptureError("failed", "The shared screen produced no picture.");

    const size = fitTo(w, h);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new CaptureError("failed", "This browser would not give me a canvas.");
    ctx.drawImage(video, 0, 0, size.width, size.height);

    video.pause();
    video.srcObject = null;

    return { dataUrl: canvas.toDataURL("image/jpeg", QUALITY), width: size.width, height: size.height, label };
  } finally {
    // In `finally`, so a thrown error still stops the share. Leaving the
    // screen being shared after a failure is the worst outcome available here.
    for (const t of stream.getTracks()) t.stop();
  }
}

/** Wait until the video actually has a frame, with a ceiling so it cannot hang. */
function frameReady(video: HTMLVideoElement, timeoutMs = 2000): Promise<void> {
  return new Promise((resolve) => {
    const done = () => resolve();
    // requestVideoFrameCallback is exact where it exists; everywhere else, two
    // animation frames is enough for the first painted frame.
    const rvfc = (video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number })
      .requestVideoFrameCallback;
    if (typeof rvfc === "function") {
      rvfc.call(video, done);
    } else {
      requestAnimationFrame(() => requestAnimationFrame(done));
    }
    setTimeout(done, timeoutMs);
  });
}

/**
 * The warning shown before the picker opens.
 *
 * Said before rather than after, because afterwards is too late: the frame has
 * already been read by then. Short enough to be read.
 */
export const CAPTURE_WARNING =
  "The picture is sent once to be read, and is not saved. Share the window with the form on it rather than your whole screen, and close anything with a password on it first.";
