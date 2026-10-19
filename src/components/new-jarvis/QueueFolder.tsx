"use client";

// ---------------------------------------------------------------------------
// One In Queue folder: the chat half of a row.
//
// Clicking a row opens this. It reads like a chat — a box at the top to type
// into, every request below it newest first — because the owner types into it
// the way they would message someone: "make the boy wave", "add a dog", one
// after another, or a list of them at once ("- a\n- b" files two).
//
// Nothing here is ticked and left behind. A request completed — here, or by a
// Claude Code session through the connector — leaves the folder; the board
// re-reads by itself, so a request finished on the PC disappears from the
// phone without anyone pressing anything.
// ---------------------------------------------------------------------------

import { useRef, useState } from "react";
import { Icon } from "../icons";
import { MAX_IMAGES, inFolder, type FinishedRequest, type QueueRequest } from "@/lib/new-jarvis/requests";
import { shrinkImage, type UseRequests } from "@/lib/new-jarvis/useRequests";

export function RequestComposer({
  requests,
  folder,
  placeholder,
  autoFocus,
}: {
  requests: UseRequests;
  folder: string;
  placeholder: string;
  autoFocus?: boolean;
}) {
  const [text, setText] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const send = async () => {
    if (busy || (!text.trim() && images.length === 0)) return;
    setBusy(true);
    setSaid(null);
    const added = await requests.add(folder, text, images);
    setBusy(false);
    if (added.length) {
      setText("");
      setImages([]);
      setSaid(added.length > 1 ? `Queued ${added.length} requests.` : "Queued.");
    } else if (!requests.error) {
      setSaid("Already in this folder.");
    }
  };

  const attach = async (files: FileList | null) => {
    if (!files?.length) return;
    const room = MAX_IMAGES - images.length;
    const picked = [...files].filter((f) => f.type.startsWith("image/")).slice(0, room);
    try {
      const shrunk = await Promise.all(picked.map((f) => shrinkImage(f)));
      setImages((cur) => [...cur, ...shrunk].slice(0, MAX_IMAGES));
    } catch (e) {
      setSaid(e instanceof Error ? e.message : "Couldn't add that picture.");
    }
  };

  return (
    <div className="nj-rq-compose">
      {images.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-2 pt-2">
          {images.map((src, i) => (
            <span key={i} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element -- a local data URL thumbnail */}
              <img src={src} alt={`Attached picture ${i + 1}`} className="h-12 w-12 rounded border border-line object-cover" />
              <button
                type="button"
                onClick={() => setImages((cur) => cur.filter((_, j) => j !== i))}
                className="absolute -right-1.5 -top-1.5 rounded-full border border-line bg-panel p-0.5 text-ink-muted hover:text-ink"
                title="Remove this picture"
              >
                <Icon.Close width={9} height={9} />
                <span className="sr-only">Remove picture {i + 1}</span>
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex items-end gap-1.5 p-1.5">
        <button
          type="button"
          onClick={() => file.current?.click()}
          disabled={images.length >= MAX_IMAGES}
          title={images.length >= MAX_IMAGES ? `Up to ${MAX_IMAGES} pictures` : "Attach a picture (a character, a screenshot…)"}
          className="shrink-0 rounded p-1.5 text-ink-muted transition hover:bg-elevated hover:text-ink disabled:opacity-40"
        >
          <Icon.Image width={14} height={14} />
          <span className="sr-only">Attach a picture</span>
        </button>
        <input
          ref={file}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            void attach(e.target.files);
            e.target.value = "";
          }}
        />
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          onPaste={(e) => {
            const pics = [...e.clipboardData.files].filter((f) => f.type.startsWith("image/"));
            if (pics.length) {
              e.preventDefault();
              const list = new DataTransfer();
              pics.forEach((p) => list.items.add(p));
              void attach(list.files);
            }
          }}
          rows={1}
          autoFocus={autoFocus}
          placeholder={placeholder}
          aria-label={placeholder}
          className="max-h-40 min-h-[30px] flex-1 resize-y rounded-md border border-line bg-canvas px-2 py-1.5 text-[12px] leading-snug text-ink outline-none transition placeholder:text-ink-faint focus:border-brand-2"
        />
        <button
          type="button"
          onClick={() => void send()}
          disabled={busy || (!text.trim() && images.length === 0)}
          className="inline-flex shrink-0 items-center gap-1 rounded-md bg-brand-2/90 px-2.5 py-1.5 text-[11px] font-medium text-white transition hover:bg-brand-2 disabled:opacity-40"
        >
          <Icon.Send width={11} height={11} aria-hidden /> {busy ? "Queuing…" : "Queue"}
        </button>
      </div>
      <p className="px-2.5 pb-1.5 text-[10px] text-ink-faint">
        {said ?? requests.error ?? "Enter to queue · Shift+Enter for a new line · a list of “- items” queues one per line"}
      </p>
    </div>
  );
}

export function RequestList({ requests, folder }: { requests: UseRequests; folder: string }) {
  const list = inFolder(requests.doc, folder);
  if (!list.length) {
    return <p className="px-1 py-2 text-[11px] text-ink-faint">Nothing queued here yet. Type an idea above.</p>;
  }
  return (
    <ul className="space-y-1.5">
      {list.map((r) => (
        <RequestBubble key={r.id} r={r} requests={requests} />
      ))}
    </ul>
  );
}

function when(iso: string): string {
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function RequestBubble({ r, requests }: { r: QueueRequest; requests: UseRequests }) {
  const working = r.status === "working";
  return (
    <li className={`nj-rq ${working ? "is-working" : ""}`}>
      <div className="flex items-start gap-2">
        <button
          type="button"
          onClick={() => void requests.complete(r.id)}
          title="Done — take it off the queue"
          className="nj-rq-tick"
        >
          <Icon.Check width={9} height={9} aria-hidden />
          <span className="sr-only">Mark done: {r.text}</span>
        </button>
        <div className="min-w-0 flex-1">
          <p className="whitespace-pre-wrap break-words text-[12px] leading-snug text-ink">{r.text}</p>
          {r.images.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {r.images.map((src, i) => (
                <a key={i} href={src} target="_blank" rel="noreferrer" title="Open full size">
                  {/* eslint-disable-next-line @next/next/no-img-element -- a stored data URL */}
                  <img src={src} alt={`Picture ${i + 1} on this request`} className="h-14 w-14 rounded border border-line object-cover" />
                </a>
              ))}
            </div>
          )}
          {r.notes.length > 0 && (
            <ul className="mt-1 space-y-0.5">
              {r.notes.map((n, i) => (
                <li key={i} className="text-[10.5px] text-ink-muted">
                  <span className="text-ink-faint">{n.by}:</span> {n.text}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-1 flex flex-wrap items-center gap-x-2 font-mono text-[9.5px] text-ink-faint">
            <span>{when(r.createdAt)}</span>
            {r.from !== "you" && <span>from {r.from}</span>}
            {working && (
              <span className="inline-flex items-center gap-1 text-[var(--nj-wip)]">
                <span className="nj-rq-live" aria-hidden /> {r.startedBy ?? "an agent"} is working on it
              </span>
            )}
            <span className="select-all">{r.id}</span>
          </p>
        </div>
        <div className="flex shrink-0 items-center">
          {working && (
            <button
              type="button"
              onClick={() => void requests.release(r.id)}
              title="Put it back to waiting"
              className="rounded p-1 text-ink-faint transition hover:bg-elevated hover:text-ink"
            >
              <Icon.Rewind width={11} height={11} />
              <span className="sr-only">Put back to waiting</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => void requests.remove(r.id)}
            title="Delete without doing it"
            className="rounded p-1 text-ink-faint transition hover:bg-elevated hover:text-[#f08a7a]"
          >
            <Icon.Trash width={11} height={11} />
            <span className="sr-only">Delete request</span>
          </button>
        </div>
      </div>
    </li>
  );
}

/** What left the queue lately — the answer to "did that get done?". */
export function FinishedLog({
  requests,
  folderName,
}: {
  requests: UseRequests;
  folderName: (folder: string) => string;
}) {
  const list: FinishedRequest[] = requests.doc.finished;
  if (!list.length) return <p className="px-3 py-3 text-[11px] text-ink-faint">Nothing finished in the last two weeks.</p>;
  return (
    <ul className="divide-y divide-line-soft">
      {list.map((f) => (
        <li key={f.id} className="flex items-start gap-2 px-3 py-1.5">
          <span className="nj-pip nj-pip-done mt-1.5" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[11.5px] text-ink" title={f.text}>
              {f.text}
            </p>
            <p className="text-[10.5px] text-ink-muted">
              {folderName(f.folder)} · done by {f.by} · {when(f.doneAt)}
              {f.result ? ` — ${f.result}` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void requests.reopen(f.id)}
            title="It wasn't finished — put it back"
            className="shrink-0 rounded border border-line px-1.5 py-0.5 text-[10px] text-ink-muted transition hover:bg-elevated hover:text-ink"
          >
            Reopen
          </button>
        </li>
      ))}
    </ul>
  );
}
