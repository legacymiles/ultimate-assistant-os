"use client";

// ---------------------------------------------------------------------------
// The Deck — the Dashboard's landing pane. Minimal on purpose.
//
//   hero        live core, greeting, one line of status
//   launcher    favorite apps (starred on the Apps page) + last used
//   widgets     Camera Autopilot, Notifications, To-do, Calendar, In Queue,
//               Improvements, YouTube videos — each a small
//               card that opens full-size on a tap (see Widgets.tsx)
//
// Camera Autopilot's widget shows a strip of the waiting photos (or the last
// ones filed, when the queue is clear); expanded, it is the full grid, each
// photo with Jarvis's guess. New iPhone photos arrive by themselves: the shell
// checks the inbox every 10 minutes (useCameraWatch) and the Updates feed
// raises a notification.
//
// Two ways to act on a photo, and the owner chose both:
//   • "File it" on a card files it straight to the guess. The tap IS the yes.
//   • Anywhere else on the card opens the photo sheet: the picture, the guess,
//     File it, and a prompt box to tell Jarvis what to do with it instead.
//     Inside the sheet, Jarvis may re-read the photo with the owner's words
//     (that only changes the guess), but filing, removing and remembering a
//     habit each still wait for a tap.
//   • A job ("find this repo and add it as a skill", "build an app in my
//     plugins") comes back as a "Do it" card. Its Yes hands the job and the
//     photo to the super chat, which runs it with every tool the chat has.
//   • Recently FILED photos open the same sheet. The queue lives on the device
//     that pulled the photos in, so on a phone the filed strip is often all
//     there is — every picture you can see must open a chat you can act in.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../icons";
import "./deck.css";
import { HudField, Reactor } from "./HudField";

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
import { folderPathString, getData } from "@/lib/recall/store";
import { getFile } from "@/lib/recall/files";
import { folderPaths } from "@/lib/recall/classify";
import { describeAction, type AutopilotAction, type AutopilotReply } from "@/lib/new-jarvis/autopilotChat";
import { askJarvis } from "@/lib/new-jarvis/askEvent";
import type { PendingPhoto } from "@/lib/recall/photos/types";
import type { UpdatesApi } from "@/lib/jarvis/useUpdates";
import type { CalendarEvent } from "@/lib/recall/calendar/types";
import { CAMERA_CHANGED, type CameraWatch } from "@/lib/new-jarvis/useCameraWatch";
import {
  CalendarExpanded,
  CalendarWidget,
  MiniBtn,
  NotificationsExpanded,
  NotificationsWidget,
  TodoExpanded,
  TodoWidget,
  Widget,
  WidgetPicker,
  WidgetSheet,
  SheetPortal,
  useTopEscape,
  useWidgetPrefs,
  WIDGETS,
  type WidgetId,
} from "./Widgets";
import { ImprovementsExpanded, ImprovementsWidget } from "./Improvements";
import { QueueExpanded, QueueWidget } from "./QueueWidget";
import { YouTubeVideosExpanded, YouTubeVideosWidget } from "../youtube-videos/YouTubeVideosWidget";
import { FindMyLifeExpanded, FindMyLifeWidget } from "../find-my-life/FindMyLifeWidget";
import { IphoneNotesExpanded, IphoneNotesWidget } from "../iphone-notes/IphoneNotesWidget";
import { TextInboxExpanded, TextInboxWidget } from "../text-inbox/TextInboxWidget";
import type { UseQueue } from "@/lib/new-jarvis/useQueue";
import { useIdeas } from "@/lib/new-jarvis/useIdeas";
import type { AuditProposalLike } from "@/lib/new-jarvis/ideas";
import type { JarvisStore } from "@/lib/jarvis/types";
import { MicButton } from "../jarvis/MicButton";
import { useDictation } from "@/lib/new-jarvis/useDictation";
import { phoneLine, type PhoneSignals } from "@/lib/dashboard/phoneStatus";
import { photoConfidence } from "@/lib/recall/photos/confidence";
import { passesFilter, sortByConfidence, type Confidence, type ConfidenceFilter, type ConfidenceSort } from "@/lib/confidence/calibrate";

interface Props {
  go: (tab: string) => void;
  ownerName?: string;
  unread: number;
  /** Setup items still open; the hero offers to finish them. */
  setupLeft: number;
  onSetup: () => void;
  updates: UpdatesApi;
  events: CalendarEvent[];
  camera: CameraWatch;
  /** What the Improvements widget reads: chat, memories. */
  store: JarvisStore | null;
  /** The self-audit's findings, shown under Improvements › Jarvis. */
  audit: AuditProposalLike[];
  /** The In Queue board — the shell's one hook, so pips agree everywhere. */
  queue: UseQueue;
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

/**
 * What the photo sheet talks about: a photo waiting in the queue, or one that
 * is already filed. Both open the same chat; only a queued one can be filed.
 */
interface Shot {
  id: string;
  title: string;
  thumb?: string;
  caption: string;
  tags: string[];
  /** The full picture in this browser's IndexedDB, when it is here. */
  fileId?: string;
  /** Already filed — where it went. */
  filed?: string;
  /** In the queue. */
  pending?: PendingPhoto;
}

const shotOf = (p: PendingPhoto): Shot => ({
  id: p.id,
  title: titleOfPhoto(p),
  thumb: p.thumb,
  caption: p.analysis?.caption ?? "",
  tags: p.analysis?.tags ?? [],
  fileId: p.fileId,
  pending: p,
});

/** The picture itself, for a job sent to chat: the full file if this device has it, else the preview. */
async function shotFile(s: Shot): Promise<File | null> {
  let blob: Blob | null = s.fileId ? await getFile(s.fileId).catch(() => null) : null;
  if (!blob && s.thumb) blob = await fetch(s.thumb).then((r) => (r.ok ? r.blob() : null)).catch(() => null);
  if (!blob) return null;
  const type = blob.type || "image/jpeg";
  const ext = type.split("/")[1]?.replace("jpeg", "jpg") || "jpg";
  return new File([blob], `${s.title.slice(0, 60) || "photo"}.${ext}`, { type });
}

/** Pointer-driven 3D tilt and a glare that follows the cursor. Mouse only. */
function tilt(max = 8) {
  return {
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
      if (e.pointerType !== "mouse") return;
      const el = e.currentTarget;
      const r = el.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width;
      const py = (e.clientY - r.top) / r.height;
      el.style.setProperty("--ry", `${(px - 0.5) * max}deg`);
      el.style.setProperty("--rx", `${(0.5 - py) * max}deg`);
      el.style.setProperty("--mx", `${px * 100}%`);
      el.style.setProperty("--my", `${py * 100}%`);
      el.dataset.hot = "true";
    },
    onPointerLeave: (e: React.PointerEvent<HTMLElement>) => {
      const el = e.currentTarget;
      el.style.setProperty("--rx", "0deg");
      el.style.setProperty("--ry", "0deg");
      el.dataset.hot = "false";
    },
  };
}

