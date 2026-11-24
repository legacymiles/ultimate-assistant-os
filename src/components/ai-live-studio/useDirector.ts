"use client";

// The director's side of the studio — everything PRIVATE.
//
//   A. Your mic → speech recognition → directions. The mic is measured for
//      its level meter in its own audio graph that is never connected to a
//      speaker, so nothing you say can reach the stream.
//   B. Talkback → Alex answering you, played on YOUR output device through
//      its own audio element. It plays only when talkbackVerdict says that
//      device is physically different from the stream's; otherwise he answers
//      in text. Talkback never touches the public audio graph in useStudio.
//   C. The public performance stays in useStudio. This hook only hands it
//      resolved directions (applyDirectives) — never words to say, except a
//      "Say exactly" line the owner typed on purpose.
//
// With Talkback off, nothing here makes a sound: acknowledgements are visual.

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import {
  parseCommand, resolveDirectives, sanitizeDirectives, typedCommand, withTarget,
  type Clarify, type CommandType, type Directive, type Resolved,


} from "@/lib/ai-live-studio/command";
import { afterWakeWord, isEcho, needsConfirm, talkbackVerdict, type ListenMode, type OutputDevice } from "@/lib/ai-live-studio/routing";
import { splitSentences } from "@/lib/ai-live-studio/speech";
import { loadLocal, saveLocal } from "@/lib/sync/appState";
import type { Studio } from "./useStudio";

/** Per device: which headphones are yours depends on the machine. */
const PREFS_KEY = "ai-live-studio:director";
const MAX_ENTRIES = 120;
const TICKER_MS = 6000;
const DIRECT_TIMEOUT_MS = 10_000;

export type MicState = "off" | "starting" | "listening" | "hearing" | "blocked" | "unsupported" | "error";

export interface DirEntry {
  id: string;
  ts: number;
  /** you = the director · alex = Alex to you, privately · note = the studio telling you something. */
  role: "you" | "alex" | "note";
  text: string;
  source?: "mic" | "typed";
  type?: CommandType;
  status?: "working" | "done" | "ask" | "confirm" | "ignored" | "failed";
  acks?: string[];
  problems?: string[];
  /** "Which Mike?" — the direction waiting for an answer. */
  clarify?: Clarify & { directive: Directive };
  /** Why Alex answered in text instead of out loud. */
  silent?: string;
}

interface Prefs {
  talkback: boolean;
  listenMode: ListenMode;
  privateSink: string;
}

const DEFAULT_PREFS: Prefs = { talkback: false, listenMode: "open", privateSink: "" };

function readPrefs(): Prefs {
  const r = loadLocal<Partial<Prefs>>(PREFS_KEY, DEFAULT_PREFS);
  return {
    talkback: r.talkback === true,
    listenMode: r.listenMode === "push" || r.listenMode === "wake" ? r.listenMode : "open",
    privateSink: typeof r.privateSink === "string" ? r.privateSink : "",
  };
}

interface RecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string; confidence: number }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}

function recognitionCtor(): (new () => RecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => RecognitionLike; webkitSpeechRecognition?: new () => RecognitionLike };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

let seq = 0;
const uid = (p: string) => `${p}:${Date.now().toString(36)}:${(seq += 1)}`;

