import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Motion tokens. One personality, reused everywhere: confident, fast out.
 * `ease` is the default curve itself so it can be dropped straight into a
 * transition; `easeSnap` is the playful overshoot, for small elements only.
 */
export const ease = [0.16, 1, 0.3, 1] as [number, number, number, number];
export const easeSnap = [0.3, 1.4, 0.5, 1] as [number, number, number, number];

export const dur = { fast: 0.25, base: 0.45, slow: 0.7, hero: 1.1 };

export const spring = {
  soft: { type: "spring", stiffness: 160, damping: 22, mass: 1 },
  snappy: { type: "spring", stiffness: 420, damping: 32 },
  /** The Margin Beam's settle — weighted, overshoots once. */
  beam: { type: "spring", stiffness: 300, damping: 18, mass: 1.1 },
} as const;

export const rise = (i = 0) => ({
  initial: { opacity: 0, y: 14 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: dur.slow, ease, delay: i * 0.05 },
});

/** Relative time in the words a person would use. */
export function ago(iso: string | null | undefined): string {
  if (!iso) return "unknown";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "unknown";
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 50) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) {
    const h = Math.round(s / 3600);
    return `${h} hour${h === 1 ? "" : "s"} ago`;
  }
  const d = Math.round(s / 86400);
  if (d < 31) return `${d} day${d === 1 ? "" : "s"} ago`;
  const m = Math.round(d / 30.4);
  if (m < 12) return `${m} month${m === 1 ? "" : "s"} ago`;
  return `${Math.round(m / 12)} year${Math.round(m / 12) === 1 ? "" : "s"} ago`;
}

export function shortDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function hostOf(url: string | null | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
