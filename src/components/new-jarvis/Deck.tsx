"use client";

// ---------------------------------------------------------------------------
// The Deck — the Dashboard's landing pane. Minimal on purpose.
//
//   hero        live core, greeting, one line of status
//   launcher    favorite apps (starred on the Apps page) + last used
//   autopilot   a grid of every photo not filed yet, each with Jarvis's guess
//
// Two ways to act on a photo, and the owner chose both:
//   • "File it" on a card files it straight to the guess. The tap IS the yes.
//   • Anywhere else on the card opens the photo sheet: the picture, the guess,
//     File it, and a prompt box to tell Jarvis what to do with it instead.
//     Inside the sheet, Jarvis may re-read the photo with the owner's words
//     (that only changes the guess), but filing, removing and remembering a
//     habit each still wait for a tap.
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
import { getFile } from "@/lib/recall/files";
import { folderPaths } from "@/lib/recall/classify";
import { describeAction, type AutopilotAction, type AutopilotReply } from "@/lib/new-jarvis/autopilotChat";
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

let seq = 0;
const mid = () => `m${Date.now().toString(36)}${(seq++).toString(36)}`;

/** Why a photo wants the owner rather than a one-tap file. */
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

function recallCtx() {
  const data = getData();
  const tags = new Set<string>();
  for (const it of data.items) for (const t of it.tags) tags.add(t);
  return { folderPaths: folderPaths(data.folders), existingTags: [...tags] };
}

const titleOfPhoto = (p?: PendingPhoto | null) => p?.analysis?.title || p?.name || "photo";

