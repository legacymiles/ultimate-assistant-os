"use client";

// The studio's runtime: the real Director, fed by the demo audience or the
// TikTok relay, answering through the brain route, speaking through the best
// voice path available, and driving the stage's key light every frame.
//
// Voice paths, best first:
//   1. LiveTalking (C:\dev\livetalking :8010) — wav in, lip-synced face out
//   2. /api/tts (Phonon, or Fish as its net) — wav played here
//   3. The browser's own voice — always works, no key, no server
// Each falls through to the next on failure, so a stream never goes silent.

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { createDemoFeed, demoViewerCount } from "@/lib/ai-live-studio/demo";
import type { ChatRef, Directive, Resolved } from "@/lib/ai-live-studio/command";
import { ackFor } from "@/lib/ai-live-studio/command";
import { Director, type Cue, type Direction, type Turn } from "@/lib/ai-live-studio/director";
import { parseEvent, type EventKind } from "@/lib/ai-live-studio/events";
import { LiveTalking } from "@/lib/ai-live-studio/livetalking";
import { REASON_LABEL } from "@/lib/ai-live-studio/moderation";
import {
  DEFAULT_PERFORMANCE, MAX_AVOID, MAX_NOTES, expressionFor, motionFor, sanitizePerformance, speedFor,
  type Emotion, type Performance, type ReplyDirection,
} from "@/lib/ai-live-studio/performance";
import { PRIORITY, priorityOf } from "@/lib/ai-live-studio/priority";
import {
  DEFAULT_SETTINGS,
  applyPreset as presetOf,
  fillersFor,
  idleMsFor,
  sanitizeSettings,
  withChange,
  type Mood,
  type PresetId,
  type StudioSettings,
} from "@/lib/ai-live-studio/personality";
import { speakable } from "@/lib/ai-live-studio/reply";
import { splitSentences } from "@/lib/ai-live-studio/speech";
import { loadLocal, saveLocal, saveSynced } from "@/lib/sync/appState";
import { useRemotePull } from "@/lib/sync/useSync";

export const SETTINGS_KEY = "ai-live-studio:v1";
/** Which face this device shows — per device, because LiveTalking runs on one PC. */
const FACE_KEY = "ai-live-studio:face";
/** Demo audience or TikTok — per device, because the relay runs on one PC. */
const FEED_KEY = "ai-live-studio:feed";
/** LiveTalking's own sample avatar — not the owner's host. */
export const SAMPLE_AVATAR = "wav2lip256_avatar1";
/** The acting state the director set — synced, so it survives a reload mid-stream. */
export const PERF_KEY = "ai-live-studio:perf:v1";
/** Which device the stream's audio plays on — per device, because devices are. */
const SINK_KEY = "ai-live-studio:public-sink";
const RELAY_URL = "ws://127.0.0.1:8787";
const MAX_ITEMS = 300;
const REPLY_TIMEOUT_MS = 10_000;

export type AiState = "offline" | "listening" | "thinking" | "speaking" | "paused";
export type Feed = "demo" | "tiktok";
/** online = connected and in use · available = running here but not in use · offline = not running. */
export type ConnState = "checking" | "online" | "available" | "offline";
export type FeedState = "idle" | "connecting" | "connected" | "unreachable";
export type VoiceMode = "checking" | "phonon" | "fish-audio" | "self-hosted" | "browser";
export type ItemStatus = "queued" | "answering" | "answered" | "hidden" | "muted" | "repeat" | "stale" | "skipped";

export interface ChatItem {
  id: string;
  role: "viewer" | "ai" | "system";
  kind?: EventKind | "say" | "filler" | "cue";
  handle?: string;
  user: string;
  text: string;
  ts: number;
  avatar?: string;
  status?: ItemStatus;
  note?: string;
  replyTo?: { id: string; user: string; text: string; kind: EventKind };
  mood?: Mood;
  /** The director moved it up. */
  prioritized?: boolean;
  /** The director's private note for this answer — shown to the owner only. */
  instruction?: string;
  canned?: boolean;
  speaking?: boolean;
}

export interface StageCue {
  user: string;
  handle: string;
  text: string;
  kind: EventKind;
  avatar?: string;
}

/** One row of the Up next queue. */
export interface UpNext {
  id: string;
  handle: string;
  user: string;
  text: string;
  kind: EventKind;
  /** Why it's where it is, in words. */
  why: string;
  prioritized: boolean;
  waitedS: number;
}

