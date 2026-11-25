"use client";

// ---------------------------------------------------------------------------
// The message box on the stage — how the owner talks to Jarvis, the 24/7
// Queue's commander. The same parts every Jarvis chat has:
//
//   words     grows with the text; Enter sends, Shift+Enter is a new line;
//             "/" focuses it from anywhere on the page
//   pictures  attach (button), paste or drop — shrunk in the browser
//             (chatMedia.prepareMedia), shown as thumbnails, sent as reference
//             pictures the planner LOOKS at and every filed task keeps
//   model     the router: Auto (the hub's router picks) or one tap on a
//             favourite, or any OpenRouter model from the full list. Cloud
//             models only — the queue plans on the server, so the "my
//             subscription" brains (which need the PC) are not offered
//   mic       "Start talking to Jarvis": talk-to-type into the box
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from "react";
import { Icon } from "../icons";
import { ModelPicker } from "../new-jarvis/ModelPicker";
import { prepareMedia, type ChatMedia } from "@/lib/new-jarvis/chatMedia";
import { modelLabel } from "@/lib/new-jarvis/chatModels";
import { useDictation } from "@/lib/new-jarvis/useDictation";
import { MAX_REFS } from "@/lib/queue247/refs";

/** One tap each. "" = Auto. Everything else is in the full list. */
export const QUICK_MODELS: { id: string; label: string }[] = [
  { id: "", label: "Auto router" },
  { id: "anthropic/claude-opus-5.5", label: "Opus 5.5" },
  { id: "deepseek/deepseek-v4.1-flash", label: "DeepSeek V4.1" },
];

const MODEL_KEY = "q247.model:v1";

export function useQueueModel(): [string, (id: string) => void] {
  const [model, setModel] = useState("");
  useEffect(() => {
    try {
      setModel(localStorage.getItem(MODEL_KEY) ?? "");
    } catch {
      /* private mode: Auto */
    }
  }, []);
  const pick = (id: string) => {
    setModel(id);
    try {
      localStorage.setItem(MODEL_KEY, id);
    } catch {
      /* the pick still holds for this visit */
    }
  };
  return [model, pick];
}

export interface Outgoing {
  text: string;
  media: ChatMedia[];
}

