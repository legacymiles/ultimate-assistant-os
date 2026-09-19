"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../icons";
import { Markdown } from "../Markdown";
import { ACTIVE_STATUSES, MAX_MESSAGE_CHARS, modelLabel, type Game } from "@/lib/game-creator/types";
import { ago, deleteGame, fetchGame, launchGame, retryGame, sendMessage, shotUrl } from "./api";
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
  const [tab, setTab] = useState<"chat" | "about" | "design" | "log">("chat");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const chatEnd = useRef<HTMLDivElement>(null);
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
    if (tab === "chat") chatEnd.current?.scrollIntoView({ block: "end" });
  }, [tab, game?.log.length, game?.messages?.length]);

  const timeline = useMemo(() => (game ? chatTimeline(game) : []), [game]);

  const send = async () => {
    const text = draft.trim();
    if (!text) return;
    setSending(true);
    try {
      setGame(await sendMessage(id, text));
      setDraft("");
      setError("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSending(false);
    }
  };

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

  const [launching, setLaunching] = useState<"" | "play" | "open">("");
  const startOnPc = async (action: "play" | "open") => {
    setLaunching(action);
    try {
      setGame(await launchGame(id, action));
      setError("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLaunching("");
    }
  };

  // Watch a pending Play/Open until the PC has picked it up.
  const launchPending = game?.launch?.state === "pending";
  useEffect(() => {
    if (!launchPending) return;
    const t = setInterval(() => void load(), 3000);
    return () => clearInterval(t);
  }, [launchPending, load]);

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
              {(["chat", "about", "design", "log"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTab(t)}
                  className={`-mb-px border-b-2 px-3 py-2 text-xs font-medium capitalize transition ${
                    tab === t ? "border-brand text-ink" : "border-transparent text-ink-muted hover:text-ink"
                  }`}
                >
                  {t === "log" ? `Build log (${game.log.length})` : t === "chat" ? "Chat with the agent" : t}
                </button>
              ))}
            </div>

            {tab === "chat" && (
              <div className="flex flex-col gap-3">
                <div className="max-h-[520px] overflow-y-auto rounded-2xl border border-line bg-canvas p-3">
                  {timeline.length === 0 ? (
                    <p className="text-sm text-ink-faint">
                      The agent&apos;s updates appear here once your PC starts building. You can write to it any time.
                    </p>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {timeline.map((item) =>
                        item.kind === "user" ? (
                          <div key={item.key} className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-brand/20 px-3 py-2">
                            <p className="whitespace-pre-wrap text-sm text-ink">{item.text}</p>
                            <p className="mt-0.5 text-right text-[10px] text-ink-faint">
                              {new Date(item.t).toLocaleTimeString()} ·{" "}
                              {item.state === "delivered" ? "the agent has it" : "waiting for your PC"}
                            </p>
                          </div>
                        ) : (
                          <div
                            key={item.key}
                            className="mr-auto max-w-[85%] rounded-2xl rounded-bl-md border border-line bg-panel px-3 py-2"
                          >
                            <p className="whitespace-pre-wrap text-sm text-ink-muted">{item.text}</p>
                            <p className="mt-0.5 text-[10px] text-ink-faint">{new Date(item.t).toLocaleTimeString()}</p>
                          </div>
                        ),
                      )}
                    </div>
                  )}
                  <div ref={chatEnd} />
                </div>
                <div className="flex flex-col gap-2">
                  <label htmlFor="gc-chat" className="sr-only">
                    Message to the agent
                  </label>
                  <textarea
                    id="gc-chat"
                    value={draft}
                    maxLength={MAX_MESSAGE_CHARS}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        void send();
                      }
                    }}
                    rows={2}
                    placeholder={
                      active
                        ? "Tell the agent something — it reads it between steps"
                        : "Ask for changes — e.g. make the zombies faster, add fog"
                    }
                    className="w-full resize-y rounded-2xl border border-line bg-canvas px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-brand/60 focus:ring-2 focus:ring-brand/20"
                  />
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => void send()}
                      disabled={sending || !draft.trim()}
                      className="rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
                    >
                      {sending ? "Sending…" : active ? "Send" : "Send and rebuild"}
                    </button>
                    <span className="text-[11px] text-ink-faint">
                      {active
                        ? "Enter sends · Shift+Enter for a new line"
                        : "Your PC continues the same session on this project and updates the game."}
                    </span>
                  </div>
                  {error && <p className="text-xs text-red-400">{error}</p>}
                </div>
              </div>
            )}

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
              {game.model && (
                <p className="mt-1 text-[11px] text-ink-faint">
                  Model <code className="text-ink-muted">{modelLabel(game.model)}</code>
                </p>
              )}
              {game.skill && (
                <p className="mt-1 text-[11px] text-ink-faint">
                  Skill <code className="text-ink-muted">{game.skill}</code>
                  {game.skillUsed === true && <span className="text-emerald-400"> · loaded</span>}
                  {game.skillUsed === false && <span className="text-amber-400"> · not confirmed</span>}
                </p>
              )}

              {game.status === "ready" ? (
                <div className="mt-4 grid gap-2">
                  {game.paths?.packagedExe && (
                    <button
                      type="button"
                      onClick={() => void startOnPc("play")}
                      disabled={Boolean(launching)}
                      className="rounded-xl bg-core px-4 py-2.5 text-center text-sm font-semibold text-canvas transition hover:brightness-110 disabled:opacity-60"
                    >
                      {launching === "play" ? "Sending…" : "Play on my PC"}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void startOnPc("open")}
                    disabled={Boolean(launching)}
                    className="rounded-xl border border-line px-4 py-2.5 text-center text-sm font-medium text-ink transition hover:bg-elevated disabled:opacity-60"
                  >
                    {launching === "open" ? "Sending…" : "Open in Unreal Engine"}
                  </button>
                  {game.launch && (
                    <p className="rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-[11px] text-ink-muted" role="status">
                      {game.launch.state === "pending"
                        ? `Sent — your PC ${game.launch.action === "play" ? "starts the game" : "opens Unreal"} within a few seconds (the builder must be running).`
                        : `Your PC picked it up ${ago(game.launch.sentAt)} — look for the ${game.launch.action === "play" ? "game" : "Unreal"} window.`}
                    </p>
                  )}
                  <p className="text-[11px] leading-relaxed text-ink-faint">
                    Opens on the PC that built it, through its builder. Not working?{" "}
                    <a href={`ueos://${game.paths?.packagedExe ? "play" : "open"}?id=${encodeURIComponent(game.id)}`} className="underline">
                      Try the direct link
                    </a>
                    .
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

type ChatItem =
  | { kind: "user"; key: string; t: string; text: string; state: "pending" | "delivered" }
  | { kind: "agent"; key: string; t: string; text: string };

// Log lines that are the builder's own bookkeeping or a tool call, not the agent talking.
const NOT_SPEECH = /^(→|stderr:|Project created:|Claude finished\.|Skill loaded:|Skill check:|Message from you)/;

/** The owner's messages interleaved with what the agent said (its narration from the build log). */
function chatTimeline(game: Game): ChatItem[] {
  const items: ChatItem[] = [
    ...(game.messages ?? []).map((m) => ({ kind: "user" as const, key: m.id, t: m.at, text: m.text, state: m.state })),
    ...game.log
      .map((l, i) => ({ l, i }))
      .filter(({ l }) => !NOT_SPEECH.test(l.line))
      .map(({ l, i }) => ({ kind: "agent" as const, key: `log-${i}`, t: l.t, text: l.line })),
  ];
  return items.sort((a, b) => a.t.localeCompare(b.t));
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
