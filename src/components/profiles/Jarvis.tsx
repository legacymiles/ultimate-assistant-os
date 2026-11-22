"use client";

// ---------------------------------------------------------------------------
// Jarvis in Profiles — the one interface for finding and filing anything.
//
// Four sizes, and the owner is always in charge of which:
//   orb   — while scrolling and browsing by hand
//   bar   — resting state on every page; focus offers questions for this page
//   peek  — a quick question answers in one card above the bar
//   full  — the conversation: tell Jarvis things, drop photos, review changes
//
// Nothing Jarvis proposes is saved until the owner taps Save, and every save
// lands in Changed today with an Undo. The brain is the owner's harness on
// their PC when it is on (lib/profiles/brain.ts), the cloud otherwise, and the
// offline reader when neither can answer.
// ---------------------------------------------------------------------------

import { AnimatePresence, motion } from "motion/react";
import {
  ArrowUp, ArrowUpRight, Check, ChevronDown, ChevronUp, Copy, Eye, Images, Mic, Minimize2, Move, Paperclip, Pencil, Plus, ShieldCheck, Trash2, Undo2, X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ask } from "@/lib/profiles/brain";
import type { Turn } from "@/lib/profiles/agent";
import type { Found } from "@/lib/profiles/found";
import { applyChanges, describeChanges, type ChangeLine } from "@/lib/profiles/changes";
import { ROOT } from "@/lib/profiles/seed";
import { findItem, hueOf, mediaUnder, pathTo, resolveNode, whereLabel } from "@/lib/profiles/tree";
import type { AgentActions, Change, Media, ProfilesData } from "@/lib/profiles/types";
import type { ProfilesStore } from "@/lib/profiles/useProfiles";
import { useVoiceTarget } from "../voice/VoiceProvider";
import { fileToMedia, MediaTile, Mark } from "./bits";

import { describeIdentity, identifyImage } from "@/lib/identity/match";
export type JarvisMode = "bar" | "full";

interface Pending {
  changes: Change[];
  lines: ChangeLine[];
  on: boolean[];
  state: "waiting" | "saved" | "cancelled" | "undone";
  logId?: string;
  skipped?: string[];
  focus?: string | null;
}

type Msg =
  | { id: string; role: "user"; text: string; media?: Media[] }
  | { id: string; role: "jarvis"; text: string; status: "thinking" | "done" | "error"; by?: string; note?: string; actions?: AgentActions; pending?: Pending; ask: string; found?: Found[] };

const uid = () => Math.random().toString(36).slice(2, 10);
const sty = (o: Record<string, string | number>) => o as CSSProperties;
const GLOBAL_ASKS = ["What email do I use for my printing suppliers?", "What is the gas code at my job?", "Show me pictures of my son"];

export interface JarvisProps {
  store: ProfilesStore;
  here: string;
  mode: JarvisMode;
  setMode: (m: JarvisMode) => void;
  scrolled: boolean;
  peek: boolean;
  setPeek: (v: boolean) => void;
  request: { text: string; send: boolean; n: number } | null;
  brainLabel: string;
  resetNonce: number;
  go: (id: string, opts?: { highlight?: string; gallery?: boolean }) => void;
  lightbox: (list: Media[], i: number) => void;
  toast: (t: string) => void;
}

