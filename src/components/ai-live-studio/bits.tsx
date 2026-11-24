"use client";

import { hashText } from "@/lib/ai-live-studio/events";

/**
 * A viewer's picture: their real one when TikTok sends it, otherwise a
 * monogram on a hue derived from their handle — stable, so the same viewer
 * always looks the same. Never a stand-in image service.
 */
export function Monogram({ name, handle, src, size = 30 }: { name: string; handle?: string; src?: string; size?: number }) {
  const style = { width: size, height: size, fontSize: Math.round(size * 0.4) };
  if (src) {
    return (
      <span className="als-mono" style={style}>
        {/* eslint-disable-next-line @next/next/no-img-element -- remote TikTok avatar, size is tiny */}
        <img src={src} alt="" width={size} height={size} loading="lazy" referrerPolicy="no-referrer" />
      </span>
    );
  }
  const hue = parseInt(hashText(handle || name), 36) % 360;
  const initial = (name.replace(/[^\p{L}\p{N}]/gu, "")[0] ?? "?").toUpperCase();
  return (
    <span
      className="als-mono"
      aria-hidden="true"
      style={{ ...style, background: `linear-gradient(135deg, hsl(${hue} 34% 80%), hsl(${(hue + 46) % 360} 26% 63%))` }}
    >
      {initial}
    </span>
  );
}

export function clock(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** 754 000 → "12:34", 4 000 000 → "1:06:40". */
export function elapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/** What a gift / follow / share says, in words. */
export function eventLine(kind: string, text: string): string {
  if (kind === "gift") return `sent ${/^[aeiou]/i.test(text) ? "an" : "a"} ${text || "gift"}`;
  if (kind === "follow") return "just followed";
  if (kind === "share") return "shared the stream";
  return text;
}
