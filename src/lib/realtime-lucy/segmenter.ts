// Person-vs-background segmentation for Realtime Lucy's "masked" cond_mode.
//
// Runs MediaPipe's selfie segmenter in the browser, entirely off the model's
// GPU budget, and turns each frame into the small 0–255 grid the server
// resamples onto the latent grid. Everything is served from /public — no CDN,
// so the app still works with no network.
//
// The CPU delegate is deliberate: the WebGL delegate would open a context on
// the same card the DiT is filling (5.1 GB of 6 GB on the dev laptop), and a
// 256×192 segmentation four times a second costs a CPU almost nothing.

import {
  MASK_GRID_W,
  MEDIAPIPE_SEGMENTER_MODEL,
  MEDIAPIPE_WASM_PATH,
  type MaskTarget,
} from "./protocol";

/** Size the video is segmented at, before the mask is boxed down to the grid. */
const SEG_W = 256;
const SEG_H = 192;

export interface MaskFrame {
  w: number;
  h: number;
  /** base64 of w*h bytes: 255 = the prompt owns it, 0 = keep the camera. */
  data: string;
  /** Fraction of the frame the prompt owns, 0–1 — for the UI readout. */
  coverage: number;
}

export interface Segmenter {
  /** null when this frame could not be segmented (video not ready yet). */
  run: (video: HTMLVideoElement, target: MaskTarget, timestampMs: number) => MaskFrame | null;
  close: () => void;
}

function toBase64(bytes: Uint8Array) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

/**
 * Load the segmenter. Throws if the vendored assets are missing or the
 * browser cannot run them — callers fall back to no mask rather than break
 * the stream.
 */
export async function createSegmenter(): Promise<Segmenter> {
  const { FilesetResolver, ImageSegmenter } = await import("@mediapipe/tasks-vision");
  const vision = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_PATH);
  const segmenter = await ImageSegmenter.createFromOptions(vision, {
    baseOptions: { modelAssetPath: MEDIAPIPE_SEGMENTER_MODEL, delegate: "CPU" },
    runningMode: "VIDEO",
    outputCategoryMask: true,
    outputConfidenceMasks: false,
  });

  // Which category index is the person? Ask the model rather than assume:
  // "background" is the one label that is stable across segmenter variants.
  let subjectIndex = 1;
  try {
    const labels = segmenter.getLabels();
    const bg = labels.findIndex((l) => l.toLowerCase().includes("background"));
    const other = labels.findIndex((_, i) => i !== bg);
    if (other >= 0) subjectIndex = other;
  } catch {
    /* keep the default */
  }

  const canvas = document.createElement("canvas");
  canvas.width = SEG_W;
  canvas.height = SEG_H;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("no 2d context for segmentation");

  let closed = false;

  return {
    run(video, target, timestampMs) {
      if (closed || !video.videoWidth || video.readyState < 2) return null;

      // Grid follows the camera's aspect so it lands on the latent grid
      // without stretching; the server resamples from here.
      const aspect = video.videoWidth / video.videoHeight;
      const gridW = MASK_GRID_W;
      const gridH = Math.max(8, Math.round(MASK_GRID_W / aspect));

      ctx.drawImage(video, 0, 0, SEG_W, SEG_H);

      let out: MaskFrame | null = null;
      segmenter.segmentForVideo(canvas, timestampMs, (result) => {
        const categoryMask = result.categoryMask;
        if (!categoryMask) return;
        const cats = categoryMask.getAsUint8Array();

        // Box-average each cell of the grid. Averaging 0/1 over a block is
        // what gives the edge a soft ramp instead of a staircase.
        const grid = new Uint8Array(gridW * gridH);
        let sum = 0;
        for (let gy = 0; gy < gridH; gy++) {
          const y0 = Math.floor((gy * SEG_H) / gridH);
          const y1 = Math.max(y0 + 1, Math.floor(((gy + 1) * SEG_H) / gridH));
          for (let gx = 0; gx < gridW; gx++) {
            const x0 = Math.floor((gx * SEG_W) / gridW);
            const x1 = Math.max(x0 + 1, Math.floor(((gx + 1) * SEG_W) / gridW));
            let hits = 0;
            let n = 0;
            for (let y = y0; y < y1; y++) {
              const row = y * SEG_W;
              for (let x = x0; x < x1; x++) {
                if (cats[row + x] === subjectIndex) hits++;
                n++;
              }
            }
            // `subject` repaints the person, `background` repaints everything
            // else — so the fraction is inverted for the latter.
            const subjectFrac = n ? hits / n : 0;
            const v = target === "subject" ? subjectFrac : 1 - subjectFrac;
            grid[gy * gridW + gx] = Math.round(v * 255);
            sum += v;
          }
        }
        result.close();
        out = {
          w: gridW,
          h: gridH,
          data: toBase64(grid),
          coverage: sum / (gridW * gridH),
        };
      });
      return out;
    },
    close() {
      closed = true;
      try {
        segmenter.close();
      } catch {
        /* already gone */
      }
    },
  };
}
