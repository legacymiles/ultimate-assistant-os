// ---------------------------------------------------------------------------
// The plates — what the scanner reveals.
//
// Two painters per plate, drawn into identically-sized canvases so the reveal
// is a removal of a layer rather than a swap of two pictures (see Scanner.tsx).
//
// The SEALED layer is the panel at rest: plate dark, a faint rule, the song's
// name set in mono, and a flat dead line where the sound should be. It has to
// be quiet enough to live behind typography in a dense studio screen.
//
// The LIVE layer underneath is the measured waveform of the clip that is
// actually loaded, with the readouts beside it. That is the reason the mechanic
// earns its place here instead of being decoration: sweeping the plate is how
// you find out what you are holding — a 30-second preview or a whole record, a
// loud master or a quiet one, a ballad or a drill beat.
// ---------------------------------------------------------------------------

import type { Painter } from "./Scanner";

/** The studio's own tokens, as canvas needs them literally. */
const INK = "#eceaf2";
const INK_2 = "#a2a1ae";
const INK_3 = "#55555f";
const PLATE = "#0c0d12";
const LINE = "#20212a";
const GO = "#7c5cff";
const CYAN = "#63d2ff";

export interface Lane {
  /** "A" / "B", or nothing for a single-record plate. */
  side?: string;
  /** The record's name. */
  name: string;
  /** Measured envelope, 0-1. Empty when nothing is loaded. */
  peaks: number[];
  /** One line under the name: what the clip is. */
  note?: string;
}

/** A signature that changes exactly when the painted result would. */
export function laneSignature(lanes: Lane[], extra = ""): string {
  return (
    lanes
      .map((l) => `${l.side ?? ""}|${l.name}|${l.note ?? ""}|${l.peaks.length}|${l.peaks[Math.floor(l.peaks.length / 2)] ?? 0}`)
      .join("~") + `~${extra}`
  );
}

function grid(ctx: CanvasRenderingContext2D, w: number, h: number, colour: string, step: number) {
  ctx.strokeStyle = colour;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = step; x < w; x += step) {
    ctx.moveTo(Math.round(x) + 0.5, 0);
    ctx.lineTo(Math.round(x) + 0.5, h);
  }
  for (let y = step; y < h; y += step) {
    ctx.moveTo(0, Math.round(y) + 0.5);
    ctx.lineTo(w, Math.round(y) + 0.5);
  }
  ctx.stroke();
}

function mono(size: number, weight = 500): string {
  return `${weight} ${size}px "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
}

/**
 * Where each lane sits, and the one rule the layout has to keep: the top band
 * belongs to the React typography laid over the plate (see `.mct-plate-over`),
 * so nothing is painted into it. The lanes label themselves from the bottom up
 * and put the sound in the middle.
 */
const TOP_BAND = 72;

function laneBoxes(lanes: Lane[], w: number): { x: number; width: number; lane: Lane }[] {
  const pad = 14;
  const gap = lanes.length > 1 ? 18 : 0;
  const width = (w - pad * 2 - gap * (lanes.length - 1)) / lanes.length;
  return lanes.map((lane, i) => ({ lane, x: pad + i * (width + gap), width }));
}

/** The band the waveform may use: centred, clear of the overlay and the labels. */
function waveBand(h: number): { mid: number; room: number } {
  const mid = Math.round((TOP_BAND + (h - 48)) / 2);
  return { mid, room: Math.max(6, Math.min(mid - TOP_BAND, h - 48 - mid)) };
}

/** The caption, top right — the one line the overlay never reaches. */
function caption(ctx: CanvasRenderingContext2D, w: number, text: string, colour: string) {
  ctx.fillStyle = colour;
  ctx.font = mono(9);
  ctx.fillText(text, Math.max(14, w - 14 - ctx.measureText(text).width), 22);
}

/** The sealed layer: the plate, the names, and a dead line. */
export function sealedPlate(lanes: Lane[], text: string): Painter {
  return (ctx, w, h) => {
    ctx.fillStyle = PLATE;
    ctx.fillRect(0, 0, w, h);
    grid(ctx, w, h, "rgba(255,255,255,0.022)", 22);

    ctx.strokeStyle = LINE;
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
    caption(ctx, w, text, INK_3);

    const { mid } = waveBand(h);
    for (const { lane, x, width } of laneBoxes(lanes, w)) {
      // The dead line. Flat on purpose: there is nothing to see until it is
      // scanned, and a decorative wave here would give the game away.
      ctx.strokeStyle = "rgba(236,234,242,0.16)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, mid + 0.5);
      ctx.lineTo(x + width, mid + 0.5);
      ctx.stroke();

      ctx.fillStyle = INK_3;
      ctx.font = mono(9, 600);
      ctx.fillText((lane.side ? `${lane.side} · ` : "") + "SEALED", x, h - 42);

      ctx.fillStyle = INK;
      ctx.font = mono(13, 600);
      ctx.fillText(clip(ctx, lane.name, width), x, h - 24);

      if (lane.note) {
        ctx.fillStyle = INK_3;
        ctx.font = mono(9);
        ctx.fillText(clip(ctx, lane.note, width), x, h - 10);
      }
    }
  };
}

/** The live layer: the measured waveform, in the studio's gradient. */
export function wavePlate(lanes: Lane[], text: string): Painter {
  return (ctx, w, h) => {
    ctx.fillStyle = "#05060a";
    ctx.fillRect(0, 0, w, h);
    grid(ctx, w, h, "rgba(124,92,255,0.10)", 22);
    caption(ctx, w, text, CYAN);

    const { mid, room } = waveBand(h);
    for (const { lane, x, width } of laneBoxes(lanes, w)) {
      if (lane.peaks.length) {
        const gradient = ctx.createLinearGradient(x, 0, x + width, 0);
        gradient.addColorStop(0, GO);
        gradient.addColorStop(1, CYAN);
        ctx.fillStyle = gradient;

        const bars = lane.peaks.length;
        const step = width / bars;
        const bar = Math.max(1, Math.min(3, step * 0.62));
        for (let i = 0; i < bars; i++) {
          const tall = Math.max(1, lane.peaks[i] * room);
          ctx.fillRect(x + i * step, mid - tall, bar, tall * 2);
        }

        ctx.strokeStyle = "rgba(99,210,255,0.5)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, mid + 0.5);
        ctx.lineTo(x + width, mid + 0.5);
        ctx.stroke();
      } else {
        ctx.fillStyle = INK_3;
        ctx.font = mono(10);
        ctx.fillText("nothing decoded on this side", x, mid + 4);
      }

      ctx.fillStyle = CYAN;
      ctx.font = mono(9, 600);
      ctx.fillText((lane.side ? `${lane.side} · ` : "") + (lane.peaks.length ? "LIVE" : "NO AUDIO"), x, h - 42);

      ctx.fillStyle = INK;
      ctx.font = mono(13, 600);
      ctx.fillText(clip(ctx, lane.name, width), x, h - 24);

      if (lane.note) {
        ctx.fillStyle = INK_2;
        ctx.font = mono(9);
        ctx.fillText(clip(ctx, lane.note, width), x, h - 10);
      }
    }
  };
}

/** Trim a string to the width it has, with an ellipsis when it does not fit. */
function clip(ctx: CanvasRenderingContext2D, text: string, width: number): string {
  if (ctx.measureText(text).width <= width) return text;
  let out = text;
  while (out.length > 4 && ctx.measureText(`${out}…`).width > width) out = out.slice(0, -1);
  return `${out}…`;
}
