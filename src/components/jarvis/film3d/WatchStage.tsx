"use client";

// Stage 5 — Watch: the finished film (from this browser or from the PC), its
// download, changes on request, and every film made with this flow.

import { useState } from "react";
import { Icon } from "../../icons";
import { FILM3D_FOLDER, type Film, type Film3DFlow } from "@/lib/studio/film3d/useFilm3D";

function when(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 60) return `${Math.max(1, mins)}m ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function hasVideo(f: Film): boolean {
  return f.kind === "done" ? Boolean(f.finished.video) : Boolean(f.request.video);
}

function statusOf(f: Film): string {
  if (f.kind === "done") return f.finished.video ? (f.finished.by === "this browser" ? "Made in the browser" : "Ready to watch") : "Finished";
  if (f.request.video) return "Video back";
  return f.request.status === "working" ? "Rendering on your PC" : "Waiting for your PC";
}

export function WatchStage({ flow }: { flow: Film3DFlow }) {
  const film = flow.job;
  const local = flow.local?.phase === "done" && flow.local.url && (!film || flow.local.id === film.id) ? flow.local : null;
  const [ask, setAsk] = useState("");
  const [asked, setAsked] = useState<string | null>(null);

  if (!film && !local) {
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

  const title = film?.title ?? flow.film.title;
  const src = film ? `/api/new-jarvis/requests/watch?id=${encodeURIComponent(film.id)}` : "";
  const remote = film ? hasVideo(film) : false;
  // Just made here: play the file in memory (instant, and works signed out).
  const play = local?.url ?? (remote ? src : "");
  const result = film?.kind === "done" ? film.finished.result : undefined;
  const tall = flow.draft.aspect === "9:16" && Boolean(local);

  const queueAsk = () => {
    if (!ask.trim()) return;
    const ref = film ? ` (${film.id})` : "";
    const text = `Changes to "${title}"${ref} — re-render with the threejs-film-story skill, same hero and film:\n${ask.trim()}`;
    void flow.requests.add(FILM3D_FOLDER, text).then((added) => {
      if (added.length) {
        setAsk("");
        setAsked(`Queued as ${added[0].id}. Your PC picks it up with the rest of the queue — or change the storyboard and make it here.`);
      }
    });
  };

  return (
    <section aria-labelledby="f3-watch" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 id="f3-watch" className="text-[15px] font-semibold text-ink">{title}</h3>
          <p className="text-[11px] text-ink-faint">{film ? `${statusOf(film)} · ${when(film.at)} · ${film.id}` : local?.label}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {(remote || local) && (
            <a className="f3-ghost" href={local?.url ?? `${src}&download=1`} download={local ? `${title.replace(/[^\w-]+/g, "-")}.mp4` : undefined}>
              <Icon.Download width={12} height={12} aria-hidden /> Download MP4
            </a>
          )}
          <button type="button" className="f3-ghost" onClick={() => flow.go("board")}>
            <Icon.Edit width={11} height={11} aria-hidden /> Edit the storyboard
          </button>
          <button type="button" className="f3-go" onClick={flow.newStory}>
            <Icon.Plus width={12} height={12} aria-hidden /> New story, same hero
          </button>
        </div>
      </div>

      {play ? (
        // #t=1.4 opens the player on the title frame, not the black fade-in.
        <video key={play} src={`${play}#t=1.4`} controls playsInline className={`rounded-xl border border-line bg-black ${tall ? "mx-auto max-h-[70vh]" : "w-full"}`} />
      ) : (
        <div className="grid aspect-video place-items-center rounded-xl border border-dashed border-line bg-panel/60 p-6 text-center">
          <div>
            <p className="text-[13px] text-ink">{film?.kind === "done" ? "Finished, but no video came back." : "Not back yet."}</p>
            <p className="mx-auto mt-1 max-w-md text-[11.5px] text-ink-muted">
              {film?.kind === "done" ? result ?? "The PC finished without uploading the file." : "Your PC renders it the next time Claude Code works the queue. This page updates by itself."}
            </p>
            <button type="button" className="f3-ghost mt-3" onClick={() => flow.go("render")}>See progress, or make it here</button>
          </div>
        </div>
      )}
      {result && play && <p className="text-[11.5px] text-ink-muted">{result}</p>}

      <div className="rounded-xl border border-line bg-panel p-3">
        <label className="f3-label" htmlFor="f3-ask">Want changes? Edit the storyboard yourself, or ask your PC</label>
        <div className="flex gap-2">
          <input id="f3-ask" className="f3-field" value={ask} onChange={(e) => setAsk(e.target.value)} placeholder="Make the forest bit longer and end on a close-up" onKeyDown={(e) => e.key === "Enter" && queueAsk()} />
          <button type="button" className="f3-ghost shrink-0" disabled={!ask.trim()} onClick={queueAsk}>
            <Icon.Send width={11} height={11} aria-hidden /> Queue it
          </button>
        </div>
        {asked && <p className="mt-1.5 text-[11px] text-ink-faint">{asked}</p>}
      </div>
    </section>
  );
}

export function FilmList({ flow }: { flow: Film3DFlow }) {
  const { films, jobId } = flow;
  return (
    <div className="p-2">
      <p className="px-1.5 pb-1.5 pt-1 text-[10.5px] font-semibold uppercase tracking-wide text-ink-muted">Your 3D films</p>
      {films.length === 0 ? (
        <p className="px-1.5 py-2 text-[11.5px] text-ink-faint">Nothing made yet. Finished films land here, newest first.</p>
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
                <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${hasVideo(f) ? "bg-emerald-400" : f.kind === "open" && f.request.status === "working" ? "bg-[var(--f3-hero)]" : "bg-ink-faint"}`} aria-hidden />
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