/** The greeting types itself in once, on arrival. */
function useTyped(text: string): [string, boolean] {
  const [n, setN] = useState(0);
  const done = useRef(false);
  useEffect(() => {
    if (done.current) {
      setN(text.length);
      return;
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      done.current = true;
      setN(text.length);
      return;
    }
    let i = 0;
    const t = setInterval(() => {
      i++;
      setN(i);
      if (i >= text.length) {
        done.current = true;
        clearInterval(t);
      }
    }, 38);
    return () => clearInterval(t);
  }, [text]);
  return [text.slice(0, n), n < text.length];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** "3m ago" / "just now", for the camera check line. */
function since(t: number | null): string {
  if (!t) return "not yet";
  const m = Math.floor((Date.now() - t) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
}

/**
 * What the phone has been doing — the last photo, or WHY none came (an old
 * link, a Shortcut that finds nothing, a send that wasn't a photo).
 */
function lastFromPhone(phone: PhoneSignals): string {
  return phoneLine(phone, (t) => since(t)).text;
}

/** The last photos filed, for the preview strip when nothing is waiting. */
function recentFiled(n: number): Shot[] {
  try {
    const data = getData();
    return data.items
      .filter((i) => i.kind === "image" && i.attachment?.url)
      .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))
      .slice(0, n)
      .map((i) => ({
        id: i.id,
        title: i.title || "photo",
        thumb: i.attachment!.url!,
        caption: i.summary || i.body?.slice(0, 200) || "",
        tags: i.tags ?? [],
        fileId: i.attachment?.fileId,
        filed: folderPathString(data.folders, i.folderId),
      }));
  } catch {
    return [];
  }
}

