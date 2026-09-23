"use client";

// ---------------------------------------------------------------------------
// MP3 Download — search a song, confirm it is the right one, then get a file.
//
// The middle step is the app. Every downloader on the internet is a URL box
// and a button, which is why people end up with a sped-up edit, a cover, or a
// lyric video with a nine-second intro. Here the catalogue names the recording
// first — album, year, length, thirty seconds of the actual audio — and only
// then does anything get searched for, with every candidate scored against the
// thing you confirmed rather than against the words you typed.
// ---------------------------------------------------------------------------

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  downloadCandidate,
  fetchBridgeInfo,
  fetchYtdlpStatus,
  fileUrlFor,
  grabAnywhere,
  huntSources,
  searchSongs,
  type BridgeInfo,
  type GrabMode,
  type HuntResult,
  type LinkProbe,
  type Saved,
  type YtdlpStatus,
} from "@/lib/mp3-download/client";
import { formatBytes, formatDuration, releaseYear } from "@/lib/mp3-download/match";
import {
  clearLibrary,
  creditsText,
  forgetGrab,
  loadLibrary,
  recordGrab,
  LIBRARY_KEY,
} from "@/lib/mp3-download/store";
import type { Candidate, Grab, Track } from "@/lib/mp3-download/types";
import { useRemotePull } from "@/lib/sync/useSync";
import { cn, formatDate } from "@/lib/utils";
import { Icon } from "../icons";
import { LicenceChip } from "./bits";
import { Dossier } from "./Dossier";
import { LinkGrab } from "./LinkGrab";
import { ResultsTable } from "./ResultsTable";
import { SourceTable } from "./SourceTable";
import { usePlayer } from "./usePlayer";
import { YourPc } from "./YourPc";

const EXAMPLES = ["Moonlight Sonata", "Take Five Brubeck", "Rhapsody in Blue"];

/** A pasted address, as opposed to the name of a song. */
const LOOKS_LIKE_URL = /^https?:\/\/\S+$/i;

type Tab = "find" | "link" | "pc" | "library";

