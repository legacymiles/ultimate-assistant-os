"use client";

// ---------------------------------------------------------------------------
// The avatar, the one voice button, and the floating dock — the pieces every
// Jarvis chat harness shows (picked by the owner 2026-11-22, mockup 3 "Bold":
// a big avatar centred over the chat while it is empty, ONE big round voice
// button, and a pill top-right once a conversation starts that expands into a
// side stage). It transforms into a new form every few seconds by itself.
//
// The Three.js scene is loaded only in the browser and only when shown
// (dynamic import), and anything without WebGL gets a CSS glow instead of a
// blank box.
// ---------------------------------------------------------------------------

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { Maximize2, Mic, Minimize2, Square } from "lucide-react";
import { PRESETS } from "@/lib/new-jarvis/avatar/looks";
import { avatarStore, useAvatar } from "@/lib/new-jarvis/avatar/store";
import type { UseWakeVoice, VoiceState } from "@/lib/new-jarvis/useWakeVoice";
import type { AvatarVariant, AvatarVoice } from "./AvatarScene";
import "./avatar.css";

const AvatarScene = dynamic(() => import("./AvatarScene"), { ssr: false, loading: () => <div className="jav-fallback" aria-hidden /> });

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const q = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(q.matches);
    const on = () => setReduced(q.matches);
    q.addEventListener("change", on);
    return () => q.removeEventListener("change", on);
  }, []);
  return reduced;
}

