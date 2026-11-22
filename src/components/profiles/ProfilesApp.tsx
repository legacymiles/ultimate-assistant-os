"use client";

// ---------------------------------------------------------------------------
// Profiles — a web of people, businesses and jobs, run by talking to Jarvis.
//
// Design rule (owner, Nov 2026): show the current level, click to go deeper,
// use Jarvis to find or manage anything. Never the whole tree at once, never a
// dashboard, never a permanent sidebar. Jarvis collapses so the owner can
// browse by hand; it opens into a full conversation to tell it new things.
//
// The toy (interactive-web-studio): every world has its own light. Diving into
// a profile re-lights the whole page in that profile's colour while its mark
// flies from the card into the page header; Jarvis can FLY you to an answer
// level by level, so you watch the path it took.
// ---------------------------------------------------------------------------

import { LayoutGroup, motion, AnimatePresence } from "motion/react";
import { Undo2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { harnessReady } from "@/lib/profiles/brain";
import type { HarnessStatus } from "@/lib/profiles/harnessBrain";
import { resetHarnessThread } from "@/lib/profiles/harnessBrain";
import { ROOT } from "@/lib/profiles/seed";
import { hueOf, pathTo } from "@/lib/profiles/tree";
import type { Media } from "@/lib/profiles/types";
import { useProfiles } from "@/lib/profiles/useProfiles";
import { Jarvis, type JarvisMode } from "./Jarvis";
import { GalleryView, HomeView, Lightbox, NodeView, SettingsView, type Nav, type View } from "./views";
import { LightboxIdentityActions } from "./identity";
import "./profiles.css";

const EASE = [0.16, 1, 0.3, 1] as const;
const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
/** A tab opened in the background never runs its entrance; it must not open half-faded. */
const hidden = () => typeof document !== "undefined" && document.visibilityState !== "visible";
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function keyOf(v: View) {
  return `${v.t}:${v.id}`;
}

/** `#son`, `#son/photos`, `#son/settings`, `#settings` */
function hashFor(v: View): string {
  if (v.t === "settings" && v.id === ROOT) return "#settings";
  if (v.id === ROOT) return "";
  return `#${v.id}${v.t === "gallery" ? "/photos" : v.t === "settings" ? "/settings" : ""}`;
}

export interface SettingsExtra {
  id: string;
  title: string;
  blurb?: string;
  render: () => ReactNode;
}

export interface ProfilesAppProps {
  /**
   * Mounted inside another surface (Jarvis › Profile, the Dashboard's Profiles
   * tab): scrolls inside its own box, never touches the page's address bar,
   * and keeps the Jarvis bar inside that box.
   */
  embedded?: boolean;
  /** Extra settings groups the host owns — Jarvis passes Connections and the Backend checklist. */
  settingsExtras?: SettingsExtra[];
  /** Open Profiles › Settings with this extra expanded (e.g. a #connections link). */
  openSettings?: string;
}

export function ProfilesApp({ embedded = false, settingsExtras = [], openSettings }: ProfilesAppProps = {}) {
  const store = useProfiles();
  const { data } = store;
  const [stack, setStack] = useState<View[]>([{ t: "node", id: ROOT }]);
  const [dir, setDir] = useState<"in" | "out">("in");
  const [highlight, setHighlight] = useState("");
  const [reveal, setReveal] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<JarvisMode>("bar");
  const [peek, setPeek] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [lb, setLb] = useState<{ list: Media[]; i: number } | null>(null);
  const [toast, setToast] = useState<{ text: string; undo?: string; n: number } | null>(null);
  const [request, setRequest] = useState<{ text: string; send: boolean; n: number } | null>(null);
  const [harness, setHarness] = useState<HarnessStatus | null>(null);
  const [resetNonce, setResetNonce] = useState(0);
  const flying = useRef(false);
  const [navigated, setNavigated] = useState(false);
  const [still, setStill] = useState(false);
  useEffect(() => {
    const sync = () => setStill(hidden());
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);

  const view = stack[stack.length - 1];
  const here = view.id;
  const hue = hueOf(data, here);

  // --- deep links: #son, #son/photos, #son/settings, #settings ------------------------
  const dataRef = useRef(data);
  dataRef.current = data;
  const fromHash = useCallback((): View[] | null => {
    const raw = window.location.hash.slice(1);
    const d = dataRef.current;
    if (!raw) return [{ t: "node", id: ROOT }];
    const [id, sub] = raw.split("/");
    if (id === "settings") return [{ t: "node", id: ROOT }, { t: "settings", id: ROOT }];
    if (!d.nodes[id]) return null;
    const s: View[] = pathTo(d, id).map((x) => ({ t: "node", id: x }));
    if (sub === "photos") s.push({ t: "gallery", id });
    if (sub === "settings") s.push({ t: "settings", id });
    return s;
  }, []);
  const hashRead = useRef(false);
  useEffect(() => {
    // Inside Jarvis the hash is Jarvis's (#connections, #harness…), not ours.
    if (!store.ready || embedded) return;
    const s = fromHash();
    if (s) setStack(s);
    hashRead.current = true;
    const onHash = () => {
      const next = fromHash();
      if (next) setStack((cur) => (cur.map(keyOf).join() === next.map(keyOf).join() ? cur : next));
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [embedded, fromHash, store.ready]);
  useEffect(() => {
    // Not before the link we arrived on has been read, or it would be wiped.
    if (!hashRead.current || embedded) return;
    const h = hashFor(view);
    // Each level is a history entry, so the browser's Back goes up a level.
    if (window.location.hash !== h && (window.location.hash || h)) history.pushState(null, "", h || window.location.pathname + window.location.search);
  }, [embedded, view]);

  // A host can ask for Settings with one of its groups open.
  useEffect(() => {
    if (openSettings) setStack([{ t: "node", id: ROOT }, { t: "settings", id: ROOT }]);
  }, [openSettings]);

  // --- the page's light follows the world you are in --------------------------------
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    root.current?.style.setProperty("--pf-hue", String(hue));
  }, [hue]);

  useEffect(() => {
    const box = embedded ? root.current : null;
    const onScroll = () => setScrolled((box ? box.scrollTop : window.scrollY) > 140);
    onScroll();
    const target: HTMLElement | Window = box ?? window;
    target.addEventListener("scroll", onScroll, { passive: true });
    return () => target.removeEventListener("scroll", onScroll);
  }, [embedded]);

  const recheck = useCallback(() => {
    setHarness(null);
    void harnessReady(true).then(setHarness);
  }, []);
  useEffect(() => {
    void harnessReady().then(setHarness);
  }, []);

  // --- navigation ---------------------------------------------------------------
  const setTop = useCallback((next: View[], d: "in" | "out") => {
    setNavigated(true);
    setDir(d);
    if (embedded) root.current?.scrollTo({ top: 0 });
    else window.scrollTo({ top: 0 });
    setStack(next);
  }, [embedded]);

  const showToast = useCallback(
    (text: string, undo?: string) => setToast({ text, undo: undo === "last" ? store.lastLog() : undo, n: Date.now() }),
    [store],
  );
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.undo ? 6000 : 2600);
    return () => clearTimeout(t);
  }, [toast]);

  /** Go to a node level by level from wherever we are, so the path is visible. */
  const fly = useCallback(
    async (id: string, opts: { highlight?: string; gallery?: boolean } = {}) => {
      if (!data.nodes[id] || flying.current) return;
      flying.current = true;
      const target: View[] = pathTo(data, id).map((x) => ({ t: "node", id: x }));
      if (opts.gallery) target.push({ t: "gallery", id });
      let k = 0;
      while (k < stack.length && k < target.length && keyOf(stack[k]) === keyOf(target[k])) k++;
      try {
        if (reduced() || (k === stack.length && target.length - k <= 1)) {
          setTop(target, k < stack.length ? "out" : "in");
        } else {
          if (k < stack.length) {
            setTop(target.slice(0, Math.max(k, 1)), "out");
            await wait(260);
          }
          for (let i = Math.max(k, 1); i < target.length; i++) {
            setTop(target.slice(0, i + 1), "in");
            await wait(300);
          }
        }
        if (opts.highlight) {
          setHighlight(opts.highlight);
          setTimeout(() => setHighlight(""), 3200);
        }
      } finally {
        flying.current = false;
      }
    },
    [data, setTop, stack],
  );

  const nav: Nav = useMemo(
    () => ({
      open: (v) => {
        if (v.t === "node" && v.id !== ROOT && stack.some((s) => keyOf(s) === keyOf(v))) {
          // A link back up the stack: pull out to it rather than stacking a loop.
          setTop(stack.slice(0, stack.findIndex((s) => keyOf(s) === keyOf(v)) + 1), "out");
          return;
        }
        if (v.t === "node" && data.nodes[v.id] && !stack.some((s) => s.id === pathTo(data, v.id).slice(-2)[0])) {
          // A linked profile that lives elsewhere: arrive by its real path.
          void fly(v.id);
          return;
        }
        setTop([...stack, v], "in");
      },
      back: () => stack.length > 1 && setTop(stack.slice(0, -1), "out"),
      toCrumb: (i) => setTop(stack.slice(0, i + 1), "out"),
      ask: (text, opts) => setRequest({ text, send: Boolean(opts?.send), n: Date.now() }),
      toast: showToast,
    }),
    [data, fly, setTop, showToast, stack],
  );

  // --- Esc: the innermost thing closes first -----------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (lb) return; // the lightbox handles its own
      const t = e.target as HTMLElement;
      if (mode === "full") return setMode("bar");
      if (peek) return setPeek(false);
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return t.blur();
      if (stack.length > 1) setTop(stack.slice(0, -1), "out");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lb, mode, peek, setTop, stack]);

  const brainLabel =
    data.settings.brain === "offline"
      ? "Offline reader"
      : data.settings.brain === "cloud"
        ? "Cloud model"
        : harness?.ok
          ? `${harness.label} on your PC · Jarvis harness`
          : harness == null
            ? "Connecting to your PC…"
            : "Cloud, then offline · your PC harness is off";

  const toggleReveal = useCallback((id: string) => setReveal((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; }), []);

  const page =
    view.t === "settings" ? (
      <SettingsView store={store} nav={nav} stack={stack} id={view.id} harness={harness} recheck={recheck} extras={settingsExtras} openExtra={openSettings} embedded={embedded} resetChat={() => { void resetHarnessThread(); setResetNonce(Date.now()); showToast("Fresh conversation"); }} />
    ) : view.t === "gallery" ? (
      <GalleryView store={store} nav={nav} stack={stack} id={view.id} lightbox={(list, i) => setLb({ list, i })} />
    ) : view.id === ROOT ? (
      <HomeView store={store} nav={nav} stack={stack} />
    ) : (
      <NodeView store={store} nav={nav} stack={stack} id={view.id} highlight={highlight} reveal={reveal} setReveal={toggleReveal} />
    );

  return (
    <div ref={root} className={`pf${still ? " still" : ""}${embedded ? " embedded" : ""}`} style={{ "--pf-hue": hue } as CSSProperties}>
      <div className="pf-ambient" aria-hidden="true" />
      <LayoutGroup>
        <motion.main
          key={keyOf(view)}
          className="pf-wrap"
          // No entrance on the very first paint: the server cannot know whether
          // the tab is visible, and guessing differently from the browser is a
          // hydration mismatch. Every later page change animates.
          initial={!navigated || reduced() || hidden() ? false : { opacity: 0, scale: dir === "in" ? 0.975 : 1.025, filter: "blur(8px)" }}
          animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
          transition={{ duration: 0.55, ease: EASE }}
          style={{ transformOrigin: "50% 20%" }}
        >
          {page}
        </motion.main>
      </LayoutGroup>

      <Jarvis
        store={store}
        here={view.t === "node" ? here : view.id}
        mode={mode}
        setMode={setMode}
        scrolled={scrolled}
        peek={peek}
        setPeek={setPeek}
        request={request}
        brainLabel={brainLabel}
        resetNonce={resetNonce}
        go={(id, opts) => void fly(id, opts)}
        lightbox={(list, i) => setLb({ list, i })}
        toast={showToast}
      />

      <AnimatePresence>
        {lb ? (
          <Lightbox
            key="lb"
            list={lb.list}
            index={lb.i}
            close={() => setLb(null)}
            actions={(m) => {
              const owner = Object.values(store.data.nodes).find((n) => n.media.some((x) => x.id === m.id));
              return owner ? <LightboxIdentityActions store={store} node={owner} m={m} nav={nav} /> : null;
            }}
          />
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {toast && mode === "bar" && !peek ? (
          <motion.div key={toast.n} className="pf-toast" role="status" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }} transition={{ duration: 0.3, ease: EASE }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
              {toast.text}
              {toast.undo ? (
                <button type="button" className="pf-btn" style={{ padding: "4px 10px" }} onClick={() => { store.undo(toast.undo!); setToast(null); }}>
                  <Undo2 /> Undo
                </button>
              ) : null}
            </span>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
