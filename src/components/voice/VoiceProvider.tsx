"use client";

// ---------------------------------------------------------------------------
// One voice for the whole hub.
//
// Jarvis's always-listening voice (useWakeVoice: wake word, barge-in, echo
// test, spoken answers) used to live inside Jarvis's Chat tab, so it only
// worked on that one page. It now lives here, in the root layout, which stays
// mounted across every client-side navigation — so there is ONE microphone,
// it keeps listening as the owner moves between apps, and every chat box and
// harness thread can receive what is said (see lib/voice/targets.ts):
//
//   say "Jarvis, …" (or tap the orb) → the sentence goes to the chat or
//   harness thread being used → its answer is read back.
//
// With nothing registered on the page it types into the text box the owner
// was in, and with no box either it hands the request to Jarvis's agent,
// which has the PC harness, the browser and every hub tool.
//
// Three guards:
//   · owner pages only — clients, public apps and the login page never get a
//     microphone (routeAccess);
//   · never inside a frame — a framed app would start a second microphone
//     listening to the same room;
//   · only the visible tab listens, so two open tabs never both answer.
// ---------------------------------------------------------------------------

import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { routeAccess } from "@/lib/hubAccess";
import { ASK_EVENT } from "@/lib/new-jarvis/askEvent";
import { useWakeVoice, type UseWakeVoice } from "@/lib/new-jarvis/useWakeVoice";
import { pickTarget, register, shouldStopListening, speakable, touch, unregister, type Registered, type Registry, type VoiceTarget } from "@/lib/voice/targets";
import { VoiceOrb } from "./VoiceOrb";

/** Hands-free = always listening for "Jarvis". Off unless the owner turns it on. */
const HANDS_FREE_KEY = "hub-voice:hands-free";
const PENDING_KEY = "hub-voice:pending-ask";

export interface HubVoice {
  voice: UseWakeVoice;
  /** The target a sentence would go to right now. */
  target: Registered | null;
  /** True where the voice may run at all (owner page, top window). */
  allowed: boolean;
  registerTarget: (t: VoiceTarget) => () => void;
  touchTarget: (id: string) => void;
  setSpeakReplies: (on: boolean) => void;
  /**
   * The start/stop button. Off → listen for ONE request (no wake word needed),
   * answer, and switch the microphone off again. On → stop everything now:
   * the microphone and anything being said.
   */
  tap: () => Promise<void>;
  /** Stop listening and speaking right now. */
  stop: () => void;
  /** True while it is listening, thinking or speaking. */
  active: boolean;
  /** Always listening for "Jarvis" — opt-in, remembered on this device. */
  handsFree: boolean;
  setHandsFree: (on: boolean) => void;
}

const Ctx = createContext<HubVoice | null>(null);

/** The hub voice, or null outside the provider (tests, framed pages). */
export function useHubVoice(): HubVoice | null {
  return useContext(Ctx);
}

