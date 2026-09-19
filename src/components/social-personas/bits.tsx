"use client";

import type { SocialPlatform } from "@/lib/social-personas/types";

const PLATFORM_COLOR: Record<string, string> = {
  tiktok: "#ff0050",
  instagram: "#d62976",
  facebook: "#1877f2",
  youtube: "#ff0000",
  other: "#888",
};

export function PlatformDot({ platform }: { platform: SocialPlatform | string }) {
  return <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: PLATFORM_COLOR[platform] ?? "#888" }} />;
}

export function Avatar({ name, hue, size = 32 }: { name: string; hue: number; size?: number }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-xl font-bold text-white"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.38,
        background: `linear-gradient(135deg, hsl(${hue} 75% 55%), hsl(${(hue + 50) % 360} 70% 40%))`,
      }}
      aria-hidden
    >
      {initials || "?"}
    </span>
  );
}

export function Btn({
  children,
  onClick,
  disabled,
  primary,
  title,
  className = "",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  primary?: boolean;
  title?: string;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={
        "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 " +
        (primary ? "bg-brand text-white hover:bg-brand-2 " : "border border-line text-ink-muted hover:bg-panel-2 hover:text-ink ") +
        className
      }
    >
      {children}
    </button>
  );
}

export const inputCls =
  "w-full rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-brand focus:ring-2 focus:ring-brand/30";
