"use client";

// ---------------------------------------------------------------------------
// The avatar and the big voice button (picked by the owner 2026-11-22, mockup
// 3 "Bold": a big avatar centred over the empty chat with ONE big round voice
// button). Once a conversation starts the avatar lives inside the chat box as
// its voice button instead (components/voice/ChatVoiceAvatar.tsx) — never in a
// floating window over the page. It transforms every few seconds by itself.
//
// The Three.js scene is loaded only in the browser and only when shown
// (dynamic import), and anything without WebGL gets a CSS glow instead of a
// blank box.
// ---------------------------------------------------------------------------

import dynamic from "next/dynamic";
import { Component, useEffect, useState, type ReactNode } from "react";
import { Mic, Square } from "lucide-react";
import { avatarStore, useAvatar } from "@/lib/new-jarvis/avatar/store";
import type { VoiceState } from "@/lib/new-jarvis/useWakeVoice";
import type { AvatarVariant, AvatarVoice } from "./AvatarScene";
import { liveFace } from "@/lib/new-jarvis/avatar/liveFace";
import { REAL_FACE_SRC, RealFace, useLiveFace } from "./RealFace";
import "./avatar.css";

const AvatarScene = dynamic(() => import("./AvatarScene"), { ssr: false, loading: () => <div className="jav-fallback" aria-hidden /> });

/**
 * The 3D scene loads as its own chunk — on first view, or later when someone
 * switches back from the real face. If that load fails (a flaky network, a
 * deploy mid-session) the glowing core shows instead of the whole page
 * crashing; the next view tries again.
 */
class SceneBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? <div className="jav-fallback" aria-hidden /> : this.props.children;
  }
}

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
  // Which agent: the Three.js avatar, or the real-looking face. One setting,
  // synced, so every chat box and the big avatar show the same one.
  const real = useAvatar().prefs.face === "real";
  const state = voice?.state ?? "off";
  return (
    <div className={`jav jav--${variant}${real ? " jav--real" : ""} ${className}`} data-state={busy && state === "off" ? "thinking" : state} aria-hidden>
      {!real && <div className="jav-aura" />}
      {real ? (
        <RealFace voice={voice} variant={variant} reduced={reduced} />
      ) : gl ? (
        <SceneBoundary>
          <AvatarScene voice={voice} busy={busy} variant={variant} reduced={reduced} />
        </SceneBoundary>
      ) : (
        <div className="jav-fallback" />
      )}
    </div>
  );
}

/**
 * The 3D | Real switch (the picked mockup: a small pill under the face).
 * The same control sits in the avatar popover of every chat box.
 */
export function FaceSwitch({ className = "", lips = true }: { className?: string; lips?: boolean }) {
  const face = useAvatar().prefs.face;
  const pick = (f: "3d" | "real") => avatarStore.apply([{ type: "face", face: f }]);
  return (
    <>
    <div className={`jav-face ${className}`} role="radiogroup" aria-label="Jarvis's face">
      <button type="button" role="radio" aria-checked={face === "3d"} className="jav-face__opt" onClick={() => pick("3d")}>
        <span className="jav-face__dot jav-face__dot--3d" aria-hidden />
        3D
      </button>
      <button type="button" role="radio" aria-checked={face === "real"} className="jav-face__opt" onClick={() => pick("real")}>
        <span className="jav-face__dot" style={{ backgroundImage: `url(${REAL_FACE_SRC})` }} aria-hidden />
        Real
      </button>
    </div>
    {lips && face === "real" && <LipSyncLine />}
    </>
  );
}

/**
 * Under the big face: whether the real face is lip-synced, and the one button
 * that fixes it when it isn't — so a silent face always says why. (The chat
 * boxes' popover has the full switch.)
 */
function LipSyncLine() {
  const lf = useLiveFace();
  if (lf.enabled && lf.state === "live") {
    return (
      <p className="jav-lipline" data-state="live" role="status">
        {lf.asr ? "Lips and hearing on this PC — tap the mic and talk" : "Lip sync on — tap the mic and talk"}
      </p>
    );
  }
  if (!lf.enabled) {
    return (
      <p className="jav-lipline" data-state="off" role="status">
        Lip sync is off
        <button type="button" onClick={() => liveFace.setEnabled(true)}>
          Turn on
        </button>
      </p>
    );
  }
  if (lf.state === "unavailable") {
    return (
      <p className="jav-lipline" data-state="unavailable" role="status">
        {lf.busy ? "LiveTalking is busy — other open Jarvis tabs hold every face" : <>LiveTalking isn&rsquo;t answering on this PC</>}
        <button type="button" onClick={() => liveFace.retry()}>
          Try again
        </button>
      </p>
    );
  }
  return (
    <p className="jav-lipline" data-state="connecting" role="status">
      Connecting to LiveTalking…
    </p>
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
