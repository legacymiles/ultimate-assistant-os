// ---------------------------------------------------------------------------
// Music Video Studio — the colour law, and the numbers.
//
// The timeline is read at a glance or it is not read at all, so exactly three
// things carry colour and they never trade places:
//
//   cyan    the song, and the playhead riding it.
//   amber   lip sync. The ranges on the lip-sync lane, and every video block
//           one of them lands on — so "this shot sings" is the same colour in
//           both lanes and you can see the alignment without reading a word.
//   indigo  a video block playing under the music.
// ---------------------------------------------------------------------------

import type { AspectRatio } from "./types";

export interface Skin {
  label: string;
  hue: number;
  /** Block fill. */
  fill: string;
  /** Block border. */
  edge: string;
  /** Border on the selected block. */
  edgeOn: string;
  /** Label text on the block, and the lane header. */
  text: string;
  /** The lane's own strip behind the blocks. */
  bed: string;
}

/** A video block that a lip-sync range lands on. */
export const SINGS: Skin = {
  label: "Lip sync",
  hue: 36,
  fill: "linear-gradient(176deg, hsl(36 92% 58% / 0.30), hsl(28 88% 44% / 0.16))",
  edge: "hsl(36 90% 60% / 0.44)",
  edgeOn: "hsl(38 96% 66%)",
  text: "hsl(40 96% 78%)",
  bed: "hsl(36 60% 50% / 0.05)",
};

/** A video block playing under the music. */
export const PLAYS: Skin = {
  label: "Video",
  hue: 246,
  fill: "linear-gradient(176deg, hsl(246 82% 68% / 0.24), hsl(256 70% 50% / 0.11))",
  edge: "hsl(246 70% 70% / 0.36)",
  edgeOn: "hsl(246 92% 76%)",
  text: "hsl(248 88% 84%)",
  bed: "hsl(246 60% 60% / 0.04)",
};

export const blockSkin = (lipSynced: boolean): Skin => (lipSynced ? SINGS : PLAYS);

/** The hue a placeholder clip is painted with when there is no API key. */
export const placeholderHue = (lipSynced: boolean): number => blockSkin(lipSynced).hue;

export const ASPECT_RATIOS: { label: string; value: AspectRatio; note: string }[] = [
  { label: "16:9", value: "16:9", note: "Wide" },
  { label: "9:16", value: "9:16", note: "Vertical" },
  { label: "1:1", value: "1:1", note: "Square" },
];

export const ASPECT_CSS: Record<AspectRatio, string> = {
  "16:9": "16 / 9",
  "9:16": "9 / 16",
  "1:1": "1 / 1",
};

/** mm:ss.t — the only time format in the app. */
export function timecode(sec: number, tenths = false): string {
  const clamped = Math.max(0, sec);
  const m = Math.floor(clamped / 60);
  const s = Math.floor(clamped % 60);
  const base = `${m}:${String(s).padStart(2, "0")}`;
  if (!tenths) return base;
  return `${base}.${Math.floor((clamped % 1) * 10)}`;
}

export const secs = (sec: number): string =>
  sec >= 10 || sec % 1 === 0 ? `${Math.round(sec)}s` : `${sec.toFixed(1)}s`;
