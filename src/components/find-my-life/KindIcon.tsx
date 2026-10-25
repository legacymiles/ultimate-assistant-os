// One line-drawn glyph per kind of thing, on the same 24-unit grid and stroke
// as the rest of Jarvis's icons.

import type { Kind } from "@/lib/find-my-life/kinds";

const PATHS: Record<Kind, React.ReactNode> = {
  phone: (
    <>
      <rect x="6.5" y="2.5" width="11" height="19" rx="2.4" />
      <path d="M10.5 18.5h3" />
    </>
  ),
  laptop: (
    <>
      <rect x="4.5" y="5" width="15" height="10.5" rx="1.4" />
      <path d="M2.5 19h19" />
    </>
  ),
  tablet: (
    <>
      <rect x="2.5" y="4.5" width="19" height="15" rx="2.2" />
      <path d="M18.4 11.2v1.6" />
    </>
  ),
  watch: (
    <>
      <rect x="7" y="6.5" width="10" height="11" rx="2.6" />
      <path d="M9 6.5 10 2.5h4l1 4M9 17.5l1 4h4l1-4M12 10v2.2l1.4 1" />
    </>
  ),
  earbuds: (
    <>
      <path d="M7 4.2a3 3 0 0 1 3 3v1.6a3 3 0 0 1-3 3M7 11.8V19.5" />
      <path d="M17 4.2a3 3 0 0 0-3 3v1.6a3 3 0 0 0 3 3M17 11.8V19.5" />
    </>
  ),
  glasses: (
    <>
      <circle cx="6.5" cy="14" r="3.6" />
      <circle cx="17.5" cy="14" r="3.6" />
      <path d="M10.1 13.4c1.2-.9 2.6-.9 3.8 0M2.9 13 5 7.2M21.1 13 19 7.2" />
    </>
  ),
  car: (
    <>
      <path d="M4.5 16.2v-4.1L6.8 6.6h10.4l2.3 5.5v4.1z" />
      <path d="M4.5 12.1h15" />
      <circle cx="7.8" cy="16.6" r="1.7" />
      <circle cx="16.2" cy="16.6" r="1.7" />
    </>
  ),
  keys: (
    <>
      <circle cx="8" cy="8" r="4.2" />
      <path d="m11 11 9.2 9.2M17.2 17.2l2.2-2.2M14.6 14.6l2-2" />
    </>
  ),
  wallet: (
    <>
      <rect x="3" y="6" width="18" height="13.5" rx="2.2" />
      <path d="M3 9.6h18M15.5 13.2h3.5v3h-3.5z" />
    </>
  ),
  bag: (
    <>
      <rect x="4" y="8" width="16" height="12.5" rx="2.2" />
      <path d="M9 8V6.2a3 3 0 0 1 6 0V8M4 12.5h16" />
    </>
  ),
  bike: (
    <>
      <circle cx="5.8" cy="16" r="3.6" />
      <circle cx="18.2" cy="16" r="3.6" />
      <path d="M5.8 16 10 9h5.4l2.8 7M10 9l3.2 7M8.6 5.8h3" />
    </>
  ),
  pet: (
    <>
      <circle cx="8.2" cy="6.8" r="1.7" />
      <circle cx="15.8" cy="6.8" r="1.7" />
      <circle cx="4.8" cy="11" r="1.7" />
      <circle cx="19.2" cy="11" r="1.7" />
      <path d="M12 10.8c-3 0-5.2 3.2-5.2 5.8 0 2 2 2.6 5.2 2.6s5.2-.6 5.2-2.6c0-2.6-2.2-5.8-5.2-5.8z" />
    </>
  ),
  other: (
    <>
      <path d="m12 2.8 8.2 4.6v9.2L12 21.2l-8.2-4.6V7.4z" />
      <path d="M12 12l8.2-4.6M12 12v9.2M12 12 3.8 7.4" />
    </>
  ),
};

export function KindIcon({ kind, size = 18, className }: { kind: Kind; size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {PATHS[kind] ?? PATHS.other}
    </svg>
  );
}
