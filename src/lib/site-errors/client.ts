// Sending a crash report from the browser. Never throws, never blocks, and
// sends each distinct message at most once every 30 seconds per tab, so a
// render loop cannot flood the log or the network.

import type { ErrorKind } from "./log";

const ENDPOINT = "/api/site-errors/report";
const recent = new Map<string, number>();

export function reportError(err: unknown, kind: ErrorKind, extra?: { digest?: string; site?: string }): void {
  try {
    if (typeof window === "undefined") return;
    const e = err instanceof Error ? err : new Error(typeof err === "string" ? err : safeString(err));
    const message = (e.message || e.name || "Unknown error").slice(0, 500);
    const now = Date.now();
    if ((recent.get(message) ?? 0) > now - 30_000) return;
    recent.set(message, now);
    if (recent.size > 50) recent.clear();
    const body = JSON.stringify({
      site: extra?.site ?? "hub",
      kind,
      message,
      stack: (e.stack ?? "").slice(0, 4_000),
      url: window.location.pathname,
      digest: extra?.digest,
    });
    // sendBeacon survives the page closing; fetch keepalive is the fallback.
    const sent = navigator.sendBeacon?.(ENDPOINT, new Blob([body], { type: "application/json" }));
    if (!sent) void fetch(ENDPOINT, { method: "POST", body, headers: { "Content-Type": "application/json" }, keepalive: true }).catch(() => {});
  } catch {
    // A reporter that crashes is worse than none.
  }
}

function safeString(v: unknown): string {
  try {
    return typeof v === "object" ? JSON.stringify(v).slice(0, 300) : String(v);
  } catch {
    return "Unknown error";
  }
}