let webglOk: boolean | null = null;
function hasWebgl(): boolean {
  if (webglOk !== null) return webglOk;
  try {
    const c = document.createElement("canvas");
    webglOk = Boolean(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    webglOk = false;
  }
  return webglOk;
}

/** What the avatar is doing, in one word, for the caption under it. */
export function avatarStateLabel(state: VoiceState | undefined, busy?: boolean, handsFree?: boolean): string {
  if (state === "hearing") return "Listening";
  if (state === "thinking" || (busy && state !== "speaking")) return "Thinking";
  if (state === "speaking") return "Speaking";
  if (state === "waiting") return handsFree ? "Say “Jarvis”" : "Listening";
  return "Ready";
}

export function JarvisAvatar({ voice, busy, variant, className = "" }: { voice: AvatarVoice | null; busy?: boolean; variant: AvatarVariant; className?: string }) {
  const reduced = useReducedMotion();
  const [gl, setGl] = useState<boolean | null>(null);
  useEffect(() => setGl(hasWebgl()), []);
  const state = voice?.state ?? "off";
  return (
    <div className={`jav jav--${variant} ${className}`} data-state={busy && state === "off" ? "thinking" : state} aria-hidden>
      <div className="jav-aura" />
      {gl ? <AvatarScene voice={voice} busy={busy} variant={variant} reduced={reduced} /> : <div className="jav-fallback" />}
    </div>
  );
}

/**
 * THE voice button. Tap to talk (one request, then the microphone goes off by
 * itself), tap again to stop listening or cut off the answer.
 */
export function VoiceButton({
  state,
  supported,
  onTap,
  size = "big",
  label = true,
}: {
  state: VoiceState;
  supported: boolean;
  onTap: () => void;
  size?: "big" | "small";
  label?: boolean;
}) {
  const live = state === "hearing" || state === "thinking" || state === "speaking";
  const text = !supported
    ? "This browser can't listen — Chrome or Edge can"
    : state === "hearing"
      ? "Listening… tap to stop"
      : state === "thinking"
        ? "Thinking… tap to stop"
        : state === "speaking"
          ? "Speaking — tap to interrupt"
          : "Start a conversation";
  return (
    <div className={`jav-voice jav-voice--${size}`} data-state={state} data-live={live || undefined}>
      <button
        type="button"
        className="jav-voice__btn"
        onClick={onTap}
        disabled={!supported}
        aria-pressed={live}
        aria-label={live ? "Stop" : "Start a voice conversation"}
        title={text}
      >
        <span className="jav-voice__ring" aria-hidden />
        {live ? <Square size={size === "big" ? 20 : 12} fill="currentColor" aria-hidden /> : <Mic size={size === "big" ? 26 : 15} aria-hidden />}
      </button>
      {label && <span className="jav-voice__label">{text}</span>}
    </div>
  );
}

const DOCK_KEY = "jarvis-avatar:dock-open";

/**
 * The avatar while a conversation is the focus: a pill top-right (face, what
 * it is doing, the voice button, expand), or a side stage when expanded.
 * Everything voice-related that is not the button lives in the stage, so the
 * page has exactly one voice control.
 */
export function AvatarDock({
  voice,
  busy,
  onTalk,
  handsFree,
  onHandsFree,
  speakReplies,
  onSpeakReplies,
  where,
}: {
  voice: UseWakeVoice;
  busy?: boolean;
  onTalk: () => void;
  handsFree: boolean;
  onHandsFree: (on: boolean) => void;
  speakReplies?: boolean;
  onSpeakReplies?: (on: boolean) => void;
  /** Where a spoken request goes, e.g. "Website Studio". */
  where?: string;
}) {
  const [open, setOpen] = useState(false);
  const av = useAvatar();
  useEffect(() => {
    try {
      setOpen(window.localStorage.getItem(DOCK_KEY) === "1");
    } catch {
      /* private mode: starts as the pill */
    }
  }, []);
  const toggle = (on: boolean) => {
    setOpen(on);
    try {
      if (on) window.localStorage.setItem(DOCK_KEY, "1");
      else window.localStorage.removeItem(DOCK_KEY);
    } catch {
      /* not remembered, still works */
    }
  };
  const label = avatarStateLabel(voice.state, busy, handsFree);
  const lookName = av.prefs.custom ? "Your look" : (PRESETS.find((p) => p.look === av.showing)?.name ?? "Transforming");
  const bars = [0.5, 0.9, 0.65, 1, 0.55];

  if (!open) {
    return (
      <div className="jav-pill" data-state={voice.state} data-hub-voice="">
        <button type="button" className="jav-pill__face" onClick={() => toggle(true)} aria-label="Expand Jarvis">
          <JarvisAvatar voice={voice} busy={busy} variant="pill" />
        </button>
        <span className="jav-pill__state" aria-live="polite">
          {voice.error ? <span className="jav-pill__err">{voice.error}</span> : label}
        </span>
        <span className="jav-pill__wave" aria-hidden>
          {bars.map((b, i) => (
            <i key={i} style={{ transform: `scaleY(${0.2 + Math.min(1, voice.level * 1.6) * b})` }} />
          ))}
        </span>
        <VoiceButton state={voice.state} supported={voice.supported} onTap={onTalk} size="small" label={false} />
        <button type="button" className="jav-pill__expand" onClick={() => toggle(true)} aria-label="Expand" title="Expand">
          <Maximize2 size={13} aria-hidden />
        </button>
      </div>
    );
  }

  return (
    <aside className="jav-stage" data-state={voice.state} data-hub-voice="" aria-label="Jarvis">
      <header className="jav-stage__head">
        <span className="jav-stage__dot" aria-hidden />
        <span className="jav-stage__state" aria-live="polite">
          {label}
          {where ? <em> · {where}</em> : null}
        </span>
        <button type="button" className="jav-stage__min" onClick={() => toggle(false)} aria-label="Minimise" title="Minimise">
          <Minimize2 size={13} aria-hidden />
        </button>
      </header>
      <JarvisAvatar voice={voice} busy={busy} variant="panel" />
      <p className="jav-stage__look">{lookName}</p>
      {(voice.heard || voice.error) && <p className={`jav-stage__heard ${voice.error ? "is-err" : ""}`}>{voice.error || voice.heard}</p>}
      <VoiceButton state={voice.state} supported={voice.supported} onTap={onTalk} />
      <div className="jav-stage__opts">
        <Switch on={av.prefs.cycle} onChange={(on) => avatarStore.apply([{ type: "cycle", on }])} label="Transform every few seconds" />
        <Switch on={handsFree} onChange={onHandsFree} label="Always listen for “Jarvis”" />
        {onSpeakReplies && <Switch on={speakReplies ?? true} onChange={onSpeakReplies} label="Speak answers aloud" />}
        {av.prefs.custom && (
          <button type="button" className="jav-stage__reset" onClick={() => avatarStore.apply([{ type: "reset" }])}>
            Back to the usual look
          </button>
        )}
      </div>
      <p className="jav-stage__try">Try: “turn yourself into a blue holographic wolf” · “make your eyes glowing red” · “smaller and float”</p>
    </aside>
  );
}

function Switch({ on, onChange, label }: { on: boolean; onChange: (on: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} className="jav-switch" onClick={() => onChange(!on)}>
      <span className="jav-switch__track" aria-hidden>
        <span className="jav-switch__knob" />
      </span>
      {label}
    </button>
  );
}
