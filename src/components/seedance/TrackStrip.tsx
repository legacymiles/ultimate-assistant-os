"use client";

// ---------------------------------------------------------------------------
// The track, across the top of the conversation.
//
// It is pinned rather than scrolled away with the first message, because it is
// the one thing every later turn is measured against: the tempo the cuts land
// on, the sections, and whether there are words yet. A board further down the
// page is unreadable without knowing which of those are true.
//
// The strip is also where the honesty about the pipeline lives. Three states,
// and it never blurs them:
//
//   MEASURED   free, local, always true. Tempo, key, bar lines, sections, drops.
//   HEARD      a listening model transcribed the words. Costs a key, timings are
//              close rather than frame-accurate, and the strip says so.
//   PASTED     the owner supplied the words and they were SPREAD over the sung
//              sections. Nothing heard them; the strip says that too.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "../icons";
import { timecode } from "@/lib/seedance/constants";
import { alignPastedLyrics, analyzeSong, withLines } from "@/lib/seedance/audio/analyze.client";
import { transcribeSong } from "@/lib/seedance/audio/transcribe";
import { VISUAL_MODES, type AudioTimeline, type VisualMode } from "@/lib/seedance/audio/timeline";
import type { LoadedAudio } from "@/lib/soundprint/audio-analysis";

