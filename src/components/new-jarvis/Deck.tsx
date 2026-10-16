"use client";

// ---------------------------------------------------------------------------
// The Deck — the Dashboard's landing pane.
//
//   hero        live core, greeting, the numbers that need the owner
//   launcher    favorite apps (starred on the Apps page) and the last used
//   autopilot   every photo from the camera roll not filed yet, each with
//               Jarvis's proposal — and, beside it, the Autopilot chat
//   rules       what Camera Autopilot has learned, switchable
//
// Nothing here files a photo on its own. The tile buttons and the chat both
// end in a confirm card; only "Yes" calls the pipeline. The pipeline itself is
// the Photos tab's, unchanged — this is a second door onto the same queue.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../icons";
import "./deck.css";

import { studioPlugins } from "@/lib/studio/plugins";
import { ago, noteLaunch, toggleFavorite, useLauncher } from "@/lib/new-jarvis/launcher";
import {
  AUTOPILOT_CHANGED,
  addRule,
  destinationLabel,
  getAutopilot,
  removeRule,
  toggleRule,
  type AutopilotData,
} from "@/lib/recall/photos/autopilot";
import { getQueue } from "@/lib/recall/photos/store";
import { approvePhotos, importPhotos, reanalyze, rejectPhotos } from "@/lib/recall/photos/pipeline";
import { gatherKnownPlaces, destinationById } from "@/lib/dashboard/destinations/registry";
import { getData } from "@/lib/recall/store";
import { folderPaths } from "@/lib/recall/classify";
import {
  describeAction,
  type AutopilotAction,
  type AutopilotPhotoBrief,
  type AutopilotReply,
} from "@/lib/new-jarvis/autopilotChat";
import type { PendingPhoto } from "@/lib/recall/photos/types";

interface Props {
  go: (tab: string) => void;
  ownerName?: string;
  unread: number;
  /** Setup items still open; the hero offers to finish them. */
  setupLeft: number;
  onSetup: () => void;
}

type ActionState = "pending" | "running" | "done" | "declined" | "failed";

interface ChatMsg {
  id: string;
  role: "jarvis" | "you";
  text: string;
  actions?: { action: AutopilotAction; state: ActionState; note?: string }[];
}

type Filter = "all" | "ready" | "needs";

let seq = 0;
const mid = () => `m${Date.now().toString(36)}${(seq++).toString(36)}`;

/** Why a photo wants the owner rather than a one-tap yes. */
function flagOf(p: PendingPhoto): string | undefined {
  const a = p.analysis;
  if (p.status === "failed") return p.error || "Couldn't be read";
  if (a?.engine === "heuristic") return "Not read by AI — needs your call";
  if (p.duplicateOf && !p.keepDuplicate) return `Looks like ${p.duplicateOf.label}`;
  if (a?.destination) {
    const d = destinationById(a.destination.id);
    const f = d?.parse(a.destination.fields);
    if (d && f) return d.preview(f).unverified;
  }
  if ((a?.unknownPeople ?? 0) > 0) return "Someone I don't recognise";
  return undefined;
}

function greeting(name?: string): string {
  const h = new Date().getHours();
  const part = h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  return name ? `${part}, ${name}.` : `${part}.`;
}

