"use client";

// ---------------------------------------------------------------------------
// The hub's voice, as one small orb in the bottom-left corner of every owner
// page (Jarvis draws its own reactor for the same voice, so it is hidden
// there).
//
// It is a START / STOP button, not an always-open microphone: tap it and it
// listens for one request, answers, and switches itself off. While it is
// listening, thinking or speaking, a Stop button cuts everything at once.
// Always listening for "Jarvis" is Hands-free — an opt-in switch in the label,
// off unless the owner turns it on.
// ---------------------------------------------------------------------------

import { Mic, Square } from "lucide-react";
import { useState } from "react";
import { useHubVoice } from "./VoiceProvider";
import "./voice.css";

export function VoiceOrb() {
  const hub = useHubVoice();
  const [open, setOpen] = useState(false);
  const voice = hub?.voice;
  if (!hub || !voice) return null;

  const state = voice.state;
  const active = hub.active;
  const where = hub.target?.label ?? "Jarvis";
  const line = voice.error
    ? voice.error
    : state === "hearing"
      ? voice.heard || "Listening… say what you need"
      : state === "thinking"
        ? `Sending to ${where}…`
        : state === "speaking"
          ? "Answering — tap Stop to cut it off"
          : hub.handsFree && voice.listening
            ? `Hands-free: listening for “Jarvis” · goes to ${where}`
            : `Tap to talk · goes to ${where}`;
  const showLine = open || active || Boolean(voice.error);

  return (
    <div
      className="hv"
      data-hub-voice=""
      data-state={active ? state : "off"}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      {showLine ? (
        <div className="hv-line" role="status" aria-live="polite">
          <span>{line}</span>
          {active ? (
            <button type="button" className="hv-stop" onClick={hub.stop}>
              <Square aria-hidden="true" /> Stop
            </button>
          ) : (
            <button
              type="button"
              role="switch"
              aria-checked={hub.handsFree}
              className="hv-hf"
              onClick={() => hub.setHandsFree(!hub.handsFree)}
              title="Always listen for “Jarvis” on this device"
            >
              <span className="hv-sw" aria-hidden="true" />
              Hands-free
            </button>
          )}
        </div>
      ) : null}
      <button
        type="button"
        className="hv-orb"
        aria-pressed={active}
        aria-label={active ? "Stop listening" : `Start talking to ${where}`}
        onClick={() => void hub.tap()}
      >
        <span className="hv-core" />
        {active ? <Square className="hv-glyph hv-glyph-stop" aria-hidden="true" /> : <Mic className="hv-glyph" aria-hidden="true" />}
      </button>
    </div>
  );
}