export function Mp3Download() {
  const [tab, setTab] = useState<Tab>("find");

  const [query, setQuery] = useState("");
  const [tracks, setTracks] = useState<Track[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [picked, setPicked] = useState<Track | null>(null);
  const [confirmed, setConfirmed] = useState<Track | null>(null);

  const [hunt, setHunt] = useState<HuntResult | null>(null);
  const [hunting, setHunting] = useState(false);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [doneIds, setDoneIds] = useState<Set<string>>(new Set());
  const [failure, setFailure] = useState<{ id: string; message: string } | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const [grabs, setGrabs] = useState<Grab[]>([]);
  const [engine, setEngine] = useState<(YtdlpStatus & { sites?: string[] }) | null>(null);
  const [bridge, setBridge] = useState<BridgeInfo | null>(null);
  /** A link the owner pasted into the search box, on its way to the paste tab. */
  const [handover, setHandover] = useState("");
  const player = usePlayer();
  const input = useRef<HTMLInputElement>(null);
  const searchSeq = useRef(0);

  const reloadLibrary = useCallback(() => setGrabs(loadLibrary().grabs), []);
  useEffect(reloadLibrary, [reloadLibrary]);
  useRemotePull(LIBRARY_KEY, reloadLibrary);

  // Asked once: the paste box needs to know whether yt-dlp is on this machine
  // before the owner pastes into a field that cannot do anything.
  useEffect(() => {
    void fetch("/api/mp3-download/link")
      .then((r) => r.json() as Promise<YtdlpStatus & { sites?: string[] }>)
      .then(setEngine)
      .catch(() => void fetchYtdlpStatus().then(setEngine).catch(() => undefined));
  }, []);

  const readBridge = useCallback(() => {
    void fetchBridgeInfo().then(setBridge).catch(() => undefined);
  }, []);
  useEffect(readBridge, [readBridge]);

  /** Where a YouTube grab will actually happen, in one word for the UI. */
  const grabHost: "here" | "pc" | "nowhere" = engine?.ok
    ? "here"
    : bridge?.hasToken
      ? "pc"
      : "nowhere";

  const stage = confirmed ? 3 : picked ? 2 : 1;

  // --- stage 1 -------------------------------------------------------------

  const runSearch = useCallback(async (text: string) => {
    const q = text.trim();
    const seq = ++searchSeq.current;
    // A pasted address is not a song title. Searching the catalogue for it
    // would return nothing and teach the owner that the app is broken.
    if (LOOKS_LIKE_URL.test(q)) {
      setTracks([]);
      setSearched(false);
      setSearchError(null);
      setSearching(false);
      return;
    }
    if (q.length < 2) {
      setTracks([]);
      setSearched(false);
      setSearchError(null);
      return;
    }
    setSearching(true);
    setSearchError(null);
    try {
      const found = await searchSongs(q);
      if (seq !== searchSeq.current) return; // a later keystroke already won
      setTracks(found);
      setSearched(true);
    } catch {
      if (seq !== searchSeq.current) return;
      setTracks([]);
      setSearched(true);
      setSearchError("The catalogue did not answer. Check the connection and try again.");
    } finally {
      if (seq === searchSeq.current) setSearching(false);
    }
  }, []);

  // Type-ahead, but unhurried: the catalogue is a remote service and a request
  // per keystroke would be rude to it and useless to the reader.
  useEffect(() => {
    const t = setTimeout(() => void runSearch(query), 380);
    return () => clearTimeout(t);
  }, [query, runSearch]);

  const previewTrack = (track: Track) => {
    if (!track.previewUrl) {
      setNote(`No preview clip for “${track.title}”.`);
      return;
    }
    player.toggle(track.id, track.previewUrl);
  };

  // --- stage 2 → 3 ---------------------------------------------------------

  const confirm = useCallback(
    async (track: Track) => {
      player.stop();
      setConfirmed(track);
      setHunt(null);
      setFailure(null);
      setHunting(true);
      try {
        setHunt(await huntSources(track));
      } catch {
        setHunt({
          candidates: [],
          checked: [],
          error: "The sources did not answer. Try searching again.",
        });
      } finally {
        setHunting(false);
      }
    },
    [player],
  );

  const restart = () => {
    player.stop();
    setPicked(null);
    setConfirmed(null);
    setHunt(null);
    setFailure(null);
    setDoneIds(new Set());
    input.current?.focus();
  };

  // --- stage 3 -------------------------------------------------------------

  const download = async (candidate: Candidate) => {
    if (!confirmed) return;
    setFailure(null);

    const remember = (filename: string, bytes: number | null) => {
      recordGrab({
        title: confirmed.title,
        artist: confirmed.artist,
        filename,
        provider: candidate.provider,
        providerLabel: candidate.providerLabel,
        pageUrl: candidate.pageUrl,
        fileUrl: candidate.fileUrl,
        format: candidate.format,
        bytes,
        licence: candidate.licence,
      });
      reloadLibrary();
      setDoneIds((prev) => new Set(prev).add(candidate.id));
      setNote(`Saved ${filename}`);
    };

    // Every row waits for the bytes now, YouTube or not. The direct sources
    // used to be fired off and recorded immediately, which meant a download
    // that never arrived still appeared in the library as though it had.
    setBusyId(candidate.id);
    try {
      const saved =
        candidate.provider === "youtube"
          ? await grabAnywhere(
              {
                url: candidate.fileUrl,
                mode: "audio",
                title: confirmed.title,
                creator: confirmed.artist,
                track: confirmed,
              },
              engine,
              bridge,
              (state) =>
                setNote(
                  state === "queued"
                    ? bridge?.online
                      ? "Sent to your PC…"
                      : "Queued — waiting for your PC to wake up."
                    : state === "running"
                      ? "Your PC is fetching it…"
                      : "",
                ),
            )
          : await downloadCandidate(confirmed, candidate);
      remember(saved.filename, saved.bytes);
    } catch (err) {
      setFailure({
        id: candidate.id,
        message: err instanceof Error ? err.message : "That download failed.",
      });
    } finally {
      setBusyId(null);
    }
  };

  const recheck = () => {
    if (confirmed) void confirm(confirmed);
  };

  /** A paste-box grab lands in the same library, with the same provenance. */
  const rememberLink = (probe: LinkProbe, saved: Saved, mode: GrabMode) => {
    recordGrab({
      title: probe.title,
      artist: probe.creator,
      filename: saved.filename,
      provider: "youtube",
      providerLabel: probe.siteLabel,
      pageUrl: probe.pageUrl,
      fileUrl: probe.pageUrl,
      format: mode === "video" ? "MP4" : "MP3",
      bytes: saved.bytes,
      licence: probe.licence,
    });
    reloadLibrary();
  };

  const openLinkTab = (pasted: string) => {
    player.stop();
    setHandover(pasted);
    setTab("link");
  };

  const credits = useMemo(() => creditsText(grabs), [grabs]);

  // --- render --------------------------------------------------------------

  return (
    <div className="mp3dl flex min-h-dvh flex-col bg-canvas">
      <TopBar tab={tab} setTab={setTab} libraryCount={grabs.length} />

      {/* The rail describes the search flow's three steps. On the paste tab and
          in the library there are no steps, and a progress bar for a journey
          you are not on is furniture pretending to be information. */}
      {tab === "find" && (
        <StageRail
          stage={stage}
          onJump={(target) => {
            if (target === 1) restart();
            else if (target === 2 && confirmed) {
              player.stop();
              setPicked(confirmed);
              setConfirmed(null);
            }
          }}
        />
      )}

      {tab === "link" ? (
        <LinkGrab
          engine={engine}
          bridge={bridge}
          sites={engine?.sites ?? []}
          initialUrl={handover}
          onGrabbed={rememberLink}
          onNote={setNote}
        />
      ) : tab === "pc" ? (
        <YourPc engineOk={engine?.ok ?? false} onNote={setNote} onChanged={readBridge} />
      ) : tab === "library" ? (
        <Library
          grabs={grabs}
          credits={credits}
          onForget={(id) => {
            forgetGrab(id);
            reloadLibrary();
          }}
          onClear={() => {
            clearLibrary();
            reloadLibrary();
          }}
          onNote={setNote}
        />
      ) : (
        <main className="mx-auto w-full max-w-6xl flex-1 px-3 pb-16 pt-4 sm:px-5">
          {/* Stage 1 is always reachable: the query bar never leaves. */}
          <div className="relative">
            <Icon.Search
              width={15}
              height={15}
              aria-hidden
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint"
            />
            <input
              ref={input}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void runSearch(query);
              }}
              type="search"
              autoComplete="off"
              placeholder="Name the song — title, or title and artist"
              aria-label="Search for a song"
              className="w-full rounded-xl border border-line bg-panel py-3 pl-9 pr-24 text-[14px] text-ink shadow-[0_10px_30px_-22px_rgb(0_0_0_/_1)] transition placeholder:text-ink-faint hover:border-line focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
            />
            {searching && (
              <span className="absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-1.5 text-[11px] text-ink-muted">
                <Icon.Refresh width={12} height={12} className="animate-spin" />
                Searching
              </span>
            )}
          </div>

          {LOOKS_LIKE_URL.test(query.trim()) && (
            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-brand/30 bg-brand/[0.07] px-3 py-2.5">
              <p className="text-[12.5px] text-ink">
                That is a link, not a song name — the paste box can take it straight.
              </p>
              <button
                type="button"
                onClick={() => openLinkTab(query.trim())}
                className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-brand px-2.5 py-1.5 text-[12px] font-semibold text-white transition hover:bg-brand-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/70"
              >
                Grab this link
                <Icon.ArrowRight width={12} height={12} />
              </button>
            </div>
          )}

          {searchError && (
            <p className="mt-3 rounded-lg border border-amber-400/30 bg-amber-400/[0.07] px-3 py-2 text-[12.5px] text-amber-200">
              {searchError}
            </p>
          )}

          {/* Stage 2/3 ride above the results so the confirmed song stays put. */}
          {picked && !confirmed && (
            <section className="mt-4 overflow-hidden rounded-xl border border-line bg-panel shadow-[0_24px_60px_-40px_rgb(0_0_0_/_1)]">
              <Dossier
                track={picked}
                playing={player.id === picked.id && player.playing}
                loading={player.id === picked.id && player.loading}
                position={player.id === picked.id ? player.position : 0}
                duration={player.id === picked.id ? player.duration : 0}
                error={player.id === picked.id ? player.error : null}
                onToggle={() => previewTrack(picked)}
                onSeek={player.seek}
                onConfirm={() => void confirm(picked)}
                onReject={() => {
                  player.stop();
                  setPicked(null);
                }}
              />
            </section>
          )}

          {confirmed && (
            <section className="mt-4">
              <ConfirmedBar track={confirmed} onChange={restart} />
              <div className="mt-3 overflow-hidden rounded-xl border border-line bg-panel shadow-[0_24px_60px_-40px_rgb(0_0_0_/_1)]">
                {hunting ? (
                  <Hunting track={confirmed} />
                ) : (
                  <SourceTable
                    track={confirmed}
                    candidates={hunt?.candidates ?? []}
                    checked={hunt?.checked ?? []}
                    playingId={player.id}
                    playing={player.playing}
                    audioLoading={player.loading}
                    busyId={busyId}
                    doneIds={doneIds}
                    failure={failure}
                    onPreview={(c) => player.toggle(c.id, fileUrlFor(confirmed, c))}
                    onDownload={(c) => void download(c)}
                    onRecheck={recheck}
                    rechecking={hunting}
                  />
                )}
              </div>
            </section>
          )}

          {/* Results stay visible under stage 2 so switching takes one click. */}
          {!confirmed && (
            <section className="mt-4 overflow-hidden rounded-xl border border-line bg-panel">
              {tracks.length > 0 ? (
                <ResultsTable
                  tracks={tracks}
                  playingId={player.id}
                  playing={player.playing}
                  loading={player.loading}
                  onPreview={previewTrack}
                  onPick={(t) => {
                    player.stop();
                    setPicked(t);
                  }}
                  pickedId={picked?.id ?? null}
                />
              ) : searched && !searching ? (
                <p className="px-4 py-10 text-center text-[13px] text-ink-muted">
                  Nothing in the catalogue matches “{query.trim()}”. Try the artist's name too.
                </p>
              ) : (
                <FirstRun onExample={(q) => setQuery(q)} />
              )}
            </section>
          )}
        </main>
      )}

      {note && <Toast text={note} onDismiss={() => setNote(null)} />}
    </div>
  );
}