export function JarvisComposer({
  onSend,
  busy,
  disabled,
  model,
  onModel,
  inputRef,
}: {
  onSend: (o: Outgoing) => Promise<boolean>;
  busy: boolean;
  disabled: boolean;
  model: string;
  onModel: (id: string) => void;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const [text, setText] = useState("");
  const [media, setMedia] = useState<ChatMedia[]>([]);
  const [preparing, setPreparing] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const textRef = useRef(text);
  textRef.current = text;
  const mic = useDictation(
    () => textRef.current,
    (t) => setText(t),
  );

  // Grow between two lines and 160 px.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    const id = requestAnimationFrame(() => {
      el.style.height = "0px";
      el.style.height = `${Math.min(160, Math.max(46, el.scrollHeight))}px`;
    });
    return () => cancelAnimationFrame(id);
  }, [text, inputRef]);

  const addFiles = async (files: File[]) => {
    const pics = files.filter((f) => f.type.startsWith("image/"));
    const other = files.length - pics.length;
    const room = MAX_REFS - media.length;
    const take = pics.slice(0, Math.max(0, room));
    const notes: string[] = [];
    if (other) notes.push("Only pictures go in here — use Recreate a video for clips.");
    if (pics.length > take.length) notes.push(`Up to ${MAX_REFS} pictures per message.`);
    setProblem(notes.length ? notes.join(" ") : null);
    if (!take.length) return;
    setPreparing((n) => n + take.length);
    for (const f of take) {
      try {
        const m = await prepareMedia(f);
        setMedia((list) => (list.length < MAX_REFS ? [...list, m] : list));
      } catch (e) {
        setProblem((e as Error).message);
      } finally {
        setPreparing((n) => n - 1);
      }
    }
  };

  const send = async () => {
    const t = text.trim();
    if ((!t && !media.length) || busy || preparing) return;
    mic.stop();
    const ok = await onSend({ text: t, media });
    if (ok) {
      setText("");
      setMedia([]);
      setProblem(null);
    }
  };

  const picked = QUICK_MODELS.some((q) => q.id === model);
  const armed = Boolean(text.trim() || media.length);

  return (
    <div
      className="qs-composer"
      data-drag={dragging ? "true" : undefined}
      data-armed={armed ? "true" : undefined}
      onDragOver={(e) => {
        if (Array.from(e.dataTransfer.items).some((i) => i.kind === "file")) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        setDragging(false);
        const files = Array.from(e.dataTransfer.files);
        if (!files.length) return;
        e.preventDefault();
        void addFiles(files);
      }}
    >
      {(media.length > 0 || preparing > 0) && (
        <ul className="qs-thumbs" aria-label="Reference pictures">
          {media.map((m) => (
            <li key={m.id} className="qs-thumb">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={m.thumb} alt={m.name} />
              <button type="button" onClick={() => setMedia((l) => l.filter((x) => x.id !== m.id))} aria-label={`Remove ${m.name}`}>
                <Icon.Close width={10} height={10} />
              </button>
            </li>
          ))}
          {Array.from({ length: preparing }, (_, i) => (
            <li key={`p${i}`} className="qs-thumb q-skel" aria-label="Preparing a picture" />
          ))}
        </ul>
      )}

      <textarea
        ref={inputRef}
        rows={2}
        value={text}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onPaste={(e) => {
          const files = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith("image/"));
          if (!files.length) return;
          e.preventDefault();
          void addFiles(files);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void send();
          }
        }}
        placeholder={disabled ? "Jarvis can take orders once the queue is connected." : mic.on ? "Listening…" : "Tell Jarvis what you want done…"}
        aria-label="Tell Jarvis what you want done"
      />

      <div className="qs-bar">
        <input
          ref={picker}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            void addFiles(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
        <button
          type="button"
          className="qs-tool"
          onClick={() => picker.current?.click()}
          disabled={disabled || media.length >= MAX_REFS}
          aria-label="Attach reference pictures"
          title="Attach reference pictures (or paste / drop them)"
        >
          <Icon.Image width={15} height={15} />
          <span className="sr-only">Picture</span>
        </button>

        <div className="qs-models" role="radiogroup" aria-label="Which model Jarvis plans with">
          {QUICK_MODELS.map((q) => (
            <button key={q.id || "auto"} type="button" role="radio" aria-checked={model === q.id} className="qs-model" onClick={() => onModel(q.id)}>
              {q.label}
            </button>
          ))}
          <ModelPicker
            value={picked ? "" : model}
            onChange={onModel}
            cloudOnly
            triggerLabel={picked ? "More models" : modelLabel(model)}
            className={`qs-model qs-model-more ${!picked ? "is-on" : ""}`}
          />
        </div>

        <span className="flex-1" />

        <button
          type="button"
          className="qs-tool"
          data-on={mic.on ? "true" : undefined}
          onClick={mic.toggle}
          disabled={disabled || !mic.supported}
          aria-pressed={mic.on}
          title={mic.supported ? (mic.on ? "Tap to stop" : "Say it; the words land in the box") : "This browser can't listen. Chrome, Edge or Safari can."}
        >
          <Icon.Mic width={14} height={14} />
          <span className="max-sm:sr-only">{mic.on ? "Listening… tap to stop" : "Start talking to Jarvis"}</span>
        </button>

        <button type="button" className="qs-send" disabled={disabled || busy || preparing > 0 || !armed} onClick={() => void send()} aria-label="Send to Jarvis">
          {busy ? (
            <span className="q-thinking" aria-hidden>
              <i />
              <i />
              <i />
            </span>
          ) : (
            <Icon.Send width={13} height={13} aria-hidden />
          )}
          <span>{busy ? "Planning" : "Send"}</span>
        </button>
      </div>

      {(problem || mic.error) && (
        <p className="qs-problem" role="status">
          {problem ?? mic.error}
        </p>
      )}
    </div>
  );
}
