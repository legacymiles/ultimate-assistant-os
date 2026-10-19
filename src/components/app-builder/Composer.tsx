"use client";

// The chat bar: type a request, and attach screen recordings and pictures —
// by the paperclip, by dropping them on it, or by pasting. Videos are read
// right here (frames + narration) before anything is sent.

import { useRef, useState } from "react";
import { ACCEPT, MAX_ITEMS, prepare, type PreparedMedia } from "@/lib/app-builder/media";

interface Props {
  busy: boolean;
  onSend: (text: string, media: PreparedMedia[]) => void;
  placeholder: string;
  /** The big first-screen version. */
  hero?: boolean;
  sendLabel?: string;
  autoFocus?: boolean;
  onTyping?: (length: number) => void;
  /** Lets the parent drop text in (example chips). */
  textRef?: React.MutableRefObject<((t: string) => void) | null>;
}

export function Composer({ busy, onSend, placeholder, hero, sendLabel, autoFocus, onTyping, textRef }: Props) {
  const [text, setText] = useState("");
  const [media, setMedia] = useState<PreparedMedia[]>([]);
  const [reading, setReading] = useState(0);
  const [problem, setProblem] = useState("");
  const [over, setOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  if (textRef) {
    textRef.current = (t: string) => {
      setText(t);
      onTyping?.(t.length);
    };
  }

  const add = (files: File[]) => {
    const usable = files.filter((f) => f.type.startsWith("video/") || f.type.startsWith("image/"));
    if (usable.length < files.length) setProblem("Only videos and pictures can be attached.");
    const room = MAX_ITEMS - media.length - reading;
    if (usable.length > room) setProblem(`Up to ${MAX_ITEMS} attachments at once — the rest were left out.`);
    for (const f of usable.slice(0, Math.max(0, room))) {
      setReading((n) => n + 1);
      void prepare(f)
        .then((m) => setMedia((list) => [...list, m]))
        .catch((e: unknown) => setProblem(e instanceof Error ? e.message : `Couldn't read ${f.name}.`))
        .finally(() => setReading((n) => n - 1));
    }
  };

  const canSend = !busy && reading === 0 && (text.trim().length >= (media.length ? 0 : 3) || media.length > 0);
  const send = () => {
    if (!canSend) return;
    onSend(text.trim(), media);
    setText("");
    setMedia([]);
    setProblem("");
    onTyping?.(0);
  };

  return (
    <form
      className={`ab-composer${hero ? " is-hero" : ""}${over ? " is-over" : ""}`}
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
      onDragOver={(e) => {
        if ([...e.dataTransfer.types].includes("Files")) {
          e.preventDefault();
          setOver(true);
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        add([...e.dataTransfer.files]);
      }}
    >
      {(media.length > 0 || reading > 0) && (
        <ul className="ab-attach" aria-label="Attachments">
          {media.map((m) => (
            <li key={m.id} className={`ab-att ab-att-${m.kind}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={m.thumb} alt="" />
              <span className="ab-att-meta">
                {m.kind === "video" ? `▶ ${m.duration ? `${Math.round(m.duration)}s` : "clip"} · ${m.frames.length} frames${m.sound ? " · sound" : ""}` : "picture"}
              </span>
              <button type="button" aria-label={`Remove ${m.name}`} onClick={() => setMedia((l) => l.filter((x) => x.id !== m.id))}>
                ✕
              </button>
            </li>
          ))}
          {Array.from({ length: reading }, (_, i) => (
            <li key={`r${i}`} className="ab-att is-reading" aria-label="Reading a video">
              <span className="ab-pulse" aria-hidden />
              <span className="ab-att-meta">watching…</span>
            </li>
          ))}
        </ul>
      )}
      <div className="ab-composer-row">
        <button
          type="button"
          className="ab-clip"
          aria-label="Attach videos or pictures"
          title="Attach a screen recording or pictures of an app or workflow"
          onClick={() => fileInput.current?.click()}
        >
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
            <path
              d="M21 11.5l-8.6 8.6a5.5 5.5 0 01-7.8-7.8l8.6-8.6a3.7 3.7 0 015.2 5.2l-8.6 8.6a1.8 1.8 0 01-2.6-2.6l7.9-7.9"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <input
          ref={fileInput}
          type="file"
          accept={ACCEPT}
          multiple
          hidden
          onChange={(e) => {
            add([...(e.target.files ?? [])]);
            e.target.value = "";
          }}
        />
        <textarea
          aria-label={placeholder}
          placeholder={placeholder}
          value={text}
          rows={hero ? 3 : 2}
          maxLength={6000}
          autoFocus={autoFocus}
          onChange={(e) => {
            setText(e.target.value);
            onTyping?.(e.target.value.length);
          }}
          onPaste={(e) => {
            const files = [...e.clipboardData.files];
            if (files.length) {
              e.preventDefault();
              add(files);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (hero ? e.metaKey || e.ctrlKey : !e.shiftKey)) {
              e.preventDefault();
              send();
            }
          }}
        />
        {hero ? (
          <button className="ab-primary" disabled={!canSend}>
            {busy ? (media.length ? "Watching…" : "Waking the agent…") : sendLabel ?? "Start building"}
            <span aria-hidden>→</span>
          </button>
        ) : (
          <button className="ab-send" disabled={!canSend} aria-label="Send">
            ↑
          </button>
        )}
      </div>
      {problem && (
        <p className="ab-composer-note" role="status">
          {problem}
        </p>
      )}
      {over && <div className="ab-drop">Drop recordings or pictures — the agent will take them apart</div>}
    </form>
  );
}