export function Deck({ go, ownerName, unread, setupLeft, onSetup }: Props) {
  // ---- launcher -----------------------------------------------------------
  const launcher = useLauncher();
  const plugins = useMemo(() => studioPlugins(), []);
  const bySlug = useMemo(() => new Map(plugins.map((p) => [p.slug, p])), [plugins]);
  const favorites = launcher.favorites.map((s) => bySlug.get(s)).filter(Boolean) as typeof plugins;

  // ---- the queue ----------------------------------------------------------
  const [queue, setQueue] = useState<PendingPhoto[]>([]);
  const refresh = useCallback(() => setQueue(getQueue()), []);
  useEffect(() => {
    refresh();
    // The Photos tab, the iPhone drain and this pane all write the same local
    // queue; a cheap poll keeps the Deck honest without a store rewrite.
    const t = setInterval(refresh, 2500);
    window.addEventListener("storage", refresh);
    return () => {
      clearInterval(t);
      window.removeEventListener("storage", refresh);
    };
  }, [refresh]);

  const [rules, setRules] = useState<AutopilotData>({ rules: [], examples: [] });
  useEffect(() => {
    const read = () => setRules(getAutopilot());
    read();
    window.addEventListener(AUTOPILOT_CHANGED, read);
    return () => window.removeEventListener(AUTOPILOT_CHANGED, read);
  }, []);

  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const ready = queue.filter((p) => p.status === "ready");
  const analyzing = queue.filter((p) => p.status === "analyzing").length;
  const needs = queue.filter((p) => p.status === "failed" || (p.status === "ready" && flagOf(p)));
  const confident = ready.filter((p) => !flagOf(p));
  const shown = filter === "ready" ? confident : filter === "needs" ? needs : queue;
  const sel = queue.find((p) => p.id === selected) ?? null;
  const titleOf = useCallback(
    (id: string) => {
      const p = queue.find((x) => x.id === id);
      return p?.analysis?.title || p?.name || "photo";
    },
    [queue],
  );

  // ---- iPhone inbox -------------------------------------------------------
  const [inbox, setInbox] = useState<{ linked: boolean; ids: string[] }>({ linked: false, ids: [] });
  const readInbox = useCallback(async () => {
    try {
      const r = await fetch("/api/dashboard/inbox");
      if (!r.ok) return;
      const d = (await r.json()) as { linked?: boolean; entries?: { id: string }[] };
      setInbox({ linked: Boolean(d.linked), ids: (d.entries ?? []).map((e) => e.id) });
    } catch {
      /* offline */
    }
  }, []);
  useEffect(() => {
    void readInbox();
    const t = setInterval(() => void readInbox(), 60_000);
    return () => clearInterval(t);
  }, [readInbox]);

  const recallCtx = () => {
    const data = getData();
    const tags = new Set<string>();
    for (const it of data.items) for (const t of it.tags) tags.add(t);
    return { folderPaths: folderPaths(data.folders), existingTags: [...tags] };
  };

  const runImport = useCallback(
    async (files: File[]) => {
      if (!files.length) return;
      setBusy(`Reading ${files.length} photo${files.length === 1 ? "" : "s"}…`);
      try {
        const ctx = recallCtx();
        await importPhotos({ files, ...ctx, onQueue: setQueue });
      } finally {
        setBusy(null);
        refresh();
      }
    },
    [refresh],
  );

  const pullIphone = useCallback(async () => {
    if (!inbox.ids.length) return;
    setBusy("Pulling from your iPhone…");
    try {
      const r = await fetch("/api/dashboard/inbox/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: inbox.ids }),
      });
      const d = (await r.json()) as { photos?: { name: string; contentType: string; dataUrl: string }[] };
      const files = await Promise.all(
        (d.photos ?? []).map(async (p) => new File([await (await fetch(p.dataUrl)).blob()], p.name, { type: p.contentType })),
      );
      await runImport(files);
    } finally {
      setBusy(null);
      void readInbox();
    }
  }, [inbox.ids, readInbox, runImport]);

  const fileInput = useRef<HTMLInputElement>(null);

  // ---- chat ---------------------------------------------------------------
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [draft, setDraft] = useState("");
  const [thinking, setThinking] = useState(false);
  const greeted = useRef(false);

  useEffect(() => {
    if (greeted.current || !queue.length) return;
    greeted.current = true;
    const n = queue.filter((p) => p.status !== "failed").length;
    setMsgs([
      {
        id: mid(),
        role: "jarvis",
        text:
          `${n} photo${n === 1 ? "" : "s"} waiting. ${confident.length} I'm confident about, ` +
          `${needs.length} I'd like your call on. Tap one to talk it through — nothing moves until you say yes.`,
      },
    ]);
  }, [queue, confident.length, needs.length]);

  const propose = useCallback((text: string, actions: AutopilotAction[]) => {
    setMsgs((m) => [...m, { id: mid(), role: "jarvis", text, actions: actions.map((action) => ({ action, state: "pending" })) }]);
  }, []);

  const setActionState = (msgId: string, idx: number, state: ActionState, note?: string) =>
    setMsgs((m) =>
      m.map((x) =>
        x.id !== msgId ? x : { ...x, actions: x.actions?.map((a, i) => (i === idx ? { ...a, state, note } : a)) },
      ),
    );

  const runAction = useCallback(
    async (msgId: string, idx: number, a: AutopilotAction) => {
      setActionState(msgId, idx, "running");
      try {
        if (a.type === "file") {
          const res = await approvePhotos({ photoIds: a.ids });
          const note =
            `Filed ${res.filed}` +
            (res.filedElsewhere ? ` · ${res.filedElsewhere} into other apps` : "") +
            (res.problems.length ? ` · ${res.problems.length} failed: ${res.problems[0].error}` : "");
          setActionState(msgId, idx, res.problems.length && !res.filed ? "failed" : "done", note);
        } else if (a.type === "reject") {
          await rejectPhotos(a.ids);
          setActionState(msgId, idx, "done", "Removed from the queue");
        } else if (a.type === "reroute") {
          const ctx = recallCtx();
          await reanalyze(a.id, ctx.folderPaths, ctx.existingTags, {
            userPrompt: a.instruction,
            knownPlaces: await gatherKnownPlaces(),
          });
          const p = getQueue().find((x) => x.id === a.id);
          setActionState(msgId, idx, "done", p ? `Now proposed: ${destinationLabel(p)} — tap File it when it looks right` : "Re-read");
        } else if (a.type === "rule") {
          addRule(a.text, "told");
          setActionState(msgId, idx, "done", "Saved — I'll use it on every new photo");
        }
      } catch (err) {
        setActionState(msgId, idx, "failed", err instanceof Error ? err.message : "That didn't work");
      } finally {
        refresh();
      }
    },
    [refresh],
  );

  const send = useCallback(
    async (textArg?: string) => {
      const text = (textArg ?? draft).trim();
      if (!text || thinking) return;
      setDraft("");
      const next: ChatMsg[] = [...msgs, { id: mid(), role: "you", text }];
      setMsgs(next);
      setThinking(true);
      const photos: AutopilotPhotoBrief[] = queue
        .filter((p) => p.status === "ready")
        .map((p) => ({
          id: p.id,
          title: p.analysis?.title || p.name,
          caption: p.analysis?.caption ?? "",
          where: destinationLabel(p),
          tags: p.analysis?.tags ?? [],
          flagged: flagOf(p),
        }));
      try {
        const r = await fetch("/api/new-jarvis/autopilot", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: next.slice(-12).map((m) => ({ role: m.role === "you" ? "user" : "assistant", content: m.text })),
            photos,
            selectedId: selected,
            rules: rules.rules.filter((x) => x.on).map((x) => x.text),
            ownerName,
          }),
        });
        const d = (await r.json()) as AutopilotReply & { error?: string };
        if (!r.ok) throw new Error(d.error || "Jarvis couldn't answer");
        propose(d.reply, d.actions ?? []);
      } catch (err) {
        propose(err instanceof Error ? err.message : "I couldn't reach the model — try again.", []);
      } finally {
        setThinking(false);
      }
    },
    [draft, msgs, ownerName, propose, queue, rules.rules, selected, thinking],
  );

  // ---- render -------------------------------------------------------------
  const rulesOn = rules.rules.filter((r) => r.on).length;

  return (
    <div className="deck overflow-y-auto">
      <div className="mx-auto flex max-w-[1500px] flex-col gap-4 p-3 sm:p-4">
        {/* hero */}
        <section className="deck-panel deck-panel--live flex flex-wrap items-center gap-4 p-4">
          <div className="deck-core" data-busy={Boolean(busy || analyzing || thinking)} aria-hidden>
            <i />
            <i />
            <i />
          </div>
          <div className="min-w-0 flex-[1_1_280px]">
            <p className="deck-kicker">Online · learning from you</p>
            <h1 className="mt-1 text-[26px] font-semibold leading-tight text-ink">{greeting(ownerName)}</h1>
            <p className="mt-1 max-w-xl text-[12.5px] leading-relaxed text-ink-muted">
              {busy ??
                (queue.length
                  ? `${queue.length} new photo${queue.length === 1 ? "" : "s"} in Camera Autopilot. I've made my guesses — nothing moves until you say so.`
                  : "Camera roll is clear. New photos land here with my guess for where they go.")}
            </p>
            {setupLeft > 0 && (
              <button type="button" onClick={onSetup} className="deck-btn mt-2 text-[11.5px]">
                <Icon.Sparkles width={13} height={13} aria-hidden />
                Finish setup · {setupLeft} left
              </button>
            )}
          </div>
          <div className="grid flex-[1_1_320px] grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Waiting" value={queue.length} tone="var(--hud)" />
            <Stat label="Confident" value={confident.length} />
            <Stat label="Rules learned" value={rulesOn} tone="var(--hud-amber)" />
            <Stat label="Updates" value={unread} tone="var(--hud-green)" />
          </div>
        </section>

        {/* launcher */}
        <section className="deck-panel p-3" aria-labelledby="deck-fav">
          <div className="mb-2 flex flex-wrap items-baseline gap-2">
            <h2 id="deck-fav" className="text-[13px] font-semibold text-ink">
              Favorites
            </h2>
            <button type="button" onClick={() => go("plugins")} className="text-[11px] text-ink-muted underline-offset-2 hover:text-ink hover:underline">
              Star apps in Apps →
            </button>
          </div>
          {favorites.length ? (
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
              {favorites.map((p) => (
                <li key={p.slug} className="relative">
                  <a
                    href={p.href}
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => noteLaunch("app", p.slug, p.title)}
                    className="deck-tile"
                    style={{ ["--h" as string]: p.hue }}
                  >
                    <span className="deck-glyph" aria-hidden>
                      {p.title.replace(/[^A-Za-z ]/g, "").split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase()}
                    </span>
                    <span>
                      <span className="block truncate text-[13px] font-semibold text-ink">{p.title}</span>
                      <span className="block truncate text-[10.5px] text-ink-muted">{p.tag}</span>
                    </span>
                  </a>
                  <button
                    type="button"
                    onClick={() => toggleFavorite(p.slug)}
                    aria-label={`Unpin ${p.title}`}
                    className="absolute right-1.5 top-1.5 grid h-7 w-7 place-items-center rounded-md text-amber-300 hover:bg-panel-2"
                  >
                    <Icon.Star width={13} height={13} fill="currentColor" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-lg border border-dashed border-line px-3 py-4 text-[12px] text-ink-muted">
              No favorites yet. Open <button type="button" className="text-ink underline" onClick={() => go("plugins")}>Apps</button> and tap the star on the ones you use most.
            </p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-line-soft pt-2.5">
            <span className="deck-kicker mr-1" style={{ color: "var(--color-ink-faint)" }}>
              Last used
            </span>
            {launcher.recent.length === 0 && <span className="text-[11px] text-ink-faint">Apps and tabs you open show up here.</span>}
            {launcher.recent.map((r) => {
              const app = r.kind === "app" ? bySlug.get(r.id) : null;
              const body = (
                <>
                  <span className="text-ink">{r.label}</span>
                  <span className="font-mono text-[10px] text-ink-faint">{ago(r.at)}</span>
                </>
              );
              return app ? (
                <a
                  key={`${r.kind}:${r.id}`}
                  href={app.href}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => noteLaunch("app", app.slug, app.title)}
                  className="deck-btn rounded-full text-[11.5px]"
                >
                  {body}
                </a>
              ) : (
                <button key={`${r.kind}:${r.id}`} type="button" onClick={() => go(r.id)} className="deck-btn rounded-full text-[11.5px]">
                  {body}
                </button>
              );
            })}
          </div>
        </section>

        {/* autopilot + chat */}
        <div className="flex flex-wrap items-start gap-4">
          <section className="deck-panel deck-panel--live relative min-w-0 flex-[999_1_560px] p-3" aria-labelledby="deck-ap">
            {queue.length > 0 && <div className="deck-scan" aria-hidden />}
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="deck-kicker">Autopilot · asks before acting</p>
                <h2 id="deck-ap" className="mt-0.5 text-[17px] font-semibold text-ink">
                  Camera Autopilot
                </h2>
                <p className="text-[11.5px] text-ink-muted">
                  New photos not filed yet{analyzing ? ` · reading ${analyzing} now` : ""}. Tap one to discuss it with Jarvis.
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {inbox.ids.length > 0 && (
                  <button type="button" className="deck-btn deck-btn--go" onClick={() => void pullIphone()} disabled={Boolean(busy)}>
                    <Icon.Download width={13} height={13} aria-hidden />
                    Pull {inbox.ids.length} from iPhone
                  </button>
                )}
                <button type="button" className="deck-btn" onClick={() => fileInput.current?.click()} disabled={Boolean(busy)}>
                  <Icon.Upload width={13} height={13} aria-hidden />
                  Add photos
                </button>
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/*"
                  multiple
                  hidden
                  onChange={(e) => {
                    const files = [...(e.target.files ?? [])];
                    e.target.value = "";
                    void runImport(files);
                  }}
                />
                {!inbox.linked && (
                  <button type="button" className="deck-btn" onClick={() => go("photos")}>
                    <Icon.Camera width={13} height={13} aria-hidden />
                    Link iPhone
                  </button>
                )}
                <button
                  type="button"
                  className="deck-btn deck-btn--go"
                  disabled={!confident.length}
                  onClick={() =>
                    propose(
                      `Before I act: file ${confident.length} photo${confident.length === 1 ? "" : "s"} I'm confident about?\n` +
                        confident
                          .slice(0, 8)
                          .map((p) => `· ${p.analysis?.title || p.name} → ${destinationLabel(p)}`)
                          .join("\n") +
                        (confident.length > 8 ? `\n· …and ${confident.length - 8} more` : ""),
                      [{ type: "file", ids: confident.map((p) => p.id) }],
                    )
                  }
                >
                  File {confident.length} confident
                </button>
              </div>
            </div>

            <div role="group" aria-label="Filter" className="mt-3 flex flex-wrap gap-1.5">
              {(
                [
                  ["all", "All new", queue.length],
                  ["ready", "Confident", confident.length],
                  ["needs", "Needs you", needs.length],
                ] as const
              ).map(([id, label, n]) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={filter === id}
                  onClick={() => setFilter(id)}
                  className={`deck-btn rounded-full text-[11.5px] ${filter === id ? "deck-btn--go" : ""}`}
                >
                  {label} · <span className="font-mono">{n}</span>
                </button>
              ))}
            </div>

            {shown.length === 0 ? (
              <div className="mt-3 rounded-xl border border-dashed border-line px-4 py-8 text-center text-[12px] text-ink-muted">
                {queue.length
                  ? "Nothing in this filter."
                  : "All caught up. Link your iPhone or add photos, and I'll sort them here."}
              </div>
            ) : (
              <ul className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4">
                {shown.map((p) => {
                  const flag = flagOf(p);
                  const on = p.id === selected;
                  return (
                    <li key={p.id} className="deck-shot" aria-current={on}>
                      <button type="button" className="text-left" onClick={() => setSelected(on ? null : p.id)} aria-pressed={on}>
                        <div className="deck-thumb">
                          {p.thumb ? <img src={p.thumb} alt="" /> : null}
                          {p.status === "analyzing" && <div className="deck-analyzing">READING…</div>}
                        </div>
                        <div className="space-y-1 p-2">
                          <p className="truncate text-[12px] font-semibold text-ink">{p.analysis?.title || p.name}</p>
                          <p className="truncate font-mono text-[10.5px] text-ink-muted">→ {p.status === "ready" ? destinationLabel(p) : p.status}</p>
                          {flag && <p className="line-clamp-2 text-[10.5px] text-amber-300">{flag}</p>}
                        </div>
                      </button>
                      {p.status === "ready" && (
                        <div className="mt-auto flex gap-1 p-2 pt-0">
                          <button
                            type="button"
                            className="deck-btn deck-btn--go flex-1 text-[11px]"
                            onClick={() => {
                              setSelected(p.id);
                              propose(`Before I act: file "${p.analysis?.title || p.name}" to ${destinationLabel(p)}?`, [
                                { type: "file", ids: [p.id] },
                              ]);
                            }}
                          >
                            File it
                          </button>
                          <button
                            type="button"
                            className="deck-btn text-[11px]"
                            aria-label={`Remove ${p.analysis?.title || p.name} from the queue`}
                            onClick={() =>
                              propose(`Remove "${p.analysis?.title || p.name}" from the queue? It stays on your phone.`, [
                                { type: "reject", ids: [p.id] },
                              ])
                            }
                          >
                            <Icon.Close width={12} height={12} aria-hidden />
                          </button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            <button type="button" onClick={() => go("photos")} className="mt-3 text-[11px] text-ink-muted hover:text-ink">
              Open the full review in Photos →
            </button>
          </section>

          <div className="flex min-w-0 flex-[1_1_360px] flex-col gap-4">
            <section className="deck-panel deck-panel--live flex flex-col gap-2.5 p-3" aria-labelledby="deck-chat">
              <div className="flex items-center gap-2.5">
                <div className="deck-core" style={{ width: 34, height: 34 }} data-busy={thinking} aria-hidden>
                  <i />
                  <i />
                  <i />
                </div>
                <div className="min-w-0">
                  <h2 id="deck-chat" className="text-[14px] font-semibold text-ink">
                    Jarvis · Autopilot
                  </h2>
                  <p className="text-[10.5px] text-ink-muted">Talks it through, then asks before doing anything</p>
                </div>
              </div>

              {sel && (
                <div className="flex items-center gap-2.5 rounded-lg border border-line bg-panel-2 p-2">
                  {sel.thumb ? (
                    <img src={sel.thumb} alt="" className="h-12 w-12 shrink-0 rounded-md object-cover" />
                  ) : (
                    <span className="h-12 w-12 shrink-0 rounded-md bg-panel" />
                  )}
                  <div className="min-w-0">
                    <p className="deck-kicker">Discussing</p>
                    <p className="truncate text-[12px] font-semibold text-ink">{sel.analysis?.title || sel.name}</p>
                    <p className="line-clamp-2 text-[10.5px] text-ink-muted">{sel.analysis?.caption}</p>
                  </div>
                </div>
              )}

              <div className="deck-msgs h-[340px] pr-1">
                <div className="flex flex-col gap-2">
                  {msgs.length === 0 && (
                    <p className="text-[11.5px] text-ink-faint">
                      Ask about any photo, or tell me your habits — &ldquo;song screenshots go to my Classifier&rdquo;.
                    </p>
                  )}
                  {msgs.map((m) => (
                    <div key={m.id} className={`deck-bubble ${m.role === "jarvis" ? "deck-bubble--jarvis" : "deck-bubble--you"}`}>
                      {m.text}
                      {m.actions?.map((a, i) => (
                        <div key={i} className="deck-action mt-2" data-state={a.state}>
                          <p className="text-[11.5px] text-ink">{describeAction(a.action, titleOf)}</p>
                          {a.note && <p className="mt-0.5 text-[10.5px] text-ink-muted">{a.note}</p>}
                          {a.state === "pending" && (
                            <div className="mt-1.5 flex gap-1.5">
                              <button type="button" className="deck-btn deck-btn--go text-[11px]" onClick={() => void runAction(m.id, i, a.action)}>
                                Yes, do it
                              </button>
                              <button type="button" className="deck-btn text-[11px]" onClick={() => setActionState(m.id, i, "declined")}>
                                Not now
                              </button>
                            </div>
                          )}
                          {a.state === "running" && <p className="mt-1 font-mono text-[10px] text-[var(--hud)]">WORKING…</p>}
                        </div>
                      ))}
                    </div>
                  ))}
                  {thinking && <p className="font-mono text-[10px] text-[var(--hud)]">THINKING…</p>}
                </div>
              </div>

              <div className="flex flex-wrap gap-1">
                {["Song images go to my Classifier", "Repo screenshots → Folders", "Why that folder?"].map((q) => (
                  <button key={q} type="button" className="deck-btn rounded-full text-[10.5px]" onClick={() => void send(q)}>
                    {q}
                  </button>
                ))}
              </div>

              <form
                className="flex gap-1.5"
                onSubmit={(e) => {
                  e.preventDefault();
                  void send();
                }}
              >
                <label htmlFor="deck-ask" className="sr-only">
                  Message Jarvis about your photos
                </label>
                <input
                  id="deck-ask"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={sel ? "Where should this one go?" : "Tell Jarvis where things go…"}
                  className="min-h-[38px] min-w-0 flex-1 rounded-lg border border-line bg-panel-2 px-3 text-[12.5px] text-ink placeholder:text-ink-faint"
                />
                <button type="submit" className="deck-btn deck-btn--go" aria-label="Send" disabled={!draft.trim() || thinking}>
                  <Icon.Send width={14} height={14} aria-hidden />
                </button>
              </form>
            </section>

            <Rules data={rules} />
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="deck-stat">
      <b style={tone ? { color: tone } : undefined} data-num>
        {value}
      </b>
      <span className="text-[10.5px] text-ink-muted">{label}</span>
    </div>
  );
}

function Rules({ data }: { data: AutopilotData }) {
  const [text, setText] = useState("");
  return (
    <section className="deck-panel p-3" aria-labelledby="deck-rules">
      <h2 id="deck-rules" className="text-[13px] font-semibold text-ink">
        What I&apos;ve learned
      </h2>
      <p className="text-[10.5px] text-ink-muted">Used on every new photo. Switch any off and I stop using it.</p>
      <ul className="mt-2 flex flex-col gap-1.5">
        {data.rules.length === 0 && <li className="text-[11px] text-ink-faint">Nothing yet — tell me a habit, or file a few photos and I&apos;ll pick it up.</li>}
        {data.rules
          .slice()
          .reverse()
          .map((r) => (
            <li key={r.id} className="flex items-center gap-2 rounded-lg border border-line-soft bg-panel-2 px-2.5 py-1.5">
              <div className="min-w-0 flex-1">
                <p className="text-[11.5px] leading-snug text-ink">{r.text}</p>
                <p className="font-mono text-[9.5px] uppercase tracking-wider text-ink-faint">
                  {r.source === "told" ? "You told me" : r.source === "learned" ? "Learned from your filing" : "From setup"}
                </p>
              </div>
              <button type="button" role="switch" aria-checked={r.on} aria-label={`Use: ${r.text}`} className="deck-switch" onClick={() => toggleRule(r.id)} />
              <button type="button" aria-label={`Delete: ${r.text}`} className="grid h-7 w-7 place-items-center rounded text-ink-faint hover:text-ink" onClick={() => removeRule(r.id)}>
                <Icon.Trash width={12} height={12} aria-hidden />
              </button>
            </li>
          ))}
      </ul>
      <form
        className="mt-2 flex gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) addRule(text, "told");
          setText("");
        }}
      >
        <label htmlFor="deck-rule" className="sr-only">
          Add a rule
        </label>
        <input
          id="deck-rule"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="e.g. Screenshots of houses go to Folders › Real Estate"
          className="min-h-[34px] min-w-0 flex-1 rounded-lg border border-line bg-panel-2 px-2.5 text-[11.5px] text-ink placeholder:text-ink-faint"
        />
        <button type="submit" className="deck-btn" disabled={!text.trim()}>
          Add
        </button>
      </form>
    </section>
  );
}