export function Jarvis(p: JarvisProps) {
  const { store, here, mode, setMode, peek, setPeek } = p;
  const { data } = store;
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [bar, setBar] = useState("");
  const [draft, setDraft] = useState("");
  const [focused, setFocused] = useState(false);
  const [attach, setAttach] = useState<Media[]>([]);
  const [scope, setScope] = useState<"all" | "here">("all");
  const [busy, setBusy] = useState(false);
  const [reveal, setReveal] = useState<Set<string>>(new Set());
  const [listening, setListening] = useState(false);
  const barInput = useRef<HTMLInputElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const thread = useRef<HTMLDivElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);
  const dataRef = useRef(data);
  dataRef.current = data;

  // After a new profile is saved, the conversation stays with it, so the
  // answers to its intake questions are filed there — until the page moves.
  const [focus, setFocus] = useState<string | null>(null);
  useEffect(() => setFocus(null), [here]);
  const chatHere = focus && data.nodes[focus] && !data.nodes[focus].archived ? focus : here;
  const hereNode = data.nodes[chatHere];
  const hue = hueOf(data, chatHere);

  // Fresh conversation (Settings → Start fresh).
  useEffect(() => {
    if (p.resetNonce) setMsgs([]);
  }, [p.resetNonce]);

  useEffect(() => {
    if (here === ROOT) setScope("all");
  }, [here]);

  // "/" focuses the bar from anywhere that is not already a text field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
      if (e.key === "/" && !typing) {
        e.preventDefault();
        if (mode === "full") area.current?.focus();
        else barInput.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode]);

  useEffect(() => {
    thread.current?.scrollTo({ top: thread.current.scrollHeight, behavior: "smooth" });
  }, [msgs, mode]);

  useEffect(() => {
    if (mode === "full") setTimeout(() => area.current?.focus(), 60);
  }, [mode]);

  // --- talking -----------------------------------------------------------------

  const send = useCallback(
    async (raw: string, from: "bar" | "full", media: Media[] = []): Promise<string> => {
      const text = raw.trim();
      if ((!text && !media.length) || busy) return busy ? "I'm still answering the last one." : "";
      const d = dataRef.current;
      const history: Turn[] = msgs
        .filter((m) => m.role === "user" || (m.role === "jarvis" && m.status === "done"))
        .map((m) => ({ role: m.role === "user" ? "user" : "assistant", text: m.text }));
      const user: Msg = { id: uid(), role: "user", text: text || (media.length === 1 ? "A photo" : `${media.length} photos`), media: media.length ? media : undefined };
      const jid = uid();
      setMsgs((m) => [...m, user, { id: jid, role: "jarvis", text: "", status: "thinking", ask: text }]);
      if (from === "bar") setPeek(true);
      if (media.length) setMode("full");
      setBusy(true);
      abort.current?.abort();
      const ctl = new AbortController();
      abort.current = ctl;
      // Who is in the first photo, by the faces enrolled in Profiles. Sure
      // matches can decide where it is filed; unsure ones only inform the ask.
      const firstPhoto = media.find((m) => m.kind === "photo" && m.src);
      const faces = firstPhoto?.src ? await identifyImage(firstPhoto.src).catch(() => null) : null;
      const facesLine = faces ? describeIdentity(faces) : "";
      const message = media.length ? `${text || "Here are some photos."}\n[The owner attached ${media.length} ${media.length === 1 ? "photo" : "photos/videos"}. Put the profile id they belong in as "media".]${facesLine ? `\n${facesLine}` : ""}` : text;
      try {
        const a = await ask({
          data: d,
          here: chatHere,
          scope,
          message,
          history,
          signal: ctl.signal,
          onText: (s) => setMsgs((m) => m.map((x) => (x.id === jid && x.role === "jarvis" ? { ...x, text: s } : x))),
        });
        const changes = [...(a.actions.changes ?? [])];
        let words = a.text;
        if (media.length) {
          // One person recognised for sure is a better guess than "the page I'm on".
          const recognised = faces?.sure.length === 1 ? faces.sure[0].identityId : null;
          const target = a.actions.media ?? a.actions.open ?? resolveNode(d, text, chatHere)?.id ?? recognised ?? (chatHere !== ROOT ? chatHere : null);
          if (target && d.nodes[target]) {
            changes.push({ op: "add_media", node: target, media });
            if (!a.actions.changes?.length && a.by !== "harness") words = `I'll file ${media.length === 1 ? "it" : `all ${media.length}`} in ${d.nodes[target].name}'s photos.`;
          } else words = `${words}\n\nWhich profile should ${media.length === 1 ? "this go" : "these go"} in? Open it, or tell me.`.trim();
        }
        const pending: Pending | undefined = changes.length
          ? { changes, lines: describeChanges(d, changes), on: changes.map(() => true), state: "waiting" }
          : undefined;
        if (pending && from === "bar") setMode("full");
        setMsgs((m) =>
          m.map((x) =>
            x.id === jid
              ? { id: jid, role: "jarvis", ask: text, text: words, status: "done", by: a.label, note: a.note, actions: { ...a.actions, media: media.length ? undefined : a.actions.media }, pending, found: a.found }
              : x,
          ),
        );
        // "Open the heat press" — go there straight away.
        if (a.actions.open && !changes.length && /^(open|go to|take me|jump|show me)\b/i.test(text)) p.go(a.actions.open);
        // What the voice reads back: the words, plus a nudge when changes wait for Save.
        return pending
          ? `${words} ${pending.lines.length === 1 ? "One change is" : `${pending.lines.length} changes are`} waiting for you to tap Save.`
          : words;
      } catch (e) {
        if ((e as Error).name === "AbortError") {
          setMsgs((m) => m.filter((x) => x.id !== jid));
          return "";
        }
        setMsgs((m) => m.map((x) => (x.id === jid ? { id: jid, role: "jarvis", ask: text, text: `Something went wrong: ${(e as Error).message}`, status: "error" } : x)));
        return `Something went wrong: ${(e as Error).message}`;
      } finally {
        setBusy(false);
      }
    },
    [busy, chatHere, msgs, p, scope, setMode, setPeek],
  );

  // The hub's voice (components/voice): "Jarvis, …" on any Profiles page comes
  // here, answers in the peek card or the open chat, and is read back.
  const voiceTarget = useVoiceTarget({
    id: "profiles-chat",
    label: hereNode && chatHere !== ROOT ? `Profiles · ${hereNode.name}` : "Profiles",
    kind: "chat",
    // Profiles is only mounted while it is on screen (its own page, or the
    // Profile pane inside Jarvis), so it outranks Jarvis's main chat then.
    priority: 35,
    send: (text) => send(text, mode === "full" ? "full" : "bar"),
  });

  // Requests from the page ("Add details with Jarvis", chips, settings).
  useEffect(() => {
    if (!p.request) return;
    if (p.request.send) {
      setMode("full");
      void send(p.request.text, "full");
    } else {
      setMode("full");
      setDraft(p.request.text);
      setTimeout(() => {
        const el = area.current;
        if (el) {
          el.focus();
          el.setSelectionRange(el.value.length, el.value.length);
        }
      }, 80);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.request?.n]);

  const save = (id: string) => {
    const m = msgs.find((x) => x.id === id);
    if (!m || m.role !== "jarvis" || !m.pending) return;
    const chosen = m.pending.changes.filter((_, i) => m.pending!.on[i]);
    if (!chosen.length) return;
    const r = store.apply(chosen, m.pending.lines.filter((_, i) => m.pending!.on[i]).map((l) => l.title).join(" · "));
    const made = Object.values(r.created)[0];
    if (made) setFocus(made);
    setMsgs((all) => all.map((x) => (x.id === id && x.role === "jarvis" && x.pending ? { ...x, pending: { ...x.pending, state: "saved", logId: r.logId, skipped: r.skipped, focus: r.focus } } : x)));
  };

  const setPending = (id: string, patch: Partial<Pending>) =>
    setMsgs((all) => all.map((x) => (x.id === id && x.role === "jarvis" && x.pending ? { ...x, pending: { ...x.pending, ...patch } } : x)));

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const made = (await Promise.all([...files].slice(0, 24).map(fileToMedia))).filter((m): m is Media => Boolean(m));
    if (!made.length) p.toast("Those files aren't photos or videos");
    setAttach((a) => [...a, ...made]);
    setMode("full");
  };

  const dictate = () => {
    type Rec = { lang: string; interimResults: boolean; continuous: boolean; onresult: (e: { results: ArrayLike<{ 0: { transcript: string } }> }) => void; onend: () => void; start: () => void; stop: () => void };
    const W = window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec };
    const R = W.SpeechRecognition ?? W.webkitSpeechRecognition;
    if (!R) return p.toast("This browser can't take dictation. Try Chrome or Safari.");
    if (listening) return;
    const r = new R();
    r.lang = "en-US";
    r.interimResults = true;
    r.continuous = false;
    const before = draft ? `${draft.trimEnd()} ` : "";
    r.onresult = (e) => setDraft(before + Array.from(e.results).map((x) => x[0].transcript).join(""));
    r.onend = () => setListening(false);
    setListening(true);
    r.start();
  };

  const last = [...msgs].reverse().find((m): m is Extract<Msg, { role: "jarvis" }> => m.role === "jarvis");
  const waiting = [...msgs].reverse().find((m): m is Extract<Msg, { role: "jarvis" }> => m.role === "jarvis" && m.pending?.state === "waiting");
  const asks = hereNode?.asks?.length ? hereNode.asks : GLOBAL_ASKS;
  const orb = p.scrolled && !focused && mode === "bar" && !peek && !bar;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todays = data.log.filter((l) => l.at >= today.getTime());

  // --- render ------------------------------------------------------------------

  const card = (m: Extract<Msg, { role: "jarvis" }>, compact = false) => (
    <JarvisBody
      m={m}
      data={data}
      compact={compact}
      mask={data.settings.mask}
      reveal={reveal}
      setReveal={(id) => setReveal((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; })}
      go={(id, opts) => { setPeek(false); setMode("bar"); p.go(id, opts); }}
      lightbox={p.lightbox}
      toast={p.toast}
      ask={(t) => void send(t, compact ? "bar" : "full")}
      save={() => save(m.id)}
      cancel={() => setPending(m.id, { state: "cancelled" })}
      toggle={(i) => m.pending && setPending(m.id, { on: m.pending.on.map((v, k) => (k === i ? !v : v)) })}
      undo={() => { if (m.pending?.logId) { store.undo(m.pending.logId); setPending(m.id, { state: "undone" }); } }}
      openFull={() => { setPeek(false); setMode("full"); }}
    />
  );

  return (
    <>
      <AnimatePresence>
        {mode === "full" ? (
          <>
            <motion.div key="scrim" className="pf-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setMode("bar")} />
            <motion.section
              key="sheet"
              className="pf-sheet"
              role="dialog"
              aria-modal="true"
              aria-label="Jarvis"
              style={sty({ "--h": hue })}
              initial={{ opacity: 0, y: 40, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 30, scale: 0.98 }}
              transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            >
              <div className="pf-convo">
                <div className="pf-s-head">
                  <span className={`pf-orb${busy ? " busy" : ""}`} />
                  <div className="pf-s-title">
                    <strong>Jarvis</strong>
                    <span>{p.brainLabel}</span>
                  </div>
                  {chatHere !== ROOT && hereNode ? (
                    <div className="pf-scope" role="group" aria-label="Search where">
                      <button type="button" aria-pressed={scope === "all"} onClick={() => setScope("all")}>Everywhere</button>
                      <button type="button" aria-pressed={scope === "here"} onClick={() => setScope("here")}>In {hereNode.name}</button>
                    </div>
                  ) : null}
                  <div className="pf-s-tools">
                    <button type="button" className="pf-ib" onClick={() => setMode("bar")} aria-label="Shrink to the bar">
                      <Minimize2 />
                    </button>
                  </div>
                </div>
                <div className="pf-thread" ref={thread} aria-live="polite">
                  {!msgs.length ? (
                    <div className="pf-welcome">
                      <h2>{chatHere !== ROOT && hereNode ? `What should I know about ${hereNode.name}?` : "Tell me anything. I'll file it."}</h2>
                      <p>Ask where something is, or tell me something new in your own words: a person, a code, a date, a purchase. I&apos;ll work out where it belongs and ask before saving. Drop photos in and I&apos;ll file those too.</p>
                      <div className="pf-chips">
                        {asks.map((t) => (
                          <button key={t} type="button" className="pf-chip" onClick={() => void send(t, "full")}>
                            {t}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {msgs.map((m) =>
                    m.role === "user" ? (
                      <motion.div key={m.id} className="pf-u" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
                        {m.media?.length ? (
                          <div className="pf-u-media">
                            {m.media.slice(0, 8).map((x) => (
                              <MediaTile key={x.id} m={x} />
                            ))}
                          </div>
                        ) : null}
                        {m.text}
                      </motion.div>
                    ) : (
                      <motion.div key={m.id} className="pf-a" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
                        <span className={`pf-orb${m.status === "thinking" ? " busy" : ""}`} />
                        {card(m)}
                      </motion.div>
                    ),
                  )}
                </div>
                <form
                  className="pf-composer"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void send(draft, "full", attach);
                    setDraft("");
                    setAttach([]);
                  }}
                >
                  {attach.length ? (
                    <div className="pf-attach">
                      {attach.map((x) => (
                        <MediaTile key={x.id} m={x} onClick={() => setAttach((a) => a.filter((y) => y.id !== x.id))} />
                      ))}
                    </div>
                  ) : null}
                  <textarea
                    ref={area}
                    id="pf-composer"
                    onFocus={voiceTarget.touch}
                    rows={1}
                    value={draft}
                    placeholder={chatHere !== ROOT && hereNode ? `Tell Jarvis about ${hereNode.name}, or ask anything…` : "Tell Jarvis something, or ask anything…"}
                    onChange={(e) => {
                      setDraft(e.target.value);
                      e.target.style.height = "auto";
                      e.target.style.height = `${Math.min(160, e.target.scrollHeight)}px`;
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        e.currentTarget.form?.requestSubmit();
                      }
                    }}
                    onPaste={(e) => {
                      if (e.clipboardData.files.length) {
                        e.preventDefault();
                        void onFiles(e.clipboardData.files);
                      }
                    }}
                  />
                  <div className="pf-c-row">
                    <input ref={file} id="pf-attach" type="file" accept="image/*,video/*" multiple hidden onChange={(e) => { void onFiles(e.target.files); e.target.value = ""; }} />
                    <button type="button" className="pf-ib" onClick={() => file.current?.click()} aria-label="Attach photos or videos">
                      <Paperclip />
                    </button>
                    <button type="button" className={`pf-ib${listening ? " pf-rec" : ""}`} onClick={dictate} aria-label={listening ? "Listening" : "Dictate"}>
                      <Mic />
                    </button>
                    <span className="pf-hint">
                      <ShieldCheck />
                      Jarvis asks before saving anything
                    </span>
                    <button type="submit" className="pf-send" aria-label="Send" disabled={busy || (!draft.trim() && !attach.length)}>
                      <ArrowUp />
                    </button>
                  </div>
                </form>
              </div>
              <LivePanel data={data} waiting={waiting} todays={todays} undo={(id) => store.undo(id)} />
            </motion.section>
          </>
        ) : null}
      </AnimatePresence>

      {mode === "bar" ? (
        <div className="pf-j">
          <AnimatePresence>
            {peek && last ? (
              <motion.div
                key="peek"
                className="pf-float"
                style={sty({ "--h": hue })}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
              >
                <div className="pf-peekc">
                  <div className="pf-peekc-row">
                    <span className={`pf-orb${last.status === "thinking" ? " busy" : ""}`} style={sty({ "--s": "20px" })} />
                    <span className="pf-src">{last.status === "thinking" ? "THINKING…" : (last.by ?? "").toUpperCase()}</span>
                    <span className="pf-sp">
                      <button type="button" className="pf-btn" onClick={() => { setPeek(false); setMode("full"); }}>
                        Open chat
                      </button>
                      <button type="button" className="pf-ib" style={{ width: 32, height: 32 }} onClick={() => setPeek(false)} aria-label="Close">
                        <X />
                      </button>
                    </span>
                  </div>
                  {card(last, true)}
                </div>
              </motion.div>
            ) : focused && !bar && !peek ? (
              <motion.div key="suggest" className="pf-float pf-suggest pf-chips" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }}>
                {asks.slice(0, 3).map((t) => (
                  <button key={t} type="button" className="pf-chip" onMouseDown={(e) => e.preventDefault()} onClick={() => void send(t, "bar")}>
                    <b>{/^(remember|add|move|change|i )/i.test(t) ? "Tell" : "Ask"}</b> · {t}
                  </button>
                ))}
              </motion.div>
            ) : null}
          </AnimatePresence>

          <AnimatePresence mode="wait" initial={false}>
            {orb ? (
              <motion.button
                key="orb"
                type="button"
                className="pf-fab"
                aria-label="Ask Jarvis"
                initial={{ opacity: 0, scale: 0.6 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.6 }}
                transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                onClick={() => setTimeout(() => barInput.current?.focus(), 30)}
                onFocus={() => setTimeout(() => barInput.current?.focus(), 30)}
              >
                <span className="pf-orb" />
              </motion.button>
            ) : (
              <motion.form
                key="bar"
                className={`pf-bar${focused ? " focus" : ""}`}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 16 }}
                transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                onSubmit={(e) => {
                  e.preventDefault();
                  void send(bar, "bar");
                  setBar("");
                }}
              >
                <span className={`pf-orb${busy ? " busy" : ""}`} />
                <input
                  ref={barInput}
                  id="pf-bar"
                  value={bar}
                  autoComplete="off"
                  onChange={(e) => setBar(e.target.value)}
                  onFocus={() => {
                    setFocused(true);
                    voiceTarget.touch();
                  }}
                  onBlur={() => setTimeout(() => setFocused(false), 120)}
                  placeholder={chatHere !== ROOT && hereNode ? `Ask about ${hereNode.name}, or tell Jarvis something…` : "Ask about anything, or tell Jarvis something new"}
                  aria-label="Ask or tell Jarvis"
                />
                {bar ? (
                  <button type="submit" className="pf-send" aria-label="Ask" disabled={busy}>
                    <ArrowUp />
                  </button>
                ) : (
                  <>
                    <span className="pf-kbd">/</span>
                    <span className="pf-vr" />
                    <button type="button" className="pf-exp" onClick={() => { setPeek(false); setMode("full"); }} aria-label="Open the chat">
                      {msgs.length ? <span className="pf-badge" /> : null}
                      <span>Chat</span>
                      <ChevronUp />
                    </button>
                  </>
                )}
              </motion.form>
            )}
          </AnimatePresence>
        </div>
      ) : null}
    </>
  );
}

