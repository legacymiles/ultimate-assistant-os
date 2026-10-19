"use client";

// Stage 5 — Watch: the film itself, plus every film made with this flow.

import { useState } from "react";
import { Icon } from "../../icons";
import type { Film, KidsFlow } from "@/lib/studio/kids-flow/useKidsFlow";
import { KIDS_FOLDER } from "@/lib/studio/kids-flow/useKidsFlow";

function when(iso: string): string {
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60_000);
  if (mins < 60) return `${Math.max(1, mins)}m ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function hasVideo(f: Film): boolean {
  return f.kind === "done" ? Boolean(f.finished.video) : Boolean(f.request.video);
}

function statusOf(f: Film): string {
  if (f.kind === "done") return f.finished.video ? "Ready to watch" : "Finished";
  if (f.request.video) return "Video back";
  return f.request.status === "working" ? "Rendering on your PC" : "Waiting for your PC";
}

export function WatchStage({ flow }: { flow: KidsFlow }) {
  const film = flow.job;
  const [ask, setAsk] = useState("");
  const [asked, setAsked] = useState<string | null>(null);

  if (!film) {
    return (
      <div className="space-y-3">
        <h3 className="text-[15px] font-semibold text-ink">Your films</h3>
        <div className="rounded-xl border border-line bg-panel lg:hidden">
          <FilmList flow={flow} />
        </div>
        <p className="hidden text-[12px] text-ink-muted lg:block">Pick a film on the right, or make one — start at Character.</p>
      </div>
    );
  }

  const queueAsk = () => {
    if (!ask.trim()) return;
    const text = `Changes to "${film.title}" (${film.id}) — re-render with the animate-character-story skill, same character and piece:\n${ask.trim()}`;
    void flow.requests.add(KIDS_FOLDER, text).then((added) => {
      if (added.length) {
        setAsk("");
        setAsked(`Queued as ${added[0].id}. Your PC picks it up with the rest of the queue.`);
      }
    });
  };

  const src = `/api/new-jarvis/requests/watch?id=${encodeURIComponent(film.id)}`;
  const video = hasVideo(film);
  const result = film.kind === "done" ? film.finished.result : undefined;

  return (
    <section aria-labelledby="kf-watch" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 id="kf-watch" className="text-[15px] font-semibold text-ink">{film.title}</h3>
          <p className="text-[11px] text-ink-faint">{statusOf(film)} · {when(film.at)} · {film.id}</p>
        </div>
        <div className="flex gap-2">
          {video && (
            <a className="kf-ghost" href={`${src}&download=1`}>
              <Icon.Download width={12} height={12} aria-hidden /> Download MP4
            </a>
          )}
          <button type="button" className="kf-go" onClick={flow.newStory}>
            <Icon.Plus width={12} height={12} aria-hidden /> New story, same hero
          </button>
        </div>
      </div>

      {video ? (
        <video key={film.id} src={src} controls playsInline className="w-full rounded-xl border border-line bg-black" />
      ) : (
        <div className="grid aspect-video place-items-center rounded-xl border border-dashed border-line bg-panel/60 p-6 text-center">
          <div>
            <p className="text-[13px] text-ink">{film.kind === "done" ? "Finished, but no video came back." : "Not back yet."}</p>
            <p className="mt-1 max-w-md text-[11.5px] text-ink-muted">
              {film.kind === "done"
                ? result ?? "The PC finished this without uploading the file. It's on the PC in ~/Videos/animate/out."
                : "Your PC renders it the next time Claude Code works the queue. This page updates by itself."}
            </p>
            {film.kind === "open" && (
              <button type="button" className="kf-ghost mt-3" onClick={() => flow.go("render")}>See progress</button>
            )}
          </div>
        </div>
      )}

      {result && video && <p className="text-[11.5px] text-ink-muted">{result}</p>}

      <div className="rounded-xl border border-line bg-panel p-3">
        <label className="kf-label" htmlFor="kf-ask">Want changes? Ask for them</label>
        <div className="flex gap-2">
          <input
            id="kf-ask"
            className="kf-field"
            value={ask}
            onChange={(e) => setAsk(e.target.value)}
            placeholder="Make him wave at the end, and slow down the forest bit"
            onKeyDown={(e) => {
              if (e.key === "Enter") queueAsk();
            }}
          />
          <button
            type="button"
            className="kf-ghost shrink-0"
            disabled={!ask.trim()}
            onClick={queueAsk}
          >
            <Icon.Send width={11} height={11} aria-hidden /> Queue it
          </button>
        </div>
        {asked && <p className="mt-1.5 text-[11px] text-ink-faint">{asked}</p>}
      </div>
    </section>
  );
}

export function FilmList({ flow }: { flow: KidsFlow }) {
  const { films, jobId } = flow;
  return (
    <div className="p-2">
      <p className="px-1.5 pb-1.5 pt-1 text-[10.5px] font-semibold uppercase tracking-wide text-ink-muted">Your films</p>
      {films.length === 0 ? (
        <p className="px-1.5 py-2 text-[11.5px] text-ink-faint">Nothing made yet. Finished films land here.</p>
      ) : (
        <ul className="space-y-0.5">
          {films.map((f) => (
            <li key={f.id}>
              <button
                type="button"
                onClick={() => flow.openFilm(f.id)}
                aria-current={jobId === f.id ? "true" : undefined}
                className={`flex w-full items-start gap-2 rounded-lg px-1.5 py-1.5 text-left transition hover:bg-elevated ${jobId === f.id ? "bg-elevated" : ""}`}
              >
                <span
                  className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${hasVideo(f) ? "bg-emerald-400" : f.kind === "open" && f.request.status === "working" ? "bg-[var(--kf-hero)]" : "bg-ink-faint"}`}
                  aria-hidden
                />
                <span className="min-w-0">
                  <span className="block truncate text-[12px] text-ink">{f.title}</span>
                  <span className="block text-[10.5px] text-ink-faint">{statusOf(f)} · {when(f.at)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