export function Deck({ go, ownerName, setupLeft, onSetup }: Props) {
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

  const [busy, setBusy] = useState<string | null>(null);
  const [filing, setFiling] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  /** One conversation per photo, so closing and reopening keeps the thread. */
  const [threads, setThreads] = useState<Record<string, ChatMsg[]>>({});

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const analyzing = queue.filter((p) => p.status === "analyzing").length;
  const open = queue.find((p) => p.id === openId) ?? null;

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

  const runImport = useCallback(
    async (files: File[]) => {
      if (!files.length) return;
      setBusy(`Reading ${files.length} photo${files.length === 1 ? "" : "s"}…`);
      try {
        await importPhotos({ files, ...recallCtx(), onQueue: setQueue });
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

  // ---- filing: the card's button is the yes -------------------------------
  const fileNow = useCallback(
    async (ids: string[]) => {
      if (!ids.length) return;
      const where = ids.length === 1 ? destinationLabel(getQueue().find((p) => p.id === ids[0])!) : "";
      setFiling((s) => new Set([...s, ...ids]));
      try {
        const res = await approvePhotos({ photoIds: ids });
        if (res.problems.length && !res.filed) setToast(`Couldn't file: ${res.problems[0].error}`);
        else if (ids.length === 1) setToast(`Filed → ${where}`);
        else setToast(`Filed ${res.filed} photo${res.filed === 1 ? "" : "s"}${res.problems.length ? ` · ${res.problems.length} failed` : ""}`);
      } catch (err) {
        setToast(err instanceof Error ? err.message : "Couldn't file that.");
      } finally {
        setFiling((s) => {
          const n = new Set(s);
          ids.forEach((i) => n.delete(i));
          return n;
        });
        refresh();
      }
    },
    [refresh],
  );

  const removeNow = useCallback(
    async (id: string) => {
      await rejectPhotos([id]);
      setToast("Removed from the queue — it's still on your phone");
      refresh();
    },
    [refresh],
  );

  // ---- render -------------------------------------------------------------
  const status =
    busy ??
    (queue.length
      ? `${queue.length} new photo${queue.length === 1 ? "" : "s"} to sort${analyzing ? ` · reading ${analyzing} now` : ""}.`
      : "Camera roll is clear.");

  return (
    <div className="deck h-full overflow-y-auto">
      <div className="mx-auto flex max-w-[1400px] flex-col gap-5 p-3 sm:p-5">
        {/* hero — one line, no dashboard furniture */}
        <section className="flex flex-wrap items-center gap-4 px-1 pt-1">
          <div className="deck-core" style={{ width: 64, height: 64 }} data-busy={Boolean(busy || analyzing)} aria-hidden>
            <i />
            <i />
            <i />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-[24px] font-semibold leading-tight text-ink">{greeting(ownerName)}</h1>
            <p className="mt-0.5 text-[12.5px] text-ink-muted">
              {status}
              {setupLeft > 0 && (
                <>
                  {" "}
                  <button type="button" onClick={onSetup} className="text-[var(--hud)] underline-offset-2 hover:underline">
                    Finish setup ({setupLeft})
                  </button>
                </>
              )}
            </p>
          </div>
        </section>

        {/* launcher */}
        <section aria-label="Favorites">
          {favorites.length ? (
            <ul className="flex gap-2 overflow-x-auto pb-1">
              {favorites.map((p) => (
                <li key={p.slug} className="relative w-[150px] shrink-0">
                  <a
                    href={p.href}
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => noteLaunch("app", p.slug, p.title)}
                    className="deck-tile"
                    style={{ ["--h" as string]: p.hue, minHeight: 78 }}
                  >
                    <span className="deck-glyph" aria-hidden>
                      {p.title.replace(/[^A-Za-z ]/g, "").split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase()}
                    </span>
                    <span className="block truncate text-[12.5px] font-semibold text-ink">{p.title}</span>
                  </a>
                  <button
                    type="button"
                    onClick={() => toggleFavorite(p.slug)}
                    aria-label={`Unpin ${p.title}`}
                    className="absolute right-1 top-1 grid h-7 w-7 place-items-center rounded-md text-amber-300 opacity-70 hover:opacity-100"
                  >
                    <Icon.Star width={12} height={12} fill="currentColor" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <button type="button" onClick={() => go("plugins")} className="text-[12px] text-ink-muted hover:text-ink">
              <Icon.Star width={12} height={12} className="mr-1 inline" aria-hidden />
              Star your favorite apps to pin them here
            </button>
          )}
          {launcher.recent.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px]">
              <span className="deck-kicker" style={{ color: "var(--color-ink-faint)" }}>
                Recent
              </span>
              {launcher.recent.slice(0, 5).map((r) => {
                const app = r.kind === "app" ? bySlug.get(r.id) : null;
                const label = (
                  <>
                    {r.label} <span className="font-mono text-[10px] text-ink-faint">{ago(r.at)}</span>
                  </>
                );
                return app ? (
                  <a
                    key={`${r.kind}:${r.id}`}
                    href={app.href}
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => noteLaunch("app", app.slug, app.title)}
                    className="text-ink-muted hover:text-ink"
                  >
                    {label}
                  </a>
                ) : (
                  <button key={`${r.kind}:${r.id}`} type="button" onClick={() => go(r.id)} className="text-ink-muted hover:text-ink">
                    {label}
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {/* autopilot */}
        <section className="deck-panel deck-panel--live relative p-3 sm:p-4" aria-labelledby="deck-ap">
          {queue.length > 0 && <div className="deck-scan" aria-hidden />}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-baseline gap-2">
              <h2 id="deck-ap" className="text-[15px] font-semibold text-ink">
                Camera Autopilot
              </h2>
              <span className="font-mono text-[11px] text-[var(--hud)]" data-num>
                {queue.length}
              </span>
            </div>
            <div className="flex items-center gap-1">
              {inbox.ids.length > 0 && (
                <button type="button" className="deck-btn deck-btn--go" onClick={() => void pullIphone()} disabled={Boolean(busy)}>
                  <Icon.Download width={13} height={13} aria-hidden />
                  {inbox.ids.length} from iPhone
                </button>
              )}
              <IconBtn label="Add photos" onClick={() => fileInput.current?.click()} disabled={Boolean(busy)}>
                <Icon.Upload width={14} height={14} aria-hidden />
              </IconBtn>
              {!inbox.linked && (
                <IconBtn label="Link your iPhone" onClick={() => go("photos")}>
                  <Icon.Camera width={14} height={14} aria-hidden />
                </IconBtn>
              )}
              <IconBtn label={`What Jarvis has learned (${rules.rules.filter((r) => r.on).length})`} onClick={() => setRulesOpen(true)}>
                <Icon.Sparkles width={14} height={14} aria-hidden />
              </IconBtn>
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
            </div>
          </div>

          {queue.length === 0 ? (
            <div className="mt-3 rounded-xl border border-dashed border-line px-4 py-10 text-center text-[12px] text-ink-muted">
              All caught up. New photos from your camera roll land here with my guess for where they go.
            </div>
          ) : (
            <ul className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {queue.map((p) => {
                const flag = p.status === "ready" ? flagOf(p) : undefined;
                const isFiling = filing.has(p.id);
                return (
                  // The whole card opens the sheet; "File it" is its own button
                  // on top, so a tap there files without opening anything.
                  <li key={p.id} className="deck-shot">
                    <button
                      type="button"
                      className="text-left"
                      onClick={() => setOpenId(p.id)}
                      aria-label={`Open ${titleOfPhoto(p)} to talk it through with Jarvis`}
                    >
                      <div className="deck-thumb">
                        {p.thumb ? <img src={p.thumb} alt="" /> : null}
                        {p.status === "analyzing" && <div className="deck-analyzing">READING…</div>}
                        {flag && (
                          <span
                            className="absolute left-2 top-2 h-2.5 w-2.5 rounded-full bg-[var(--hud-amber)] shadow-[0_0_8px_var(--hud-amber)]"
                            title={flag}
                            aria-hidden
                          />
                        )}
                      </div>
                      <div className="space-y-0.5 px-2.5 pt-2">
                        <p className="truncate text-[12px] font-semibold text-ink">{titleOfPhoto(p)}</p>
                        <p className="truncate font-mono text-[10.5px] text-ink-muted">
                          → {p.status === "ready" ? destinationLabel(p) : p.status === "failed" ? "couldn't read" : "reading…"}
                        </p>
                      </div>
                    </button>
                    <div className="p-2.5 pt-2">
                      <button
                        type="button"
                        className="deck-btn deck-btn--go w-full text-[11.5px]"
                        disabled={p.status !== "ready" || isFiling}
                        onClick={() => void fileNow([p.id])}
                      >
                        {isFiling ? "Filing…" : "File it"}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      {open && (
        <PhotoSheet
          photo={open}
          thread={threads[open.id] ?? []}
          setThread={(fn) => setThreads((t) => ({ ...t, [open.id]: fn(t[open.id] ?? []) }))}
          filing={filing.has(open.id)}
          rules={rules.rules.filter((r) => r.on).map((r) => r.text)}
          ownerName={ownerName}
          onClose={() => setOpenId(null)}
          onFile={() => {
            const id = open.id;
            setOpenId(null);
            void fileNow([id]);
          }}
          onRemove={() => {
            const id = open.id;
            setOpenId(null);
            void removeNow(id);
          }}
          refresh={refresh}
        />
      )}

      {rulesOpen && <RulesSheet data={rules} onClose={() => setRulesOpen(false)} />}

      {toast && (
        <div role="status" className="fixed bottom-14 left-1/2 z-[60] -translate-x-1/2 rounded-full border border-[var(--hud-dim)] bg-panel px-4 py-2 text-[12px] text-ink shadow-[0_0_30px_-10px_var(--hud)]">
          {toast}
        </div>
      )}
    </div>
  );
}

function IconBtn({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="grid h-9 w-9 place-items-center rounded-lg text-ink-muted transition hover:bg-panel-2 hover:text-[var(--hud)] disabled:opacity-40"
    >
      {children}
    </button>
  );
}

/** Shared frame for the two pop-ups: a centred sheet on a laptop, bottom sheet on a phone. */
function Sheet({ label, onClose, children, wide }: { label: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      className="deck fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center sm:p-4"
      style={{ background: "rgb(0 0 0 / 0.7)" }}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className={`deck-panel deck-panel--live flex max-h-[92dvh] w-full flex-col overflow-hidden bg-panel ${wide ? "sm:max-w-4xl" : "sm:max-w-lg"}`}>
        {children}
      </div>
    </div>
  );
}

function PhotoSheet({
  photo,
  thread,
  setThread,
  filing,
  rules,
  ownerName,
  onClose,
  onFile,
  onRemove,
  refresh,
}: {
  photo: PendingPhoto;
  thread: ChatMsg[];
  setThread: (fn: (t: ChatMsg[]) => ChatMsg[]) => void;
  filing: boolean;
  rules: string[];
  ownerName?: string;
  onClose: () => void;
  onFile: () => void;
  onRemove: () => void;
  refresh: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [thinking, setThinking] = useState(false);
  const [full, setFull] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const flag = photo.status === "ready" ? flagOf(photo) : undefined;
  const where = photo.status === "ready" ? destinationLabel(photo) : null;

  // The card only has a 180px thumbnail; the sheet shows the real picture.
  useEffect(() => {
    let url: string | null = null;
    void getFile(photo.fileId).then((b) => {
      if (!b) return;
      url = URL.createObjectURL(b);
      setFull(url);
    });
    input.current?.focus();
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [photo.fileId]);

  const setActionState = (msgId: string, idx: number, state: ActionState, note?: string) =>
    setThread((m) => m.map((x) => (x.id !== msgId ? x : { ...x, actions: x.actions?.map((a, i) => (i === idx ? { ...a, state, note } : a)) })));

  const reread = async (instruction: string) => {
    const ctx = recallCtx();
    await reanalyze(photo.id, ctx.folderPaths, ctx.existingTags, { userPrompt: instruction, knownPlaces: await gatherKnownPlaces() });
    refresh();
    const p = getQueue().find((x) => x.id === photo.id);
    return p ? destinationLabel(p) : null;
  };

  const runAction = async (msgId: string, idx: number, a: AutopilotAction) => {
    if (a.type === "file") return onFile();
    if (a.type === "reject") return onRemove();
    setActionState(msgId, idx, "running");
    try {
      if (a.type === "rule") {
        addRule(a.text, "told");
        setActionState(msgId, idx, "done", "Saved — I'll use it on every new photo");
      } else if (a.type === "reroute") {
        const now = await reread(a.instruction);
        setActionState(msgId, idx, "done", now ? `New guess: ${now}` : "Re-read");
      }
    } catch (err) {
      setActionState(msgId, idx, "failed", err instanceof Error ? err.message : "That didn't work");
    }
  };

  const send = async (textArg?: string) => {
    const text = (textArg ?? draft).trim();
    if (!text || thinking) return;
    setDraft("");
    const mine: ChatMsg = { id: mid(), role: "you", text };
    const history = [...thread, mine];
    setThread(() => history);
    setThinking(true);
    try {
      const r = await fetch("/api/new-jarvis/autopilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: history.slice(-12).map((m) => ({ role: m.role === "you" ? "user" : "assistant", content: m.text })),
          photos: [
            {
              id: photo.id,
              title: titleOfPhoto(photo),
              caption: photo.analysis?.caption ?? "",
              where: where ?? "not decided",
              tags: photo.analysis?.tags ?? [],
              flagged: flag,
            },
          ],
          selectedId: photo.id,
          rules,
          ownerName,
        }),
      });
      const d = (await r.json()) as AutopilotReply & { error?: string };
      if (!r.ok) throw new Error(d.error || "Jarvis couldn't answer");

      // A re-read only changes the GUESS, so it runs straight away and the
      // new destination shows on the File it button. Everything that writes
      // or deletes still waits for a tap.
      const reroutes = (d.actions ?? []).filter((a): a is Extract<AutopilotAction, { type: "reroute" }> => a.type === "reroute");
      const rest = (d.actions ?? []).filter((a) => a.type !== "reroute" && a.type !== "file");
      const reply: ChatMsg = { id: mid(), role: "jarvis", text: d.reply, actions: rest.map((action) => ({ action, state: "pending" })) };
      setThread((t) => [...t, reply]);
      for (const a of reroutes) {
        setThread((t) => [...t, { id: mid(), role: "jarvis", text: "Re-reading it with that in mind…" }]);
        const now = await reread(a.instruction);
        setThread((t) => [...t, { id: mid(), role: "jarvis", text: now ? `New guess: ${now}. Tap File it when it looks right.` : "Re-read — see the new guess above." }]);
      }
    } catch (err) {
      setThread((t) => [...t, { id: mid(), role: "jarvis", text: err instanceof Error ? err.message : "I couldn't reach the model — try again." }]);
    } finally {
      setThinking(false);
    }
  };

  return (
    <Sheet label={`${titleOfPhoto(photo)} — talk it through with Jarvis`} onClose={onClose} wide>
      <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
        {/* the picture */}
        <div className="relative flex shrink-0 items-center justify-center bg-black/40 sm:w-[48%]">
          {full || photo.thumb ? (
            <img src={full ?? photo.thumb} alt={titleOfPhoto(photo)} className="max-h-[38dvh] w-full object-contain sm:max-h-[70dvh]" />
          ) : (
            <div className="h-48 w-full" />
          )}
          <button type="button" onClick={onClose} aria-label="Close" className="absolute right-2 top-2 grid h-9 w-9 place-items-center rounded-full bg-black/60 text-ink-muted hover:text-ink sm:hidden">
            <Icon.Close width={14} height={14} />
          </button>
        </div>

        {/* the guess + the conversation */}
        <div className="flex min-h-0 flex-1 flex-col">
          <header className="flex items-start gap-2 border-b border-line px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="deck-kicker">Jarvis thinks</p>
              <h2 className="mt-0.5 truncate text-[15px] font-semibold text-ink">{titleOfPhoto(photo)}</h2>
              {photo.analysis?.caption && <p className="mt-0.5 line-clamp-2 text-[11.5px] text-ink-muted">{photo.analysis.caption}</p>}
            </div>
            <button type="button" onClick={onClose} aria-label="Close" className="hidden h-8 w-8 place-items-center rounded text-ink-faint hover:text-ink sm:grid">
              <Icon.Close width={13} height={13} />
            </button>
          </header>

          <div className="space-y-2 px-4 py-3">
            <div className="flex items-center gap-2">
              <p className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink">→ {where ?? (photo.status === "failed" ? "couldn't read it" : "reading…")}</p>
              <button type="button" className="deck-btn deck-btn--go" disabled={photo.status !== "ready" || filing} onClick={onFile}>
                {filing ? "Filing…" : "File it"}
              </button>
            </div>
            {flag && <p className="text-[11px] text-amber-300">{flag}</p>}
          </div>

          <div className="deck-msgs min-h-[120px] flex-1 border-t border-line-soft px-4 py-3">
            <div className="flex flex-col gap-2">
              {thread.length === 0 && (
                <p className="text-[11.5px] leading-relaxed text-ink-faint">
                  Not right? Tell me what to do with it — &ldquo;this is a song, put it in my Classifier&rdquo;, &ldquo;save this repo&rdquo;, &ldquo;put it in
                  Folders › Jobs&rdquo;. I&apos;ll re-read it and update my guess.
                </p>
              )}
              {thread.map((m) => (
                <div key={m.id} className={`deck-bubble ${m.role === "jarvis" ? "deck-bubble--jarvis" : "deck-bubble--you"}`}>
                  {m.text}
                  {m.actions?.map((a, i) => (
                    <div key={i} className="deck-action mt-2" data-state={a.state}>
                      <p className="text-[11.5px] text-ink">{describeAction(a.action, () => titleOfPhoto(photo))}</p>
                      {a.note && <p className="mt-0.5 text-[10.5px] text-ink-muted">{a.note}</p>}
                      {a.state === "pending" && (
                        <div className="mt-1.5 flex gap-1.5">
                          <button type="button" className="deck-btn deck-btn--go text-[11px]" onClick={() => void runAction(m.id, i, a.action)}>
                            Yes
                          </button>
                          <button type="button" className="deck-btn text-[11px]" onClick={() => setActionState(m.id, i, "declined")}>
                            No
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ))}
              {thinking && <p className="font-mono text-[10px] text-[var(--hud)]">THINKING…</p>}
            </div>
          </div>

          <form
            className="flex gap-1.5 border-t border-line px-3 py-2.5"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <label htmlFor="sheet-ask" className="sr-only">
              Tell Jarvis what to do with this photo
            </label>
            <input
              id="sheet-ask"
              ref={input}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Tell Jarvis what to do with this…"
              className="min-h-[40px] min-w-0 flex-1 rounded-lg border border-line bg-panel-2 px-3 text-[12.5px] text-ink placeholder:text-ink-faint"
            />
            <button type="submit" className="deck-btn deck-btn--go" aria-label="Send" disabled={!draft.trim() || thinking}>
              <Icon.Send width={14} height={14} aria-hidden />
            </button>
          </form>
          <button type="button" onClick={onRemove} className="self-start px-4 pb-3 text-[11px] text-ink-faint hover:text-ink">
            Remove from queue
          </button>
        </div>
      </div>
    </Sheet>
  );
}

function RulesSheet({ data, onClose }: { data: AutopilotData; onClose: () => void }) {
  const [text, setText] = useState("");
  return (
    <Sheet label="What Jarvis has learned" onClose={onClose}>
      <header className="flex items-start gap-2 border-b border-line px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="deck-kicker">Camera Autopilot</p>
          <h2 className="text-[15px] font-semibold text-ink">What I&apos;ve learned</h2>
          <p className="text-[11px] text-ink-muted">Used on every new photo. Switch any off and I stop using it.</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="grid h-8 w-8 place-items-center rounded text-ink-faint hover:text-ink">
          <Icon.Close width={13} height={13} />
        </button>
      </header>
      <ul className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-4 py-3">
        {data.rules.length === 0 && <li className="text-[11.5px] text-ink-faint">Nothing yet — tell me a habit below, or file a few photos and I&apos;ll pick it up.</li>}
        {data.rules
          .slice()
          .reverse()
          .map((r) => (
            <li key={r.id} className="flex items-center gap-2 rounded-lg border border-line-soft bg-panel-2 px-2.5 py-1.5">
              <div className="min-w-0 flex-1">
                <p className="text-[12px] leading-snug text-ink">{r.text}</p>
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
        className="flex gap-1.5 border-t border-line px-3 py-2.5"
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
          className="min-h-[38px] min-w-0 flex-1 rounded-lg border border-line bg-panel-2 px-3 text-[12px] text-ink placeholder:text-ink-faint"
        />
        <button type="submit" className="deck-btn" disabled={!text.trim()}>
          Add
        </button>
      </form>
    </Sheet>
  );
}