// --- one Jarvis message ------------------------------------------------------------

function JarvisBody({ m, data, compact, mask, reveal, setReveal, go, lightbox, toast, ask, save, cancel, toggle, undo, openFull }: {
  m: Extract<Msg, { role: "jarvis" }>;
  data: ProfilesData;
  compact: boolean;
  mask: boolean;
  reveal: Set<string>;
  setReveal: (id: string) => void;
  go: (id: string, opts?: { highlight?: string; gallery?: boolean }) => void;
  lightbox: (list: Media[], i: number) => void;
  toast: (t: string) => void;
  ask: (t: string) => void;
  save: () => void;
  cancel: () => void;
  toggle: (i: number) => void;
  undo: () => void;
  openFull: () => void;
}) {
  if (m.status === "thinking" && !m.text)
    return (
      <div className="pf-a-body">
        <span className="pf-typing" aria-label="Jarvis is thinking">
          <i />
          <i />
          <i />
        </span>
      </div>
    );
  // A change set is the answer; source cards beside it are clutter.
  const sources = (m.pending ? (m.actions?.sources ?? []).filter((id) => /^(mem|rec):/.test(id)) : (m.actions?.sources ?? [])).slice(0, compact ? 1 : 4);
  const mediaNode = m.actions?.media && data.nodes[m.actions.media] ? m.actions.media : null;
  const media = mediaNode ? mediaUnder(data, mediaNode) : [];
  const openNode = m.actions?.open && data.nodes[m.actions.open] ? data.nodes[m.actions.open] : null;
  const pend = m.pending;
  return (
    <div className="pf-a-body">
      {m.text ? <p>{rich(m.text)}</p> : null}
      {sources.map((id) => {
        const elsewhere = m.found?.find((x) => x.id === id);
        if (elsewhere)
          return (
            <div key={id} className="pf-rc" style={sty({ "--h": elsewhere.source === "Memory" ? 268 : elsewhere.source === "Photos" ? 34 : 198 })}>
              {elsewhere.src ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="pf-thumb" src={elsewhere.src} alt="" />
              ) : null}
              <div className="pf-rc-main">
                <div className="pf-src">
                  <span className="pf-tag">{elsewhere.source}</span>
                  {elsewhere.where}
                </div>
                <div className="pf-rc-v">{elsewhere.title}</div>
                {elsewhere.text ? <div className="pf-rc-t">{elsewhere.text}</div> : null}
              </div>
            </div>
          );
        const f = findItem(data, id);
        if (f) {
          const hidden = f.item.secret && mask && !reveal.has(f.item.id);
          const h = hueOf(data, f.node.id);
          return (
            <div key={id} className="pf-rc" style={sty({ "--h": h })}>
              <div className="pf-rc-main">
                <div className="pf-src">
                  <span className="pf-tag">Profile</span>
                  {whereLabel(data, f.node.id)} › {f.section.title.toUpperCase()}
                </div>
                <div className={`pf-rc-v${f.item.secret ? " big" : ""}`}>
                  {f.item.k} ·{" "}
                  {hidden ? (
                    <button type="button" className="pf-mask" onClick={() => setReveal(f.item.id)} aria-label={`Show ${f.item.k}`}>
                      <Eye /> ••••<em>Show</em>
                    </button>
                  ) : (
                    f.item.v
                  )}
                </div>
              </div>
              <button
                type="button"
                className="pf-ib"
                style={{ width: 32, height: 32 }}
                aria-label={`Copy ${f.item.k}`}
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(f.item.v);
                    toast(`Copied ${f.item.k}`);
                  } catch {
                    toast("Your browser blocked copying");
                  }
                }}
              >
                <Copy />
              </button>
              <button type="button" className="pf-ib" style={{ width: 32, height: 32 }} aria-label={`Go to ${f.node.name}`} onClick={() => go(f.node.id, { highlight: f.item.id })}>
                <ArrowUpRight />
              </button>
            </div>
          );
        }
        const n = data.nodes[id];
        if (!n) return null;
        const h = hueOf(data, n.id);
        return (
          <button key={id} type="button" className="pf-rc" style={sty({ "--h": h })} onClick={() => go(n.id)}>
            <Mark node={n} hue={h} size={32} soft={n.kind === "thing"} />
            <div className="pf-rc-main">
              <div className="pf-src">
                <span className="pf-tag">Profile</span>
                {whereLabel(data, n.id)}
              </div>
              <div className="pf-rc-v">{n.sub || n.label}</div>
            </div>
            <ArrowUpRight />
          </button>
        );
      })}
      {/* Pages a researched answer came from — the same card as a profile
          source, so a web answer reads as part of the app rather than a
          bolted-on browser. Opened in a new tab: the owner is mid-conversation. */}
      {(m.actions?.links ?? []).slice(0, compact ? 1 : 3).map((l) => {
        let host = l.url;
        try {
          host = new URL(l.url).hostname.replace(/^www\./, "");
        } catch {
          /* show the raw address */
        }
        return (
          <a key={l.url} className="pf-rc" href={l.url} target="_blank" rel="noopener noreferrer" style={sty({ "--h": 210 })}>
            <div className="pf-rc-main">
              <div className="pf-src">
                <span className="pf-tag">Web</span>
                {host}
              </div>
              <div className="pf-rc-v">{l.title}</div>
            </div>
            <ArrowUpRight />
          </a>
        );
      })}
      {media.length ? (
        <>
          <div className="pf-strip">
            {media.slice(0, compact ? 3 : 6).map((x, i) => (
              <MediaTile key={x.id} m={x} onClick={() => lightbox(media, i)} />
            ))}
          </div>
          <div>
            <button type="button" className="pf-btn" onClick={() => go(mediaNode!, { gallery: true })}>
              <Images /> Open gallery
            </button>
          </div>
        </>
      ) : null}
      {openNode && !pend && !sources.includes(openNode.id) ? (
        <div>
          <button type="button" className="pf-btn" onClick={() => go(openNode.id)}>
            Open {openNode.name} <ArrowUpRight />
          </button>
        </div>
      ) : null}
      {pend ? (
        compact && pend.state === "waiting" ? (
          <div>
            <button type="button" className="pf-btn go" onClick={openFull}>
              Review {pend.lines.length} {pend.lines.length === 1 ? "change" : "changes"}
            </button>
          </div>
        ) : (
          <ChangeCard pend={pend} data={data} save={save} cancel={cancel} toggle={toggle} undo={undo} go={go} />
        )
      ) : null}
      {m.actions?.chips?.length && !compact ? (
        <div className="pf-chips">
          {m.actions.chips.map((c) => (
            <button key={c} type="button" className="pf-chip" onClick={() => ask(c)}>
              {c}
            </button>
          ))}
        </div>
      ) : null}
      {!compact && m.by ? <span className="pf-by">{m.by.toUpperCase()}</span> : null}
      {!compact && m.note ? <span className="pf-note">{m.note}</span> : null}
    </div>
  );
}

