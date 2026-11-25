// The real-looking face, lip-synced by LiveTalking on this PC.
//
// ONE connection per page, however many faces are on screen (the big avatar,
// every chat box, the popover): each LiveTalking session runs its own lip-sync
// inference on the GPU, so the faces share a single stream. It connects while
// at least one real face is showing AND lip sync is switched on for this
// device, and gives itself up as Jarvis's voice sink only while live.
//
// On by default wherever the real face is picked — picking "Real" is the
// opt-in, and nothing reaches for 127.0.0.1 until a real face is on screen
// (owner, 2026-11-24: the live site's real face sat silent because lip sync
// was off there and its switch was out of sight). It can still be switched
// off per device. From the public site Chrome may ask once for local network
// access; when LiveTalking isn't running (or that's declined) the face is the
// breathing portrait and Jarvis speaks as usual — nothing is lost.
//
// Browser-only. Talks to LiveTalking through the same client AI Live Studio
// uses (`/offer`, `/humanaudio`, `/is_speaking`, `/interrupt_talk`).

import { LiveTalking } from "@/lib/ai-live-studio/livetalking";
import { localAsrAvailable } from "@/lib/ai-live-studio/localRecognition";
import { voiceSink, type VoiceSink } from "../voiceSink";
import { MOVES, MOVE_MS, nextIdleMs, pickAfterLine, pickIdle, type Move } from "./moves";
import { speechMsForText, wavDurationMs } from "./wav";

export type LiveFaceState = "off" | "checking" | "connecting" | "live" | "unavailable";

export interface LiveFaceSnapshot {
  state: LiveFaceState;
  stream: MediaStream | null;
  /** Lip sync switched on for this device. */
  enabled: boolean;
  /** LiveTalking's own speech recognition answers too — Jarvis hears through it while live. */
  asr: boolean;
  /** LiveTalking is running but every face slot is taken (other open tabs hold them). */
  busy: boolean;
}

const PREF_KEY = "jarvis-avatar:livetalking";
const RETRY_MS = 30_000;
/**
 * A tab nobody can see gives its LiveTalking slot back after this long. Each
 * slot is a lip-sync run on the GPU, LiveTalking allows five, and background
 * tabs were holding all of them — so the tab in front was refused (owner,
 * 2026-11-24: "it said LiveTalking wasn't working").
 */
const HIDDEN_RELEASE_MS = 15_000;
const SPEAK_CEILING_MS = 90_000;
/** LiveTalking's own voice (Edge), used only when the hub's voice server is down. Suits Alex. */
const FALLBACK_VOICE = "en-US-AndrewNeural";

const lt = new LiveTalking();
const listeners = new Set<() => void>();
let snap: LiveFaceSnapshot = { state: "off", stream: null, enabled: false, asr: false, busy: false };
let loaded = false;
let wanted = 0;
let pc: RTCPeerConnection | null = null;
let session = "";
let audioEl: HTMLAudioElement | null = null;
let ctx: AudioContext | null = null;
let level: AnalyserNode | null = null;
let retry: ReturnType<typeof setTimeout> | null = null;
let closeTimer: ReturnType<typeof setTimeout> | null = null;
let interrupted = false;
let hiddenTimer: ReturnType<typeof setTimeout> | null = null;
// Alex's moves (moves.ts): a reaction after a line, something of his own while quiet.
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let talking = false;
let actingUntil = 0;
let lastMove: string | null = null;
const hidden = () => typeof document !== "undefined" && document.hidden;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function emit(patch: Partial<LiveFaceSnapshot>) {
  snap = { ...snap, ...patch };
  for (const l of listeners) l();
}

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  // A reload or a closed tab doesn't close WebRTC cleanly: LiveTalking would keep
  // running that session's lip sync on the GPU until it timed out. Close it now.
  window.addEventListener("pagehide", () => close());
  // Only the tab in front holds a slot: hand it back a while after the tab is
  // hidden, take one again when it's shown.
  document.addEventListener("visibilitychange", () => {
    if (hiddenTimer) {
      clearTimeout(hiddenTimer);
      hiddenTimer = null;
    }
    if (hidden()) {
      hiddenTimer = setTimeout(() => {
        hiddenTimer = null;
        if (hidden() && snap.state !== "off") close();
      }, HIDDEN_RELEASE_MS);
    } else if (wanted > 0 && snap.enabled && (snap.state === "off" || snap.state === "unavailable")) {
      if (retry) clearTimeout(retry);
      retry = null;
      emit({ state: "off" });
      void connect();
    }
  });
  let enabled = true;
  try {
    const v = localStorage.getItem(PREF_KEY);
    if (v === "on") enabled = true;
    if (v === "off") enabled = false;
  } catch {
    /* no storage: the default stands */
  }
  snap = { ...snap, enabled };
}