export function useDirector(studio: Studio, boothRef: RefObject<HTMLElement | null>) {
  const [prefs, setPrefsState] = useState<Prefs>(readPrefs);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const setPrefs = useCallback((patch: Partial<Prefs>) => {
    setPrefsState((p) => {
      const next = { ...p, ...patch };
      saveLocal(PREFS_KEY, next);
      return next;
    });
  }, []);

  const [on, setOn] = useState(false);
  const onRef = useRef(false);
  onRef.current = on;
  const [mic, setMic] = useState<MicState>("off");
  const [micLabel, setMicLabel] = useState("");
  const [interim, setInterim] = useState("");
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const [ticker, setTicker] = useState<{ id: string; text: string; ts: number }[]>([]);
  const [outputs, setOutputs] = useState<OutputDevice[]>([]);
  const [compose, setCompose] = useState<{ type: CommandType; targetId: string | null }>({ type: "direction", targetId: null });
  const [alexTalking, setAlexTalking] = useState(false);
  const [holding, setHolding] = useState(false);
  const holdingRef = useRef(false);
  const composerRef = useRef<HTMLInputElement | null>(null);

  const rec = useRef<RecognitionLike | null>(null);
  const micStream = useRef<MediaStream | null>(null);
  const micCtx = useRef<AudioContext | null>(null);
  const micAnalyser = useRef<AnalyserNode | null>(null);
  /** Alex's private lines — the mic must not take them for instructions either. */
  const privateLines = useRef<string[]>([]);
  const privateAudio = useRef<HTMLAudioElement | null>(null);
  const studioRef = useRef(studio);
  studioRef.current = studio;

  // ---- What may Talkback do right now -----------------------------------------
  const canRoutePrivate = typeof window !== "undefined" && typeof (HTMLMediaElement.prototype as { setSinkId?: unknown }).setSinkId === "function";
  const verdict = talkbackVerdict({
    talkback: prefs.talkback,
    canRoute: canRoutePrivate,
    publicId: studio.canRoute ? studio.publicSink : "",
    privateId: prefs.privateSink,
    devices: outputs,
    voice: studio.voiceMode === "browser" ? "browser" : "server",
  });
  const verdictRef = useRef(verdict);
  verdictRef.current = verdict;

  // ---- Entries and the ticker -----------------------------------------------------
  const add = useCallback((e: Omit<DirEntry, "id" | "ts"> & { id?: string }) => {
    const entry: DirEntry = { id: e.id ?? uid(e.role), ts: Date.now(), ...e };
    setEntries((xs) => [...xs, entry].slice(-MAX_ENTRIES));
    return entry.id;
  }, []);
  const patch = useCallback((id: string, p: Partial<DirEntry>) => {
    setEntries((xs) => xs.map((x) => (x.id === id ? { ...x, ...p } : x)));
  }, []);
  const tick = useCallback((texts: string[]) => {
    if (!texts.length) return;
    const now = Date.now();
    setTicker((t) => [...t, ...texts.map((text) => ({ id: uid("t"), text, ts: now }))].slice(-3));
  }, []);
  useEffect(() => {
    if (!ticker.length) return;
    const t = setTimeout(() => setTicker((xs) => xs.filter((x) => Date.now() - x.ts < TICKER_MS)), 1000);
    return () => clearTimeout(t);
  }, [ticker]);

  // Things the public side noticed ("Mike just commented").
  useEffect(() => {
    studio.setPrivateListener((text) => {
      add({ role: "note", text });
      tick([text]);
    });
    return () => studio.setPrivateListener(null);
  }, [studio, add, tick]);

  // ---- Output devices (labels appear once the mic is allowed) -------------------
  const refreshDevices = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) return;
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      setOutputs(all.filter((d) => d.kind === "audiooutput").map((d) => ({ deviceId: d.deviceId, groupId: d.groupId, label: d.label })));
      const input = all.find((d) => d.kind === "audioinput" && d.deviceId === "default") ?? all.find((d) => d.kind === "audioinput");
      if (input?.label) setMicLabel(input.label.replace(/^Default - /, ""));
    } catch {
      /* no device list: the routing line says "Default" */
    }
  }, []);
  // Devices are read only after the owner acts (the mic starts, or "Change" opens) —
  // nothing about the machine's audio is touched on page load.
  useEffect(() => {
    const md = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;

    md?.addEventListener?.("devicechange", refreshDevices);
    return () => md?.removeEventListener?.("devicechange", refreshDevices);
  }, [refreshDevices]);

  // ---- Talkback: Alex to you, on your device only --------------------------------
  const speakPrivate = useCallback(async (text: string): Promise<boolean> => {
    if (verdictRef.current.mode !== "voice") return false;
    const s = studioRef.current.settings;
    privateLines.current = [...privateLines.current, text].slice(-6);
    setAlexTalking(true);
    try {
      for (const piece of splitSentences(text)) {
        if (verdictRef.current.mode !== "voice") break;
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 12_000);
        const res = await fetch("/api/tts", {
          method: "POST",
          signal: ctrl.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: piece, format: "wav", speed: s.speed, voiceId: s.voice }),
        });
        clearTimeout(t);
        if (!res.ok || res.headers.get("content-type")?.includes("application/json")) return false;
        const url = URL.createObjectURL(await res.blob());
        const el = new Audio(url) as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
        privateAudio.current = el;
        try {
          // Routed BEFORE it plays: if the device can't be set, it never plays.
          if (!el.setSinkId) return false;
          await el.setSinkId(prefsRef.current.privateSink || "");
          await el.play();
          await new Promise<void>((done) => {
            el.onended = () => done();
            el.onpause = () => done();
            el.onerror = () => done();
          });
        } finally {
          URL.revokeObjectURL(url);
          if (privateAudio.current === el) privateAudio.current = null;
        }
      }
      return true;
    } catch {
      return false;
    } finally {
      setAlexTalking(false);
    }
  }, []);

  /** Turning Talkback off silences him at once — the stream never noticed either way. */
  const setTalkback = useCallback((v: boolean) => {
    setPrefs({ talkback: v });
    if (!v) privateAudio.current?.pause();
  }, [setPrefs]);

  // ---- Understanding and applying ---------------------------------------------------
  const apply = useCallback((entryId: string, directives: Directive[], extraProblems: string[] = []) => {
    const ctx = studioRef.current.commandContext();
    const r = resolveDirectives(directives, ctx);
    const { acks, problems } = studioRef.current.applyDirectives(r.ready.map((x) => x.directive));
    const all = [...extraProblems, ...r.problems, ...problems];
    const clarify = r.clarify ? { ...r.clarify, directive: directives[r.clarify.index] } : undefined;
    patch(entryId, {
      acks,
      problems: all,
      status: clarify ? "ask" : acks.length ? "done" : all.length ? "failed" : "done",
      ...(clarify ? { clarify } : {}),
    });
    tick(acks);
    return acks;
  }, [patch, tick]);

  const run = useCallback(async (text: string, source: "mic" | "typed", type: CommandType = "direction") => {
    const st = studioRef.current;
    const id = add({ role: "you", text, source, type, status: "working" });
    const ctx = st.commandContext();

    // Typed command types need no interpreting.
    if (type !== "direction") {
      const target = compose.targetId ?? st.selectedId;
      const out = typedCommand(type, text, target);
      if ("error" in out) {
        patch(id, { status: "failed", problems: [out.error] });
        return;
      }
      apply(id, out.directives);
      return;
    }

    const parsed = parseCommand(text, ctx);
    const talk = verdictRef.current.mode !== "off";
    const handled = parsed.leftover.length === 0 && !parsed.question;
    let directives = parsed.directives;

    // Applied at once — nothing waits for the network when the parser knew what you meant.
    const appliedAcks = handled ? apply(id, directives) : [];
    if (handled && !talk) return;

    // The brain: anything left over, a question, or Talkback wanting to answer.
    let reply = "";
    let note = "";
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), DIRECT_TIMEOUT_MS);
      const focus = ctx.comments.find((c) => c.id === ctx.focusId);
      const res = await fetch("/api/ai-live-studio/direct", {
        method: "POST",
        signal: ctrl.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          talkback: talk,
          settings: st.settings,
          performance: st.perf,
          applied: appliedAcks.slice(0, 8),
          context: {
            comments: ctx.comments,
            focus: focus ? `@${focus.handle}: ${focus.text}` : "",
            speaking: st.caption,
            recent: ctx.recent,
            waiting: ctx.waiting,
            viewers: st.metrics.viewers,
            live: ctx.live,
          },
          history: entriesRef.current
            .filter((e) => e.role !== "note" && e.id !== id)
            .slice(-10)
            .map((e) => ({ role: e.role === "alex" ? "alex" : "director", text: e.text })),
        }),
      });
      clearTimeout(t);
      const j = (await res.json()) as { directives?: unknown; reply?: string; note?: string };
      reply = typeof j.reply === "string" ? j.reply : "";
      note = typeof j.note === "string" ? j.note : "";
      if (!handled) {
        // A plain question never changes the show, whatever the model returned —
        // only a clear request ("could you…") is acted on.
        const asking = /^(?:could|can|would|will) you\b|^why (?:don'?t|not)\b|^how about\b|^what if\b/i.test(text.replace(/^\W*\w+[,:]\s*/, ""));
        const fromBrain = parsed.question && !asking ? [] : sanitizeDirectives(j.directives);

        // The brain read the whole sentence, so its reading replaces the parser's.
        if (fromBrain.length) directives = fromBrain;
        // No brain (no key, timed out): keep what the parser understood, and the rest as a note for the next reply.
        else if (note) directives = [...directives, ...parsed.leftover.map((l) => ({ type: "note" as const, scope: "next" as const, text: l }))];
      }
    } catch {
      note = "The AI didn't answer in time — what I understood was applied.";
      if (!handled) directives = [...directives, ...parsed.leftover.map((l) => ({ type: "note" as const, scope: "next" as const, text: l }))];
    }

    if (!handled) apply(id, directives, note && !reply ? [note] : []);

    if (reply) {
      const v = verdictRef.current;
      const silent = v.mode === "voice" ? undefined : v.mode === "text" ? v.why : "Talkback is off — answered in text only.";
      add({ role: "alex", text: reply, ...(silent ? { silent } : {}) });
      if (v.mode === "voice") {
        const ok = await speakPrivate(reply);
        if (!ok) add({ role: "note", text: "Couldn't play Talkback on your headphones — his answer is above, in text." });
      }
    } else if (parsed.question && !talk && note) {
      add({ role: "note", text: note });
    }
  }, [add, patch, apply, speakPrivate, compose.targetId]);

  /** What the mic heard: filtered for Alex's own voice, the wake word and unsure recognition. */
  const heard = useCallback((raw: string, confidence?: number) => {
    let text = raw.replace(/\s+/g, " ").trim();
    if (!text) return;
    if (isEcho(text, [...studioRef.current.recentPublic(), ...privateLines.current])) return;
    if (prefsRef.current.listenMode === "wake") {
      const after = afterWakeWord(text, studioRef.current.settings.name);
      if (!after) return;
      text = after;
    }
    if (needsConfirm(confidence)) {
      add({ role: "you", text, source: "mic", status: "confirm" });
      return;
    }
    void run(text, "mic");
  }, [add, run]);

  // ---- The mic ------------------------------------------------------------------------
  const stopRecognition = useCallback(() => {
    const r = rec.current;
    rec.current = null;
    if (!r) return;
    r.onend = null;
    try {
      r.stop();
    } catch {
      /* already stopped */
    }
  }, []);

  const startRecognition = useCallback(() => {
    const Ctor = recognitionCtor();
    if (!Ctor) {
      setMic("unsupported");
      return;
    }
    if (rec.current) return;
    const r = new Ctor();
    r.continuous = true;
    r.interimResults = true;
    r.lang = "en-US";
    r.onresult = (e) => {
      let live = "";
      for (let i = e.resultIndex; i < e.results.length; i += 1) {
        const res = e.results[i];
        const alt = res[0];
        if (!alt) continue;
        if (res.isFinal) {
          setInterim("");
          heard(alt.transcript, alt.confidence);
        } else live += alt.transcript;
      }
      if (live) {
        setInterim(live.trim());
        setMic("hearing");
      } else setMic((m) => (m === "hearing" ? "listening" : m));
    };
    r.onerror = (ev) => {
      if (ev.error === "not-allowed" || ev.error === "service-not-allowed") {
        setMic("blocked");
        setOn(false);
      } else if (ev.error !== "no-speech" && ev.error !== "aborted") setMic("error");
    };
    // Recognition stops by itself after a silence; while Director Mode is on it starts again.
    r.onend = () => {
      rec.current = null;
      setInterim("");
      const keep = onRef.current && (prefsRef.current.listenMode !== "push" || holdingRef.current);
      if (keep) setTimeout(() => onRef.current && startRecognition(), 250);
      else setMic((m) => (m === "blocked" || m === "unsupported" ? m : onRef.current ? "listening" : "off"));
    };
    rec.current = r;
    try {
      r.start();
      setMic("listening");
    } catch {
      setMic("error");
    }
  }, [heard]);

  const stopMeter = useCallback(() => {
    micStream.current?.getTracks().forEach((t) => t.stop());
    micStream.current = null;
    void micCtx.current?.close();
    micCtx.current = null;
    micAnalyser.current = null;
    boothRef.current?.style.setProperty("--mic", "0");
  }, [boothRef]);

  /** Only for the level meter. Its own graph, never connected to any speaker. */
  const startMeter = useCallback(async () => {
    if (micStream.current || typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) return true;
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      micStream.current = s;
      const ctx = new AudioContext();
      const a = ctx.createAnalyser();
      a.fftSize = 512;
      ctx.createMediaStreamSource(s).connect(a);
      micCtx.current = ctx;
      micAnalyser.current = a;
      void refreshDevices();
      return true;
    } catch {
      setMic("blocked");
      return false;
    }
  }, [refreshDevices]);

  // The orb's ring follows your voice — written per frame, transform/opacity only.
  useEffect(() => {
    if (!on) return;
    let raf = 0;
    let level = 0;
    const buf = new Uint8Array(512);
    const frame = () => {
      const a = micAnalyser.current;
      let target = 0;
      if (a) {
        a.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < a.fftSize; i += 1) {
          const v = (buf[i] - 128) / 128;
          sum += v * v;
        }
        target = Math.min(1, Math.sqrt(sum / a.fftSize) * 5);
      }
      level += (target - level) * (target > level ? 0.5 : 0.12);
      boothRef.current?.style.setProperty("--mic", level.toFixed(3));
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [on, boothRef]);

  const setDirectorMode = useCallback(async (v: boolean) => {
    if (!v) {
      setOn(false);
      onRef.current = false;
      stopRecognition();
      stopMeter();
      setInterim("");
      setMic("off");
      return;
    }
    if (!recognitionCtor()) {
      setMic("unsupported");
      return;
    }
    setMic("starting");
    if (!(await startMeter())) return;
    setOn(true);
    onRef.current = true;
    if (prefsRef.current.listenMode !== "push") startRecognition();
    else setMic("listening");
  }, [startMeter, startRecognition, stopMeter, stopRecognition]);

  /** Hold-to-talk: recognition runs only while held. */
  const hold = useCallback((v: boolean) => {
    if (prefsRef.current.listenMode !== "push" || !onRef.current) return;
    holdingRef.current = v;
    setHolding(v);
    if (v) startRecognition();
    else stopRecognition();
  }, [startRecognition, stopRecognition]);

  // Hold the ` key to talk (not while typing).
  useEffect(() => {
    if (prefs.listenMode !== "push" || !on) return;
    const typing = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
    };
    const down = (e: KeyboardEvent) => {
      if (e.code === "Backquote" && !e.repeat && !typing(e)) {
        e.preventDefault();
        hold(true);
      }
    };
    const up = (e: KeyboardEvent) => e.code === "Backquote" && hold(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [prefs.listenMode, on, hold]);

  const setListenMode = useCallback((m: ListenMode) => {
    setPrefs({ listenMode: m });
    prefsRef.current = { ...prefsRef.current, listenMode: m };
    if (!onRef.current) return;
    stopRecognition();
    if (m !== "push") startRecognition();
  }, [setPrefs, startRecognition, stopRecognition]);

  useEffect(() => () => {
    onRef.current = false;
    stopRecognition();
    stopMeter();
    privateAudio.current?.pause();
  }, [stopRecognition, stopMeter]);

  // ---- The owner's answers to the thread -----------------------------------------------
  const choose = useCallback((entryId: string, option: number) => {
    const e = entriesRef.current.find((x) => x.id === entryId);
    const c = e?.clarify;
    const opt = c?.options[option];
    if (!e || !c || !opt) return;
    const { acks, problems } = studioRef.current.applyDirectives([withTarget(c.directive, opt.target)]);
    patch(entryId, { status: acks.length ? "done" : "failed", acks: [...(e.acks ?? []), ...acks], problems: [...(e.problems ?? []), ...problems], clarify: undefined });
    tick(acks);
  }, [patch, tick]);

  const confirm = useCallback((entryId: string, yes: boolean) => {
    const e = entriesRef.current.find((x) => x.id === entryId);
    if (!e) return;
    if (!yes) {
      patch(entryId, { status: "ignored" });
      return;
    }
    setEntries((xs) => xs.filter((x) => x.id !== entryId));
    void run(e.text, "mic");
  }, [patch, run]);

  /** The command bar. */
  const send = useCallback((text: string) => {
    const t = text.trim();
    if (!t && (compose.type === "direction" || compose.type === "say")) {
      composerRef.current?.focus();
      return;
    }
    void run(t, "typed", compose.type);
  }, [compose.type, run]);

  /** A comment's own button (Reply, Prioritize, Skip, Mute): applied at once, and logged in the thread. */
  const quick = useCallback((label: string, list: Directive<Resolved>[]) => {
    const id = add({ role: "you", text: label, source: "typed", status: "working" });
    const { acks, problems } = studioRef.current.applyDirectives(list);
    patch(id, { acks, problems, status: acks.length ? "done" : "failed" });
    tick(acks);
  }, [add, patch, tick]);

  /** From a comment's own buttons: set up the command bar for it. */
  const aim = useCallback((type: CommandType, targetId: string | null) => {
    setCompose({ type, targetId });
    if (targetId) studioRef.current.setSelectedId(targetId);
    setTimeout(() => composerRef.current?.focus(), 0);
  }, []);

  /** End the private session. The stream carries on, and so does the direction already given. */
  const endSession = useCallback(() => {
    void setDirectorMode(false);
    setTalkback(false);
    setCompose({ type: "direction", targetId: null });
    const p = studioRef.current.perf;
    const still = [p.emotion !== "neutral" ? p.emotion : "", ...p.avoid.map((a) => `avoiding ${a}`), ...p.notes].filter(Boolean);
    add({ role: "note", text: `Director session ended — the stream carries on.${still.length ? ` Still in effect: ${still.join(" · ")}.` : ""}` });
  }, [setDirectorMode, setTalkback, add]);

  return {
    on, mic, micLabel, interim, holding, prefs, verdict, outputs, entries, ticker, compose, alexTalking, composerRef,
    setDirectorMode, setTalkback, setListenMode, setPrivateSink: (id: string) => setPrefs({ privateSink: id }),
    hold, send, choose, confirm, aim, quick, setCompose, endSession, refreshDevices,
  };
}

export type DirectorApi = ReturnType<typeof useDirector>;
