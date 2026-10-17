"use client";

// ---------------------------------------------------------------------------
// The command line: the one control that is always on screen and always focused.
//
// It is pinned above whatever the centre column is showing — the block stack,
// or a mounted tab — because the point of the arrangement is that you never
// have to go somewhere to ask for something. Typing and speaking produce the
// same block; the only difference the surface records is which one it was.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from "react";
import { Icon } from "../icons";
import { ModelPicker } from "./ModelPicker";
import { ACCEPT_CHAT_MEDIA, type ChatMedia } from "@/lib/new-jarvis/chatMedia";
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
  model,
  onModel,
  media,
  onFiles,
  onRemoveMedia,
  preparing,
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
  /** OpenRouter model id; "" = Auto. */
  model: string;
  onModel: (id: string) => void;
  /** Pictures, clips and recordings waiting to go with the next message. */
  media: ChatMedia[];
  onFiles: (files: File[]) => void;
  onRemoveMedia: (id: string) => void;
  /** Files still being read in the browser. */
  preparing: number;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const picker = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const mediaFiles = (list: DataTransfer | null) =>
    list ? Array.from(list.files).filter((f) => /^(image|video|audio)\//.test(f.type)) : [];

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
    <div className="nj-commandbar border-b border-line bg-panel px-3 py-2.5">
      {/* Wraps on a phone: the chips and the two buttons hold the first line
          and the field takes the whole of the second. Kept on one line, the
          field is squeezed to about forty pixels and the placeholder sets one
          word per line. */}
      <div
        className={`nj-command flex flex-wrap items-center gap-2 rounded-lg border bg-canvas px-2.5 py-2 ${dragging ? "border-brand" : "border-line"}`}
        data-armed={Boolean(value.trim() || media.length)}
        data-hearing={hearing}
        data-busy={busy || undefined}
        onDragOver={(e) => {
          if (Array.from(e.dataTransfer.items).some((i) => i.kind === "file")) {
            e.preventDefault();
            setDragging(true);
          }
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          const files = mediaFiles(e.dataTransfer);
          setDragging(false);
          if (!files.length) return;
          e.preventDefault();
          onFiles(files);
        }}
        onPaste={(e) => {
          const files = mediaFiles(e.clipboardData);
          if (files.length) {
            e.preventDefault();
            onFiles(files);
          }
        }}
      >
        <ModelPicker value={model} onChange={onModel} />
        <div className="order-1 flex shrink-0 gap-0.5">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => onMode(m.id)}
              title={m.hint}
              aria-pressed={mode === m.id}
              className={`rounded px-1.5 py-0.5 text-[10.5px] font-medium uppercase tracking-wide transition ${
                mode === m.id ? "bg-brand-2 text-white hover:bg-[var(--nj-brand-press)]" : "text-ink-muted hover:bg-elevated hover:text-ink"
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
          onClick={() => picker.current?.click()}
          title="Attach pictures, videos or audio (or drop / paste them here)"
          className="order-2 shrink-0 rounded-md p-1.5 text-ink-muted transition hover:bg-elevated hover:text-ink sm:order-3"
        >
          <Icon.Image width={15} height={15} />
          <span className="sr-only">Attach pictures, videos or audio</span>
        </button>
        <input
          ref={picker}
          type="file"
          accept={ACCEPT_CHAT_MEDIA}
          multiple
          hidden
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = "";
            if (files.length) onFiles(files);
          }}
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
          disabled={(!value.trim() && !media.length) || preparing > 0}
          title={busy ? "Send — something is already running, this starts another block" : "Send"}
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
      {(media.length > 0 || preparing > 0) && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 px-1">
          {media.map((m) => (
            <span key={m.id} className="group relative block h-14 w-14 overflow-hidden rounded-md border border-line" title={m.trimmed ?? m.name}>
              <img src={m.thumb} alt={m.name} className="h-full w-full object-cover" />
              {m.kind !== "image" && (
                <span className="absolute bottom-0 left-0 right-0 bg-black/65 text-center font-mono text-[8.5px] uppercase text-ink">{m.kind}</span>
              )}
              <button
                type="button"
                onClick={() => onRemoveMedia(m.id)}
                aria-label={`Remove ${m.name}`}
                className="absolute right-0.5 top-0.5 grid h-5 w-5 place-items-center rounded-full bg-black/70 text-ink opacity-80 hover:opacity-100"
              >
                <Icon.Close width={9} height={9} aria-hidden />
              </button>
            </span>
          ))}
          {preparing > 0 && (
            <span className="grid h-14 w-14 place-items-center rounded-md border border-dashed border-line font-mono text-[9px] text-ink-muted">
              reading…
            </span>
          )}
        </div>
      )}
      <p className="mt-1 px-1 text-[10.5px] text-ink-muted">
        {MODES.find((m) => m.id === mode)?.hint}
        {dragging ? " · Drop to attach" : ""}
      </p>
    </div>
  );
}
