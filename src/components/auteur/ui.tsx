"use client";

// Small shared primitives for the studio. Everything visual that repeats.

import { useEffect, useState, type ReactNode } from "react";
import { mediaUrl } from "@/lib/auteur/media";
import type { AspectRatio, ShotTake } from "@/lib/auteur/types";
import { cn } from "@/lib/utils";

export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("au-mono", className)}>{children}</span>;
}

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("block", className)}>
      <div className="mb-1.5 flex items-baseline justify-between">
        <Mono>{label}</Mono>
        {hint && <span className="text-[11px] text-[var(--au-ink-3)]">{hint}</span>}
      </div>
      {children}
    </label>
  );
}

export function Btn({
  children,
  className,
  variant = "default",
  size,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "primary" | "ghost" | "danger";
  size?: "sm" | "icon";
}) {
  return (
    <button
      type="button"
      className={cn(
        "au-btn",
        variant === "primary" && "au-btn-primary",
        variant === "ghost" && "au-btn-ghost",
        variant === "danger" && "au-btn-ghost au-btn-danger",
        size === "sm" && "au-btn-sm",
        size === "icon" && "au-btn-icon",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Chip({
  on,
  children,
  hue,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { on?: boolean; hue?: number }) {
  return (
    <button type="button" className="au-chip" data-on={on ? "true" : "false"} {...rest}>
      {hue !== undefined && (
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{ background: `hsl(${hue} 70% 60%)`, opacity: on ? 1 : 0.6 }}
        />
      )}
      {children}
    </button>
  );
}

export function aspectStyle(aspect: AspectRatio): React.CSSProperties {
  return { aspectRatio: aspect === "16:9" ? "16 / 9" : aspect === "9:16" ? "9 / 16" : "1 / 1" };
}

/** Resolve a mediaId to an object URL, or null while loading / when absent. */
export function useMediaUrl(mediaId: string | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    if (!mediaId) {
      setUrl(null);
      return;
    }
    void mediaUrl(mediaId).then((u) => {
      if (live) setUrl(u);
    });
    return () => {
      live = false;
    };
  }, [mediaId]);
  return url;
}

/**
 * What a shot looks like right now: its clip if the active take has one, else
 * an animatic painted in the project's hue with the shot's own words on it.
 */
export function TakeFrame({
  take,
  aspect,
  hue,
  label,
  caption,
  controls = false,
  autoPlay = false,
  muted = true,
  className,
  onEnded,
  videoRef,
}: {
  take: ShotTake | null;
  aspect: AspectRatio;
  hue: number;
  label?: string;
  caption?: string;
  controls?: boolean;
  autoPlay?: boolean;
  muted?: boolean;
  className?: string;
  onEnded?: () => void;
  videoRef?: React.Ref<HTMLVideoElement>;
}) {
  const url = useMediaUrl(take?.mediaId);
  const status = take?.status ?? "idle";
  return (
    <div className={cn("au-frame", className)} style={aspectStyle(aspect)}>
      {url ? (
        <video
          ref={videoRef}
          src={url}
          controls={controls}
          autoPlay={autoPlay}
          muted={muted}
          playsInline
          loop={!onEnded}
          onEnded={onEnded}
        />
      ) : (
        <div className="au-animatic" style={{ ["--h" as string]: take?.posterHue ?? hue }}>
          {caption && (
            <div className="absolute inset-x-0 bottom-0 p-3 text-[11px] leading-snug text-white/70 [text-shadow:0_1px_2px_rgba(0,0,0,.8)]">
              {caption}
            </div>
          )}
          {(status === "generating" || status === "queued") && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="flex items-center gap-2 rounded-full bg-black/60 px-3 py-1.5 backdrop-blur">
                <span className="au-dot" data-s={status} />
                <span className="text-[11px] text-white/85">{status === "queued" ? "Queued" : "Rendering"}</span>
              </div>
            </div>
          )}
          {status === "error" && (
            <div className="absolute inset-0 flex items-center justify-center p-3">
              <div className="rounded-lg bg-black/70 px-3 py-2 text-center text-[11px] text-[#ff9b8c]">{take?.error ?? "Failed"}</div>
            </div>
          )}
          {status === "done" && take?.engine === "placeholder" && (
            <div className="absolute right-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-white/60">
              animatic
            </div>
          )}
        </div>
      )}
      {label && (
        <div className="au-mono absolute left-2 top-2 rounded bg-black/60 px-1.5 py-0.5 !text-white/80">{label}</div>
      )}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cn("inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent", className)}
      aria-hidden
    />
  );
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="flex h-full min-h-[240px] flex-col items-center justify-center rounded-xl border border-dashed border-[var(--au-line-strong)] p-8 text-center">
      <p className="text-sm font-medium text-[var(--au-ink)]">{title}</p>
      <p className="mt-1 max-w-sm text-xs leading-relaxed text-[var(--au-ink-2)]">{body}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function fmtSec(s: number): string {
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return m ? `${m}:${r.toFixed(0).padStart(2, "0")}` : `${r.toFixed(r % 1 ? 1 : 0)}s`;
}
