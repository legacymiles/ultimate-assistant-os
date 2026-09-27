"use client";

// ---------------------------------------------------------------------------
// The command line: the one control that is always on screen and always focused.
//
// It is pinned above whatever the centre column is showing — the block stack,
// or a mounted tab — because the point of the arrangement is that you never
// have to go somewhere to ask for something. Typing and speaking produce the
// same block; the only difference the surface records is which one it was.
// ---------------------------------------------------------------------------

import { useEffect, useRef } from "react";
import { Icon } from "../icons";
import { MODES, type Mode } from "@/lib/new-jarvis/types";
import type { VoiceState } from "@/lib/new-jarvis/useWakeVoice";

export function CommandLine({
  value,
  onChange,
  onSubmit,
  mode,
  onMode,
  voiceState,
  heard,
  micSupported,
  onMic,
  busy,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  mode: Mode;
  onMode: (m: Mode) => void;
  voiceState: VoiceState;
  heard: string;
  micSupported: boolean;
  onMic: () => void;
  busy: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  // Grow with the text rather than scrolling inside three lines: a long
  // instruction you cannot see the start of is one you cannot check before
  // sending.
  //
  // Measured in a frame, not inline. On mount the first measurement happens
  // before flex has settled and before the mono face has loaded, and
  // scrollHeight then reports the container's height — which silently pins an
  // empty one-line box open at the 200px ceiling for the life of the page,
  // because nothing re-runs this until the owner types.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      el.style.height = "auto";
      el.style.height = `${Math.max(22, Math.min(el.scrollHeight, 200))}px`;
    };
    const frame = requestAnimationFrame(fit);
    window.addEventListener("resize", fit);
    // A late-loading font changes the line height under a box already sized.
    void document.fonts?.ready.then(fit).catch(() => {});
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", fit);
    };
  }, [value]);

  // "/" focuses it from anywhere, the way every dense tool does, and Escape
  // gives the keyboard back to the page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable;
      if (e.key === "/" && !typing) {
        e.preventDefault();
        ref.current?.focus();
      }
      if (e.key === "Escape" && document.activeElement === ref.current) ref.current?.blur();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const hearing = voiceState === "hearing";
  const shown = hearing && heard ? heard : value;

  return (
    <div className="border-b border-line bg-panel px-3 py-2.5">
      {/* Wraps on a phone: the chips and the two buttons hold the first line
          and the field takes the whole of the second. Kept on one line, the
          field is squeezed to about forty pixels and the placeholder sets one
          word per line. */}
      <div
        className="nj-command flex flex-wrap items-center gap-2 rounded-lg border border-line bg-canvas px-2.5 py-2"
        data-armed={Boolean(value.trim())}
        data-hearing={hearing}
      >
        <div className="order-1 flex shrink-0 gap-0.5">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => onMode(m.id)}
              title={m.hint}
              aria-pressed={mode === m.id}
              className={`rounded px-1.5 py-0.5 text-[10.5px] font-medium uppercase tracking-wide transition ${
                mode === m.id ? "bg-brand text-white" : "text-ink-muted hover:bg-elevated hover:text-ink"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>

        <textarea
          ref={ref}
          rows={1}
          value={shown}
          readOnly={hearing}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSubmit();
            }
          }}
          placeholder={
            hearing
              ? "Listening…"
              : voiceState === "waiting"
                ? 'Type, or say "Jarvis"…'
                : "Ask, or tell it what to do…"
          }
          aria-label="Command"
          className="order-4 min-w-0 basis-full resize-none overflow-hidden bg-transparent py-0.5 font-mono text-[13px] leading-relaxed text-ink outline-none placeholder:text-ink-muted sm:order-2 sm:basis-0 sm:flex-1"
        />

        <button
          type="button"
          onClick={onMic}
          disabled={!micSupported}
          title={
            !micSupported
              ? "This browser cannot listen. Chrome, Edge or Safari can."
              : voiceState === "off"
                ? "Listen for \"Jarvis\""
                : "Stop listening"
          }
          className={`order-2 ml-auto shrink-0 rounded-md p-1.5 transition sm:order-3 sm:ml-0 ${
            voiceState === "off"
              ? "text-ink-muted hover:bg-elevated hover:text-ink"
              : hearing
                ? "bg-core/15 text-core"
                : "bg-brand/15 text-brand"
          } disabled:cursor-not-allowed disabled:opacity-40`}
        >
          <Icon.Mic width={15} height={15} />
          <span className="sr-only">{voiceState === "off" ? "Start listening" : "Stop listening"}</span>
        </button>

        <button
          type="button"
          onClick={onSubmit}
          disabled={!value.trim() || busy}
          title={busy ? "Working…" : "Send"}
          className="order-3 shrink-0 rounded-md p-1.5 text-ink-muted transition hover:bg-elevated hover:text-ink disabled:cursor-not-allowed disabled:opacity-30 sm:order-4"
        >
          {busy ? (
            <Icon.Refresh width={15} height={15} className="animate-spin [animation-duration:1.4s]" />
          ) : (
            <Icon.Send width={15} height={15} />
          )}
          <span className="sr-only">{busy ? "Working" : "Send"}</span>
        </button>
      </div>
      <p className="mt-1 px-1 text-[10.5px] text-ink-muted">
        {MODES.find((m) => m.id === mode)?.hint}
      </p>
    </div>
  );
}