export interface Metrics {
  fps: number;
  fpsSource: "render" | "stream";
  latencyMs: number | null;
  queue: number;
  viewers: number | null;
  replies: number;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function useStudio(stageRef: RefObject<HTMLElement | null>) {
  // ---- Settings: synced across devices (D3) -------------------------------
  const [settings, setSettings] = useState<StudioSettings>(() => sanitizeSettings(loadLocal(SETTINGS_KEY, DEFAULT_SETTINGS)));
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  useRemotePull(SETTINGS_KEY, () => setSettings(sanitizeSettings(loadLocal(SETTINGS_KEY, DEFAULT_SETTINGS))));

  const update = useCallback((patch: Partial<StudioSettings>) => {
    setSettings((s) => {
      const next = withChange(s, patch);
      saveSynced(SETTINGS_KEY, next);
      return next;
    });
  }, []);
  const applyPreset = useCallback((id: PresetId) => {
    setSettings((s) => {
      const next = presetOf(s, id);
      saveSynced(SETTINGS_KEY, next);
      return next;
    });
  }, []);

  // ---- Visible state -------------------------------------------------------
  const [live, setLive] = useState(false);
  const [liveSince, setLiveSince] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(false);
  const [aiState, setAiState] = useState<AiState>("offline");
  const [items, setItems] = useState<ChatItem[]>([]);
  const [caption, setCaption] = useState("");
  const [question, setQuestion] = useState<StageCue | null>(null);
  const [gift, setGift] = useState<StageCue | null>(null);
  const [feed, setFeedState0] = useState<Feed>(() => (loadLocal<Feed>(FEED_KEY, "demo") === "tiktok" ? "tiktok" : "demo"));
  const [feedState, setFeedState] = useState<FeedState>("idle");
  const [ltState, setLtState] = useState<ConnState>("checking");
  // The owner's chosen face (the portrait) is the default. LiveTalking only
  // takes over when picked: until an avatar is built from that portrait, it
  // serves its own sample face, which is somebody else.
  const [useLive, setUseLiveState] = useState<boolean>(() => loadLocal<boolean>(FACE_KEY, false) === true);
  const setUseLive = useCallback((v: boolean) => {
    setUseLiveState(v);
    saveLocal(FACE_KEY, v);
  }, []);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [voiceMode, setVoiceMode] = useState<VoiceMode>("checking");
  const [metrics, setMetrics] = useState<Metrics>({ fps: 0, fpsSource: "render", latencyMs: null, queue: 0, viewers: null, replies: 0 });
  const [toast, setToast] = useState<{ text: string; tone: "info" | "warn" } | null>(null);
  const [upNext, setUpNext] = useState<UpNext[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedRef = useRef<string | null>(null);
  selectedRef.current = selectedId;

  // ---- Performance: what the director set (D3: synced) -------------------
  const [perf, setPerf] = useState<Performance>(() => sanitizePerformance(loadLocal(PERF_KEY, DEFAULT_PERFORMANCE)));
  const perfRef = useRef(perf);
  perfRef.current = perf;
  useRemotePull(PERF_KEY, () => setPerf(sanitizePerformance(loadLocal(PERF_KEY, DEFAULT_PERFORMANCE))));
  /** One-off direction for the next reply only. */
  const nextNotes = useRef<string[]>([]);
  const nextEmotion = useRef<Emotion | null>(null);
  /** Bumped by every direction, so a reply written before it is thrown away. */
  const dirVersion = useRef(0);
  const [expression, setExpression] = useState<Emotion>("neutral");
  const [pendingNext, setPendingNext] = useState<string[]>([]);

  // ---- Where the stream's sound goes (the device OBS captures) ------------
  const [publicSink, setPublicSinkState] = useState<string>(() => loadLocal<string>(SINK_KEY, ""));
  const publicSinkRef = useRef(publicSink);
  publicSinkRef.current = publicSink;
  /** The browser lets this page choose the output device for its own audio graph. */
  const [canRoute, setCanRoute] = useState(false);
  useEffect(() => {
    setCanRoute(typeof window !== "undefined" && "AudioContext" in window && typeof (AudioContext.prototype as { setSinkId?: unknown }).setSinkId === "function");
  }, []);

  // ---- Runtime refs (no stale closures inside long-running loops) ---------
  const director = useRef<Director | null>(null);
  const liveRef = useRef(false);
  const pausedRef = useRef(false);
  const mutedRef = useRef(false);
  const genRef = useRef(0);
  const busyRef = useRef(false);
  const interruptRef = useRef(false);
  const speakingPriority = useRef(-1);
  const currentAudio = useRef<HTMLAudioElement | null>(null);
  const audioCtx = useRef<AudioContext | null>(null);
  const analyser = useRef<AnalyserNode | null>(null);
  const outGain = useRef<GainNode | null>(null);
  const remoteAnalyser = useRef<AnalyserNode | null>(null);
  const synthLevel = useRef(0);
  /** The browser voice is talking. Many voices report no word boundaries, so this drives an envelope. */
  const browserSpeaking = useRef(false);
  const level = useRef(0);
  const ltSpeaking = useRef(false);
  const lt = useRef(new LiveTalking());
  const pc = useRef<RTCPeerConnection | null>(null);
  const session = useRef("");
  const memory = useRef(new Map<string, string[]>());
  const feedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const relay = useRef<WebSocket | null>(null);
  const renderFps = useRef(0);
  const streamFps = useRef<number | null>(null);
  const lastLatency = useRef<number | null>(null);
  const replies = useRef(0);
  /** The next reply, already being written while the current one is spoken. */
  const prefetched = useRef<{ id: string; version: number; reply: Promise<{ reply: string; mood: Mood; canned: boolean } | null>; abort: AbortController } | null>(null);
  /** A burst of directions writes the next reply once, after the burst. */
  const rethink = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Throw away the reply written ahead — and stop paying for it. */
  const dropPrefetch = useCallback(() => {
    prefetched.current?.abort.abort();
    prefetched.current = null;
  }, []);
  /** Alex's last public lines — the echo guard and Talkback's context read them. */
  const recentLines = useRef<string[]>([]);
  /** The comment being answered right now. */
  const answeringId = useRef<string | null>(null);
  /** "Don't answer that" during that answer: finish the sentence, then stop. */
  const wrapUp = useRef(false);
  const lastTopic = useRef("");
  const voiceModeRef = useRef<VoiceMode>("checking");
  voiceModeRef.current = voiceMode;
  const useLiveRef = useRef(useLive);
  useLiveRef.current = useLive;
  const ltStateRef = useRef(ltState);
  ltStateRef.current = ltState;
  const feedRef = useRef<Feed>("demo");
  feedRef.current = feed;
  const liveSinceRef = useRef<number | null>(null);
  liveSinceRef.current = liveSince;
  /** True only while "Preview voice" plays, so speak() runs without a stream. */
  const previewing = useRef(false);

  const notify = useCallback((text: string, tone: "info" | "warn" = "info") => {
    setToast({ text, tone });
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4200);
    return () => clearTimeout(t);
  }, [toast]);

  const itemsRef = useRef(items);
  itemsRef.current = items;
  /** The private side listens here for things the public side noticed ("Mike just commented"). */
  const privateListener = useRef<((text: string) => void) | null>(null);
  const setPrivateListener = useCallback((fn: ((text: string) => void) | null) => {
    privateListener.current = fn;
  }, []);

  /** Change the standing performance, save it, and throw away replies written under the old one. */
  const changePerf = useCallback((fn: (p: Performance) => Performance) => {
    setPerf((p) => {
      const next = sanitizePerformance(fn(p));
      saveSynced(PERF_KEY, next);
      return next;
    });
    dirVersion.current += 1;
    dropPrefetch();
  }, [dropPrefetch]);

  // ---- Chat list helpers ---------------------------------------------------
  const addItem = useCallback((item: ChatItem) => {
    setItems((xs) => (xs.some((x) => x.id === item.id) ? xs : [...xs, item].slice(-MAX_ITEMS)));
  }, []);
  const patchItem = useCallback((id: string, patch: Partial<ChatItem>) => {
    setItems((xs) => xs.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  }, []);

  // ---- Keep the director in step with the sliders, mid-stream --------------
  useEffect(() => {
    director.current?.setOptions({
      characterName: settings.name,
      maxPerMinute: settings.frequency,
      idleMs: idleMsFor(settings.interaction),
      blocklist: settings.blocklist,
      fillers: fillersFor(settings),
    });
  }, [settings]);

  // ---- Audio graph: source → analyser → gain(mute) → speakers --------------
  const ensureAudio = useCallback(() => {
    if (typeof window === "undefined") return null;
    if (!audioCtx.current) {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctx();
      const a = ctx.createAnalyser();
      a.fftSize = 512;
      const g = ctx.createGain();
      a.connect(g);
      g.connect(ctx.destination);
      audioCtx.current = ctx;
      analyser.current = a;
      outGain.current = g;
      // The stream's voice plays on the device the stream captures — never the director's headphones.
      const sink = publicSinkRef.current;
      const routed = ctx as AudioContext & { setSinkId?: (id: string) => Promise<void> };
      if (sink && routed.setSinkId) void routed.setSinkId(sink).catch(() => undefined);
    }
    void audioCtx.current.resume();
    return audioCtx.current;
  }, []);

  const setPublicSink = useCallback((id: string) => {
    setPublicSinkState(id);
    saveLocal(SINK_KEY, id);
    const ctx = audioCtx.current as (AudioContext & { setSinkId?: (id: string) => Promise<void> }) | null;
    if (ctx?.setSinkId) void ctx.setSinkId(id || "").catch(() => undefined);
  }, []);

  // ---- The face acts: expression + the director's eye contact and head movement
  useEffect(() => {
    const m = motionFor(perf, expression);
    const el = stageRef.current;
    if (!el) return;
    el.style.setProperty("--head", String(m.head));
    el.style.setProperty("--away", String(m.away));
    el.style.setProperty("--lean", String(m.lean));
    el.style.setProperty("--tilt", `${m.tilt}deg`);
    el.style.setProperty("--tempo", String(m.tempo));
    el.dataset.expr = expression;
  }, [perf, expression, stageRef]);

  useEffect(() => {
    mutedRef.current = muted;
    if (outGain.current) outGain.current.gain.value = muted ? 0 : 1;
  }, [muted]);

  // ---- Per-frame: measure the voice, drive the key light, count frames ----
  useEffect(() => {
    let raf = 0;
    let frames = 0;
    let since = performance.now();
    const buf = new Uint8Array(512);
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const rms = (a: AnalyserNode) => {
      a.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < a.fftSize; i += 1) {
        const v = (buf[i] - 128) / 128;
        sum += v * v;
      }
      return Math.sqrt(sum / a.fftSize);
    };
    const tick = (t: number) => {
      frames += 1;
      if (t - since >= 1000) {
        renderFps.current = Math.round((frames * 1000) / (t - since));
        frames = 0;
        since = t;
      }
      let target = 0;
      if (currentAudio.current && analyser.current) target = Math.min(1, rms(analyser.current) * 4.2);
      else if (ltSpeaking.current && remoteAnalyser.current) target = Math.min(1, rms(remoteAnalyser.current) * 4.2);
      synthLevel.current *= 0.9;
      target = Math.max(target, synthLevel.current);
      // No measurable audio from the browser's voice: give it a speech-like
      // envelope so the light still says "speaking", never a dead stage.
      if (browserSpeaking.current) {
        target = Math.max(target, 0.3 + 0.24 * Math.abs(Math.sin(t / 105)) * (0.65 + 0.35 * Math.sin(t / 43)));
      }
      // Fast attack, slow release: syllables read, silence settles.
      level.current += (target - level.current) * (target > level.current ? 0.55 : 0.1);
      const shown = reduced ? (speakingPriority.current >= 0 ? 0.42 : 0) : level.current;
      stageRef.current?.style.setProperty("--lvl", shown.toFixed(3));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [stageRef]);

  // ---- Once a second: the honest numbers -----------------------------------
  useEffect(() => {
    const id = setInterval(async () => {
      if (pc.current && stream) {
        try {
          const stats = await pc.current.getStats();
          stats.forEach((r) => {
            if (r.type === "inbound-rtp" && r.kind === "video" && typeof r.framesPerSecond === "number") streamFps.current = r.framesPerSecond;
          });
        } catch {
          streamFps.current = null;
        }
      } else streamFps.current = null;
      const usingStream = streamFps.current !== null;
      // The Up next queue, in answer order, with the reason for each place.
      const d = director.current;
      if (d) {
        const now = Date.now();
        const name = settingsRef.current.name;
        setUpNext(
          d.pending(now).slice(0, 4).map((ev) => {
            const q = d.queued(ev.id);
            const waitedS = Math.max(0, Math.round((now - ev.ts) / 1000));
            const p = priorityOf(ev, name);
            const base =
              ev.kind === "gift" ? "Gift" : ev.kind === "follow" ? "Follow" : ev.kind === "share" ? "Share"
                : p === PRIORITY.mention ? "Mentions him" : p === PRIORITY.question ? "Question" : "Comment";
            const prioritized = !!q && q.boost > 0;
            const note = q?.direction?.note;
            return {
              id: ev.id, handle: ev.handle, user: ev.user, text: ev.text, kind: ev.kind, waitedS, prioritized,
              why: prioritized ? `Prioritized by you${note ? ` · “${note.slice(0, 48)}”` : ""}` : `${base} · ${waitedS} s${note ? ` · “${note.slice(0, 40)}”` : ""}`,
            };
          }),
        );
      } else setUpNext([]);
      setMetrics({
        fps: Math.round(usingStream ? (streamFps.current ?? 0) : renderFps.current),
        fpsSource: usingStream ? "stream" : "render",
        latencyMs: lastLatency.current,
        queue: director.current?.size ?? 0,
        viewers: liveRef.current && feedRef.current === "demo" && liveSinceRef.current ? demoViewerCount(Date.now() - liveSinceRef.current) : null,
        replies: replies.current,
      });
    }, 1000);
    return () => clearInterval(id);
  }, [stream]);

  // ---- Which voice backend the server has (R4) -----------------------------
  useEffect(() => {
    fetch("/api/tts")
      .then((r) => r.json() as Promise<{ mode?: VoiceMode }>)
      .then((c) => setVoiceMode(c.mode ?? "browser"))
      .catch(() => setVoiceMode("browser"));
  }, []);

  // ---- LiveTalking: connect when it answers, close on leave ----------------
  const closeLiveTalking = useCallback(() => {
    pc.current?.close();
    pc.current = null;
    session.current = "";
    remoteAnalyser.current = null;
    setStream(null);
  }, []);

  const connectLiveTalking = useCallback(async () => {
    closeLiveTalking();
    setLtState("checking");
    if (!(await lt.current.reachable())) {
      setLtState("offline");
      return;
    }
    try {
      const peer = new RTCPeerConnection({ iceServers: [] });
      pc.current = peer;
      peer.addTransceiver("video", { direction: "recvonly" });
      peer.addTransceiver("audio", { direction: "recvonly" });
      peer.ontrack = (e) => {
        const s = e.streams[0];
        if (!s) return;
        setStream(s);
        if (e.track.kind === "audio") {
          const ctx = ensureAudio();
          if (ctx) {
            const a = ctx.createAnalyser();
            a.fftSize = 512;
            ctx.createMediaStreamSource(new MediaStream([e.track])).connect(a);
            remoteAnalyser.current = a;
          }
        }
      };
      peer.onconnectionstatechange = () => {
        if (peer.connectionState === "failed" || peer.connectionState === "disconnected") setLtState("offline");
      };
      await peer.setLocalDescription(await peer.createOffer());
      await new Promise<void>((done) => {
        if (peer.iceGatheringState === "complete") return done();
        const check = () => {
          if (peer.iceGatheringState === "complete") {
            peer.removeEventListener("icegatheringstatechange", check);
            done();
          }
        };
        peer.addEventListener("icegatheringstatechange", check);
        setTimeout(done, 3000);
      });
      const local = peer.localDescription;
      if (!local) throw new Error("no offer");
      const answer = await lt.current.offer({ sdp: local.sdp, type: local.type });
      session.current = String(answer.sessionid);
      await peer.setRemoteDescription({ sdp: answer.sdp, type: answer.type as RTCSdpType });
      setLtState("online");
    } catch {
      closeLiveTalking();
      setLtState("offline");
    }
  }, [closeLiveTalking, ensureAudio]);

  useEffect(() => {
    if (useLive) void connectLiveTalking();
    else {
      closeLiveTalking();
      // Not using it — but say truthfully whether it's running, without opening a session.
      setLtState("checking");
      void lt.current.reachable().then((ok) => setLtState(ok ? "available" : "offline"));
    }
    return () => closeLiveTalking();
  }, [useLive, connectLiveTalking, closeLiveTalking]);

  // ---- Speaking ------------------------------------------------------------
  const expressionRef = useRef<Emotion>("neutral");
  expressionRef.current = expression;

  const synth = useCallback(async (text: string): Promise<Blob | null> => {
    if (voiceModeRef.current === "browser") return null;
    const s = settingsRef.current;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 12_000);
      const res = await fetch("/api/tts", {
        method: "POST",
        signal: ctrl.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, format: "wav", speed: speedFor(s, expressionRef.current), voiceId: s.voice }),
      });
      clearTimeout(t);
      if (!res.ok || res.headers.get("content-type")?.includes("application/json")) throw new Error("no audio");
      return await res.blob();
    } catch {
      // Re-read: the mode can change during the await above.
      const mode = voiceModeRef.current as VoiceMode;
      if (mode !== "browser") {
        setVoiceMode("browser");
        notify("The voice server isn't answering, so the browser's voice is speaking for now.", "warn");
      }
      return null;
    }
  }, [notify]);

  const playBlob = useCallback(async (blob: Blob, onStart: () => void) => {
    const ctx = ensureAudio();
    const url = URL.createObjectURL(blob);
    const el = new Audio(url);
    if (ctx && analyser.current) ctx.createMediaElementSource(el).connect(analyser.current);
    currentAudio.current = el;
    try {
      await el.play();
      onStart();
      await new Promise<void>((done) => {
        el.onended = () => done();
        el.onpause = () => done();
        el.onerror = () => done();
      });
    } catch {
      /* autoplay refused or decode failed: the caption still showed */
    } finally {
      URL.revokeObjectURL(url);
      if (currentAudio.current === el) currentAudio.current = null;
    }
  }, [ensureAudio]);

  const speakBrowser = useCallback(async (text: string, onStart: () => void) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      onStart();
      browserSpeaking.current = true;
      await sleep(Math.min(9000, 400 + text.length * 55));
      browserSpeaking.current = false;
      return;
    }
    const synthApi = window.speechSynthesis;
    const u = new SpeechSynthesisUtterance(text);
    u.rate = settingsRef.current.speed;
    u.volume = mutedRef.current ? 0 : 1;
    const voice = synthApi.getVoices().find((v) => /en[-_]US/i.test(v.lang) && /male|guy|david|mark|alex/i.test(v.name)) ??
      synthApi.getVoices().find((v) => /^en/i.test(v.lang));
    if (voice) u.voice = voice;
    await new Promise<void>((done) => {
      const cap = setTimeout(() => {
        browserSpeaking.current = false;
        done();
      }, Math.max(4000, text.length * 110));
      u.onstart = () => {
        browserSpeaking.current = true;
        onStart();
      };
      u.onboundary = () => {
        synthLevel.current = 0.75 + Math.random() * 0.2;
      };
      u.onend = u.onerror = () => {
        clearTimeout(cap);
        browserSpeaking.current = false;
        done();
      };
      synthApi.speak(u);
    });
  }, []);

  const waitForLiveTalking = useCallback(async () => {
    ltSpeaking.current = true;
    await sleep(350);
    const until = Date.now() + 30_000;
    while (!interruptRef.current && Date.now() < until && (await lt.current.isSpeaking(session.current))) await sleep(200);
    ltSpeaking.current = false;
  }, []);

  const speak = useCallback(async (text: string, priority: number, startedAt?: number) => {
    // Last line of defence before the voice and the captions: nothing that
    // looks like markup is ever read aloud on air.
    const pieces = splitSentences(speakable(text));
    if (!pieces.length) return;
    interruptRef.current = false;
    speakingPriority.current = priority;
    setAiState("speaking");

    let first = true;
    const onStart = () => {
      if (!first) return;
      first = false;
      // Reply speed: from picking the turn to the first word out — what the
      // system controls. Time spent waiting in a busy queue is a different
      // number (the room is long), shown as the queue, not blamed on speed.
      if (startedAt) lastLatency.current = Date.now() - startedAt;
    };

    const viaLive = useLiveRef.current && ltStateRef.current === "online" && !!session.current;
    let pending = synth(pieces[0]);
    for (let i = 0; i < pieces.length; i += 1) {
      if (interruptRef.current || (!liveRef.current && !previewing.current)) break;
      // "Don't answer that" mid-answer: the current sentence finishes, the rest is dropped.
      if (i > 0 && wrapUp.current) break;
      setCaption(pieces[i]);
      const blob = await pending;
      pending = i + 1 < pieces.length ? synth(pieces[i + 1]) : Promise.resolve(null);
      if (!blob) {
        await speakBrowser(pieces[i], onStart);
      } else if (viaLive && (await lt.current.speak(session.current, blob))) {
        onStart();
        await waitForLiveTalking();
      } else {
        await playBlob(blob, onStart);
      }
    }
    setCaption("");
    speakingPriority.current = -1;
    wrapUp.current = false;
    recentLines.current = [...recentLines.current, pieces.join(" ")].slice(-6);
  }, [synth, speakBrowser, playBlob, waitForLiveTalking]);

  const interrupt = useCallback(() => {
    interruptRef.current = true;
    currentAudio.current?.pause();
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    if (session.current) void lt.current.interrupt(session.current);
  }, []);

  // ---- The brain -----------------------------------------------------------
  /** The private block for one reply: standing performance + this reply's notes + this viewer's note. */
  const directionFor = useCallback((d?: Direction): ReplyDirection => {
    const p = perfRef.current;
    return {
      emotion: d?.expression ?? nextEmotion.current ?? p.emotion,
      notes: p.notes,
      avoid: p.avoid,
      next: nextNotes.current,
      instruction: d?.note ?? "",
      reactions: p.reactions,
    };
  }, []);

  const askBrain = useCallback(async (kind: EventKind, user: string, text: string, said: string[], busy: boolean, direction: ReplyDirection, cancel?: AbortSignal) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), REPLY_TIMEOUT_MS);
    cancel?.addEventListener("abort", () => ctrl.abort());
    try {
      const res = await fetch("/api/ai-live-studio/reply", {
        method: "POST",
        signal: ctrl.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: settingsRef.current, kind, user, text, memory: said, busy, direction }),
      });
      const j = (await res.json()) as { reply?: string; mood?: Mood; canned?: boolean; note?: string; error?: string };
      if (!res.ok) return null;
      if (j.note) notify(j.note, "info");
      return j.reply ? { reply: j.reply, mood: j.mood ?? "neutral", canned: !!j.canned } : null;
    } catch {
      // Cancelled on purpose (a newer direction replaced it): not a failure, say nothing.
      if (!cancel?.aborted) notify("The AI didn't answer in time — moving to the next comment.", "warn");
      return null;
    } finally {
      clearTimeout(t);
    }
  }, [notify]);

  /**
   * A line the director asked for ("ask everyone where they're from"). The
   * intent is private: it goes to the brain, and only the line it writes is
   * shown and spoken — never the instruction itself.
   */
  const askCue = useCallback(async (cue: Cue) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), REPLY_TIMEOUT_MS);
    try {
      const res = await fetch("/api/ai-live-studio/reply", {
        method: "POST",
        signal: ctrl.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          settings: settingsRef.current, kind: "cue", cue: cue.kind, text: cue.intent,
          user: cue.about?.user ?? "", about: cue.about?.text ?? "", direction: directionFor(),
        }),
      });
      const j = (await res.json()) as { reply?: string; mood?: Mood; canned?: boolean; note?: string };
      if (!res.ok || !j.reply) return null;
      if (j.note) notify(j.note, "info");
      return { reply: j.reply, mood: j.mood ?? "neutral", canned: !!j.canned };
    } catch {
      notify("The AI didn't write that line in time — skipped it.", "warn");
      return null;
    } finally {
      clearTimeout(t);
    }
  }, [notify, directionFor]);

  // ---- Thinking ahead ------------------------------------------------------
  // While one line is spoken, the next reply is already being written — the
  // way a good host reads the next comment while finishing the current one.
  // If a gift jumps the queue meanwhile, the guess is simply thrown away.
  const ask = useCallback((ev: { kind: EventKind; handle: string; user: string; text: string }, d?: Direction, cancel?: AbortSignal) => {
    const said = memory.current.get(ev.handle) ?? [];
    // A long queue means a busy room: ask for one short sentence, so more people get answered.
    const busy = (director.current?.size ?? 0) > 4;
    return askBrain(ev.kind, ev.user, ev.text, said, busy, directionFor(d), cancel);
  }, [askBrain, directionFor]);

  const thinkAhead = useCallback(() => {
    const next = director.current?.peekTurn(Date.now());
    if (!next) return;
    const v = dirVersion.current;
    if (prefetched.current?.id === next.event.id && prefetched.current.version === v) return;
    prefetched.current?.abort.abort();
    const abort = new AbortController();
    prefetched.current = { id: next.event.id, version: v, reply: ask(next.event, next.direction, abort.signal), abort };
  }, [ask]);

  const consumeNext = useCallback(() => {
    if (!nextNotes.current.length && !nextEmotion.current) return;
    nextNotes.current = [];
    nextEmotion.current = null;
    setPendingNext([]);
  }, []);

  // ---- One turn ------------------------------------------------------------

  const runTurn = useCallback(async (turn: Turn, gen: number) => {
    const s = settingsRef.current;
    if (turn.kind === "answer") {
      const ev = turn.event;
      const startedAt = Date.now();
      patchItem(ev.id, { status: "answering" });
      setQuestion({ user: ev.user, handle: ev.handle, text: ev.text, kind: ev.kind, avatar: ev.avatar });
      // A reply written before the latest direction is thrown away, not spoken.
      const ready = prefetched.current?.id === ev.id && prefetched.current.version === dirVersion.current ? prefetched.current.reply : null;
      if (!ready) prefetched.current?.abort.abort();
      prefetched.current = null;
      if (!ready) setAiState("thinking");
      const said = memory.current.get(ev.handle) ?? [];
      answeringId.current = ev.id;
      const cueFace = turn.direction?.expression ?? nextEmotion.current;
      let out = await (ready ?? ask(ev, turn.direction));
      // A directed answer that came back as a stock line would ignore the director: try once more.
      if (out?.canned && turn.direction?.note && gen === genRef.current && liveRef.current) {
        out = (await ask(ev, turn.direction)) ?? out;
      }

      // This reply used the one-off direction; the next one starts clean.
      consumeNext();
      if (ev.text) memory.current.set(ev.handle, [...said, ev.text].slice(-5));
      if (gen !== genRef.current || !liveRef.current) return;
      if (!out) {
        patchItem(ev.id, { status: "skipped", note: "Not answered — the AI couldn't reply in time" });
        setQuestion(null);
        return;
      }
      const aiId = `ai:${ev.id}`;
      addItem({
        id: aiId, role: "ai", user: s.name, text: out.reply, ts: Date.now(), mood: out.mood, canned: out.canned, speaking: true,
        replyTo: { id: ev.id, user: ev.user, text: ev.text, kind: ev.kind },
      });
      replies.current += 1;
      if (ev.text) lastTopic.current = ev.text;
      setExpression(expressionFor(perfRef.current.emotion, out.mood, cueFace ?? null));
      thinkAhead();
      await speak(out.reply, turn.priority, startedAt);
      answeringId.current = null;
      setExpression(expressionFor(perfRef.current.emotion, null, null));
      patchItem(aiId, { speaking: false });
      patchItem(ev.id, { status: "answered" });
      setQuestion(null);
      return;
    }
    const startedAt = Date.now();
    let text: string;
    let mood: Mood | undefined;
    if (turn.kind === "cue") {
      setAiState("thinking");
      const cueFace = nextEmotion.current;
      const out = await askCue(turn.cue);
      consumeNext();
      if (gen !== genRef.current || !liveRef.current || !out) return;
      text = out.reply;
      mood = out.mood;
      setExpression(expressionFor(perfRef.current.emotion, out.mood, cueFace));
    } else text = turn.text;
    const aiId = `ai:${turn.kind}:${startedAt}`;
    addItem({ id: aiId, role: "ai", kind: turn.kind, user: s.name, text, ts: startedAt, speaking: true, ...(mood ? { mood } : {}) });
    replies.current += 1;
    thinkAhead();
    await speak(text, turn.kind === "say" ? 1000 : turn.kind === "cue" ? 500 : 0, startedAt);
    setExpression(expressionFor(perfRef.current.emotion, null, null));
    patchItem(aiId, { speaking: false });
  }, [addItem, patchItem, ask, askCue, thinkAhead, speak, consumeNext]);

  const syncDiscarded = useCallback(() => {
    for (const d of director.current?.drainDiscarded() ?? []) {
      patchItem(d.id, {
        status: d.reason,
        note: d.reason === "repeat" ? "Not answered — already answered a question like it" : "Not answered — chat had moved on",
      });
    }
  }, [patchItem]);

  const loop = useCallback(async (gen: number) => {
    while (gen === genRef.current && liveRef.current) {
      syncDiscarded();
      if (pausedRef.current || busyRef.current) {
        await sleep(200);
        continue;
      }
      const turn = director.current?.next(Date.now()) ?? null;
      if (!turn) {
        setAiState((st) => (st === "speaking" || st === "thinking" ? "listening" : st === "offline" ? "listening" : st));
        await sleep(250);
        continue;
      }
      busyRef.current = true;
      try {
        await runTurn(turn, gen);
      } finally {
        busyRef.current = false;
        director.current?.markSpoken(Date.now());
        if (gen === genRef.current && liveRef.current && !pausedRef.current) setAiState("listening");
      }
    }
  }, [runTurn, syncDiscarded]);

  // ---- Incoming events -----------------------------------------------------
  const ingest = useCallback((raw: unknown) => {
    const d0 = director.current;
    if (!d0 || !liveRef.current) return;
    const ev = parseEvent(raw, Date.now());
    if (!ev) return;
    const d = d0.enqueue(ev);
    if (d.status === "duplicate") return; // D5: the same message twice is one row
    addItem({
      id: ev.id, role: "viewer", kind: ev.kind, handle: ev.handle, user: ev.user, text: ev.text, ts: Date.now(), avatar: ev.avatar,
      status: d.status === "queued" ? "queued" : d.status === "blocked" ? "hidden" : "muted",
      note: d.status === "blocked" ? REASON_LABEL[d.reason] : d.status === "muted" ? "Hidden — you muted this viewer" : undefined,
    });
    if (d.status !== "queued") return;
    if (d.watched) {
      patchItem(ev.id, { prioritized: d.watched.promoted || undefined, instruction: d.watched.note, note: d.watched.promoted ? "Up next — you asked for it" : undefined });
      privateListener.current?.(`${ev.user} just commented — ${d.watched.promoted ? "answering them next" : "your note is attached"}`);
    }
    if (ev.kind === "gift") setGift({ user: ev.user, handle: ev.handle, text: ev.text, kind: ev.kind, avatar: ev.avatar });
    if (speakingPriority.current >= 0 && d0.shouldInterrupt(ev, speakingPriority.current)) interrupt();
  }, [addItem, interrupt, patchItem]);

  useEffect(() => {
    if (!gift) return;
    const t = setTimeout(() => setGift(null), 4500);
    return () => clearTimeout(t);
  }, [gift]);

  // ---- Feeds ---------------------------------------------------------------
  const stopFeeds = useCallback(() => {
    if (feedTimer.current) clearTimeout(feedTimer.current);
    feedTimer.current = null;
    relay.current?.close();
    relay.current = null;
    setFeedState("idle");
  }, []);

  const startDemo = useCallback(() => {
    const feedSrc = createDemoFeed(Math.floor(Math.random() * 1000));
    const step = () => {
      const beat = feedSrc.next();
      feedTimer.current = setTimeout(() => {
        if (!liveRef.current) return;
        ingest({ ...beat.raw, ts: Date.now() });
        step();
      }, beat.after);
    };
    setFeedState("connected");
    step();
  }, [ingest]);

  const startRelay = useCallback(() => {
    setFeedState("connecting");
    let opened = false;
    try {
      const ws = new WebSocket(RELAY_URL);
      relay.current = ws;
      ws.onopen = () => {
        opened = true;
        setFeedState("connected");
      };
      ws.onmessage = (m) => {
        try {
          ingest(JSON.parse(String(m.data)));
        } catch {
          /* a malformed line from the relay is skipped, not fatal */
        }
      };
      ws.onclose = () => {
        if (relay.current !== ws) return;
        setFeedState(opened ? "connecting" : "unreachable");
        if (opened && liveRef.current) setTimeout(() => liveRef.current && feedRef.current === "tiktok" && startRelay(), 3000);
      };
    } catch {
      setFeedState("unreachable");
    }
  }, [ingest]);

  const startFeed = useCallback((f: Feed) => {
    stopFeeds();
    if (f === "demo") startDemo();
    else startRelay();
  }, [stopFeeds, startDemo, startRelay]);

  const setFeed = useCallback((f: Feed) => {
    setFeedState0(f);
    feedRef.current = f;
    saveLocal(FEED_KEY, f);
    if (liveRef.current) startFeed(f);
  }, [startFeed]);

  // ---- Owner controls ------------------------------------------------------
  const goLive = useCallback(() => {
    ensureAudio();
    const s = settingsRef.current;
    const d = new Director({
      characterName: s.name,
      fillers: fillersFor(s),
      maxPerMinute: s.frequency,
      idleMs: idleMsFor(s.interaction),
      blocklist: s.blocklist,
    });
    const now = Date.now();
    d.start(now);
    director.current = d;
    prefetched.current = null;
    memory.current.clear();
    replies.current = 0;
    lastLatency.current = null;
    liveRef.current = true;
    // Pausing before going live is deliberate: the stream starts with the AI
    // holding, so the owner can set up. It is kept, not reset.
    setLive(true);
    setLiveSince(now);
    setAiState(pausedRef.current ? "paused" : "listening");
    setItems([{ id: `sys:start:${now}`, role: "system", user: "", text: feedRef.current === "demo" ? "You're live with the demo audience." : "You're live — reading TikTok comments.", ts: now }]);
    const gen = (genRef.current += 1);
    startFeed(feedRef.current);
    void loop(gen);
  }, [ensureAudio, loop, startFeed]);

  const endLive = useCallback(() => {
    genRef.current += 1;
    liveRef.current = false;
    dropPrefetch();
    if (rethink.current) clearTimeout(rethink.current);
    setSelectedId(null);
    director.current = null; // the stream's queue ends with it
    interrupt();
    stopFeeds();
    setLive(false);
    setAiState("offline");
    setCaption("");
    setQuestion(null);
    setGift(null);
    const mins = liveSinceRef.current ? Math.round((Date.now() - liveSinceRef.current) / 60_000) : 0;
    setItems((xs) => [...xs, { id: `sys:end:${Date.now()}`, role: "system", user: "", text: `Stream ended · ${mins} min · ${replies.current} ${replies.current === 1 ? "reply" : "replies"}`, ts: Date.now() }]);
    setLiveSince(null);
  }, [interrupt, stopFeeds, dropPrefetch]);


  const togglePause = useCallback(() => {
    const next = !pausedRef.current;
    pausedRef.current = next;
    setPaused(next);
    if (next) {
      interrupt();
      setAiState("paused");
    } else setAiState(liveRef.current ? "listening" : "offline");
  }, [interrupt]);

  const toggleMute = useCallback(() => setMuted((m) => !m), []);

  const answerNow = useCallback((id: string) => {
    if (!director.current?.promote(id)) return;
    patchItem(id, { status: "queued", note: "Up next — you asked for it" });
    // Start writing its reply now, so it is ready the moment the current line ends.
    thinkAhead();
  }, [patchItem, thinkAhead]);

  const skip = useCallback((id: string) => {
    if (director.current?.drop(id)) patchItem(id, { status: "skipped", note: "Skipped by you" });
  }, [patchItem]);

  const muteViewer = useCallback((handle: string) => {
    director.current?.muteViewer(handle);
    setItems((xs) => xs.map((x) => (x.handle === handle && x.status === "queued" ? { ...x, status: "muted", note: "Hidden — you muted this viewer" } : x)));
    notify(`Muted @${handle} for the rest of this stream.`);
  }, [notify]);

  const sayLine = useCallback((text: string) => {
    if (!director.current || !liveRef.current) return notify("Go live first — then Alex can say it on stream.", "warn");
    director.current.say(text);
  }, [notify]);

  const commentAsViewer = useCallback((text: string) => {
    if (!liveRef.current) return notify("Go live first to test a comment.", "warn");
    ingest({ type: "comment", handle: "you.testing", user: "You (test)", text, id: `test:${Date.now()}`, ts: Date.now() });
  }, [ingest, notify]);

  // ---- The director's hand ---------------------------------------------------
  /**
   * Apply directions that are already resolved to real viewers and comments.
   * Nothing here speaks: it changes what the next public line is and how it
   * is delivered. Returns what to show the owner, privately.
   */
  const applyDirectives = useCallback((list: Directive<Resolved>[]): { acks: string[]; problems: string[] } => {
    const acks: string[] = [];
    const problems: string[] = [];
    const d = director.current;
    const now = Date.now();
    let touched = false;
    const needLive = (what: string) => problems.push(`Go live first — ${what} needs the stream running.`);
    const aboutOf = (t: Resolved) =>
      t.by === "comment" ? { handle: t.handle, user: t.user, text: t.text } : t.by === "viewer" ? { handle: t.handle, user: t.user } : { handle: t.name, user: t.name };
    const markSkipped = (id: string) => patchItem(id, { status: "skipped", note: "Skipped by you", prioritized: undefined });

    for (const x of list) {
      switch (x.type) {
        case "tune": {
          setSettings((s) => {
            const clamp10 = (v: number) => Math.max(0, Math.min(10, v));
            let next = x.preset ? presetOf(s, x.preset) : s;
            const patch: Partial<StudioSettings> = {};
            if (x.humor) patch.humor = clamp10(next.humor + x.humor);
            if (x.energy) patch.energy = clamp10(next.energy + x.energy);
            if (x.expressiveness) patch.expressiveness = clamp10(next.expressiveness + x.expressiveness);
            if (x.interaction) patch.interaction = clamp10(next.interaction + x.interaction);
            if (x.speed) patch.speed = Math.round(Math.min(1.3, Math.max(0.8, next.speed + x.speed)) * 100) / 100;
            if (x.style) patch.style = x.style;
            if (Object.keys(patch).length) next = withChange(next, patch);
            saveSynced(SETTINGS_KEY, next);
            return next;
          });
          acks.push(ackFor(x));
          touched = true;
          break;
        }
        case "act": {
          if (x.scope === "next") {
            if (x.emotion) nextEmotion.current = x.emotion;
          } else {
            changePerf((p) => ({
              ...p,
              ...(x.emotion ? { emotion: x.emotion } : {}),
              ...(x.eyeContact ? { eyeContact: p.eyeContact + x.eyeContact } : {}),
              ...(x.headMotion ? { headMotion: p.headMotion + x.headMotion } : {}),
              ...(x.reactions !== undefined ? { reactions: x.reactions } : {}),
            }));
            if (x.emotion && !answeringId.current) setExpression(x.emotion);
          }
          acks.push(ackFor(x));
          touched = true;
          break;
        }
        case "note": {
          if (x.scope === "next") {
            nextNotes.current = [...nextNotes.current, x.text].slice(-4);
            setPendingNext([...nextNotes.current]);
          } else changePerf((p) => ({ ...p, notes: [...p.notes.filter((n) => n !== x.text), x.text].slice(-MAX_NOTES) }));
          acks.push(ackFor(x));
          touched = true;
          break;
        }
        case "avoid":
          changePerf((p) => ({ ...p, avoid: [...p.avoid.filter((t) => t !== x.topic.toLowerCase()), x.topic.toLowerCase()].slice(-MAX_AVOID) }));
          acks.push(ackFor(x));
          touched = true;
          break;
        case "reply": {
          if (!d) {
            needLive("answering someone");
            break;
          }
          const dir: Direction = { ...(x.instruction ? { note: x.instruction } : {}), ...(x.expression ? { expression: x.expression } : {}) };
          const t = x.target;
          if (t.by === "watch") d.watch(t.name, now, { direction: dir, promote: x.promote });
          else {
            const id = t.by === "comment" ? t.id : t.commentId;
            if (id && d.has(id)) {
              if (x.promote) d.promote(id, dir);
              else d.direct(id, dir);
              patchItem(id, {
                status: "queued",
                ...(x.promote ? { prioritized: true, note: "Up next — you asked for it" } : {}),
                ...(x.instruction ? { instruction: x.instruction } : {}),
              });
            } else {
              // Already answered, or nothing waiting from them: speak to them now, in character.
              d.cue({
                kind: "line",
                intent: t.by === "comment"
                  ? `Respond to ${t.user}'s comment${x.instruction ? ` — ${x.instruction}` : ""}`
                  : `Talk to ${t.user} directly${x.instruction ? ` — ${x.instruction}` : ""}`,
                about: aboutOf(t),
              });
            }
          }
          acks.push(ackFor(x));
          touched = true;
          break;
        }
        case "skip": {
          if (!d) {
            needLive("skipping a comment");
            break;
          }
          const t = x.target;
          if (t.by === "watch") d.watch(t.name, now, { skip: true });
          else if (t.by === "comment") {
            if (answeringId.current === t.id) wrapUp.current = true;
            else if (d.drop(t.id)) markSkipped(t.id);
          } else d.dropViewer(t.handle).forEach(markSkipped);
          acks.push(ackFor(x));
          touched = true;
          break;
        }
        case "mute": {
          if (!d) {
            needLive("muting a viewer");
            break;
          }
          const t = x.target;
          if (t.by === "watch") d.watch(t.name, now, { skip: true });
          else {
            d.muteViewer(t.handle);
            setItems((xs) => xs.map((i) => (i.handle === t.handle && i.status === "queued" ? { ...i, status: "muted", note: "Hidden — you muted this viewer" } : i)));
          }
          acks.push(ackFor(x));
          touched = true;
          break;
        }
        case "cue":
          if (!d) {
            needLive("a line for the room");
            break;
          }
          d.cue({ kind: x.kind, intent: x.intent, ...(x.target ? { about: aboutOf(x.target) } : {}) });
          acks.push(ackFor(x));
          touched = true;
          break;
        case "say":
          if (!d) {
            needLive("a line for Alex to say");
            break;
          }
          d.say(x.text);
          acks.push(ackFor(x));
          break;
        case "wait":
          if (!d) {
            needLive("waiting");
            break;
          }
          d.hold(x.seconds * 1000, now);
          acks.push(ackFor(x));
          break;
        case "pause":
        case "resume":
          if ((x.type === "pause") !== pausedRef.current) togglePause();
          acks.push(ackFor(x));
          break;
        case "reset":
          changePerf(() => DEFAULT_PERFORMANCE);
          nextNotes.current = [];
          nextEmotion.current = null;
          setPendingNext([]);
          if (!answeringId.current) setExpression("neutral");
          acks.push(ackFor(x));
          touched = true;
          break;
      }
    }
    if (touched) {
      dirVersion.current += 1;
      dropPrefetch();
      // Write the next reply again under the new direction — once, after a burst settles.
      if (rethink.current) clearTimeout(rethink.current);
      if (liveRef.current) rethink.current = setTimeout(() => thinkAhead(), 400);
    }
    return { acks, problems };
  }, [changePerf, patchItem, togglePause, thinkAhead, dropPrefetch]);


  /** Sliders and chips in the booth: change the standing performance directly. */
  const setPerformance = useCallback((patch: Partial<Performance>) => {
    changePerf((p) => ({ ...p, ...patch }));
    if (patch.emotion && !answeringId.current) setExpression(patch.emotion);
  }, [changePerf]);

  /** What the private side needs to understand "that", "Mike" and the room. */
  const commandContext = useCallback(() => {
    const viewers = itemsRef.current.filter((i) => i.role === "viewer" && i.handle && (i.kind === "comment" || i.kind === "speech"));
    const comments: ChatRef[] = viewers.slice(-40).map((i) => ({
      id: i.id, handle: i.handle as string, user: i.user, text: i.text, waiting: i.status === "queued" || i.status === "answering",
    }));
    const focusId = selectedRef.current ?? answeringId.current ?? comments[comments.length - 1]?.id ?? null;
    return {
      name: settingsRef.current.name,
      comments,
      focusId,
      topic: lastTopic.current,
      recent: recentLines.current,
      waiting: director.current?.size ?? 0,
      live: liveRef.current,
    };
  }, []);

  /** Alex's latest public lines, for the mic's echo guard. */
  const recentPublic = useCallback(() => recentLines.current, []);

  /** Hear the current voice and speed without going live. Never touches the stream. */
  const previewVoice = useCallback(async () => {
    if (liveRef.current || previewing.current) return;
    ensureAudio();
    previewing.current = true;
    try {
      await speak(`Hey, I'm ${settingsRef.current.name}. This is how I sound on stream.`, 0);
    } finally {
      previewing.current = false;
      setAiState("offline");
    }
  }, [ensureAudio, speak]);

  useEffect(() => () => {
    genRef.current += 1;
    liveRef.current = false;
    if (feedTimer.current) clearTimeout(feedTimer.current);
    relay.current?.close();
    void audioCtx.current?.close();
  }, []);

  const source: "livetalking" | "preview" = useLive && ltState === "online" && stream ? "livetalking" : "preview";

  return {
    settings, update, applyPreset,
    live, liveSince, paused, muted, aiState, items, caption, question, gift, toast,
    feed, feedState, setFeed, ltState, useLive, setUseLive, reconnectLiveTalking: connectLiveTalking,
    stream, source, voiceMode, metrics,
    goLive, endLive, togglePause, toggleMute, answerNow, skip, muteViewer, sayLine, commentAsViewer, previewVoice,
    // The director's side.
    perf, setPerformance, expression, pendingNext, upNext, selectedId, setSelectedId,
    publicSink, setPublicSink, canRoute, applyDirectives, commandContext, recentPublic, setPrivateListener,
  };

}

export type Studio = ReturnType<typeof useStudio>;