/** Models write **bold** and `code`; show them as such instead of raw marks. */
function rich(text: string) {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? (
      <strong key={i} style={{ fontWeight: 600, color: "var(--pf-ink)" }}>{part.slice(2, -2)}</strong>
    ) : part.startsWith("`") && part.endsWith("`") ? (
      <code key={i} style={{ fontFamily: "var(--pf-mono)", fontSize: "0.92em" }}>{part.slice(1, -1)}</code>
    ) : (
      part
    ),
  );
}

const MARK = { "+": Plus, edit: Pencil, move: Move, remove: Trash2 } as const;

function ChangeCard({ pend, data, save, cancel, toggle, undo, go }: { pend: Pending; data: ProfilesData; save: () => void; cancel: () => void; toggle: (i: number) => void; undo: () => void; go: (id: string) => void }) {
  const [review, setReview] = useState(false);
  const n = pend.on.filter(Boolean).length;
  const target = pend.focus && data.nodes[pend.focus] ? data.nodes[pend.focus] : null;
  return (
    <div className="pf-changes">
      <div className="pf-ch-head">
        <b>
          {pend.lines.length} {pend.lines.length === 1 ? "change" : "changes"}
        </b>
        {pend.state === "waiting" ? "waiting for your OK" : pend.state === "saved" ? "saved" : pend.state === "undone" ? "undone" : "cancelled"}
        <span className="pf-pill">{pend.state === "waiting" ? "NOTHING SAVED YET" : pend.state === "saved" ? "IN CHANGED TODAY" : ""}</span>
      </div>
      {pend.lines.map((l, i) => {
        const Icon = MARK[l.mark];
        return (
          <div key={i} className={`pf-ch${pend.on[i] ? "" : " off"}`}>
            {review && pend.state === "waiting" ? (
              <button type="button" role="checkbox" aria-checked={pend.on[i]} className="pf-mk" onClick={() => toggle(i)} aria-label={`Include ${l.title}`}>
                {pend.on[i] ? <Check /> : null}
              </button>
            ) : (
              <span className={`pf-mk ${l.mark}`}>
                <Icon />
              </span>
            )}
            <div>
              {l.title}
              {l.detail ? <small>{l.detail}</small> : null}
            </div>
            <span className="pf-where">{l.where}</span>
          </div>
        );
      })}
      <div className="pf-ch-act">
        {pend.state === "waiting" ? (
          <>
            <button type="button" className="pf-btn go" onClick={save} disabled={!n}>
              {n === pend.lines.length ? (n === 1 ? "Save" : `Save all ${n}`) : `Save ${n}`}
            </button>
            <button type="button" className="pf-btn" onClick={() => setReview((r) => !r)}>
              {review ? "Done choosing" : "Review each"}
            </button>
            <button type="button" className="pf-btn" onClick={cancel}>
              Cancel
            </button>
          </>
        ) : pend.state === "saved" ? (
          <>
            <button type="button" className="pf-btn" onClick={undo}>
              <Undo2 /> Undo
            </button>
            {target ? (
              <button type="button" className="pf-btn" onClick={() => go(target.id)}>
                Open {target.name} <ArrowUpRight />
              </button>
            ) : null}
            {pend.skipped?.length ? <span className="pf-note">{pend.skipped.join(" ")}</span> : null}
          </>
        ) : null}
      </div>
    </div>
  );
}

