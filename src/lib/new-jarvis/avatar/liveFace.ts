// The real-looking face, lip-synced by LiveTalking on this PC.
//
// ONE connection per page, however many faces are on screen (the big avatar,
// every chat box, the popover): each LiveTalking session runs its own lip-sync
// inference on the GPU, so the faces share a single stream. It connects while
// at least one real face is showing AND lip sync is switched on for this
// device, and gives itself up as Jarvis's voice sink only while live.
//
// Opt-in per device, and on by default only on localhost: from the public
// site, reaching a server on 127.0.0.1 makes Chrome ask the user for local
// network access — fine for the owner on their PC, wrong to spring on anyone
// else. When LiveTalking isn't running, the face is the breathing portrait
// and Jarvis speaks as usual; nothing is lost.
//
// Browser-only. Talks to LiveTalking through the same client AI Live Studio
// uses (`/offer`, `/humanaudio`, `/is_speaking`, `/interrupt_talk`).

import { LiveTalking } from "@/lib/ai-live-studio/livetalking";
import { voiceSink, type VoiceSink } from "../voiceSink";
import { speechMsForText, wavDurationMs } from "./wav";

export type LiveFaceState = "off" | "checking" | "connecting" | "live" | "unavailable";

export interface LiveFaceSnapshot {
  state: LiveFaceState;
  stream: MediaStream | null;
  /** Lip sync switched on for this device. */
  enabled: boolean;
}

const PREF_KEY = "jarvis-avatar:livetalking";
const RETRY_MS = 30_000;
const SPEAK_CEILING_MS = 90_000;
/** LiveTalking's own voice (Edge), used only when the hub's voice server is down. Suits Alex. */
const FALLBACK_VOICE = "en-US-AndrewNeural";

const lt = new LiveTalking();
const listeners = new Set<() => void>();
let snap: LiveFaceSnapshot = { state: "off", stream: null, enabled: false };
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

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function emit(patch: Partial<LiveFaceSnapshot>) {
  snap = { ...snap, ...patch };
  for (const l of listeners) l();
}

function defaultEnabled(): boolean {
  const h = typeof location !== "undefined" ? location.hostname : "";
  return h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h.endsWith(".localhost");
}

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  // A reload or a closed tab doesn't close WebRTC cleanly: LiveTalking would keep
  // running that session's lip sync on the GPU until it timed out. Close it now.
  window.addEventListener("pagehide", () => close());
  let enabled = defaultEnabled();
  try {
    const v = localStorage.getItem(PREF_KEY);
    if (v === "on") enabled = true;
    if (v === "off") enabled = false;
  } catch {
    /* no storage: the default stands */
  }
  snap = { ...snap, enabled };
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
  async speak(audio) {
    if (snap.state !== "live" || !session) return false;
    interrupted = false;
    // A tap on the voice button has happened by now, so sound may play.
    void audioEl?.play().catch(() => undefined);
    const length = wavDurationMs(new Uint8Array(await audio.arrayBuffer()));
    const sentAt = Date.now();
    if (!(await lt.speak(session, audio))) return false;
    await untilQuiet(sentAt + (length ?? 0) + 500);
    return true;
  },
  async speakText(text) {
    if (snap.state !== "live" || !session) return false;
    interrupted = false;
    void audioEl?.play().catch(() => undefined);
    const sentAt = Date.now();
    if (!(await lt.say(session, text, FALLBACK_VOICE))) return false;
    // LiveTalking makes the voice itself first (about a second), then reads it.
    await untilQuiet(sentAt + 1200 + speechMsForText(text));
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
  pc?.close();
  pc = null;
  session = "";
  if (audioEl) audioEl.srcObject = null;
  level = null;
  emit({ state: "off", stream: null });
}

async function connect() {
  if (typeof window === "undefined" || !snap.enabled || wanted === 0) return;
  if (snap.state === "checking" || snap.state === "connecting" || snap.state === "live") return;
  if (retry) {
    clearTimeout(retry);
    retry = null;
  }
  emit({ state: "checking" });
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
    session = String(answer.sessionid);
    await peer.setRemoteDescription({ sdp: answer.sdp, type: answer.type as RTCSdpType });
    if (pc !== peer) return;
    emit({ state: "live" });
    voiceSink.set(sink);
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
  /** Try again now (LiveTalking was just started). */
  retry(): void {
    if (snap.state === "unavailable") emit({ state: "off" });
    void connect();
  },
};
