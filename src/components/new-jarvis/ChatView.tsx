"use client";

// ---------------------------------------------------------------------------
// Chat — Jarvis as a chat app.
//
//   side panel   every conversation, newest first, under Today / Yesterday /
//                Previous 7 days / Older. New chat, find, rename, delete.
//   centre       the conversation, oldest at the top: what you said on the
//                right, what Jarvis did and answered on the left, its steps
//                folded under one line you can open.
//   composer     the Studio-style chat bar. In the middle of the page while a
//                conversation is empty; docked at the bottom once it isn't.
//
// Design skill: interactive-web-studio (the HUD skin in new-jarvis-hud.css;
// this file's own rules are in new-jarvis-chat.css).
// ---------------------------------------------------------------------------

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Icon } from "../icons";
import { Markdown } from "../jarvis/Markdown";
import { GateCard, ms, StepRow } from "./Blocks";
import { Reactor } from "./HudField";
import { ModelPicker } from "./ModelPicker";
import "./new-jarvis-chat.css";
import { ACCEPT_CHAT_MEDIA, type ChatMedia } from "@/lib/new-jarvis/chatMedia";
import { modelLabel } from "@/lib/new-jarvis/chatModels";
import { groupThreads, type Thread } from "@/lib/new-jarvis/threads";
import { elapsed, MODES, type Block, type Mode } from "@/lib/new-jarvis/types";
import type { VoiceState } from "@/lib/new-jarvis/useWakeVoice";

export interface ComposerProps {
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
  model: string;
  onModel: (id: string) => void;
  media: ChatMedia[];
  onFiles: (files: File[]) => void;
  onRemoveMedia: (id: string) => void;
  preparing: number;
  /** Opens Goal check: Felix's intake and the prompt enhancer. */
  onEnhance?: () => void;
  /** Set when what's typed is about building or fixing something, e.g. "New app or feature". */
  goalHint?: string | null;
}