// --- chrome ----------------------------------------------------------------

function TopBar({
  tab,
  setTab,
  libraryCount,
}: {
  tab: Tab;
  setTab: (t: Tab) => void;
  libraryCount: number;
}) {
  return (
    <div className="flex items-center gap-2 border-b border-line bg-panel px-3 py-2.5 sm:px-4">
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-ink-muted transition hover:bg-panel-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/70"
        aria-label="Back to hub"
      >
        <Icon.ArrowLeft width={14} height={14} />
        <span className="hidden sm:inline">Hub</span>
      </Link>
      <span className="ml-1 whitespace-nowrap text-sm font-semibold text-ink">MP3 Download</span>

      <nav className="ml-auto flex items-center gap-1" aria-label="Sections">
        {(
          [
            { id: "find", label: "Find a song", icon: <Icon.Search width={12} height={12} /> },
            { id: "link", label: "Paste a link", icon: <Icon.Link width={12} height={12} /> },
            { id: "pc", label: "Your PC", icon: <Icon.Server width={12} height={12} /> },
            {
              id: "library",
              label: "Library",
              icon: <Icon.Database width={12} height={12} />,
              count: libraryCount,
            },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            aria-current={tab === t.id ? "page" : undefined}
            // The label is the icon's caption on a wide screen and redundant
            // with it on a phone, where two wrapped tabs would own the bar.
            aria-label={t.label}
            title={t.label}
            className={cn(
              "inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 py-1.5 text-xs font-medium transition",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/70",
              tab === t.id
                ? "border-brand/50 bg-brand/15 text-ink"
                : "border-transparent text-ink-muted hover:bg-panel-2 hover:text-ink",
            )}
          >
            {t.icon}
            <span className="hidden sm:inline">{t.label}</span>
            {"count" in t && t.count > 0 && (
              <span className="rounded bg-panel-2 px-1 font-mono text-[10px] tabular-nums text-ink-muted">
                {t.count}
              </span>
            )}
          </button>
        ))}
      </nav>
    </div>
  );
}

