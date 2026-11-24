"use client";

// ---------------------------------------------------------------------------
// The ONE voice button of a Jarvis chat — and it is the avatar.
//
// Owner, 2026-11-22: "there should only be 1 tts button … if there is a chat
// on any page in Jarvis then the tts animation can be integrated into that",
// and the floating corner window covered a navigation button. So the living
// avatar sits INSIDE each chat box, where the mic used to be:
//
//   tap the face   → talk (one request, then the microphone goes off by
//                    itself); tap again → stop listening / cut the answer off.
//   the small ▾    → a popover above the face with the big avatar and the
//                    voice switches. It opens only when asked and closes on a
//                    click elsewhere or Escape, so nothing sits over the page.
//
// Used by every chat that registers with the hub voice: Jarvis chat (and its
// status bar on the other tabs), Profiles, App Builder, Website Studio drafts,
// a Client Review build, a harness thread and the Dashboard agent. Outside the
// hub voice (a framed app, a client page) it draws nothing.
// ---------------------------------------------------------------------------

import { ChevronUp } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FaceSwitch, JarvisAvatar, avatarStateLabel } from "../new-jarvis/avatar/JarvisAvatar";
import { PRESETS } from "@/lib/new-jarvis/avatar/looks";
import { avatarStore, useAvatar } from "@/lib/new-jarvis/avatar/store";
import { useHubVoice } from "./VoiceProvider";
import "../new-jarvis/avatar/avatar.css";

export function ChatVoiceAvatar({ busy, size = "md" }: { busy?: boolean; size?: "sm" | "md" }) {
  const hub = useHubVoice();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  if (!hub || !hub.allowed) return null;
  const voice = hub.voice;
  const live = voice.state === "hearing" || voice.state === "thinking" || voice.state === "speaking";
  const label = avatarStateLabel(voice.state, busy, hub.handsFree);
  const title = !voice.supported
    ? "This browser can't listen — Chrome or Edge can"
    : live
      ? `${label} — tap to stop`
      : `Talk to ${hub.target?.label ?? "Jarvis"}`;

  return (
    <span ref={wrap} className={`jav-chat jav-chat--${size}`} data-state={voice.state} data-live={live || undefined} data-hub-voice="">
      <button
        type="button"
        className="jav-chat__face"
        onClick={() => void hub.tap()}
        disabled={!voice.supported}
        aria-pressed={live}
        aria-label={live ? "Stop" : "Talk to Jarvis"}
        title={title}
      >
        <JarvisAvatar voice={voice} busy={busy} variant="pill" />
        <span className="jav-chat__ring" aria-hidden />
      </button>
      <button
        type="button"
        className="jav-chat__more"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="Jarvis's avatar and voice settings"
        title="Avatar and voice settings"
      >
        <ChevronUp size={12} aria-hidden />
      </button>
      {open && <AvatarPopover anchor={wrap} busy={busy} onClose={() => setOpen(false)} />}
    </span>
  );
}

function AvatarPopover({ anchor, busy, onClose }: { anchor: React.RefObject<HTMLSpanElement | null>; busy?: boolean; onClose: () => void }) {
  const hub = useHubVoice();
  const av = useAvatar();
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // Sit just above the face (below it when there is no room above), kept
  // inside the window — anchored to the button, never parked in a corner.
  useLayoutEffect(() => {
    const place = () => {
      const a = anchor.current?.getBoundingClientRect();
      const b = box.current;
      if (!a || !b) return;
      const w = b.offsetWidth;
      const h = b.offsetHeight;
      const left = Math.min(window.innerWidth - w - 8, Math.max(8, a.right - w));
      const above = a.top - h - 8;
      const top = above >= 8 ? above : Math.min(window.innerHeight - h - 8, a.bottom + 8);
      setPos({ left, top: Math.max(8, top) });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchor]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (box.current?.contains(t) || anchor.current?.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [anchor, onClose]);

  if (!hub) return null;
  const voice = hub.voice;
  const real = av.prefs.face === "real";
  const lookName = real ? "Real face — lit by his voice" : av.prefs.custom ? "Your look" : (PRESETS.find((p) => p.look === av.showing)?.name ?? "Transforming");

  return createPortal(
    <div
      ref={box}
      className="jav-pop"
      role="dialog"
      aria-label="Jarvis"
      data-state={voice.state}
      data-hub-voice=""
      style={pos ? { left: pos.left, top: pos.top } : { visibility: "hidden", left: 0, top: 0 }}
    >
      <header className="jav-pop__head">
        <span className="jav-pop__dot" aria-hidden />
        <span className="jav-pop__state" aria-live="polite">
          {avatarStateLabel(voice.state, busy, hub.handsFree)}
          {hub.target ? <em> · {hub.target.label}</em> : null}
        </span>
      </header>
      <JarvisAvatar voice={voice} busy={busy} variant="panel" />
      <p className="jav-pop__look">{lookName}</p>
      {(voice.heard || voice.error) && <p className={`jav-pop__heard ${voice.error ? "is-err" : ""}`}>{voice.error || voice.heard}</p>}
      <FaceSwitch className="jav-face--pop" />
      <div className="jav-pop__opts">
        {!real && <Switch on={av.prefs.cycle} onChange={(on) => avatarStore.apply([{ type: "cycle", on }])} label="Transform every few seconds" />}
        <Switch on={hub.handsFree} onChange={hub.setHandsFree} label="Always listen for “Jarvis”" />
        <Switch on={hub.speakReplies} onChange={hub.setSpeakReplies} label="Speak answers aloud" />
        {av.prefs.custom && !real && (
          <button type="button" className="jav-pop__reset" onClick={() => avatarStore.apply([{ type: "reset" }])}>
            Back to the usual look
          </button>
        )}
      </div>
      <p className="jav-pop__try">
        {real
          ? "Tap the face to talk. Say “go back to 3D” to switch. Lip sync runs only with LiveTalking on your PC."
          : "Tap the face to talk. Try: “turn yourself into a blue holographic wolf” · “switch to your real face”"}
      </p>
    </div>,
    document.body,
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