/** Play one of Alex's action clips. Nothing happens when LiveTalking has no such clip. */
async function act(move: Move | null) {
  if (!move || snap.state !== "live" || !session || talking) return;
  if (await lt.act(session, move.type)) {
    actingUntil = Date.now() + MOVE_MS;
    lastMove = move.id;
  }
}

/** While he's quiet, now and then a sip, a glance at a thought, a lean in. */
function scheduleIdle() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
  if (snap.state !== "live") return;
  idleTimer = setTimeout(() => {
    idleTimer = null;
    if (snap.state !== "live") return;
    if (!talking && !hidden() && Date.now() >= actingUntil) void act(pickIdle(lastMove));
    scheduleIdle();
  }, nextIdleMs());
}

/**
 * A line is about to start. LiveTalking finishes a playing action before it
 * says anything, so cut the action rather than make the answer wait for it.
 */
async function beginLine() {
  talking = true;
  if (Date.now() < actingUntil && session) {
    actingUntil = 0;
    await lt.interrupt(session);
  }
}

/** A line has been said: maybe react to it, and restart the quiet clock. */
function endLine(text: string) {
  talking = false;
  if (!interrupted) void act(pickAfterLine(text));
  scheduleIdle();
}

/** LiveTalking accepts the audio before it starts saying it; this long to start, at most. */
const START_MS = 8_000;

/**
 * Wait until Alex has said the last word (or was cut off, or the face went
 * away), so the mic isn't handed back while he talks.
 *
 * `endBy` is when the line should be over by the clock (upload start + the
 * clip's own length). LiveTalking reads a whole clip before it answers the
 * upload, so a short line can be finished before the first poll — the clock
 * covers that; `is_speaking` covers a long line, a slow GPU and network
 * buffering. Whichever is later wins; nothing waits past the ceiling.
 */
async function untilQuiet(endBy: number) {
  const live = () => !interrupted && snap.state === "live";
  const startBy = Math.max(endBy, Date.now() + START_MS);
  let started = false;
  // Until he starts — or the clock says the line is already over.
  while (live() && Date.now() < startBy) {
    if (await lt.isSpeaking(session)) {
      started = true;
      break;
    }
    if (Date.now() >= endBy) break;
    await sleep(150);
  }
  const ceiling = Date.now() + SPEAK_CEILING_MS;
  if (started) while (live() && Date.now() < ceiling && (await lt.isSpeaking(session))) await sleep(200);
  // The stream may still be playing its last half-second; let it.
  while (live() && Date.now() < endBy) await sleep(100);
}

/** Jarvis's voice, routed through LiveTalking while the face is live. */
const sink: VoiceSink = {
  async speak(audio, text = "") {
    if (snap.state !== "live" || !session) return false;
    interrupted = false;
    // A tap on the voice button has happened by now, so sound may play.
    void audioEl?.play().catch(() => undefined);
    const length = wavDurationMs(new Uint8Array(await audio.arrayBuffer()));
    await beginLine();
    const sentAt = Date.now();
    if (!(await lt.speak(session, audio))) {
      talking = false;
      return false;
    }
    await untilQuiet(sentAt + (length ?? 0) + 500);
    endLine(text);
    return true;
  },
  async speakText(text) {
    if (snap.state !== "live" || !session) return false;
    interrupted = false;
    void audioEl?.play().catch(() => undefined);
    await beginLine();
    const sentAt = Date.now();
    if (!(await lt.say(session, text, FALLBACK_VOICE))) {
      talking = false;
      return false;
    }
    // LiveTalking makes the voice itself first (about a second), then reads it.
    await untilQuiet(sentAt + 1200 + speechMsForText(text));
    endLine(text);
    return true;
  },
  interrupt() {
    interrupted = true;
    if (session) void lt.interrupt(session);
  },
  analyser() {
    return level;
  },
};

function close() {
  if (voiceSink.get() === sink) voiceSink.set(null);
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
  talking = false;
  actingUntil = 0;
  pc?.close();
  pc = null;
  session = "";
  if (audioEl) audioEl.srcObject = null;
  level = null;
  emit({ state: "off", stream: null });
}