export function Deck({ go, ownerName, setupLeft, onSetup, updates, events, camera, store, audit, queue: inQueue }: Props) {
  const widgets = useWidgetPrefs();
  const ideas = useIdeas({ store, audit });
  const [expanded, setExpanded] = useState<WidgetId | null>(null);
  // Re-render once a minute so "checked 3m ago" moves.
  const [, setMinute] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setMinute((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);

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
    window.addEventListener(CAMERA_CHANGED, refresh);
    return () => {
      clearInterval(t);
      window.removeEventListener("storage", refresh);
      window.removeEventListener(CAMERA_CHANGED, refresh);
    };
  }, [refresh]);

  const [rules, setRules] = useState<AutopilotData>({ rules: [], examples: [] });
  useEffect(() => {
    const read = () => setRules(getAutopilot());
    read();
    window.addEventListener(AUTOPILOT_CHANGED, read);
    return () => window.removeEventListener(AUTOPILOT_CHANGED, read);
  }, []);

  // ---- confidence: a self-improving score per photo; it sorts, never files ----
  const [confSort, setConfSort] = useState<ConfidenceSort>("newest");
  const [confFilter, setConfFilter] = useState<ConfidenceFilter>("all");
  useEffect(() => {
    try {
      const p = JSON.parse(localStorage.getItem(CONF_PREF) || "{}") as { sort?: ConfidenceSort; filter?: ConfidenceFilter };
      if (CONF_SORTS.some((x) => x.id === p.sort)) setConfSort(p.sort!);
      if (CONF_FILTERS.some((x) => x.id === p.filter)) setConfFilter(p.filter!);
    } catch {
      /* private window: defaults */
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(CONF_PREF, JSON.stringify({ sort: confSort, filter: confFilter }));
    } catch {
      /* not remembered — fine */
    }
  }, [confSort, confFilter]);
  const confOf = useMemo(() => {
    const outcomes = rules.outcomes ?? [];
    const m = new Map<string, Confidence | null>();
    for (const p of queue) m.set(p.id, photoConfidence(p, p.status === "ready" ? destinationLabel(p) : "", outcomes));
    return m;
  }, [queue, rules]);
  // The queue as the owner chose to see it: sorted by how sure, filtered by band.
  const ordered = useMemo(
    () =>
      confSort === "newest"
        ? queue
        : sortByConfidence(queue, confSort, (p) => confOf.get(p.id)?.score ?? null, when),
    [queue, confSort, confOf],
  );
  const visible = useMemo(
    () => (confFilter === "all" ? ordered : ordered.filter((p) => passesFilter(confOf.get(p.id)?.score ?? null, confFilter))),
    [ordered, confFilter, confOf],
  );
  const bandCount = (f: ConfidenceFilter) => (f === "all" ? queue.length : queue.filter((p) => passesFilter(confOf.get(p.id)?.score ?? null, f)).length);

  const [busy, setBusy] = useState<string | null>(null);
  const [filing, setFiling] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  /** A filed photo opened from the "recently filed" strip. */
  const [openFiled, setOpenFiled] = useState<Shot | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  /** One conversation per photo, so closing and reopening keeps the thread. */
  const [threads, setThreads] = useState<Record<string, ChatMsg[]>>({});
  /** Camera Autopilot's own chat, about the whole queue or the photos picked. */
  const [groupThread, setGroupThread] = useState<ChatMsg[]>([]);
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const togglePick = (id: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const analyzing = queue.filter((p) => p.status === "analyzing").length;
  const open = queue.find((p) => p.id === openId) ?? null;

  // ---- iPhone inbox -------------------------------------------------------
  // Owned by the shell (useCameraWatch): checked every 10 minutes from any
  // tab, and pulled in automatically unless the owner switched that off.
  const inbox = { linked: camera.linked, ids: camera.inbox.map((e) => e.id) };

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


  const fileInput = useRef<HTMLInputElement>(null);

  // ---- filing: the card's button is the yes -------------------------------
  const fileNow = useCallback(
    async (ids: string[]) => {
      if (!ids.length) return;
      const where = ids.length === 1 ? destinationLabel(getQueue().find((p) => p.id === ids[0])!) : "";
      setFiling((s) => new Set([...s, ...ids]));
      try {
        // The card dissolves while the filing runs; holding it for the length
        // of that animation is what makes the tap feel answered.
        const [res] = await Promise.all([approvePhotos({ photoIds: ids }), sleep(520)]);
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
      await rejectPhotos([id], { learn: true });
      setToast("Removed from the queue — it's still on your phone");
      refresh();
    },
    [refresh],
  );

  /** A job about one photo, handed to the super chat with the picture. */
  const sendTask = useCallback(
    async (shot: Shot, task: string) => {
      const file = await shotFile(shot);
      setOpenId(null);
      setOpenFiled(null);
      setExpanded(null);
      go("chat");
      askJarvis({ text: task, files: file ? [file] : [], send: true, mode: "do" });
    },
    [go],
  );

  // ---- render -------------------------------------------------------------
  const status =
    busy ??
    (camera.busy || null) ??
    (queue.length
      ? `${queue.length} new photo${queue.length === 1 ? "" : "s"} to sort${analyzing ? ` · reading ${analyzing} now` : ""}.`
      : "Camera roll is clear.");

  const coreRef = useRef<HTMLDivElement>(null);
  const [typed, typing] = useTyped(greeting(ownerName));
  const working = Boolean(busy || camera.busy || analyzing || filing.size);
  const preview = queue.length ? null : recentFiled(8);
  const filedGrid = expanded === "camera" && !queue.length ? recentFiled(24) : [];

  return (
    <div className="deck deck-stage">
      {/* Inside Jarvis the galaxy behind the whole shell is the background;
          this field only draws where the Deck stands alone. */}
      <div className="deck-own-field">
        <HudField originRef={coreRef} busy={working} />
      </div>
      <div className="deck-scroll">
      <div className="mx-auto flex max-w-[1400px] flex-col gap-6 p-3 sm:p-6">
        {/* hero — one line, no dashboard furniture */}
        <section className="flex flex-wrap items-center gap-4 px-1 pt-1">
          <div ref={coreRef} className="shrink-0">
            <Reactor busy={working} size={112} />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className={`deck-display text-[34px] font-semibold leading-tight text-ink ${typing ? "deck-caret" : ""}`} aria-label={greeting(ownerName)}>
              {typed}
            </h1>
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
                    className="deck-tile deck-tilt"
                    style={{ ["--h" as string]: p.hue, minHeight: 78 }}
                    {...tilt(12)}
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
              <span className="text-[11px] text-ink-faint">Recent</span>
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

        {/* widgets */}
        <section aria-label="Widgets">
          <div className="mb-2 flex items-center justify-end px-1">
            <WidgetPicker hidden={widgets.hidden} toggle={widgets.toggle} />
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {!widgets.hidden.has("camera") && (
              <Widget
                title="Camera Autopilot"
                icon="Camera"
                count={queue.length}
                live={queue.length > 0 || camera.inbox.length > 0}
                onExpand={() => setExpanded("camera")}
                className="md:col-span-2"
                status={
                  camera.busy ||
                  camera.error ||
                  (inbox.linked
                    ? inbox.ids.length
                      ? `${inbox.ids.length} new from your iPhone — bringing them in…`
                      : camera.phone.adoptable
                        ? (
                            <span>
                              Your iPhone tried {since(Date.parse(camera.phone.adoptable))} with a link Jarvis didn&apos;t know.{" "}
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void camera.adoptPhone().then(() => camera.check());
                                }}
                                className="font-semibold text-[var(--hud)] underline underline-offset-2"
                              >
                                That&apos;s my iPhone — let it in
                              </button>
                            </span>
                          )
                        : `Auto · checked ${since(camera.lastChecked)} · ${lastFromPhone(camera.phone)}`
                    : "Not linked yet — tap 🔗 to set up your iPhone (5 min, no app needed)")
                }
                actions={
                  <>
                    <MiniBtn label="Check for new photos now" onClick={() => void camera.check()} disabled={Boolean(camera.busy)}>
                      <Icon.Refresh width={13} height={13} aria-hidden />
                    </MiniBtn>
                    <MiniBtn label="Add photos" onClick={() => fileInput.current?.click()} disabled={Boolean(busy)}>
                      <Icon.Upload width={13} height={13} aria-hidden />
                    </MiniBtn>
                    {!inbox.linked && (
                      <MiniBtn label="Set up your iPhone" onClick={() => go("iphone")}>
                        <Icon.Link width={13} height={13} aria-hidden />
                      </MiniBtn>
                    )}
                  </>
                }
              >
                {queue.length > 0 ? (
                  <>
                    <p className="mb-1.5 text-[11px] text-ink-muted">
                      {queue.length} waiting{analyzing ? ` · reading ${analyzing}` : ""} — tap one to file it or tell me where it goes
                    </p>
                    <ul className="grid grid-cols-4 gap-1.5 sm:grid-cols-6 lg:grid-cols-8">
                      {ordered.slice(0, 8).map((p, i) => (
                        <li key={p.id} className="relative">
                          <button
                            type="button"
                            aria-label={`Open ${titleOfPhoto(p)}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpenId(p.id);
                            }}
                            className="deck-thumb block aspect-square w-full overflow-hidden rounded-lg border border-line-soft"
                          >
                            {p.thumb ? <img src={p.thumb} alt="" className="h-full w-full object-cover" /> : null}
                            {p.status === "analyzing" && <span className="deck-analyzing text-[8px]">READING…</span>}
                            {!(i === 7 && queue.length > 8) && <ConfBadge c={confOf.get(p.id)} small />}
                            {i === 7 && queue.length > 8 && (
                              <span className="absolute inset-0 grid place-items-center bg-black/60 font-mono text-[12px] text-ink">+{queue.length - 8}</span>
                            )}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : preview && preview.length > 0 ? (
                  <>
                    <p className="mb-1.5 text-[11px] text-ink-muted">All caught up · recently filed — tap one to talk to me about it</p>
                    <ul className="grid grid-cols-4 gap-1.5 sm:grid-cols-6 lg:grid-cols-8">
                      {preview.map((p) => (
                        <li key={p.id}>
                          <button
                            type="button"
                            aria-label={`Open ${p.title} to talk it through with Jarvis`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpenFiled(p);
                            }}
                            className="deck-thumb block aspect-square w-full overflow-hidden rounded-lg border border-line-soft opacity-90 transition hover:opacity-100"
                          >
                            <img src={p.thumb} alt="" className="h-full w-full object-cover" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <p className="py-8 text-center text-[11.5px] text-ink-muted">All caught up. New photos land here with my guess for where they go.</p>
                )}
              </Widget>
            )}
            {!widgets.hidden.has("notes") && <IphoneNotesWidget onExpand={() => setExpanded("notes")} />}
            {!widgets.hidden.has("texts") && <TextInboxWidget onExpand={() => setExpanded("texts")} />}
            {!widgets.hidden.has("notifications") && <NotificationsWidget updates={updates} onExpand={() => setExpanded("notifications")} />}
            {!widgets.hidden.has("todo") && <TodoWidget onExpand={() => setExpanded("todo")} />}
            {!widgets.hidden.has("calendar") && <CalendarWidget events={events} onExpand={() => setExpanded("calendar")} />}
            {!widgets.hidden.has("improvements") && <ImprovementsWidget ideas={ideas} onExpand={() => setExpanded("improvements")} />}
            {!widgets.hidden.has("queue") && <QueueWidget queue={inQueue} onExpand={() => setExpanded("queue")} />}
            {!widgets.hidden.has("youtube") && <YouTubeVideosWidget onExpand={() => setExpanded("youtube")} />}
            {!widgets.hidden.has("findmy") && <FindMyLifeWidget onExpand={() => setExpanded("findmy")} />}
          </div>
          {widgets.hidden.size === WIDGETS.length && (
            <p className="px-1 text-[11.5px] text-ink-faint">Every widget is hidden — turn some back on from Widgets above.</p>
          )}
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
        </section>
      </div>
      </div>

      {expanded === "camera" && (
        <WidgetSheet
          title="Camera Autopilot"
          kicker={`${queue.length} to sort · checked ${since(camera.lastChecked)} · ${lastFromPhone(camera.phone)}`}
          onClose={() => {
            setExpanded(null);
            setSelecting(false);
            setPicked(new Set());
          }}
          footer={
            queue.length > 0 ? (
              <AutopilotBar
                queue={queue}
                picked={picked}
                selecting={selecting}
                onSelecting={(on) => {
                  setSelecting(on);
                  if (!on) setPicked(new Set());
                }}
                thread={groupThread}
                setThread={setGroupThread}
                rules={rules.rules.filter((r) => r.on).map((r) => r.text)}
                ownerName={ownerName}
                onFile={(ids) => {
                  setPicked(new Set());
                  void fileNow(ids);
                }}
                onRemove={async (ids) => {
                  await rejectPhotos(ids, { learn: true });
                  setPicked(new Set());
                  setToast(`Removed ${ids.length === 1 ? "it" : `${ids.length} photos`} from the queue — still on your phone`);
                  refresh();
                }}
                onTask={(id, task) => {
                  const p = getQueue().find((x) => x.id === id);
                  if (p) void sendTask(shotOf(p), task);
                }}
                refresh={refresh}
                confOf={confOf}
              />
            ) : undefined
          }
          actions={
            <div className="flex items-center gap-1">
              <IconBtn label="Add photos" onClick={() => fileInput.current?.click()} disabled={Boolean(busy)}>
                <Icon.Upload width={14} height={14} aria-hidden />
              </IconBtn>
              <button type="button" className="deck-btn" onClick={() => go("iphone")} aria-label="iPhone setup" title="iPhone setup">
                <Icon.Camera width={13} height={13} aria-hidden />
                <span className="hidden sm:inline">iPhone setup</span>
              </button>
              <IconBtn label="Check for new photos now" onClick={() => void camera.check()} disabled={Boolean(camera.busy)}>
                <Icon.Refresh width={14} height={14} aria-hidden />
              </IconBtn>
              <IconBtn label={`What Jarvis has learned (${rules.rules.filter((r) => r.on).length})`} onClick={() => setRulesOpen(true)}>
                <Icon.Sparkles width={14} height={14} aria-hidden />
              </IconBtn>
            </div>
          }
        >
          <div className="p-3 sm:p-4">
          {(camera.busy || camera.error) && <p className="mb-2 text-[11.5px] text-ink-muted">{camera.busy || camera.error}</p>}
          {queue.length === 0 ? (
            <>
              <div className="mt-1 rounded-xl border border-dashed border-line px-4 py-4 text-center text-[12px] text-ink-muted">
                Nothing waiting to sort. New photos from your camera roll land here with my guess for where they go.
              </div>
              {filedGrid.length > 0 && (
                <>
                  <p className="mb-2 mt-4 text-[11.5px] text-ink-muted">Recently filed — tap a photo to talk to me about it or tell me what to do with it</p>
                  <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
                    {filedGrid.map((p) => (
                      <li key={p.id}>
                        <button
                          type="button"
                          onClick={() => setOpenFiled(p)}
                          aria-label={`Open ${p.title} to talk it through with Jarvis`}
                          className="deck-thumb block w-full overflow-hidden rounded-xl border border-line-soft text-left"
                        >
                          <span className="block aspect-square w-full overflow-hidden">
                            <img src={p.thumb} alt="" className="h-full w-full object-cover" />
                          </span>
                          <span className="block truncate px-2 pt-1.5 text-[11.5px] font-semibold text-ink">{p.title}</span>
                          <span className="block truncate px-2 pb-1.5 font-mono text-[10px] text-ink-muted">in {p.filed}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </>
          ) : (
            <>
            <div className="flex flex-wrap items-center gap-2" aria-label="Sort and filter by confidence">
              <div className="deck-seg" role="group" aria-label="Sort">
                {CONF_SORTS.map((o) => (
                  <button key={o.id} type="button" aria-pressed={confSort === o.id} onClick={() => setConfSort(o.id)}>
                    {o.label}
                  </button>
                ))}
              </div>
              <div className="deck-seg" role="group" aria-label="Show">
                {CONF_FILTERS.map((o) => (
                  <button key={o.id} type="button" aria-pressed={confFilter === o.id} onClick={() => setConfFilter(o.id)} data-band={o.id}>
                    {o.label} <span className="font-mono text-[10px] opacity-70">{bandCount(o.id)}</span>
                  </button>
                ))}
              </div>
              <p className="w-full text-[11px] text-ink-faint sm:w-auto">
                Scores learn from what you file, move and remove — they never file anything on their own.
              </p>
            </div>
            {visible.length === 0 && (
              <p className="mt-3 rounded-xl border border-dashed border-line px-4 py-4 text-center text-[12px] text-ink-muted">
                No photos in that group.{" "}
                <button type="button" className="text-[var(--hud)] underline-offset-2 hover:underline" onClick={() => setConfFilter("all")}>
                  Show all {queue.length}
                </button>
              </p>
            )}
            <ul className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {visible.map((p) => {
                const flag = p.status === "ready" ? flagOf(p) : undefined;
                const isFiling = filing.has(p.id);
                return (
                  // The whole card opens the sheet; "File it" is its own button
                  // on top, so a tap there files without opening anything.
                  <li key={p.id} className="deck-shot deck-tilt" data-leaving={isFiling} {...tilt(9)}>
                    <span className="deck-corner deck-corner--tl" aria-hidden />
                    <span className="deck-corner deck-corner--br" aria-hidden />
                    <button
                      type="button"
                      className="text-left"
                      onClick={() => (selecting ? togglePick(p.id) : setOpenId(p.id))}
                      aria-pressed={selecting ? picked.has(p.id) : undefined}
                      aria-label={selecting ? `${picked.has(p.id) ? "Unselect" : "Select"} ${titleOfPhoto(p)}` : `Open ${titleOfPhoto(p)} to talk it through with Jarvis`}
                    >
                      <div className="deck-thumb">
                        {p.thumb ? <img src={p.thumb} alt="" /> : null}
                        {selecting && (
                          <span
                            className={`absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full border-2 ${picked.has(p.id) ? "border-[var(--hud)] bg-[var(--hud)] text-black" : "border-white/80 bg-black/40"}`}
                            aria-hidden
                          >
                            {picked.has(p.id) ? "✓" : ""}
                          </span>
                        )}
                        {p.status === "analyzing" && <div className="deck-analyzing">READING…</div>}
                        <ConfBadge c={confOf.get(p.id)} />
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
            </>
          )}
          </div>
        </WidgetSheet>
      )}
      {expanded === "notifications" && <NotificationsExpanded updates={updates} go={go} onClose={() => setExpanded(null)} />}
      {expanded === "todo" && <TodoExpanded onClose={() => setExpanded(null)} />}
      {expanded === "calendar" && <CalendarExpanded events={events} go={go} onClose={() => setExpanded(null)} />}
      {expanded === "improvements" && <ImprovementsExpanded ideas={ideas} go={go} onClose={() => setExpanded(null)} />}
      {expanded === "queue" && <QueueExpanded queue={inQueue} go={go} onClose={() => setExpanded(null)} />}
      {expanded === "youtube" && <YouTubeVideosExpanded onClose={() => setExpanded(null)} />}
      {expanded === "findmy" && <FindMyLifeExpanded onClose={() => setExpanded(null)} />}
      {expanded === "notes" && <IphoneNotesExpanded onClose={() => setExpanded(null)} />}
      {expanded === "texts" && <TextInboxExpanded onClose={() => setExpanded(null)} />}

      {(open || openFiled) && (() => {
        const shot = open ? shotOf(open) : openFiled!;
        const close = () => (open ? setOpenId(null) : setOpenFiled(null));
        return (
          <PhotoSheet
            key={shot.id}
            shot={shot}
            confidence={open ? confOf.get(open.id) : null}
            thread={threads[shot.id] ?? []}
            setThread={(fn) => setThreads((t) => ({ ...t, [shot.id]: fn(t[shot.id] ?? []) }))}
            filing={filing.has(shot.id)}
            rules={rules.rules.filter((r) => r.on).map((r) => r.text)}
            ownerName={ownerName}
            onClose={close}
            onFile={
              open
                ? () => {
                    const id = open.id;
                    setOpenId(null);
                    void fileNow([id]);
                  }
                : undefined
            }
            onRemove={
              open
                ? () => {
                    const id = open.id;
                    setOpenId(null);
                    void removeNow(id);
                  }
                : undefined
            }
            // The photo goes along: the agent reads the repo name, the link,
            // whatever the job needs, off the picture itself.
            onTask={(task) => sendTask(shot, task)}
            refresh={refresh}
          />
        );
      })()}

      {rulesOpen && <RulesSheet data={rules} onClose={() => setRulesOpen(false)} />}

      {toast && (
        <div role="status" className="deck-toast fixed bottom-14 left-1/2 z-[90] -translate-x-1/2 rounded-full px-4 py-2 text-[12px] text-ink">
          {toast}
        </div>
      )}
    </div>
  );
}

/** How sure Jarvis is about a photo's guess, as a small coloured chip. */
function ConfBadge({ c, small = false }: { c: Confidence | null | undefined; small?: boolean }) {
  if (!c) return null;
  return (
    <span className={`deck-conf ${small ? "deck-conf--sm" : ""}`} data-band={c.band} title={`${c.score}% sure — ${c.why}`} aria-label={`${c.score}% sure`}>
      {c.score}%
    </span>
  );
}

const CONF_SORTS: { id: ConfidenceSort; label: string }[] = [
  { id: "newest", label: "Newest" },
  { id: "most", label: "Most sure" },
  { id: "least", label: "Least sure" },
];
const CONF_FILTERS: { id: ConfidenceFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "high", label: "Sure 80+" },
  { id: "medium", label: "Maybe" },
  { id: "low", label: "Unsure" },
];
const CONF_PREF = "camera-autopilot:confidence-view";
const when = (p: PendingPhoto) => Date.parse(p.takenAt ?? p.addedAt) || Date.parse(p.addedAt) || 0;

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
function Sheet({
  label,
  onClose,
  children,
  wide,
  full,
}: {
  label: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
  /** Fill the phone's screen (a chat needs the room); a normal pop-up on a laptop. */
  full?: boolean;
}) {
  // Only the sheet on top closes: a photo opened from the expanded Camera
  // widget sits over that widget's sheet, and Escape must close just the photo.
  useTopEscape(onClose);
  return (
    <SheetPortal>
    <div
      className="deck fixed inset-0 z-[75] flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center sm:p-4"
      style={{ position: "fixed", inset: 0, background: "rgb(0 0 0 / 0.7)", minHeight: 0 }}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className={`deck-glass deck-ring deck-sheet flex w-full flex-col overflow-hidden ${full ? "h-[100dvh] sm:h-auto sm:max-h-[92dvh]" : "max-h-[92dvh]"} ${wide ? "sm:max-w-4xl" : "sm:max-w-lg"}`}
      >
        {children}
      </div>
    </div>
    </SheetPortal>
  );
}

/** Starters for a phone, where typing is the slow part. */
const QUICK_ASKS = [
  "Build an app from this in App Builder",
  "Find what this shows and add it as a skill",
  "Look this up and tell me what it is",
  "Make a note from this",
];

/** Touch screens: no autofocus (it throws the keyboard over the picture). */
const isTouch = () => typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;

function PhotoSheet({
  shot,
  confidence,
  thread,
  setThread,
  filing,
  rules,
  ownerName,
  onClose,
  onFile,
  onRemove,
  onTask,
  refresh,
}: {
  shot: Shot;
  /** How sure Jarvis is about the guess (queued photos only). */
  confidence?: Confidence | null;
  thread: ChatMsg[];
  setThread: (fn: (t: ChatMsg[]) => ChatMsg[]) => void;
  filing: boolean;
  rules: string[];
  ownerName?: string;
  onClose: () => void;
  /** Only for a photo in the queue. */
  onFile?: () => void;
  onRemove?: () => void;
  /** Hand a job about this photo to the super chat (the card's Yes is the go-ahead). */
  onTask: (task: string) => Promise<void>;
  refresh: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [thinking, setThinking] = useState(false);
  const [full, setFull] = useState<string | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const photo = shot.pending;
  const flag = photo?.status === "ready" ? flagOf(photo) : undefined;
  const where = photo ? (photo.status === "ready" ? destinationLabel(photo) : null) : shot.filed ?? null;

  // The card only has a small thumbnail; the sheet shows the real picture when
  // this device has it (a filed photo pulled in on the laptop only has its
  // preview on the phone, which is still a good-sized picture).
  useEffect(() => {
    let url: string | null = null;
    if (shot.fileId) {
      void getFile(shot.fileId)
        .then((b) => {
          if (!b) return;
          url = URL.createObjectURL(b);
          setFull(url);
        })
        .catch(() => {});
    }
    if (!isTouch()) input.current?.focus();
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [shot.fileId]);

  // Keep the newest message in view, as any chat does.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [thread.length, thinking]);

  const setActionState = (msgId: string, idx: number, state: ActionState, note?: string) =>
    setThread((m) => m.map((x) => (x.id !== msgId ? x : { ...x, actions: x.actions?.map((a, i) => (i === idx ? { ...a, state, note } : a)) })));

  const reread = async (instruction: string) => {
    if (!photo) return null;
    const ctx = recallCtx();
    await reanalyze(photo.id, ctx.folderPaths, ctx.existingTags, { userPrompt: instruction, knownPlaces: await gatherKnownPlaces() });
    refresh();
    const p = getQueue().find((x) => x.id === photo.id);
    return p ? destinationLabel(p) : null;
  };

  const runAction = async (msgId: string, idx: number, a: AutopilotAction) => {
    if (a.type === "file") return onFile?.();
    if (a.type === "reject") return onRemove?.();
    setActionState(msgId, idx, "running");
    try {
      if (a.type === "rule") {
        addRule(a.text, "told");
        setActionState(msgId, idx, "done", "Saved — I'll use it on every new photo");
      } else if (a.type === "reroute") {
        const now = await reread(a.instruction);
        setActionState(msgId, idx, "done", now ? `New guess: ${now}` : "Re-read");
      } else if (a.type === "task") {
        setActionState(msgId, idx, "done", "Sent to chat — Jarvis is on it");
        await onTask(a.task);
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
              id: shot.id,
              title: shot.title,
              caption: shot.caption,
              where: where ?? "not decided",
              tags: shot.tags,
              flagged: flag,
              filed: photo ? undefined : shot.filed || "Folders",
            },
          ],
          selectedId: shot.id,
          rules,
          ownerName,
        }),
      });
      const d = (await r.json().catch(() => ({}))) as AutopilotReply & { error?: string };
      if (!r.ok) throw new Error(d.error || "Jarvis couldn't answer just now — try again.");

      // A re-read only changes the GUESS, so it runs straight away and the
      // new destination shows on the File it button. Everything that writes
      // or deletes still waits for a tap.
      const reroutes = photo ? (d.actions ?? []).filter((a): a is Extract<AutopilotAction, { type: "reroute" }> => a.type === "reroute") : [];
      const rest = (d.actions ?? []).filter((a) => a.type !== "reroute" && a.type !== "file" && (photo || a.type !== "reject"));
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

  const status = photo
    ? `→ ${where ?? (photo.status === "failed" ? "couldn't read it" : "reading…")}`
    : `Filed in ${shot.filed || "Folders"}`;

  return (
    <Sheet label={`${shot.title} — talk it through with Jarvis`} onClose={onClose} wide full>
      {/* One scroll on a phone (picture, then the chat), side by side on a laptop.
          The typing box stays pinned at the bottom either way. */}
      <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain sm:flex sm:overflow-hidden">
          {/* the picture */}
          <div className="relative flex shrink-0 items-center justify-center bg-black/40 sm:w-[48%]">
            {full || shot.thumb ? (
              <img src={full ?? shot.thumb} alt={shot.title} className="max-h-[42dvh] w-full object-contain sm:max-h-[70dvh]" />
            ) : (
              <div className="h-48 w-full" />
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Back"
              className="absolute left-2 top-2 inline-flex h-11 items-center gap-1 rounded-full bg-black/65 pl-3 pr-4 text-[14px] text-ink sm:hidden"
            >
              <Icon.ArrowLeft width={16} height={16} aria-hidden />
              Back
            </button>
          </div>

          {/* the guess + the conversation */}
          <div className="flex min-h-0 flex-col sm:flex-1 sm:overflow-y-auto">
            <header className="flex items-start gap-2 border-b border-line px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-[11px] text-[var(--hud)]">{photo ? "Jarvis read this as" : "Already filed — tell me what to do with it"}</p>
                <h2 className="deck-display mt-0.5 line-clamp-2 text-[17px] font-semibold text-ink sm:truncate">{shot.title}</h2>
                {shot.caption && <p className="mt-0.5 line-clamp-2 text-[11.5px] text-ink-muted">{shot.caption}</p>}
              </div>
              <button type="button" onClick={onClose} aria-label="Close" className="hidden h-8 w-8 place-items-center rounded text-ink-faint hover:text-ink sm:grid">
                <Icon.Close width={13} height={13} />
              </button>
            </header>

            <div className="space-y-2 px-4 py-3">
              <div className="flex items-center gap-2">
                <p className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink">{status}</p>
                {photo && onFile && (
                  <button type="button" className="deck-btn deck-btn--go min-h-[40px]" disabled={photo.status !== "ready" || filing} onClick={onFile}>
                    {filing ? "Filing…" : "File it"}
                  </button>
                )}
              </div>
              {confidence && (
                <p className="flex items-start gap-2 text-[11.5px] text-ink-muted">
                  <ConfBadge c={confidence} />
                  <span className="min-w-0">{confidence.why}</span>
                </p>
              )}
              {flag && <p className="text-[11px] text-amber-300">{flag}</p>}
            </div>

            <div className="deck-msgs min-h-[120px] flex-1 border-t border-line-soft px-4 py-3">
              <div className="flex flex-col gap-2">
                {thread.length === 0 && (
                  <>
                    <p className="text-[12px] leading-relaxed text-ink-faint">
                      Tell me what to do with it{photo ? " — “this is a song, put it in my Classifier”, “put it in Folders › Jobs”, or" : ""} a whole job:
                      “find this repo and add it as a skill”, “build an app in my plugins from this”. Jobs go to chat with the photo, where I use your
                      browser, files and apps to get them done.
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {QUICK_ASKS.map((q) => (
                        <button
                          key={q}
                          type="button"
                          onClick={() => void send(q)}
                          disabled={thinking}
                          className="min-h-[36px] rounded-full border border-line bg-panel-2 px-3 text-left text-[12px] text-ink-muted transition hover:border-[var(--hud)] hover:text-ink"
                        >
                          {q}
                        </button>
                      ))}
                    </div>
                  </>
                )}
                {thread.map((m) => (
                  <div key={m.id} className={`deck-bubble ${m.role === "jarvis" ? "deck-bubble--jarvis" : "deck-bubble--you"}`}>
                    {m.text}
                    {m.actions?.map((a, i) => (
                      <div key={i} className="deck-action mt-2" data-state={a.state}>
                        <p className="text-[12px] text-ink">{describeAction(a.action, () => shot.title)}</p>
                        {a.note && <p className="mt-0.5 text-[11px] text-ink-muted">{a.note}</p>}
                        {a.state === "pending" && (
                          <div className="mt-1.5 flex gap-1.5">
                            <button type="button" className="deck-btn deck-btn--go min-h-[40px] min-w-[64px] text-[12px]" onClick={() => void runAction(m.id, i, a.action)}>
                              Yes
                            </button>
                            <button type="button" className="deck-btn min-h-[40px] min-w-[64px] text-[12px]" onClick={() => setActionState(m.id, i, "declined")}>
                              No
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ))}
                {thinking && <p className="font-mono text-[10px] text-[var(--hud)]">THINKING…</p>}
                <div ref={endRef} />
              </div>
            </div>

            {photo && onRemove && (
              <button type="button" onClick={onRemove} className="self-start px-4 pb-3 text-[11.5px] text-ink-faint hover:text-ink">
                Remove from queue
              </button>
            )}
          </div>
        </div>
      </div>

      <form
        className="flex shrink-0 items-end gap-1.5 border-t border-line px-3 pt-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))]"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <label htmlFor="sheet-ask" className="sr-only">
          Tell Jarvis what to do with this photo
        </label>
        {/* 16px on phones: anything smaller makes iOS zoom the page on tap. */}
        <textarea
          id="sheet-ask"
          ref={input}
          rows={1}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !isTouch()) {
              e.preventDefault();
              void send();
            }
          }}
          enterKeyHint="send"
          placeholder="Tell Jarvis what to do with this…"
          className="max-h-32 min-h-[44px] min-w-0 flex-1 resize-none rounded-lg border border-line bg-panel-2 px-3 py-2.5 text-[16px] leading-snug text-ink placeholder:text-ink-faint sm:text-[12.5px]"
        />
        <button type="submit" className="deck-btn deck-btn--go h-[44px] w-[44px] justify-center" aria-label="Send" disabled={!draft.trim() || thinking}>
          <Icon.Send width={15} height={15} aria-hidden />
        </button>
      </form>
    </Sheet>
  );
}

/**
 * Camera Autopilot's chat bar, pinned at the bottom of the expanded widget so
 * it is always in reach on a phone: tell Jarvis what to do with every waiting
 * photo, or with the ones picked in Select. Jarvis answers with Yes/No cards,
 * exactly as in a single photo's chat — nothing is filed or removed until Yes.
 */
function AutopilotBar({
  queue,
  picked,
  selecting,
  onSelecting,
  thread,
  setThread,
  rules,
  ownerName,
  onFile,
  onRemove,
  onTask,
  refresh,
  confOf,
}: {
  queue: PendingPhoto[];
  picked: Set<string>;
  selecting: boolean;
  onSelecting: (on: boolean) => void;
  thread: ChatMsg[];
  setThread: (fn: (t: ChatMsg[]) => ChatMsg[]) => void;
  rules: string[];
  ownerName?: string;
  onFile: (ids: string[]) => void;
  onRemove: (ids: string[]) => Promise<void>;
  onTask: (id: string, task: string) => void;
  refresh: () => void;
  /** Each photo's confidence, so "file the sure ones" can be understood. */
  confOf?: Map<string, Confidence | null>;
}) {
  const [draft, setDraft] = useState("");
  const [thinking, setThinking] = useState(false);
  const [showThread, setShowThread] = useState(true);
  const input = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const dictation = useDictation(() => input.current?.value ?? "", setDraft);

  const targets = picked.size ? queue.filter((p) => picked.has(p.id)) : queue;
  const scope = picked.size ? `${picked.size} selected` : `all ${queue.length} photo${queue.length === 1 ? "" : "s"}`;

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [thread.length, thinking]);

  const setActionState = (msgId: string, idx: number, state: ActionState, note?: string) =>
    setThread((m) => m.map((x) => (x.id !== msgId ? x : { ...x, actions: x.actions?.map((a, i) => (i === idx ? { ...a, state, note } : a)) })));

  const runAction = async (msgId: string, idx: number, a: AutopilotAction) => {
    setActionState(msgId, idx, "running");
    try {
      if (a.type === "file") {
        onFile(a.ids);
        setActionState(msgId, idx, "done", `Filing ${a.ids.length}…`);
      } else if (a.type === "reject") {
        await onRemove(a.ids);
        setActionState(msgId, idx, "done", "Removed from the queue");
      } else if (a.type === "rule") {
        addRule(a.text, "told");
        setActionState(msgId, idx, "done", "Saved — I'll use it on every new photo");
      } else if (a.type === "reroute") {
        const ctx = recallCtx();
        await reanalyze(a.id, ctx.folderPaths, ctx.existingTags, { userPrompt: a.instruction, knownPlaces: await gatherKnownPlaces() });
        refresh();
        const p = getQueue().find((x) => x.id === a.id);
        setActionState(msgId, idx, "done", p ? `New guess: ${destinationLabel(p)}` : "Re-read");
      } else if (a.type === "task") {
        setActionState(msgId, idx, "done", "Sent to chat — Jarvis is on it");
        onTask(a.id, a.task);
      }
    } catch (err) {
      setActionState(msgId, idx, "failed", err instanceof Error ? err.message : "That didn't work");
    }
  };

  const send = async () => {
    dictation.stop();
    const text = draft.trim();
    if (!text || thinking) return;
    setDraft("");
    setShowThread(true);
    const mine: ChatMsg = { id: mid(), role: "you", text: picked.size ? `(${picked.size} selected) ${text}` : text };
    const history = [...thread, mine];
    setThread(() => history);
    setThinking(true);
    try {
      const r = await fetch("/api/new-jarvis/autopilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: history.slice(-12).map((m) => ({ role: m.role === "you" ? "user" : "assistant", content: m.text })),
          photos: targets.slice(0, 60).map((p) => ({
            id: p.id,
            title: titleOfPhoto(p),
            caption: p.analysis?.caption ?? "",
            where: p.status === "ready" ? destinationLabel(p) : "not decided",
            tags: p.analysis?.tags ?? [],
            flagged: p.status === "ready" ? flagOf(p) : undefined,
            sure: confOf?.get(p.id)?.score,
          })),
          selectedId: targets.length === 1 ? targets[0].id : null,
          rules,
          ownerName,
        }),
      });
      const d = (await r.json().catch(() => ({}))) as AutopilotReply & { error?: string };
      if (!r.ok) throw new Error(d.error || "Jarvis couldn't answer just now — try again.");
      setThread((t) => [...t, { id: mid(), role: "jarvis", text: d.reply, actions: (d.actions ?? []).map((action) => ({ action, state: "pending" as const })) }]);
    } catch (err) {
      setThread((t) => [...t, { id: mid(), role: "jarvis", text: err instanceof Error ? err.message : "I couldn't reach the model — try again." }]);
    } finally {
      setThinking(false);
    }
  };

  const titleOf = (id: string) => titleOfPhoto(queue.find((p) => p.id === id));

  return (
    <div className="shrink-0 border-t border-line bg-[rgb(8_10_14/0.92)]">
      {showThread && (thread.length > 0 || thinking) && (
        <div className="deck-msgs max-h-[38dvh] overflow-y-auto overscroll-contain px-3 pt-2.5 sm:max-h-[30dvh]">
          <div className="flex flex-col gap-2">
            {thread.map((m) => (
              <div key={m.id} className={`deck-bubble ${m.role === "jarvis" ? "deck-bubble--jarvis" : "deck-bubble--you"}`}>
                {m.text}
                {m.actions?.map((a, i) => (
                  <div key={i} className="deck-action mt-2" data-state={a.state}>
                    <p className="text-[12px] text-ink">{describeAction(a.action, titleOf)}</p>
                    {a.note && <p className="mt-0.5 text-[11px] text-ink-muted">{a.note}</p>}
                    {a.state === "pending" && (
                      <div className="mt-1.5 flex gap-1.5">
                        <button type="button" className="deck-btn deck-btn--go min-h-[40px] min-w-[64px] text-[12px]" onClick={() => void runAction(m.id, i, a.action)}>
                          Yes
                        </button>
                        <button type="button" className="deck-btn min-h-[40px] min-w-[64px] text-[12px]" onClick={() => setActionState(m.id, i, "declined")}>
                          No
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ))}
            {thinking && <p className="font-mono text-[10px] text-[var(--hud)]">THINKING…</p>}
            <div ref={endRef} />
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-1.5 px-3 pt-2 text-[11.5px]">
        <button
          type="button"
          onClick={() => onSelecting(!selecting)}
          aria-pressed={selecting}
          className={`min-h-[34px] rounded-full border px-3 ${selecting ? "border-[var(--hud)] text-[var(--hud)]" : "border-line text-ink-muted hover:text-ink"}`}
        >
          {selecting ? "Done selecting" : "Select photos"}
        </button>
        {picked.size > 0 && (
          <button type="button" onClick={() => onFile([...picked].filter((id) => queue.find((p) => p.id === id)?.status === "ready"))} className="min-h-[34px] rounded-full border border-line px-3 text-ink-muted hover:text-ink">
            File {picked.size}
          </button>
        )}
        <span className="min-w-0 flex-1 truncate text-ink-faint">Talking about {scope}</span>
        {thread.length > 0 && (
          <button type="button" onClick={() => setShowThread((s) => !s)} className="min-h-[34px] px-2 text-ink-muted hover:text-ink">
            {showThread ? "Hide chat" : `Show chat (${thread.length})`}
          </button>
        )}
      </div>
      {dictation.error && <p className="px-3 pt-1 text-[11px] text-amber-300">{dictation.error}</p>}
      <form
        className="flex items-end gap-1.5 px-3 pt-2 pb-[max(0.625rem,env(safe-area-inset-bottom))]"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <label htmlFor="autopilot-ask" className="sr-only">
          Tell Jarvis what to do with these photos
        </label>
        {/* 16px on phones: anything smaller makes iOS zoom the page on tap. */}
        <textarea
          id="autopilot-ask"
          ref={input}
          rows={1}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !isTouch()) {
              e.preventDefault();
              void send();
            }
          }}
          enterKeyHint="send"
          placeholder={picked.size ? "What should I do with these?" : "Tell Jarvis what to do with your photos…"}
          className="max-h-32 min-h-[44px] min-w-0 flex-1 resize-none rounded-lg border border-line bg-panel-2 px-3 py-2.5 text-[16px] leading-snug text-ink placeholder:text-ink-faint sm:text-[13px]"
        />
        <MicButton dictation={dictation} />
        <button type="submit" className="deck-btn deck-btn--go h-[44px] w-[44px] justify-center" aria-label="Send" disabled={!draft.trim() || thinking}>
          <Icon.Send width={15} height={15} aria-hidden />
        </button>
      </form>
    </div>
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
          className="min-h-[44px] min-w-0 flex-1 rounded-lg border border-line bg-panel-2 px-3 text-[16px] text-ink placeholder:text-ink-faint sm:min-h-[38px] sm:text-[12px]"
        />
        <button type="submit" className="deck-btn" disabled={!text.trim()}>
          Add
        </button>
      </form>
    </Sheet>
  );
}