export function TrackStrip({
  file,
  timeline,
  audio,
  mode,
  onMode,
  onTimeline,
  onAudio,
  onFile,
  onProblem,
  compact = false,
}: {
  file: File | null;
  timeline: AudioTimeline | null;
  audio: LoadedAudio | null;
  mode: VisualMode;
  onMode: (m: VisualMode) => void;
  onTimeline: (t: AudioTimeline | null) => void;
  onAudio: (a: LoadedAudio | null) => void;
  onFile: (f: File | null) => void;
  onProblem: (s: string) => void;
  /** Docked in the 360px rail rather than across a page. */
  compact?: boolean;
}) {
  const [measuring, setMeasuring] = useState(false);
  const [listening, setListening] = useState<{ done: number; total: number } | null>(null);
  const [pasting, setPasting] = useState(false);
  const [lyrics, setLyrics] = useState("");
  const [open, setOpen] = useState(false);
  const pickRef = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);

  const measure = useCallback(
    async (f: File) => {
      setMeasuring(true);
      onProblem("");
      try {
        const { timeline: t, audio: a } = await analyzeSong(f);
        onAudio(a);
        onTimeline(t);
      } catch (e) {
        onProblem(e instanceof Error ? e.message : "That track couldn't be decoded.");
        onFile(null);
      } finally {
        setMeasuring(false);
      }
    },
    [onAudio, onTimeline, onFile, onProblem],
  );

  // The song arrives from the composer's attachments, so measuring is kicked off
  // by its appearance rather than by a button: the strip owns every state the
  // track can be in, and "attached but not yet measured" is one of them.
  //
  // `measuredFor` rather than `timeline === null` as the guard, because the two
  // are not the same question — swapping to a second song leaves the first
  // song's timeline in place, which would look measured and never re-measure.
  const measuredFor = useRef<File | null>(null);
  useEffect(() => {
    if (!file || measuredFor.current === file) return;
    measuredFor.current = file;
    void measure(file);
  }, [file, measure]);

  async function listen() {
    if (!audio || !timeline) return;
    abort.current = new AbortController();
    setListening({ done: 0, total: 1 });
    try {
      const out = await transcribeSong(audio, {
        hint: timeline.name,
        known: lyrics.trim() || undefined,
        onProgress: setListening,
        signal: abort.current.signal,
      });
      onTimeline(
        withLines(timeline, out.lines, out.heard ? "heard" : "none", out.note),
      );
      if (out.note) onProblem(out.note);
      else if (!out.lines.length) {
        onProblem("Nothing intelligible was heard — it may be instrumental. Paste the lyrics if it isn't.");
      }
    } catch (e) {
      onProblem(e instanceof Error ? e.message : "Transcribing failed.");
    } finally {
      setListening(null);
      abort.current = null;
    }
  }

  function applyPasted() {
    if (!timeline) return;
    const lines = alignPastedLyrics(timeline, lyrics);
    if (!lines.length) {
      onProblem("No lyric lines in that — one line per line.");
      return;
    }
    onTimeline(
      withLines(
        timeline,
        lines,
        "pasted",
        "The lyrics are the owner's own, spread evenly over the sung sections — nothing heard them, so "
          + "the times are approximate. Treat the WORDS as exact and the TIMING as a starting point.",
      ),
    );
    setPasting(false);
    onProblem("");
  }

  // ----- nothing yet -----
  if (!file && !timeline) {
    return (
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <Icon.Waveform width={14} height={14} className="text-accent" />
        <span className="text-xs text-ink">No track yet.</span>
        <span className="text-[11px] text-ink-faint">
          Drop a song, or attach one below — it is measured here and never uploaded.
        </span>
        <button
          onClick={() => pickRef.current?.click()}
          className="ml-auto rounded-lg border border-line px-2.5 py-1 text-xs text-ink-muted transition hover:border-accent hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Choose a file
        </button>
        <input
          ref={pickRef}
          type="file"
          accept="audio/*"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) onFile(f);
          }}
        />
      </div>
    );
  }

  const words = timeline?.lines?.length ?? 0;
  const source = timeline?.lyricSource ?? "none";

  return (
    <div className="border-b border-line">
      <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 ${compact ? "text-[11px]" : ""}`}>
        <Icon.Waveform width={14} height={14} className="shrink-0 text-accent" />
        <span className="min-w-0 truncate text-xs font-medium text-ink">
          {timeline?.name ?? file?.name ?? "Track"}
        </span>

        {measuring && (
          <span className="flex items-center gap-1.5 text-[11px] text-ink-muted">
            <Icon.Refresh width={11} height={11} className="animate-spin" />
            Measuring tempo, sections and drops…
          </span>
        )}

        {timeline && (
          <>
            <span className="flex flex-wrap items-center gap-x-2 text-[11px] tabular-nums text-ink-faint">
              <span>{timecode(timeline.durationSec)}</span>
              {timeline.bpm ? (
                <span title={`Confidence ${(timeline.bpmConfidence * 100).toFixed(0)}%`}>
                  {timeline.bpm} BPM
                </span>
              ) : (
                <span>free time</span>
              )}
              {timeline.key && <span>{timeline.key}</span>}
              <span>{timeline.sections.length} sections</span>
              <span>{timeline.hits.filter((h) => h.drop).length} drops</span>
              <span
                className={timeline.grid.confidence >= 0.4 ? "text-accent" : "text-[#f0c674]"}
                title={
                  timeline.grid.confidence >= 0.4
                    ? "The beat grid is solid, so cuts can be snapped to bar lines."
                    : "No reliable pulse — cut on meaning rather than on bars."
                }
              >
                grid {Math.round(timeline.grid.confidence * 100)}%
              </span>
            </span>

            <span
              className="rounded px-1.5 py-0.5 text-[10px] font-medium"
              style={
                words
                  ? { background: "hsl(36 92% 58% / 0.18)", color: "hsl(40 96% 78%)" }
                  : { background: "var(--color-panel-2)", color: "var(--color-ink-faint)" }
              }
              title={
                source === "heard"
                  ? "A listening model transcribed these. Timings are close, not frame-accurate."
                  : source === "pasted"
                    ? "Your own lyrics, spread over the sung sections. The words are exact; the times are a starting point."
                    : "No words yet — the film will be cut from the measurements alone."
              }
            >
              {words ? `${words} lines · ${source}` : "no words"}
            </span>
          </>
        )}

        <div className={`flex items-center gap-1.5 ${compact ? "w-full" : "ml-auto"}`}>
          {timeline && (
            <>
              <button
                onClick={() => (listening ? abort.current?.abort() : void listen())}
                disabled={!audio}
                className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-xs text-ink-muted transition hover:border-accent hover:text-ink disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                title={
                  audio
                    ? "Send 40-second clips to a listening model and get the words with their times"
                    : "The decoded audio is gone from this session — drop the file in again to transcribe it"
                }
              >
                {listening ? (
                  <>
                    <Icon.Refresh width={11} height={11} className="animate-spin" />
                    {listening.total > 1 ? `${listening.done}/${listening.total}` : "Listening…"} · stop
                  </>
                ) : (
                  <>
                    <Icon.Mic width={11} height={11} />
                    {words ? "Transcribe again" : "Transcribe"}
                  </>
                )}
              </button>
              <button
                onClick={() => setPasting((v) => !v)}
                aria-expanded={pasting}
                className="rounded-lg border border-line px-2.5 py-1 text-xs text-ink-muted transition hover:border-ink-faint hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                Paste lyrics
              </button>
            </>
          )}
          <button
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="inline-flex items-center gap-1 rounded-lg border border-line px-2.5 py-1 text-xs text-ink-muted transition hover:border-ink-faint hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            {VISUAL_MODES.find((m) => m.id === mode)?.label ?? "Mode"}
            <Icon.Chevron width={10} height={10} className={open ? "rotate-180" : ""} />
          </button>
        </div>
      </div>

      {open && (
        <div className="grid gap-1 border-t border-line px-3 py-2 sm:grid-cols-3">
          {VISUAL_MODES.map((m) => (
            <button
              key={m.id}
              onClick={() => {
                onMode(m.id);
                setOpen(false);
              }}
              aria-pressed={mode === m.id}
              className={`rounded-lg border px-2.5 py-1.5 text-left transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                mode === m.id ? "border-accent bg-panel-2" : "border-line hover:border-ink-faint"
              }`}
            >
              <span className="block text-xs font-medium text-ink">{m.label}</span>
              <span className="block text-[10px] leading-snug text-ink-faint">{m.note}</span>
            </button>
          ))}
        </div>
      )}

      {pasting && (
        <div className="border-t border-line px-3 py-2">
          <label className="block">
            <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-ink-faint">
              The words, one line per line. Bracketed markers like [Chorus] are ignored.
            </span>
            <textarea
              value={lyrics}
              onChange={(e) => setLyrics(e.target.value)}
              rows={6}
              placeholder={"I woke up thinking about you\nNow I'm driving through the city"}
              className="w-full rounded-lg border border-line bg-panel px-2 py-1.5 text-xs text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
            />
          </label>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <button
              onClick={applyPasted}
              disabled={!lyrics.trim()}
              className="rounded-lg bg-accent px-2.5 py-1 text-xs font-semibold text-[#06121a] transition hover:bg-accent-2 disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              Spread these over the sung sections
            </button>
            <button
              onClick={() => void listen()}
              disabled={!lyrics.trim() || !audio || Boolean(listening)}
              className="rounded-lg border border-line px-2.5 py-1 text-xs text-ink-muted transition hover:border-accent hover:text-ink disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              title="Better: the model keeps your exact words and only works out when each one is sung"
            >
              Use these words and let the model time them
            </button>
            <span className="text-[10px] text-ink-faint">
              Timing them is more accurate than spreading them.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
