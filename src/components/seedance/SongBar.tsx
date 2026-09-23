"use client";

// ---------------------------------------------------------------------------
// The song, drawn from decoded peaks.
//
// It is not decoration. The stretches a lip-sync range is standing on are drawn
// amber and at full height; the rest are drawn cool and low. So the answer to
// "is the voice covered here?" is the picture, not a calculation.
// ---------------------------------------------------------------------------

import { useEffect, useRef } from "react";
import { SINGS } from "@/lib/seedance/constants";
import { sortLip } from "@/lib/seedance/reel";
import type { LipRange } from "@/lib/seedance/types";

const HEIGHT = 56;

export function SongBar({
  peaks,
  totalSec,
  songSec,
  pxPerSec,
  lipsync,
  hasSong,
}: {
  peaks: number[] | undefined;
  /** Width of the whole lane — may exceed the song when the cut overruns it. */
  totalSec: number;
  /** Where the song itself actually ends. */
  songSec: number;
  pxPerSec: number;
  lipsync: LipRange[];
  hasSong: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const width = Math.max(1, Math.round(totalSec * pxPerSec));
  const songW = Math.max(1, Math.round(songSec * pxPerSec));

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(HEIGHT * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, HEIGHT);

    const mid = HEIGHT / 2;
    const covered = sortLip(lipsync).map((r) => ({
      from: r.startSec * pxPerSec,
      to: (r.startSec + r.durationSec) * pxPerSec,
    }));
    const sungAt = (x: number) => covered.some((c) => x >= c.from && x < c.to);

    // The bed: always present, so an undecodable song still reads as a track.
    ctx.fillStyle = "rgba(0, 202, 224, 0.07)";
    ctx.fillRect(0, mid - 1, songW, 2);

    if (!peaks?.length) {
      ctx.strokeStyle = "rgba(0, 202, 224, 0.28)";
      ctx.setLineDash([3, 5]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, mid);
      ctx.lineTo(songW, mid);
      ctx.stroke();
      return;
    }

    const step = 2; // one bar every 2 css px — dense enough to read as audio
    for (let x = 0; x < songW; x += step) {
      const p = peaks[Math.min(peaks.length - 1, Math.floor((x / songW) * peaks.length))];
      const sung = sungAt(x);
      const amp = Math.max(0.02, p) * (sung ? 0.94 : 0.5);
      const h = amp * (HEIGHT - 6);
      ctx.fillStyle = sung ? `hsl(${SINGS.hue} 92% 62% / 0.85)` : "rgba(0, 202, 224, 0.34)";
      ctx.fillRect(x, mid - h / 2, step - 0.6, h);
    }
  }, [peaks, width, songW, pxPerSec, lipsync]);

  return (
    <div className="relative" style={{ width, height: HEIGHT }}>
      <canvas
        ref={ref}
        style={{ width, height: HEIGHT }}
        aria-label={hasSong ? "Song waveform" : "No song loaded"}
      />
      {!hasSong && (
        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center whitespace-nowrap text-[11px] text-ink-faint">
          No song yet — the timeline runs on a 60-second runway until you load one.
        </span>
      )}
    </div>
  );
}

export const SONG_HEIGHT = HEIGHT;
