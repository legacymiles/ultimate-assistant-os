"use client";

// ---------------------------------------------------------------------------
// One attached reference, as a tile.
//
// Studio and Chat both collect references and they must look like the same
// thing in both places, because they ARE the same thing: a reference added in
// Studio is carried into the chat box by "Start in chat" and keeps its identity.
// So the tile lives here and both trays draw it.
//
// What the tile has to say, at 64px: which file, what kind it is, and — once
// the conversation has numbered it — what to call it in the prompt. Studio
// cannot know that number yet (it depends on what the conversation already
// holds), so `badge` is optional and the tile is simply not nameable there.
// ---------------------------------------------------------------------------

import { Icon } from "../icons";
import type { Attachment } from "@/lib/jarvis/chatImages";

export function ReferenceTile({
  attachment: a,
  badge,
  title,
  lit = false,
  onName,
  onHover,
  onRemove,
}: {
  attachment: Attachment;
  /** "2" for Subject 2, "A1" for Audio 1. Absent until something numbers it. */
  badge?: string;
  title: string;
  /** The prompt names this one right now. */
  lit?: boolean;
  /** Clicking types its token into the prompt. Absent where there is no token. */
  onName?: () => void;
  onHover?: (on: boolean) => void;
  onRemove: () => void;
}) {
  const frame = `block overflow-hidden rounded-lg border transition ${
    lit ? "border-accent ring-1 ring-accent" : "border-line"
  }`;
  /* eslint-disable-next-line @next/next/no-img-element */
  const picture = <img src={a.thumb} alt={a.name} className="h-16 w-16 object-cover" />;
  return (
    <li className="relative">
      {onName ? (
        <button
          type="button"
          onClick={onName}
          onMouseEnter={() => onHover?.(true)}
          onMouseLeave={() => onHover?.(false)}
          title={title}
          className={`${frame} hover:border-ink-faint`}
        >
          {picture}
        </button>
      ) : (
        <span className={frame} title={title}>
          {picture}
        </span>
      )}
      {badge && (
        <span
          className={`pointer-events-none absolute bottom-1 left-1 rounded px-1 py-px font-mono text-[9px] font-semibold transition ${
            lit ? "bg-accent text-canvas" : "bg-black/65 text-white"
          }`}
        >
          {badge}
        </span>
      )}
      {/* A picture needs no label; a clip and a track do, because what is drawn
          for them — a frame, a waveform — is not the thing itself. */}
      {(a.kind === "video" || a.kind === "audio") && (
        <span className="pointer-events-none absolute right-1 top-1 flex items-center gap-0.5 rounded bg-black/65 px-1 py-px text-[9px] text-white">
          {a.kind === "audio" && <Icon.Waveform width={8} height={8} />}
          {a.durationSec ? `${Math.round(a.durationSec)}s` : a.kind === "audio" ? "track" : "clip"}
        </span>
      )}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${a.name}`}
        className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full border border-line bg-panel text-ink-muted shadow-sm transition hover:text-ink"
      >
        <Icon.Close width={10} height={10} />
      </button>
    </li>
  );
}