async function connect() {
  if (typeof window === "undefined" || !snap.enabled || wanted === 0) return;
  // A background tab waits until it's shown (the visibility handler connects it).
  if (hidden()) return;
  if (snap.state === "checking" || snap.state === "connecting" || snap.state === "live") return;
  if (retry) {
    clearTimeout(retry);
    retry = null;
  }
  emit({ state: "checking", busy: false });
  if (!(await lt.reachable())) {
    emit({ state: "unavailable", stream: null });
    // Started LiveTalking after opening the page? Try again in a while.
    if (wanted > 0 && snap.enabled) retry = setTimeout(() => void connect(), RETRY_MS);
    return;
  }
  if (wanted === 0 || !snap.enabled) return emit({ state: "off" });
  emit({ state: "connecting" });
  try {
    const peer = new RTCPeerConnection({ iceServers: [] });
    pc = peer;
    peer.addTransceiver("video", { direction: "recvonly" });
    peer.addTransceiver("audio", { direction: "recvonly" });
    peer.ontrack = (e) => {
      const s = e.streams[0];
      if (!s) return;
      emit({ stream: s });
      if (e.track.kind === "audio") {
        // One audible element for the whole page; every <video> showing the face is muted.
        if (!audioEl) {
          audioEl = new Audio();
          audioEl.autoplay = true;
        }
        audioEl.srcObject = s;
        void audioEl.play().catch(() => undefined);
        try {
          ctx = ctx ?? new AudioContext();
          const a = ctx.createAnalyser();
          a.fftSize = 512;
          ctx.createMediaStreamSource(new MediaStream([e.track])).connect(a);
          level = a;
        } catch {
          level = null;
        }
      }
    };
    peer.onconnectionstatechange = () => {
      if (pc !== peer) return;
      if (peer.connectionState === "failed" || peer.connectionState === "disconnected") {
        close();
        emit({ state: "unavailable" });
        if (wanted > 0 && snap.enabled) retry = setTimeout(() => void connect(), RETRY_MS);
      }
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
    const answer = await lt.offer({ sdp: local.sdp, type: local.type });
    // A full LiveTalking answers 200 with {code: -1, msg: "Maximum session limit reached"}.
    const refused = answer as unknown as { code?: number; sdp?: string };
    if (refused.code === -1 || !refused.sdp) {
      peer.close();
      if (pc === peer) pc = null;
      emit({ state: "unavailable", stream: null, busy: true });
      if (wanted > 0 && snap.enabled) retry = setTimeout(() => void connect(), RETRY_MS);
      return;
    }
    session = String(answer.sessionid);
    await peer.setRemoteDescription({ sdp: answer.sdp, type: answer.type as RTCSdpType });
    if (pc !== peer) return;
    emit({ state: "live" });
    voiceSink.set(sink);
    scheduleIdle();
    // Hear through LiveTalking too, when its recognizer is installed (funasr).
    void localAsrAvailable(true).then((asr) => emit({ asr }));
  } catch {
    close();
    emit({ state: "unavailable" });
    if (wanted > 0 && snap.enabled) retry = setTimeout(() => void connect(), RETRY_MS);
  }
}

export const liveFace = {
  get(): LiveFaceSnapshot {
    load();
    return snap;
  },
  subscribe(fn: () => void): () => void {
    load();
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  /** A real face is on screen. Returns its release. Faces coming and going in a re-render don't reconnect. */
  want(): () => void {
    load();
    wanted += 1;
    if (closeTimer) {
      clearTimeout(closeTimer);
      closeTimer = null;
    }
    void connect();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      wanted = Math.max(0, wanted - 1);
      if (wanted === 0) {
        if (retry) clearTimeout(retry);
        retry = null;
        closeTimer = setTimeout(() => wanted === 0 && close(), 1500);
      }
    };
  },
  /** Switch lip sync on or off for this device. */
  setEnabled(on: boolean): void {
    load();
    try {
      localStorage.setItem(PREF_KEY, on ? "on" : "off");
    } catch {
      /* kept for this visit only */
    }
    emit({ enabled: on });
    if (on) void connect();
    else {
      if (retry) clearTimeout(retry);
      retry = null;
      close();
    }
  },
  /** Do one of Alex's moves now ("sip", "laugh", "think", "wave", "lean"). */
  act(id: string): void {
    void act(MOVES.find((m) => m.id === id) ?? null);
  },
  /** Try again now (LiveTalking was just started). */
  retry(): void {
    if (snap.state === "unavailable") emit({ state: "off" });
    void connect();
  },
};