function readHandsFree(): boolean {
  try {
    return window.localStorage.getItem(HANDS_FREE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeHandsFree(on: boolean): void {
  try {
    if (on) window.localStorage.setItem(HANDS_FREE_KEY, "1");
    else window.localStorage.removeItem(HANDS_FREE_KEY);
  } catch {
    /* private mode: it simply won't stay on across visits */
  }
}

/** A text box the owner can type in — never a password or a hidden field. */
function editable(el: Element | null): el is HTMLInputElement | HTMLTextAreaElement | HTMLElement {
  if (!el || !(el instanceof HTMLElement)) return false;
  if (el.closest("[data-hub-voice]")) return false;
  if (el instanceof HTMLTextAreaElement) return !el.disabled && !el.readOnly;
  if (el instanceof HTMLInputElement) return ["text", "search", ""].includes(el.type) && !el.disabled && !el.readOnly;
  return el.isContentEditable;
}

/** Put words into a React-controlled box so React sees them as typed. */
function typeInto(el: HTMLElement, words: string): void {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const proto = el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    const next = el.value ? `${el.value.replace(/\s+$/, "")} ${words}` : words;
    setter?.call(el, next);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.focus();
    return;
  }
  el.focus();
  document.execCommand?.("insertText", false, words);
}

export function VoiceProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  const [framed, setFramed] = useState(true);
  useEffect(() => {
    try {
      setFramed(window.self !== window.top);
    } catch {
      setFramed(true);
    }
  }, []);
  const allowed = !framed && routeAccess(pathname, new Set()) === "owner";

  const [speakReplies, setSpeakReplies] = useState(true);
  const regRef = useRef<Registry>(new Map());
  const [reg, setReg] = useState<Registry>(regRef.current);
  const commit = (next: Registry) => {
    regRef.current = next;
    setReg(next);
  };

  const lastBox = useRef<{ el: HTMLElement; at: number } | null>(null);
  useEffect(() => {
    const onFocus = (e: FocusEvent) => {
      const el = e.target as Element | null;
      if (editable(el)) lastBox.current = { el: el as HTMLElement, at: Date.now() };
    };
    document.addEventListener("focusin", onFocus);
    return () => document.removeEventListener("focusin", onFocus);
  }, []);

  const pathRef = useRef(pathname);
  pathRef.current = pathname;
  const voiceRef = useRef<UseWakeVoice | null>(null);

  const onCommand = useCallback(
    async (text: string) => {
      const voice = voiceRef.current;
      const words = text.trim();
      if (!voice || !words) return;
      const say = async (reply: string) => {
        const s = speakable(reply);
        if (s) await voice.speak(s);
        else if (voice.listening) voice.setState("waiting");
      };

      // 1. a chat or harness thread on this page
      const target = pickTarget(regRef.current);
      if (target?.speaksForItself) {
        try {
          await target.send(words);
        } catch (e) {
          await say(`That didn't reach ${target.label}. ${e instanceof Error ? e.message : ""}`);
        }
        return;
      }
      if (target) {
        voice.setState("thinking");
        try {
          const reply = await target.send(words);
          voice.markAnswered();
          if (typeof reply === "string" && reply.trim()) await say(reply);
          else if (voice.listening && voice.state !== "speaking") voice.setState("waiting");
        } catch (e) {
          await say(`That didn't reach ${target.label}. ${e instanceof Error ? e.message : ""}`);
        }
        return;
      }

      // 2. the text box the owner was just in
      const box = lastBox.current;
      if (box && box.el.isConnected && Date.now() - box.at < 60_000) {
        typeInto(box.el, words);
        if (voice.listening) voice.setState("waiting");
        return;
      }

      // 3. Jarvis's agent, which can do nearly anything
      if (pathRef.current.startsWith("/apps/jarvis")) {
        window.dispatchEvent(new CustomEvent(ASK_EVENT, { detail: { text: words, send: true, mode: "do" } }));
        return;
      }
      try {
        window.sessionStorage.setItem(PENDING_KEY, words);
      } catch {
        /* the navigation still happens; the words are typed into Chat instead */
      }
      void say("Opening Jarvis for that.");
      router.push("/apps/jarvis");
    },
    [router],
  );

  const voice = useWakeVoice({ onCommand: (t) => void onCommand(t), speakReplies });
  voiceRef.current = voice;

  // Development only: feed a sentence in as if it had been heard, so routing
  // can be checked in a browser that has no microphone. Never in production.
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    const w = window as unknown as { __hubVoice?: { say: (t: string) => Promise<void>; target: () => string | null } };
    w.__hubVoice = { say: onCommand, target: () => pickTarget(regRef.current)?.label ?? null };
    return () => {
      delete w.__hubVoice;
    };
  }, [onCommand]);

  // --- start / stop (owner, Nov 2026: "it seems like it is just always
  // listening… this needs a start and stop button so it doesn't start random
  // tasks because it's listening to random convos") --------------------------
  //
  // By default nothing listens. Start = hear ONE request without the wake
  // word, answer it, then the microphone goes off again by itself. Stop cuts
  // everything at once. Always listening for "Jarvis" is Hands-free: an
  // opt-in switch, remembered on this device, never the default.
  const [handsFree, setHandsFreeState] = useState(false);
  useEffect(() => setHandsFreeState(readHandsFree()), []);
  const handsFreeRef = useRef(handsFree);
  handsFreeRef.current = handsFree;

  const stop = useCallback(() => {
    voiceRef.current?.hush();
    voiceRef.current?.stop();
  }, []);
  const tap = useCallback(async () => {
    const v = voiceRef.current;
    if (!v) return;
    if (v.listening || v.state === "speaking" || v.state === "thinking") return stop();
    await v.talk();
  }, [stop]);
  const setHandsFree = useCallback(
    (on: boolean) => {
      writeHandsFree(on);
      setHandsFreeState(on);
      if (on) void voiceRef.current?.start();
      else stop();
    },
    [stop],
  );

  // One request, then off: the moment it goes back to waiting for its name
  // after hearing, thinking or speaking, the microphone is switched off —
  // unless Hands-free is on.
  const prevState = useRef(voice.state);
  useEffect(() => {
    const was = prevState.current;
    prevState.current = voice.state;
    if (shouldStopListening(was, voice.state, handsFreeRef.current)) voiceRef.current?.stop();
  }, [voice.state]);

  // Never on where it may not run; Hands-free resumes only on the visible tab
  // of an owner page, and a tab that goes to the background stops listening.
  useEffect(() => {
    const v = voiceRef.current;
    if (!v?.supported) return;
    if (!allowed) {
      if (v.listening) v.stop();
      return;
    }
    const sync = () => {
      const visible = document.visibilityState === "visible";
      if (!visible && voiceRef.current?.listening) voiceRef.current?.stop();
      if (visible && handsFreeRef.current && !voiceRef.current?.listening) void voiceRef.current?.start();
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, [allowed, voice.supported, handsFree]);

  const registerTarget = useCallback((t: VoiceTarget) => {
    commit(register(regRef.current, t, Date.now()));
    return () => commit(unregister(regRef.current, t.id));
  }, []);
  const touchTarget = useCallback((id: string) => {
    if (regRef.current.has(id)) commit(touch(regRef.current, id, Date.now()));
  }, []);

  const target = useMemo(() => pickTarget(reg), [reg]);
  const value = useMemo<HubVoice>(
    () => ({
      voice,
      target,
      allowed,
      registerTarget,
      touchTarget,
      setSpeakReplies,
      tap,
      stop,
      active: voice.listening || voice.state === "speaking" || voice.state === "thinking",
      handsFree,
      setHandsFree,
    }),
    [voice, target, allowed, registerTarget, touchTarget, tap, stop, handsFree, setHandsFree],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      {/* Jarvis draws its own reactor for the same voice; everywhere else gets the orb. */}
      {allowed && voice.supported && !pathname.startsWith("/apps/jarvis") ? <VoiceOrb /> : null}
    </Ctx.Provider>
  );
}

/**
 * Make a chat box or harness thread a place the voice can talk to.
 *
 * `send` may change every render; the latest one is always used. Pass
 * `active: false` to step aside (no thread open, the box is hidden).
 */
export function useVoiceTarget(t: Omit<VoiceTarget, "send"> & { send: VoiceTarget["send"]; active?: boolean }): { touch: () => void } {
  const hub = useHubVoice();
  const sendRef = useRef(t.send);
  sendRef.current = t.send;
  const { id, label, kind, priority, active = true, speaksForItself = false } = t;
  const registerTarget = hub?.registerTarget;
  useEffect(() => {
    if (!registerTarget || !active) return;
    return registerTarget({ id, label, kind, priority, speaksForItself, send: (text) => sendRef.current(text) });
  }, [registerTarget, id, label, kind, priority, active, speaksForItself]);
  const touchTarget = hub?.touchTarget;
  return { touch: useCallback(() => touchTarget?.(id), [touchTarget, id]) };
}

/** Jarvis picks up a request the voice handed over from another page. */
export function takePendingVoiceAsk(): string {
  try {
    const t = window.sessionStorage.getItem(PENDING_KEY) ?? "";
    if (t) window.sessionStorage.removeItem(PENDING_KEY);
    return t;
  } catch {
    return "";
  }
}