// --- the right side of the sheet ----------------------------------------------------

function LivePanel({ data, waiting, todays, undo }: { data: ProfilesData; waiting?: Extract<Msg, { role: "jarvis" }>; todays: ProfilesData["log"]; undo: (id: string) => void }) {
  const preview = useMemo(() => {
    if (!waiting?.pending) return null;
    const chosen = waiting.pending.changes.filter((_, i) => waiting.pending!.on[i]);
    const r = applyChanges(data, chosen);
    const focus = r.focus && r.data.nodes[r.focus] ? r.focus : null;
    if (!focus) return null;
    const before = new Set(Object.values(data.nodes).flatMap((n) => n.sections.flatMap((s) => s.items.map((i) => i.id))));
    const changed = new Set(chosen.flatMap((c) => (c.op === "set_item" ? [c.item] : [])));
    return { data: r.data, focus, isNew: !data.nodes[focus], before, changed };
  }, [data, waiting]);

  if (preview) {
    const node = preview.data.nodes[preview.focus];
    const h = hueOf(preview.data, preview.focus);
    const path = pathTo(preview.data, preview.focus).filter((x) => x !== ROOT);
    const rows = node.sections.flatMap((s) => s.items.map((i) => ({ ...i, sec: s.title })));
    return (
      <aside className="pf-live" style={sty({ "--h": h })}>
        <div className="pf-l-head">
          <i />
          WRITING TO PROFILES
        </div>
        <PathWeb data={preview.data} path={path} hue={h} isNew={preview.isNew} />
        <div className="pf-pcard" style={sty({ "--h": h })}>
          <div className="pf-pcard-top">
            <Mark node={node} hue={h} size={46} />
            <div style={{ minWidth: 0 }}>
              <h4>{node.name}</h4>
              <div className="pf-src">{whereLabel(preview.data, preview.focus).split(" › ").slice(0, -1).join(" › ") || "PROFILES"}</div>
            </div>
            {preview.isNew ? <span className="pf-new">NEW</span> : null}
          </div>
          <div style={{ marginTop: 12, position: "relative" }}>
            {rows.slice(-8).map((r) => (
              <div key={r.id} className={`pf-row${!preview.before.has(r.id) || preview.changed.has(r.id) ? " fresh" : ""}`}>
                <span className="pf-k">{r.k}</span>
                <span className="pf-v">{r.secret && data.settings.mask ? "••••" : r.money !== undefined ? `$${r.money.toFixed(2)}` : r.v}</span>
              </div>
            ))}
            {!rows.length ? <p className="pf-note" style={{ margin: "8px 0 0" }}>A new profile, ready for details.</p> : null}
          </div>
        </div>
        <p className="pf-empty">Nothing is written until you tap Save. Untick a change with Review each to leave it out.</p>
      </aside>
    );
  }

  return (
    <aside className="pf-live">
      <div className="pf-l-head" style={sty({ "--h": 198 })}>
        <i />
        CHANGED TODAY
      </div>
      {todays.length ? (
        <div className="pf-log">
          {todays.map((l) => (
            <div key={l.id} className={`pf-lg${l.undone ? " undone" : ""}`} style={sty({ "--c": l.hue })}>
              <i />
              <div>
                {l.text}
                <small>{l.where}</small>
              </div>
              {!l.undone ? (
                <button type="button" className="pf-btn" style={{ padding: "4px 10px", fontSize: 12 }} onClick={() => undo(l.id)}>
                  Undo
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <p className="pf-empty">Everything Jarvis saves today shows up here, each with an Undo. Nothing yet.</p>
      )}
    </aside>
  );
}

/** The path the information is travelling down, lit up, with the target at the end. */
function PathWeb({ data, path, hue, isNew }: { data: ProfilesData; path: string[]; hue: number; isNew: boolean }) {
  const shown = path.slice(-4);
  const W = 360;
  const step = shown.length > 1 ? (W - 80) / (shown.length - 1) : 0;
  const pts = shown.map((id, i) => ({ id, x: 40 + i * step, y: i % 2 ? 56 : 100 }));
  // Siblings of the second-to-last node, dimmed, so it reads as a web.
  const parent = shown.length > 1 ? shown[shown.length - 2] : null;
  const sibs = parent ? (data.nodes[parent]?.children ?? []).filter((c) => c !== shown[shown.length - 1] && !data.nodes[c]?.archived).slice(0, 3) : [];
  const pp = pts[pts.length - 2];
  return (
    <div className="pf-web">
      <svg viewBox={`0 0 ${W} 170`} role="img" aria-label={`Filing into ${shown.map((id) => data.nodes[id]?.name).join(", then ")}`}>
        <defs>
          <radialGradient id="pf-glow">
            <stop offset="0" stopColor={`hsl(${hue} 80% 70%)`} stopOpacity=".9" />
            <stop offset="1" stopColor={`hsl(${hue} 80% 60%)`} stopOpacity="0" />
          </radialGradient>
        </defs>
        {pp
          ? sibs.map((s, i) => {
              const sx = pp.x + 30 + i * 34;
              const sy = 150;
              return (
                <g key={s}>
                  <line x1={pp.x} y1={pp.y} x2={sx} y2={sy - 10} stroke="rgba(255,255,255,.1)" />
                  <rect x={sx - 9} y={sy - 18} width="18" height="18" rx="6" fill="rgba(255,255,255,.05)" stroke="rgba(255,255,255,.14)" />
                </g>
              );
            })
          : null}
        {pts.slice(1).map((pt, i) => (
          <line key={pt.id} x1={pts[i].x} y1={pts[i].y} x2={pt.x} y2={pt.y} stroke={`hsl(${hue} 75% 68%)`} strokeWidth="1.6" className={i === pts.length - 2 ? "pf-flow" : ""} />
        ))}
        {pts.map((pt, i) => {
          const n = data.nodes[pt.id];
          const last = i === pts.length - 1;
          return (
            <g key={pt.id}>
              {last ? <circle cx={pt.x} cy={pt.y} r="34" fill="url(#pf-glow)" opacity=".55" /> : null}
              {n?.kind === "person" ? (
                <circle cx={pt.x} cy={pt.y} r={last ? 15 : 12} fill={last && isNew ? "none" : `hsl(${hue} 65% 58%)`} stroke={`hsl(${hue} 75% 72%)`} strokeWidth="1.5" strokeDasharray={last && isNew ? "3 4" : undefined} />
              ) : (
                <rect x={pt.x - 12} y={pt.y - 12} width="24" height="24" rx="8" fill={last && isNew ? "none" : `hsl(${hue} 45% 30%)`} stroke={`hsl(${hue} 70% 65%)`} strokeDasharray={last && isNew ? "3 4" : undefined} />
              )}
              <text x={pt.x} y={pt.y + 30} textAnchor="middle" className="on">
                {(n?.name ?? "").slice(0, 16)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
