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
import { KindIcon } from "./Blocks";
import { MODES, type Mode } from "@/lib/new-jarvis/types";
import type { VoiceState } from "@/lib/new-jarvis/useWakeVoice";
import { ACCEPT_ATTACHMENTS, MAX_ATTACHMENTS, mb, type ChatAttachment } from "@/lib/new-jarvis/attachments";

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
  attachments = [],
  onAttach,
  onRemoveAttachment,
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
  /** Files waiting to go with the next request. */
  attachments?: ChatAttachment[];
  onAttach?: (files: File[]) => void;
  onRemoveAttachment?: (id: string) => void;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const picker = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const loading = attachments.some((a) => a.state === "reading" || a.state === "uploading");
  const ready = attachments.some((a) => a.state === "ready");
  const canSend = !loading && (Boolean(value.trim()) || ready);
  const full = attachments.length >= MAX_ATTACHMENTS;

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
    <div
      className="border-b border-line bg-panel px-3 py-2.5"
      onDragOver={(e) => {
        if (!onAttach || !e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        if (!onAttach) return;
        e.preventDefault();
        setDragging(false);
        const files = Array.from(e.dataTransfer.files);
        if (files.length) onAttach(files);
      }}
    >
      {/* Wraps on a phone: the chips and the two buttons hold the first line
          and the field takes the whole of the second. Kept on one line, the
          field is squeezed to about forty pixels and the placeholder sets one
          word per line. */}
      <div
        className="nj-command flex flex-wrap items-center gap-2 rounded-lg border border-line bg-canvas px-2.5 py-2"
        data-armed={canSend}
        data-hearing={hearing}
        data-dragging={dragging || undefined}
        style={dragging ? { borderColor: "var(--color-brand)" } : undefined}
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
              if (canSend) onSubmit();
            }
          }}
          onPaste={(e) => {
            // A pasted screenshot is an attachment, not a wall of nothing.
            const files = Array.from(e.clipboardData?.files ?? []);
            if (files.length && onAttach) {
              e.preventDefault();
              onAttach(files);
            }
          }}
          placeholder={
            hearing
              ? "Listening…"
              : voiceState === "waiting"
                ? 'Type, or say "Jarvis"…'
                : ready
                ? "What should it do with these?"
                : "Ask, or tell it what to do…"
          }
          aria-label="Command"
          className="order-4 min-w-0 basis-full resize-none overflow-hidden bg-transparent py-0.5 font-mono text-[13px] leading-relaxed text-ink outline-none placeholder:text-ink-muted sm:order-2 sm:basis-0 sm:flex-1"
        />

        {onAttach && (
          <>
            <button
              type="button"
              onClick={() => picker.current?.click()}
              disabled={full}
              title={full ? `Up to ${MAX_ATTACHMENTS} files at a time` : "Attach pictures, video, audio, PDFs or text files"}
              className="order-2 ml-auto shrink-0 rounded-md p-1.5 text-ink-muted transition hover:bg-elevated hover:text-ink disabled:cursor-not-allowed disabled:opacity-40 sm:order-3 sm:ml-0"
            >
              <Icon.Paperclip width={15} height={15} />
              <span className="sr-only">Attach files</span>
            </button>
            <input
              ref={picker}
              type="file"
              multiple
              accept={ACCEPT_ATTACHMENTS}
              className="hidden"
              aria-hidden
              tabIndex={-1}
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                e.target.value = "";
                if (files.length) onAttach(files);
              }}
            />
          </>
        )}

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
          className={`order-2 shrink-0 rounded-md p-1.5 transition sm:order-3 ${onAttach ? "" : "ml-auto sm:ml-0"} ${
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
          disabled={!canSend}
          title={
            loading
              ? "Waiting for the attachments to finish"
              : busy
                ? "Send — something is already running, this starts another block"
                : "Send"
          }
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
      {attachments.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Attachments">
          {attachments.map((a) => (
            <li
              key={a.id}
              title={a.error ?? a.name}
              className={`flex max-w-[15rem] items-center gap-1.5 rounded-md border py-1 pl-1 pr-1 text-[11px] ${
                a.state === "failed" ? "border-[#f87171]/50 text-ink-muted" : "border-line bg-canvas text-ink"
              }`}
            >
              {a.thumb ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={a.thumb} alt="" className="h-7 w-7 shrink-0 rounded object-cover" />
              ) : (
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded bg-elevated text-ink-muted">
                  <KindIcon kind={a.kind} size={13} />
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate">{a.name}</span>
                <span className="block truncate text-[10px] text-ink-muted">
                  {a.state === "reading"
                    ? "Reading…"
                    : a.state === "uploading"
                      ? `Uploading ${mb(a.size)}…`
                      : a.state === "failed"
                        ? a.error ?? "Could not attach"
                        : a.error
                          ? "Frame only"
                          : `${a.kind === "pdf" ? "PDF" : a.kind}${a.durationSec ? ` · ${a.durationSec}s` : ""} · ${mb(a.size)}`}
                </span>
              </span>
              {onRemoveAttachment && (
                <button
                  type="button"
                  onClick={() => onRemoveAttachment(a.id)}
                  className="shrink-0 rounded p-0.5 text-ink-muted transition hover:bg-elevated hover:text-ink"
                >
                  <Icon.Close width={12} height={12} />
                  <span className="sr-only">Remove {a.name}</span>
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-1 px-1 text-[10.5px] text-ink-muted">
        {MODES.find((m) => m.id === mode)?.hint}
      </p>
    </div>
  );
}