const STAGES = [
  { n: 1, label: "Search" },
  { n: 2, label: "Confirm" },
  { n: 3, label: "Download" },
];

function StageRail({ stage, onJump }: { stage: number; onJump: (n: number) => void }) {
  return (
    <div className="border-b border-line bg-panel/60">
      <div className="mx-auto flex w-full max-w-6xl items-center gap-3 px-3 py-2 sm:px-5">
        {STAGES.map((s, i) => {
          const state = s.n < stage ? "done" : s.n === stage ? "now" : "todo";
          return (
            <div key={s.n} className="flex flex-1 items-center gap-3 last:flex-none">
              <button
                type="button"
                onClick={() => state === "done" && onJump(s.n)}
                disabled={state !== "done"}
                className={cn(
                  "inline-flex items-center gap-2 rounded-md px-1.5 py-1 text-[11.5px] transition",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/70",
                  state === "done" && "cursor-pointer text-ink-muted hover:text-ink",
                  state === "now" && "font-semibold text-ink",
                  state === "todo" && "cursor-default text-ink-faint",
                )}
              >
                <span
                  className={cn(
                    "inline-flex h-5 w-5 items-center justify-center rounded-full border font-mono text-[10px] tabular-nums transition",
                    state === "done" && "border-core/50 bg-core/15 text-core",
                    state === "now" && "border-brand bg-brand text-white",
                    state === "todo" && "border-line text-ink-faint",
                  )}
                >
                  {state === "done" ? <Icon.Check width={10} height={10} /> : s.n}
                </span>
                {s.label}
              </button>

              {i < STAGES.length - 1 && (
                <span className="relative h-px flex-1 bg-line">
                  <span
                    className="mp3dl-spine absolute inset-y-0 left-0 bg-core/70"
                    style={{ width: s.n < stage ? "100%" : "0%" }}
                  />
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ConfirmedBar({ track, onChange }: { track: Track; onChange: () => void }) {
  return (
    <div className="mp3dl-locked flex items-center gap-3 rounded-xl border border-brand/30 bg-brand/[0.07] px-3 py-2.5">
      {track.artworkUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={track.artworkUrl}
          alt=""
          width={40}
          height={40}
          className="h-10 w-10 shrink-0 rounded border border-line object-cover"
        />
      ) : (
        <span className="h-10 w-10 shrink-0 rounded border border-line bg-panel-2" />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13.5px] font-semibold leading-tight text-ink">{track.title}</p>
        <p className="mt-0.5 truncate text-[11.5px] leading-tight text-ink-muted">
          {track.artist}
          {track.album ? " · " + track.album : ""} · {releaseYear(track.releaseDate)} ·{" "}
          <span className="font-mono tabular-nums">{formatDuration(track.durationMs)}</span>
        </p>
      </div>
      <button
        type="button"
        onClick={onChange}
        className="shrink-0 rounded-md border border-line bg-panel px-2 py-1 text-[11.5px] font-medium text-ink-muted transition hover:bg-panel-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/70"
      >
        Different song
      </button>
    </div>
  );
}

function Hunting({ track }: { track: Track }) {
  return (
    <div className="px-4 py-14 text-center">
      <Icon.Refresh width={20} height={20} className="mx-auto animate-spin text-brand" />
      <p className="mt-3 text-[13.5px] font-semibold text-ink">
        Looking for a file of “{track.title}”
      </p>
      <p className="mx-auto mt-1.5 max-w-[52ch] text-[12px] leading-relaxed text-ink-muted">
        Internet Archive, the Creative Commons catalogues, and YouTube through yt-dlp. Every hit is
        scored against the album, artist and length you just confirmed.
      </p>
    </div>
  );
}

function FirstRun({ onExample }: { onExample: (q: string) => void }) {
  return (
    <div className="px-4 py-12 text-center">
      <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-ink">
        Name a song and this finds you a file of it
      </h2>
      <p className="mx-auto mt-2 max-w-[58ch] text-[12.5px] leading-relaxed text-ink-muted">
        The catalogue confirms which recording you mean — the right album, the right year, the right
        length — and only then is anything searched for, so a cover or a sped-up edit cannot be
        handed to you by mistake. Every file arrives with its licence attached.
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        {EXAMPLES.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => onExample(q)}
            className="rounded-full border border-line bg-panel-2 px-3 py-1.5 text-[12px] text-ink-muted transition hover:border-brand/40 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/70"
          >
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}

// --- library ---------------------------------------------------------------

function Library({
  grabs,
  credits,
  onForget,
  onClear,
  onNote,
}: {
  grabs: Grab[];
  credits: string;
  onForget: (id: string) => void;
  onClear: () => void;
  onNote: (text: string) => void;
}) {
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-3 pb-16 pt-4 sm:px-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-ink">
            Everything you have pulled down
          </h2>
          <p className="mt-1 max-w-[62ch] text-[12.5px] leading-relaxed text-ink-muted">
            The audio is wherever your browser saves downloads. This is the provenance — six months
            from now, “can I use this in a client's video?” is a question about these rows, and a
            filename cannot answer it.
          </p>
        </div>
        {grabs.length > 0 && (
          <div className="flex items-center gap-2">
            {credits && (
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard?.writeText(credits);
                  onNote("Credit lines copied.");
                }}
                className="inline-flex items-center gap-1.5 rounded-md border border-line bg-panel-2 px-2.5 py-1.5 text-[12px] font-medium text-ink-muted transition hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/70"
              >
                <Icon.Copy width={12} height={12} />
                Copy credit lines
              </button>
            )}
            <button
              type="button"
              onClick={onClear}
              className="inline-flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5 text-[12px] font-medium text-ink-muted transition hover:border-amber-400/40 hover:text-amber-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/70"
            >
              <Icon.Trash width={12} height={12} />
              Clear
            </button>
          </div>
        )}
      </div>

      <div className="mt-4 overflow-hidden rounded-xl border border-line bg-panel">
        {grabs.length === 0 ? (
          <p className="px-4 py-12 text-center text-[13px] text-ink-muted">
            Nothing yet. Confirm a song and download a file, and it is recorded here with its
            licence.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[46rem] border-collapse text-left">
              <thead>
                <tr className="border-b border-line text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
                  <th scope="col" className="py-2 pl-3 pr-3 font-semibold">
                    Song
                  </th>
                  <th scope="col" className="py-2 pr-3 font-semibold">
                    Source &amp; licence
                  </th>
                  <th scope="col" className="w-20 py-2 pr-3 text-right font-semibold">
                    Size
                  </th>
                  <th scope="col" className="w-28 py-2 pr-3 text-right font-semibold">
                    Grabbed
                  </th>
                  <th scope="col" className="w-10 py-2 pr-3" />
                </tr>
              </thead>
              <tbody>
                {grabs.map((g) => (
                  <tr
                    key={g.id}
                    className="group border-b border-line-soft align-middle transition-colors last:border-0 hover:bg-panel-2/60"
                  >
                    <td className="max-w-[22rem] py-2 pl-3 pr-3">
                      <span className="block truncate text-[13px] font-medium text-ink">
                        {g.title}
                      </span>
                      <span className="mt-0.5 block truncate font-mono text-[10.5px] text-ink-muted">
                        {g.filename}
                      </span>
                    </td>
                    <td className="py-2 pr-3">
                      <span className="flex flex-wrap items-center gap-1.5 text-[11.5px] text-ink-muted">
                        <a
                          href={g.pageUrl}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="inline-flex items-center gap-1 rounded underline decoration-line underline-offset-[3px] transition hover:text-ink hover:decoration-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/70"
                        >
                          {g.providerLabel}
                          <Icon.Launch width={9} height={9} />
                        </a>
                        <LicenceChip licence={g.licence} />
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-right font-mono text-[11.5px] tabular-nums text-ink-muted">
                      {formatBytes(g.bytes)}
                    </td>
                    <td className="py-2 pr-3 text-right text-[11.5px] text-ink-muted">
                      {formatDate(g.at)}
                    </td>
                    <td className="py-2 pr-3 text-right">
                      <button
                        type="button"
                        onClick={() => onForget(g.id)}
                        aria-label={"Remove " + g.title + " from the library"}
                        className="rounded p-1 text-ink-faint transition hover:bg-panel-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/70 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
                      >
                        <Icon.Trash width={13} height={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}

// --- toast -----------------------------------------------------------------

function Toast({ text, onDismiss }: { text: string; onDismiss: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 4200);
    return () => clearTimeout(t);
  }, [text, onDismiss]);

  return (
    <div
      role="status"
      className="pointer-events-none fixed inset-x-0 bottom-5 z-50 flex justify-center px-4"
    >
      <p className="pointer-events-auto max-w-[90vw] truncate rounded-lg border border-line bg-elevated px-3 py-2 text-[12.5px] text-ink shadow-[0_18px_44px_-20px_rgb(0_0_0_/_1)]">
        {text}
      </p>
    </div>
  );
}
