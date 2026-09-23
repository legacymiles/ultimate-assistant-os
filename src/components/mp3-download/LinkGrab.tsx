"use client";

// The paste box: a link you already have, straight to a file.
//
// This skips the song search, not the confirmation. One cheap yt-dlp call
// reads the link and the page shows what it actually is — real title, real
// channel, real runtime, and whatever licence the site itself states — before
// a byte is fetched. Same discipline as the search flow, one step shorter.

import { useEffect, useRef, useState } from "react";
import {
  grabAnywhere,
  probeLink,
  type BridgeInfo,
  type GrabMode,
  type LinkProbe,
  type Saved,
  type YtdlpStatus,
} from "@/lib/mp3-download/client";
import { formatBytes, formatDuration } from "@/lib/mp3-download/match";
import { cn } from "@/lib/utils";
import { Icon } from "../icons";
import { LicenceChip } from "./bits";

const LOOKS_LIKE_URL = /^https?:\/\/\S+$/i;

export function LinkGrab({
  engine,
  bridge,
  sites,
  initialUrl,
  onGrabbed,
  onNote,
}: {
  /** This hub's own yt-dlp, when it has one. */
  engine: (YtdlpStatus & { sites?: string[] }) | null;
  /** The owner's PC, which stands in for it on the deployed site. */
  bridge: BridgeInfo | null;
  sites: string[];
  /** A URL pasted into the search box on the other tab, handed over. */
  initialUrl: string;
  onGrabbed: (probe: LinkProbe, saved: Saved, mode: GrabMode) => void;
  onNote: (text: string) => void;
}) {
  const [url, setUrl] = useState(initialUrl);
  const [probe, setProbe] = useState<LinkProbe | null>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<GrabMode | null>(null);
  const [stage, setStage] = useState<string | null>(null);
  const [got, setGot] = useState<GrabMode[]>([]);

  // Reading a link needs yt-dlp too, so the field is usable whenever EITHER
  // this server has it or the PC does.
  const viaPc = !engine?.ok && Boolean(bridge?.hasToken);
  const usable = Boolean(engine?.ok) || viaPc;
  const field = useRef<HTMLInputElement>(null);
  const seq = useRef(0);

  const read = async (raw: string) => {
    const text = raw.trim();
    const mine = ++seq.current;
    setError(null);
    if (!LOOKS_LIKE_URL.test(text)) {
      setProbe(null);
      if (text) setError("That does not look like a link. Paste the full address.");
      return;
    }
    setReading(true);
    setProbe(null);
    setGot([]);
    try {
      const found = await probeLink(text);
      if (mine !== seq.current) return;
      setProbe(found);
    } catch (err) {
      if (mine !== seq.current) return;
      setError(err instanceof Error ? err.message : "That link could not be read.");
    } finally {
      if (mine === seq.current) setReading(false);
    }
  };

  // A link handed over from the search box should already be resolving by the
  // time the tab paints — the owner has done their part.
  useEffect(() => {
    if (initialUrl) void read(initialUrl);
    else field.current?.focus();
    // Deliberately keyed only on the handover, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialUrl]);

  const grab = async (mode: GrabMode) => {
    if (!probe) return;
    setBusy(mode);
    setError(null);
    setStage(null);
    try {
      const saved = await grabAnywhere(
        { url: probe.pageUrl, mode, title: probe.title, creator: probe.creator },
        engine,
        bridge,
        (state) =>
          setStage(
            state === "queued"
              ? bridge?.online
                ? "Sent to your PC."
                : "Queued — your PC is not listening yet, this starts when it is."
              : state === "running"
                ? "Your PC is fetching it."
                : null,
          ),
      );
      setGot((prev) => [...prev, mode]);
      onGrabbed(probe, saved, mode);
      onNote("Saved " + saved.filename);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That could not be fetched.");
    } finally {
      setBusy(null);
      setStage(null);
    }
  };

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-3 pb-16 pt-4 sm:px-5">
      <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-ink">
        Paste a link and take the file
      </h2>
      <p className="mt-1 max-w-[64ch] text-[12.5px] leading-relaxed text-ink-muted">
        For when you already have the video. The link is read first, so you can see what it is and
        what the site says about reusing it, and then it comes down as audio or as video.
      </p>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Icon.Link
            width={15}
            height={15}
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint"
          />
          <input
            ref={field}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onPaste={(e) => {
              // Read it the moment it lands; pasting IS the intent here.
              const text = e.clipboardData.getData("text").trim();
              if (LOOKS_LIKE_URL.test(text)) {
                e.preventDefault();
                setUrl(text);
                void read(text);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") void read(url);
            }}
            type="url"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            placeholder="https://www.youtube.com/watch?v=…"
            aria-label="Paste a video or audio link"
            disabled={!usable}
            className="w-full rounded-xl border border-line bg-panel py-3 pl-9 pr-3 text-[13.5px] text-ink shadow-[0_10px_30px_-22px_rgb(0_0_0_/_1)] transition placeholder:text-ink-faint focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 disabled:opacity-50"
          />
        </div>
        <button
          type="button"
          onClick={() => void read(url)}
          disabled={!usable || reading || !url.trim()}
          className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-line bg-panel-2 px-4 py-3 text-[13px] font-semibold text-ink transition hover:border-brand/50 hover:bg-brand/10 disabled:opacity-40 disabled:hover:border-line disabled:hover:bg-panel-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/70 sm:py-0"
        >
          {reading ? (
            <>
              <Icon.Refresh width={13} height={13} className="animate-spin" />
              Reading
            </>
          ) : (
            "Read the link"
          )}
        </button>
      </div>

      {!usable ? (
        <p className="mt-3 rounded-lg border border-amber-400/30 bg-amber-400/[0.07] px-3 py-2.5 text-[12.5px] leading-relaxed text-amber-200">
          {engine?.message ?? "yt-dlp is not available here."} Or set it up once on your own machine
          in the <span className="font-semibold">Your PC</span> tab, and this page will hand it the
          work.
        </p>
      ) : (
        <p className="mt-2 text-[11.5px] leading-relaxed text-ink-muted">
          {viaPc && (
            <span className="text-ink">
              Fetched by your PC{bridge?.online ? "" : " — which is not listening right now"}.{" "}
            </span>
          )}
          {sites.slice(0, 10).join(" · ")}
          {sites.length > 10 ? " and a few more." : "."} One video per link — a playlist or a
          channel is turned away.
        </p>
      )}

      {error && (
        <p className="mt-3 rounded-lg border border-amber-400/30 bg-amber-400/[0.07] px-3 py-2.5 text-[12.5px] leading-relaxed text-amber-200">
          {error}
        </p>
      )}

      {reading && !probe && (
        <div className="mt-4 flex items-center gap-3 rounded-xl border border-line bg-panel px-4 py-8">
          <Icon.Refresh width={18} height={18} className="animate-spin text-brand" />
          <p className="text-[13px] text-ink-muted">
            Asking the site what this is. Nothing is being downloaded yet.
          </p>
        </div>
      )}

      {probe && (
        <section className="mp3dl-locked mt-4 overflow-hidden rounded-xl border border-line bg-panel shadow-[0_24px_60px_-40px_rgb(0_0_0_/_1)]">
          <div className="grid gap-4 p-4 sm:grid-cols-[16rem_minmax(0,1fr)] sm:p-5">
            <div className="overflow-hidden rounded-lg border border-line bg-panel-2">
              {probe.thumbnail ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={probe.thumbnail}
                  alt=""
                  className="block aspect-video w-full object-cover"
                />
              ) : (
                <div className="flex aspect-video items-center justify-center">
                  <Icon.Film width={28} height={28} className="text-ink-faint" />
                </div>
              )}
            </div>

            <div className="min-w-0">
              <h3 className="text-balance text-[18px] font-semibold leading-tight tracking-[-0.01em] text-ink">
                {probe.title}
              </h3>
              <p className="mt-1 text-[13px] text-ink-muted">{probe.creator}</p>

              <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11.5px] text-ink-muted">
                <a
                  href={probe.pageUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center gap-1 rounded border border-line bg-panel-2 px-1.5 py-1 leading-none transition hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/70"
                >
                  {probe.siteLabel}
                  <Icon.Launch width={9} height={9} />
                </a>
                <span className="rounded border border-line bg-panel-2 px-1.5 py-1 font-mono leading-none tabular-nums">
                  {formatDuration(probe.durationMs)}
                </span>
                {probe.uploaded && (
                  <span className="rounded border border-line bg-panel-2 px-1.5 py-1 font-mono leading-none tabular-nums">
                    {probe.uploaded}
                  </span>
                )}
                {probe.approxBytes && (
                  <span className="rounded border border-line bg-panel-2 px-1.5 py-1 font-mono leading-none tabular-nums">
                    ~{formatBytes(probe.approxBytes)}
                  </span>
                )}
                <LicenceChip licence={probe.licence} />
              </div>

              {probe.partial && (
                <p className="mt-3 text-[11.5px] leading-snug text-ink-muted">
                  Read from {probe.siteLabel} itself, because this server has no yt-dlp — so the
                  length and the stated licence are unknown until your PC fetches it.
                </p>
              )}

              {probe.isLive && (
                <p className="mt-3 text-[12px] leading-snug text-amber-300">
                  This is a live stream. It has no end, so a download will run until the timeout.
                </p>
              )}

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <GrabButton
                  label="Audio · MP3"
                  primary
                  busy={busy === "audio"}
                  done={got.includes("audio")}
                  disabled={busy !== null}
                  onClick={() => void grab("audio")}
                />
                <GrabButton
                  label="Video · MP4"
                  busy={busy === "video"}
                  done={got.includes("video")}
                  disabled={busy !== null}
                  onClick={() => void grab("video")}
                />
                <button
                  type="button"
                  onClick={() => {
                    setProbe(null);
                    setUrl("");
                    setGot([]);
                    field.current?.focus();
                  }}
                  className="ml-auto rounded-md px-2 py-1.5 text-[11.5px] text-ink-muted underline decoration-line underline-offset-4 transition hover:text-ink hover:decoration-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/70"
                >
                  Another link
                </button>
              </div>

              {busy && (
                <p className="mt-2.5 text-[11.5px] leading-snug text-ink-muted">
                  {stage ??
                    (viaPc
                      ? "Handing it to your PC…"
                      : "Downloading and converting on this machine.")}{" "}
                  A long video takes a minute or two, and the file saves itself when it is done.
                </p>
              )}
            </div>
          </div>
        </section>
      )}
    </main>
  );
}

function GrabButton({
  label,
  primary,
  busy,
  done,
  disabled,
  onClick,
}: {
  label: string;
  primary?: boolean;
  busy: boolean;
  done: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex min-w-[8.5rem] items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-[13px] font-semibold transition",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/70 focus-visible:ring-offset-2 focus-visible:ring-offset-panel",
        busy && "cursor-progress",
        done
          ? "border border-core/40 bg-core/10 text-core"
          : primary
            ? "bg-brand text-white shadow-[0_8px_22px_-12px_rgb(99_102_241_/_1)] hover:bg-brand-2 disabled:opacity-60"
            : "border border-line bg-panel-2 text-ink hover:border-brand/50 hover:bg-brand/10 disabled:opacity-50",
      )}
    >
      {busy ? (
        <>
          <Icon.Refresh width={13} height={13} className="animate-spin" />
          Fetching
        </>
      ) : done ? (
        <>
          <Icon.Check width={13} height={13} />
          Saved
        </>
      ) : (
        <>
          <Icon.Download width={13} height={13} />
          {label}
        </>
      )}
    </button>
  );
}
