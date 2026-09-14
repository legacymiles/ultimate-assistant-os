"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "../icons";
import { Markdown } from "../Markdown";
import { ACTIVE_STATUSES, type Game } from "@/lib/game-creator/types";
import { ago, deleteGame, fetchGame, retryGame, shotUrl } from "./api";
import { StatusPill } from "./StatusPill";
import "./game-creator.css";

// One game: screenshots, what it is, how to play it, what was cut, the design
// document, the live build log, and the buttons that open the real project on
// the owner's PC through the ueos:// link the builder registers.

export function GamePage({ id }: { id: string }) {
  const router = useRouter();
  const [game, setGame] = useState<Game | null>(null);
  const [error, setError] = useState("");
  const [shot, setShot] = useState<number | null>(null);
  const [tab, setTab] = useState<"about" | "design" | "log">("about");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState("");
  const logEnd = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      setGame(await fetchGame(id));
      setError("");
    } catch (err) {
      setError((err as Error).message);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const active = game ? ACTIVE_STATUSES.includes(game.status) : false;
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => void load(), 4000);
    return () => clearInterval(t);
  }, [active, load]);

  useEffect(() => {
    if (tab === "log") logEnd.current?.scrollIntoView({ block: "end" });
  }, [tab, game?.log.length]);

  // Keyboard navigation in the screenshot viewer.
  useEffect(() => {
    if (shot === null || !game) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShot(null);
      if (e.key === "ArrowRight") setShot((s) => (s === null ? s : (s + 1) % game.screenshots.length));
      if (e.key === "ArrowLeft") setShot((s) => (s === null ? s : (s - 1 + game.screenshots.length) % game.screenshots.length));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shot, game]);

  const copy = async (label: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(""), 1500);
    } catch {
      /* the path is visible to select by hand */
    }
  };

  const retry = async () => {
    setBusy(true);
    try {
      setGame(await retryGame(id));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!window.confirm("Remove this game from the gallery? The Unreal project on your PC is not deleted.")) return;
    setBusy(true);
    try {
      await deleteGame(id);
      router.push("/apps/game-creator");
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-line bg-panel px-3 py-2">
        <Link
          href="/apps/game-creator"
          className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-ink-muted transition hover:bg-elevated hover:text-ink"
        >
          <Icon.ArrowLeft width={13} height={13} />
          Games
        </Link>
        <span className="truncate text-sm font-semibold text-ink">{game?.title ?? "Game"}</span>
        {game && (
          <span className="ml-auto">
            <StatusPill status={game.status} />
          </span>
        )}
      </header>

      {error && !game && (
        <div className="mx-auto max-w-3xl px-4 py-16 text-center">
          <p className="text-sm text-ink">{error}</p>
          <Link href="/apps/game-creator" className="mt-3 inline-block text-xs text-brand hover:underline">
            Back to your games
          </Link>
        </div>
      )}

      {!game && !error && <div className="mx-auto mt-10 h-72 max-w-5xl animate-pulse rounded-3xl border border-line bg-panel" />}

      {game && (
        <main className="mx-auto grid max-w-[1400px] gap-6 px-4 py-6 lg:grid-cols-[1fr_380px]">
          <div className="flex min-w-0 flex-col gap-4">
            <div className="relative aspect-video overflow-hidden rounded-3xl border border-line bg-canvas">
              {game.screenshots.length ? (
                <button type="button" className="h-full w-full" onClick={() => setShot(0)} aria-label="Open screenshots">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={shotUrl(game.id, 0)} alt={game.screenshots[0].caption ?? ""} className="h-full w-full object-cover" />
                </button>
              ) : (
                <div className="gc-forge absolute inset-0 grid place-items-center" data-status={game.status}>
                  <div className="gc-forge__grid" />
                  <div className="gc-forge__scan" />
                  <p className="relative text-sm text-ink-muted">
                    {game.status === "queued"
                      ? "Waiting for your PC to pick this up"
                      : game.status === "failed"
                        ? "No screenshots — the build stopped"
                        : game.note ?? "Building…"}
                  </p>
                </div>
              )}
            </div>

            {game.screenshots.length > 1 && (
              <div className="flex gap-2 overflow-x-auto pb-1">
                {game.screenshots.map((s, i) => (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => setShot(i)}
                    className="relative aspect-video w-40 shrink-0 overflow-hidden rounded-xl border border-line transition hover:border-brand/50"
                    title={s.caption}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={shotUrl(game.id, i)} alt={s.caption ?? ""} className="h-full w-full object-cover" loading="lazy" />
                  </button>
                ))}
              </div>
            )}

            <div className="flex gap-1.5 border-b border-line">
              {(["about", "design", "log"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTab(t)}
                  className={`-mb-px border-b-2 px-3 py-2 text-xs font-medium capitalize transition ${
                    tab === t ? "border-brand text-ink" : "border-transparent text-ink-muted hover:text-ink"
                  }`}
                >
                  {t === "log" ? `Build log (${game.log.length})` : t}
                </button>
              ))}
            </div>

            {tab === "about" && (
              <div className="flex flex-col gap-5">
                <div>
                  <p className="text-xs text-ink-faint">Prompt</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-ink">{game.prompt}</p>
                </div>
                {game.summary && <p className="text-sm leading-relaxed text-ink-muted">{game.summary}</p>}
                {game.features?.length ? <List title="Built" items={game.features} /> : null}
                {game.cut?.length ? (
                  <div>
                    <p className="text-xs font-semibold text-ink">Left out</p>
                    <ul className="mt-1.5 space-y-1">
                      {game.cut.map((c) => (
                        <li key={c.feature} className="text-sm text-ink-muted">
                          <span className="text-ink">{c.feature}</span>
                          {c.reason && <span className="text-ink-faint"> — {c.reason}</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {game.error && (
                  <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-3">
                    <p className="text-xs font-semibold text-red-300">Why the build stopped</p>
                    <pre className="mt-1 whitespace-pre-wrap font-mono text-[11px] text-red-200/80">{game.error}</pre>
                  </div>
                )}
              </div>
            )}

            {tab === "design" &&
              (game.design ? (
                <Markdown source={game.design} className="text-sm" />
              ) : (
                <p className="text-sm text-ink-muted">The design document appears once the builder has written it.</p>
              ))}

            {tab === "log" && (
              <div className="max-h-[520px] overflow-y-auto rounded-2xl border border-line bg-canvas p-3 font-mono text-[11px] leading-relaxed">
                {game.log.length === 0 ? (
                  <p className="text-ink-faint">No output yet.</p>
                ) : (
                  game.log.map((l, i) => (
                    <div key={i} className="flex gap-3">
                      <span className="shrink-0 text-ink-faint">{new Date(l.t).toLocaleTimeString()}</span>
                      <span className="min-w-0 whitespace-pre-wrap break-words text-ink-muted">{l.line}</span>
                    </div>
                  ))
                )}
                <div ref={logEnd} />
              </div>
            )}
          </div>

          <aside className="flex flex-col gap-4 lg:sticky lg:top-16 lg:self-start">
            <div className="rounded-2xl border border-line bg-panel p-4">
              <p className="text-lg font-semibold text-ink">{game.title ?? "Untitled game"}</p>
              <p className="mt-0.5 text-xs text-ink-faint">
                {[game.genre, game.template !== "Auto" ? game.template : null].filter(Boolean).join(" · ") || "Genre pending"} ·
                queued {ago(game.createdAt)}
              </p>

              {game.status === "ready" ? (
                <div className="mt-4 grid gap-2">
                  {game.paths?.packagedExe && (
                    <a
                      href={`ueos://play?id=${encodeURIComponent(game.id)}`}
                      className="rounded-xl bg-core px-4 py-2.5 text-center text-sm font-semibold text-canvas transition hover:brightness-110"
                    >
                      Play on this PC
                    </a>
                  )}
                  <a
                    href={`ueos://open?id=${encodeURIComponent(game.id)}`}
                    className="rounded-xl border border-line px-4 py-2.5 text-center text-sm font-medium text-ink transition hover:bg-elevated"
                  >
                    Open in Unreal Engine
                  </a>
                  <p className="text-[11px] leading-relaxed text-ink-faint">
                    These open the game on the PC that built it. The first time, your browser asks to allow the Game Creator
                    link.
                  </p>
                </div>
              ) : game.status === "failed" ? (
                <button
                  type="button"
                  onClick={() => void retry()}
                  disabled={busy}
                  className="mt-4 w-full rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
                >
                  Try building again
                </button>
              ) : (
                <p className="mt-4 rounded-xl border border-line bg-canvas p-3 text-xs text-ink-muted">
                  {game.note ?? "Waiting for your PC"}
                  {game.startedAt && <span className="block pt-1 text-ink-faint">Started {ago(game.startedAt)}</span>}
                </p>
              )}
            </div>

            {game.controls?.length ? (
              <div className="rounded-2xl border border-line bg-panel p-4">
                <List title="Controls" items={game.controls} />
              </div>
            ) : null}

            {game.paths && (game.paths.packagedExe || game.paths.uproject) && (
              <div className="rounded-2xl border border-line bg-panel p-4">
                <p className="text-xs font-semibold text-ink">On your PC</p>
                {[
                  ["Game", game.paths.packagedExe],
                  ["Project", game.paths.uproject],
                ].map(([label, value]) =>
                  value ? (
                    <div key={label} className="mt-2">
                      <p className="text-[11px] text-ink-faint">{label}</p>
                      <div className="mt-0.5 flex items-start gap-2">
                        <code className="min-w-0 flex-1 break-all text-[11px] text-ink-muted">{value}</code>
                        <button
                          type="button"
                          onClick={() => void copy(label!, value)}
                          className="shrink-0 rounded-md border border-line px-2 py-0.5 text-[11px] text-ink-muted hover:text-ink"
                        >
                          {copied === label ? "Copied" : "Copy"}
                        </button>
                      </div>
                    </div>
                  ) : null,
                )}
              </div>
            )}

            <button
              type="button"
              onClick={() => void remove()}
              disabled={busy}
              className="self-start text-xs text-ink-faint transition hover:text-red-400"
            >
              Remove from gallery
            </button>
          </aside>
        </main>
      )}

      {game && shot !== null && game.screenshots[shot] && (
        <div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-black/90 p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => setShot(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={shotUrl(game.id, shot)}
            alt={game.screenshots[shot].caption ?? ""}
            className="max-h-[82dvh] max-w-full rounded-xl object-contain"
            onClick={(e) => e.stopPropagation()}
          />
          <p className="text-sm text-ink-muted">
            {game.screenshots[shot].caption ?? `Screenshot ${shot + 1}`}{" "}
            <span className="text-ink-faint">
              {shot + 1}/{game.screenshots.length}
            </span>
          </p>
        </div>
      )}
    </div>
  );
}

function List({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <p className="text-xs font-semibold text-ink">{title}</p>
      <ul className="mt-1.5 space-y-1">
        {items.map((it) => (
          <li key={it} className="flex gap-2 text-sm text-ink-muted">
            <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-brand" aria-hidden />
            {it}
          </li>
        ))}
      </ul>
    </div>
  );
}
