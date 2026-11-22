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
import { useEffect, useState } from "react";
import { Mic, Square } from "lucide-react";
import type { VoiceState } from "@/lib/new-jarvis/useWakeVoice";
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
