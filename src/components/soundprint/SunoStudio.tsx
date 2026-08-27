"use client";

import { useState } from "react";
import { copyText, resolveSunoTrack, type SunoTrack } from "@/lib/soundprint/client";
import { SUNO_CREATE_URL } from "@/lib/soundprint/suno";
import type { PromptSet } from "@/lib/soundprint/types";
import { cn } from "@/lib/utils";
import { Icon } from "../icons";

/**
 * Create on Suno, then play the real track here.
 *
 * Suno has no public generation API and blocks its player from being iframed
 * (frame-ancestors 'none'), so we can't auto-make or embed the song. What we
 * can do: hand you the prompts, send you to Suno to create it, and — once you
 * paste the share link back — play the actual Suno audio from its public CDN.
 */
export function SunoStudio({ prompts }: { prompts: PromptSet }) {
  const [copied, setCopied] = useState<"style" | "exclude" | "lyrics" | null>(null);
  const [url, setUrl] = useState("");
  const [track, setTrack] = useState<SunoTrack | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const copy = async (which: "style" | "exclude" | "lyrics", text: string) => {
    if (await copyText(text)) {
      setCopied(which);
      setTimeout(() => setCopied((c) => (c === which ? null : c)), 1500);
    }
  };

  const play = async () => {
    setLoading(true);
    setError("");
    setTrack(null);
    const { track: t, error: e } = await resolveSunoTrack(url);
    if (t) setTrack(t);
    setError(e);
    setLoading(false);
  };

  return (
    <div className="overflow-hidden rounded-xl border border-brand/30 bg-brand/5">
      <div className="flex items-center gap-2 border-b border-brand/20 px-3 py-2.5">
        <Icon.Launch width={13} height={13} className="text-brand" />
        <span className="text-xs font-semibold text-ink">Make it on Suno &amp; play it here</span>
      </div>

      <div className="space-y-3 p-3">
        {/* Step 1 — copy + open */}
        <div>
          <StepLabel n={1}>Copy the prompts into Suno and hit Create</StepLabel>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <MiniCopy
              label="Copy style"
              done={copied === "style"}
              onClick={() => copy("style", prompts.style)}
            />
            {prompts.exclude && (
              <MiniCopy
                label="Copy exclude"
                done={copied === "exclude"}
                onClick={() => copy("exclude", prompts.exclude)}
              />
            )}
            <MiniCopy
              label="Copy lyrics"
              done={copied === "lyrics"}
              onClick={() => copy("lyrics", prompts.lyrics)}
            />
            <a
              href={SUNO_CREATE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-brand px-2.5 py-1 text-[11px] font-semibold text-white transition hover:bg-brand-2"
            >
              Open Suno
              <Icon.Launch width={11} height={11} />
            </a>
          </div>
        </div>

        {/* Step 2 — paste link */}
        <div>
          <StepLabel n={2}>
            In Suno, open the finished song → Share → Copy Link, then paste it here
          </StepLabel>
          <div className="mt-1.5 flex gap-1.5">
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && url.trim() && !loading) void play();
              }}
              placeholder="https://suno.com/song/…  or  suno.com/s/…"
              className="min-w-0 flex-1 rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-[12px] text-ink outline-none transition placeholder:text-ink-faint focus:border-brand/60"
            />
            <button
              onClick={play}
              disabled={loading || !url.trim()}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-[11px] font-semibold text-white transition hover:bg-brand-2 disabled:opacity-50"
            >
              {loading ? (
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/40 border-t-white" />
              ) : (
                <Icon.Sparkles width={12} height={12} />
              )}
              {loading ? "Loading…" : "Play"}
            </button>
          </div>
        </div>

        {error && (
          <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-2.5 py-2 text-[11px] leading-relaxed text-red-300">
            {error}
          </p>
        )}

        {track && (
          <div className="animate-fade-in space-y-1.5">
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <audio src={track.audioUrl} controls autoPlay className="w-full" />
            <div className="flex items-center gap-3 text-[11px]">
              <a
                href={track.sunoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-medium text-brand transition hover:underline"
              >
                Open on Suno
                <Icon.Launch width={10} height={10} />
              </a>
              <a
                href={track.audioUrl}
                download={`${track.songId}.mp3`}
                className="inline-flex items-center gap-1 font-medium text-ink-muted transition hover:text-ink"
              >
                <Icon.Download width={10} height={10} />
                Download MP3
              </a>
            </div>
          </div>
        )}

        <p className="text-[10.5px] leading-relaxed text-ink-faint">
          Playing here needs the song set to “Public” or “Anyone with the link” in Suno. Nothing
          is auto-created — Suno has no public API, so you make the song and paste it back.
        </p>
      </div>
    </div>
  );
}

function StepLabel({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="flex h-4 w-4 items-center justify-center rounded-full bg-brand/20 text-[9px] font-bold text-brand">
        {n}
      </span>
      <span className="text-[11px] font-medium text-ink-muted">{children}</span>
    </div>
  );
}

function MiniCopy({
  label,
  done,
  onClick,
}: {
  label: string;
  done: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-medium transition",
        done
          ? "border-core/40 bg-core/10 text-core"
          : "border-line bg-panel text-ink-muted hover:bg-panel-2 hover:text-ink",
      )}
    >
      {done ? <Icon.Check width={10} height={10} /> : <Icon.Copy width={10} height={10} />}
      {done ? "Copied" : label}
    </button>
  );
}