export function ChatView({
  threads,
  active,
  blocks,
  composer,
  notice,
  above,
  paired,
  pc,
  onNew,
  onSelect,
  onRename,
  onDelete,
  onAnswerGate,
  onRerun,
  onStop,
}: {
  threads: Thread[];
  /** The open conversation; null = a new one, not started yet. */
  active: string | null;
  /** The open conversation's blocks, oldest first. */
  blocks: Block[];
  composer: ComposerProps;
  /** A one-line problem to show over the composer (a file that could not be read). */
  notice?: string;
  /** Rendered just above the composer — the reflex strip. */
  above?: ReactNode;
  paired: boolean;
  /** "Connect this PC" — the hero card on an empty chat, a slim strip over the composer otherwise. */
  pc?: (variant: "hero" | "strip") => ReactNode;
  onNew: () => void;
  onSelect: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onAnswerGate: (blockId: string, yes: boolean) => void;
  onRerun: (block: Block) => void;
  onStop: (blockId: string) => void;
}) {
  const [side, setSide] = useState(false);
  const [find, setFind] = useState("");
  const picker = useRef<HTMLInputElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  // Start on the side panel open on wide screens, closed on phones.
  useEffect(() => {
    setSide(window.matchMedia("(min-width: 900px)").matches);
  }, []);

  const shown = useMemo(() => {
    const q = find.trim().toLowerCase();
    return q ? threads.filter((t) => t.title.toLowerCase().includes(q)) : threads;
  }, [threads, find]);
  const groups = useMemo(() => groupThreads(shown), [shown]);
  const current = threads.find((t) => t.id === active);
  const empty = blocks.length === 0;

  // Follow the conversation down as it grows, unless the owner has scrolled
  // up to read something — then leave them where they are.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  });
  useEffect(() => {
    stick.current = true;
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [active]);

  const pickKind = (accept: string) => {
    const input = picker.current;
    if (!input) return;
    input.accept = accept;
    input.click();
  };

  const select = (id: string) => {
    onSelect(id);
    if (!window.matchMedia("(min-width: 900px)").matches) setSide(false);
    requestAnimationFrame(() => field.current?.focus());
  };
  const startNew = () => {
    onNew();
    if (!window.matchMedia("(min-width: 900px)").matches) setSide(false);
    requestAnimationFrame(() => field.current?.focus());
  };

  const bar = (
    <Composer
      {...composer}
      fieldRef={field}
      docked={!empty}
      onAttach={() => pickKind(ACCEPT_CHAT_MEDIA)}
      notice={notice}
      above={above}
    />
  );

  return (
    <div className="njc" data-side={side || undefined}>
      <input
        ref={picker}
        type="file"
        multiple
        hidden
        accept={ACCEPT_CHAT_MEDIA}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (files.length) composer.onFiles(files);
        }}
      />

      {/* --- past conversations ------------------------------------------ */}
      <aside className="njc-side" aria-label="Conversations">
        <div className="njc-side__head">
          <button type="button" className="njc-new" onClick={startNew}>
            <Icon.Plus width={15} height={15} />
            New chat
          </button>
          <button type="button" className="njc-icon njc-side__close" onClick={() => setSide(false)} aria-label="Hide conversations">
            <Icon.Sidebar width={16} height={16} />
          </button>
        </div>
        <label className="njc-find">
          <Icon.Search width={13} height={13} />
          <input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Search chats" aria-label="Search chats" />
        </label>
        <nav className="njc-list">
          {groups.length === 0 && (
            <p className="njc-list__none">{find ? "No chat called that." : "Your conversations will show up here."}</p>
          )}
          {groups.map((g) => (
            <section key={g.label}>
              <h3 className="njc-list__label">{g.label}</h3>
              <ul>
                {g.items.map((t) => (
                  <ThreadRow
                    key={t.id}
                    thread={t}
                    on={t.id === active}
                    onOpen={() => select(t.id)}
                    onRename={(title) => onRename(t.id, title)}
                    onDelete={() => onDelete(t.id)}
                  />
                ))}
              </ul>
            </section>
          ))}
        </nav>
      </aside>
      {side && <button type="button" className="njc-scrim" aria-label="Hide conversations" onClick={() => setSide(false)} />}

      {/* --- the conversation --------------------------------------------- */}
      <section className="njc-main">
        <header className="njc-top">
          {!side && (
            <button type="button" className="njc-icon" onClick={() => setSide(true)} aria-label="Show conversations" title="Conversations">
              <Icon.Sidebar width={16} height={16} />
            </button>
          )}
          <span className="njc-top__title">{current ? current.title : "New chat"}</span>
          {!empty && (
            <button type="button" className="njc-icon ml-auto" onClick={startNew} aria-label="New chat" title="New chat">
              <Icon.Edit width={15} height={15} />
            </button>
          )}
        </header>

        {empty ? (
          <div className="njc-hero">
            <div className="njc-hero__core" aria-hidden>
              <Reactor busy={composer.busy} size={72} />
            </div>
            <h2 className="njc-hero__title">What are we doing?</h2>
            <p className="njc-hero__sub">
              Ask anything, hand Jarvis a job, or give it a picture, clip or recording and say what to do with it.
            </p>
            {bar}
            <div className="njc-hero__kinds" role="group" aria-label="Attach">
              <button type="button" className="njc-chip" style={{ "--i": 0 } as React.CSSProperties} onClick={() => pickKind("image/*")}>
                <Icon.Image width={14} height={14} /> Pictures
              </button>
              <button type="button" className="njc-chip" style={{ "--i": 1 } as React.CSSProperties} onClick={() => pickKind("video/*")}>
                <Icon.Film width={14} height={14} /> Video
              </button>
              <button type="button" className="njc-chip" style={{ "--i": 2 } as React.CSSProperties} onClick={() => pickKind("audio/*")}>
                <Icon.Waveform width={14} height={14} /> Audio
              </button>
            </div>
            <ul className="njc-hero__try">
              {SUGGESTIONS.map((s, i) => (
                <li key={s}>
                  <button
                    type="button"
                    className="njc-try"
                    style={{ "--i": i + 3 } as React.CSSProperties}
                    onClick={() => {
                      composer.onChange(s);
                      field.current?.focus();
                    }}
                  >
                    {s}
                  </button>
                </li>
              ))}
            </ul>
            {!paired && pc?.("hero")}
          </div>
        ) : (
          <>
            <div
              ref={scroller}
              className="njc-scroll"
              onScroll={(e) => {
                const el = e.currentTarget;
                stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
              }}
            >
              <div className="njc-stream">
                {blocks.map((b) => (
                  <Turn
                    key={b.id}
                    block={b}
                    onAnswerGate={(yes) => onAnswerGate(b.id, yes)}
                    onRerun={() => onRerun(b)}
                    onStop={() => onStop(b.id)}
                  />
                ))}
              </div>
            </div>
            <div className="njc-dock">
              {!paired && pc?.("strip")}
              {bar}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

const SUGGESTIONS = [
  "What's on my calendar this week?",
  "What did I decide about the hub's AI provider?",
  "Open my Vercel dashboard and tell me if the last deploy failed",
];

// ---------------------------------------------------------------------------

function ThreadRow({
  thread,
  on,
  onOpen,
  onRename,
  onDelete,
}: {
  thread: Thread;
  on: boolean;
  onOpen: () => void;
  onRename: (title: string) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(thread.title);
  const [confirm, setConfirm] = useState(false);

  if (editing) {
    return (
      <li className="njc-row" data-on={on || undefined}>
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            if (draft.trim()) onRename(draft.trim());
            setEditing(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              setDraft(thread.title);
              setEditing(false);
            }
          }}
          className="njc-row__edit"
          aria-label="Chat name"
        />
      </li>
    );
  }
  return (
    <li className="njc-row" data-on={on || undefined}>
      <button type="button" className="njc-row__open" onClick={onOpen} title={thread.title}>
        {thread.title}
      </button>
      {confirm ? (
        <span className="njc-row__confirm">
          <button type="button" onClick={onDelete}>
            Delete
          </button>
          <button type="button" onClick={() => setConfirm(false)}>
            Keep
          </button>
        </span>
      ) : (
        <span className="njc-row__tools">
          <button
            type="button"
            onClick={() => {
              setDraft(thread.title);
              setEditing(true);
            }}
            aria-label={`Rename ${thread.title}`}
            title="Rename"
          >
            <Icon.Edit width={12} height={12} />
          </button>
          <button type="button" onClick={() => setConfirm(true)} aria-label={`Delete ${thread.title}`} title="Delete">
            <Icon.Trash width={12} height={12} />
          </button>
        </span>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------

/** One request: what was said, then what Jarvis did and answered. */
function Turn({
  block,
  onAnswerGate,
  onRerun,
  onStop,
}: {
  block: Block;
  onAnswerGate: (yes: boolean) => void;
  onRerun: () => void;
  onStop: () => void;
}) {
  const live = block.status === "running" || block.status === "waiting";
  const [, tick] = useState(0);
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => tick((n) => n + 1), 250);
    return () => clearInterval(t);
  }, [live]);
  const [openSteps, setOpenSteps] = useState<boolean | null>(null);
  const stepsOpen = openSteps ?? live;
  const lastDone = live ? "" : [...block.steps].reverse().find((s) => s.status === "ok" || s.status === "failed")?.id ?? "";
  const thinking = block.status === "running" && !block.answer;

  return (
    <article className="njc-turn" data-status={block.status}>
      <div className="njc-you">
        {block.media?.length ? (
          <div className="njc-you__media">
            {block.media.map((m, i) => (
              <span key={i} className="njc-thumb" title={m.name}>
                <img src={m.thumb} alt={m.name} />
                {m.kind !== "image" && <em>{m.kind}</em>}
              </span>
            ))}
          </div>
        ) : null}
        <p className="njc-you__text">{block.command}</p>
      </div>

      <div className="njc-jarvis">
        <span className="njc-avatar" aria-hidden>
          <Reactor busy={live} size={26} />
        </span>
        <div className="njc-jarvis__body">
          <div className="njc-meta">
            <span className="njc-meta__name">Jarvis</span>
            {block.model !== undefined && <span>{modelLabel(block.model)}</span>}
            <span className="uppercase">{block.mode}</span>
            <span data-num>{ms(elapsed(block))}</span>
            {live ? (
              <button type="button" onClick={onStop} className="njc-meta__act">
                Stop
              </button>
            ) : (
              <button type="button" onClick={onRerun} className="njc-meta__act" title="Ask again">
                <Icon.Refresh width={11} height={11} /> Again
              </button>
            )}
          </div>

          {block.steps.length > 0 && (
            <div className="njc-steps">
              <button type="button" className="njc-steps__toggle" onClick={() => setOpenSteps(!stepsOpen)} aria-expanded={stepsOpen}>
                <Icon.Chevron width={10} height={10} className={stepsOpen ? "rotate-90" : ""} />
                {live ? "Working" : "Worked"} through {block.steps.length} step{block.steps.length === 1 ? "" : "s"}
              </button>
              {stepsOpen && (
                <ol className="nj-ledger space-y-1.5 pt-1.5">
                  {block.steps.map((s) => (
                    <StepRow key={s.id} step={s} autoOpen={s.id === lastDone} />
                  ))}
                </ol>
              )}
            </div>
          )}

          {block.gate && (
            <div className="njc-gate">
              <GateCard gate={block.gate} onAnswer={onAnswerGate} />
            </div>
          )}

          {block.answer && (
            <div className="njc-answer">
              <Markdown text={block.answer} />
            </div>
          )}
          {block.error && <p className="njc-error">{block.error}</p>}
          {thinking && !block.gate && (
            <p className="njc-thinking">
              <i />
              <i />
              <i />
              <span>{block.steps.length ? "Working out the next step" : "Thinking"}</span>
            </p>
          )}
        </div>
      </div>
    </article>
  );
}

// ---------------------------------------------------------------------------

/** The chat bar — the Studio composer's shape: a card with the field on top and the controls under it. */
function Composer({
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
  onRemoveMedia,
  onFiles,
  preparing,
  onEnhance,
  goalHint,
  fieldRef,
  docked,
  onAttach,
  notice,
  above,
}: ComposerProps & {
  fieldRef: React.RefObject<HTMLTextAreaElement | null>;
  docked: boolean;
  onAttach: () => void;
  notice?: string;
  above?: ReactNode;
}) {
  const hearing = voiceState === "hearing";
  const shownText = hearing && heard ? heard : value;
  const canSend = Boolean(value.trim() || media.length) && preparing === 0;

  // Grows with the text up to a ceiling, measured after layout settles.
  useEffect(() => {
    const el = fieldRef.current;
    if (!el) return;
    const fit = () => {
      el.style.height = "auto";
      el.style.height = `${Math.max(docked ? 26 : 56, Math.min(el.scrollHeight, 220))}px`;
    };
    const f = requestAnimationFrame(fit);
    window.addEventListener("resize", fit);
    return () => {
      cancelAnimationFrame(f);
      window.removeEventListener("resize", fit);
    };
  }, [value, docked, fieldRef]);

  // "/" focuses the bar from anywhere; Escape lets go.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = t?.tagName === "INPUT" || t?.tagName === "TEXTAREA" || t?.isContentEditable;
      if (e.key === "/" && !typing) {
        e.preventDefault();
        fieldRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fieldRef]);

  return (
    <div className="njc-composer-wrap" data-docked={docked || undefined}>
      {above}
      {notice && <p className="njc-notice">{notice}</p>}
      <div
        className="njc-composer nj-command"
        data-armed={canSend}
        data-hearing={hearing}
        data-busy={busy || undefined}
        onPaste={(e) => {
          const files = Array.from(e.clipboardData.files).filter((f) => /^(image|video|audio)\//.test(f.type));
          if (files.length) {
            e.preventDefault();
            onFiles(files);
          }
        }}
      >
        {(media.length > 0 || preparing > 0) && (
          <div className="njc-composer__media">
            {media.map((m) => (
              <span key={m.id} className="njc-thumb" title={m.trimmed ?? m.name}>
                <img src={m.thumb} alt={m.name} />
                {m.kind !== "image" && <em>{m.kind}</em>}
                <button type="button" onClick={() => onRemoveMedia(m.id)} aria-label={`Remove ${m.name}`}>
                  <Icon.Close width={9} height={9} />
                </button>
              </span>
            ))}
            {preparing > 0 && <span className="njc-thumb njc-thumb--reading">reading…</span>}
          </div>
        )}

        <textarea
          ref={fieldRef}
          rows={docked ? 1 : 2}
          value={shownText}
          readOnly={hearing}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (canSend) onSubmit();
            }
            if (e.key === "Escape") e.currentTarget.blur();
          }}
          placeholder={
            hearing ? "Listening…" : voiceState === "waiting" ? 'Message Jarvis, or say "Jarvis"…' : "Message Jarvis…"
          }
          aria-label="Message Jarvis"
          className="njc-composer__field"
        />

        <div className="njc-composer__row">
          <button type="button" className="njc-attach" onClick={onAttach} title="Pictures, clips or recordings (or drop / paste them)">
            <Icon.Plus width={14} height={14} />
            <span className="hidden sm:inline">Image, clip or audio</span>
          </button>
          <span className="njc-sep" aria-hidden />
          {/* Wrapped so the picker's own flex order stays inside it. */}
          <span className="njc-model">
            <ModelPicker value={model} onChange={onModel} up={docked} />
          </span>
          <div className="njc-modes" role="group" aria-label="How Jarvis should work">
            {MODES.map((m) => (
              <button key={m.id} type="button" onClick={() => onMode(m.id)} title={m.hint} aria-pressed={mode === m.id}>
                {m.label}
              </button>
            ))}
          </div>
          {onEnhance && (
            <button
              type="button"
              onClick={onEnhance}
              disabled={!value.trim()}
              className="njc-icon ml-auto"
              data-on={goalHint ? true : undefined}
              title="Enhance — set the end goal and turn this into a pro-level prompt"
              aria-label="Enhance this prompt"
            >
              <Icon.Sparkles width={15} height={15} />
            </button>
          )}
          <button
            type="button"
            onClick={onMic}
            disabled={!micSupported}
            className={`njc-icon ${onEnhance ? "" : "ml-auto"}`}
            data-on={voiceState !== "off" || undefined}
            title={!micSupported ? "This browser cannot listen. Chrome, Edge or Safari can." : voiceState === "off" ? 'Listen for "Jarvis"' : "Stop listening"}
            aria-label={voiceState === "off" ? "Start listening" : "Stop listening"}
          >
            <Icon.Mic width={15} height={15} />
          </button>
          <button type="button" className="njc-send" onClick={onSubmit} disabled={!canSend} aria-label="Send">
            {busy ? <Icon.Refresh width={13} height={13} className="animate-spin [animation-duration:1.4s]" /> : <Icon.Send width={13} height={13} />}
            <span>Send</span>
          </button>
        </div>
      </div>
      <p className="njc-hint">
        {goalHint && onEnhance && (
          <button type="button" onClick={onEnhance} className="mr-2 text-brand underline-offset-2 hover:underline">
            ✦ {goalHint}? Set the end goal first ·
          </button>
        )}
        {MODES.find((m) => m.id === mode)?.hint} · Enter to send, Shift+Enter for a new line
      </p>
    </div>
  );
}
