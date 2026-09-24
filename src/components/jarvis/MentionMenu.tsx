"use client";

// ---------------------------------------------------------------------------
// The @ menu, wherever a prompt is written.
//
// Three kinds of thing answer to @, and they are ordered by how specific they
// are to THIS conversation:
//
//   people      — somebody the Photos library already knows, by name
//   references  — the pictures, clips and tracks uploaded in this conversation
//   workflows   — the Studio catalog, which is the same everywhere
//
// The middle group is the one that used to be missing outside the chat box.
// Uploading a photo and then typing "@" is the moment the owner is pointing at
// that photo; a menu that answers with a list of workflows instead is asking
// them to remember which Subject number it got. So the uploads sit above the
// catalog, with their own thumbnails, and the catalog yields four rows to make
// room whenever a person or an upload matched.
//
// It lives here rather than in any one chat because there are three composers
// for the same conversation — Chat, the Studio idea box, and Seedance's
// director — and a token typed in one is read by all of them. A menu that
// differed between them would be three vocabularies wearing one sigil.
// ---------------------------------------------------------------------------

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "../icons";
import { searchCharacters } from "@/lib/studio/characters";
import { searchReferences, type ReferenceMention } from "@/lib/studio/references";
import { searchMentions, type Mention } from "@/lib/studio/workflows";
import type { Character } from "@/lib/studio/useCharacters";

export type AtRow =
  | { key: string; group: "cast"; character: Character }
  | { key: string; group: "ref"; reference: ReferenceMention }
  | { key: string; group: "wf"; mention: Mention };

/** The reference token a row names, for the tile that should light up with it. */
export function rowToken(row: AtRow): string | null {
  return row.group === "ref" ? row.reference.token.toLowerCase() : null;
}

/**
 * What a half-typed "@sub" could mean, in one list.
 *
 * They used to be mutually exclusive lists — uploads if any matched, else
 * workflows — which was a coin toss the owner could not see. Concatenated and
 * given one highlight, the arrow keys reach every row and nothing is hidden by
 * a rule nobody wrote down.
 */
export function atRowsFor(query: string, characters: Character[], references: ReferenceMention[]): AtRow[] {
  const rows: AtRow[] = [
    ...searchCharacters(query, characters, 6).map((character) => ({
      key: `cast:${character.token}`,
      group: "cast" as const,
      character,
    })),
    // Keyed by token, not by number: Subject 1 and Audio 1 both count from one.
    ...searchReferences(query, references)
      .slice(0, 8)
      .map((reference) => ({ key: `ref:${reference.token}`, group: "ref" as const, reference })),
  ];
  // The catalog is long; it yields space to a match the owner's own library or
  // this conversation produced, and takes the menu to itself when there is none.
  const workflows = searchMentions(query, 8).slice(0, rows.length ? 4 : 8);
  return [...rows, ...workflows.map((m) => ({ key: `wf:${m.token}`, group: "wf" as const, mention: m }))];
}

/** Section headings, in the order the rows appear. */
const GROUP_LABEL: Record<AtRow["group"], string> = {
  cast: "People and characters from Photos",
  ref: "References in this conversation",
  wf: "Studio workflows",
};

export function MentionMenu({
  rows,
  index,
  onIndex,
  onChoose,
  onHighlight,
  placement = "above",
}: {
  rows: AtRow[];
  index: number;
  onIndex: (i: number) => void;
  onChoose: (row: AtRow) => void;
  /** The reference token under the cursor, so its tile in the tray lights up. */
  onHighlight?: (token: string | null) => void;
  /**
   * Which way the menu opens.
   *
   * A chat box sits at the bottom of its pane, so the menu goes up. The Studio
   * idea box sits at the TOP of its tab, above the wall of cards — opening
   * upward there puts the first rows off the top of the window, which is where
   * the uploads are. The composer says which way it has room.
   */
  placement?: "above" | "below";
}) {
  const [side, height] = useFit(placement, rows.length);
  if (!rows.length) return null;
  return (
    <ul
      ref={side.ref}
      role="listbox"
      aria-label="People, references and workflows"
      style={{ maxHeight: height }}
      className={`absolute inset-x-0 z-30 overflow-y-auto rounded-xl border border-line bg-elevated p-1 shadow-[0_12px_32px_-8px_rgb(0_0_0/0.6)] ${
        side.open === "below" ? "top-full mt-2" : "bottom-full mb-2"
      }`}
    >
      {rows.map((row, i) => {
        const head = i === 0 || rows[i - 1].group !== row.group ? GROUP_LABEL[row.group] : null;
        const on = i === index;
        return (
          <li key={row.key}>
            {head && (
              <p className="px-2 pb-1 pt-1.5 text-[10px] text-ink-faint">
                {head}
                {i === 0 ? " · ↑↓ to move · Enter to add" : ""}
              </p>
            )}
            <span role="option" aria-selected={on}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onChoose(row);
                }}
                onMouseEnter={() => {
                  onIndex(i);
                  onHighlight?.(rowToken(row));
                }}
                onMouseLeave={() => onHighlight?.(null)}
                className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left ${
                  row.group === "wf" ? "st-card " : ""
                }${on ? "bg-panel-2" : ""}`}
                style={row.group === "wf" ? { ["--h" as string]: row.mention.workflow.hue } : undefined}
              >
                {row.group === "cast" ? (
                  <CastRow character={row.character} />
                ) : row.group === "ref" ? (
                  <RefRow reference={row.reference} />
                ) : (
                  <WorkflowRow mention={row.mention} />
                )}
              </button>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** As tall as the menu ever gets, however much room there is. */
const TALLEST = 320;
/** Below this the list is more frustrating than useful, so it flips instead. */
const USABLE = 160;

/**
 * The window, narrowed by every ancestor that would cut the menu off.
 *
 * Measuring against the window alone is how a menu ends up half-hidden: these
 * panes scroll inside a fixed shell, so a list that "fits the screen" can still
 * be sliced by the pane it hangs in — and the slice takes the top rows, which
 * are the uploads.
 */
function clipOf(from: HTMLElement): { top: number; bottom: number } {
  let top = 0;
  let bottom = window.innerHeight;
  for (let el = from.parentElement; el && el !== document.body; el = el.parentElement) {
    const overflow = getComputedStyle(el).overflowY;
    if (overflow === "visible" || overflow === "clip") continue;
    const box = el.getBoundingClientRect();
    top = Math.max(top, box.top);
    bottom = Math.min(bottom, box.bottom);
  }
  return { top, bottom };
}

/**
 * Open the menu where it fits, and no taller than the room it has.
 *
 * `placement` is the composer's preference — a chat box at the bottom of its
 * pane wants the list above it, the Studio idea box at the top of its tab wants
 * it below. But the list grows with what is in it, and a preference that runs
 * off the top of the window hides exactly the rows that come first, which are
 * the uploads. So the preference is honoured while it has room and abandoned
 * when it does not, and either way the height is cut to what is actually there.
 */
function useFit(placement: "above" | "below", count: number) {
  const ref = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(placement);
  const [height, setHeight] = useState(TALLEST);

  const fit = () => {
    // The composer block the menu is pinned to. `parentElement` rather than
    // `offsetParent`, because a composer inside a fixed pane has no offset
    // parent at all and the measurement would silently never happen.
    const anchor = ref.current?.parentElement;
    if (!anchor) return;
    const box = anchor.getBoundingClientRect();
    const room = clipOf(anchor);
    const above = box.top - room.top - 12;
    const below = room.bottom - box.bottom - 12;
    const prefer = placement === "above" ? above : below;
    const other = placement === "above" ? below : above;
    const flip = prefer < USABLE && other > prefer;
    setOpen(flip ? (placement === "above" ? "below" : "above") : placement);
    setHeight(Math.max(USABLE, Math.min(TALLEST, flip ? other : prefer)));
  };

  // Before paint, so the list never shows in the wrong place for a frame.
  useLayoutEffect(fit, [placement, count]);
  useEffect(() => {
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  });

  return [{ ref, open }, height] as const;
}

/**
 * One person in the @ menu.
 *
 * The second line is the whole reason this row is useful: it says how many
 * pictures of them the library holds and whether a description has been written
 * yet. Without it "@Brandy" is a name the owner has to trust; with it they can
 * see that she is described from five photos, and see when she is not, which is
 * the moment to go and press Describe rather than the moment to wonder why the
 * clip looks like someone else.
 */
function CastRow({ character }: { character: Character }) {
  const described = Boolean(character.appearance);
  return (
    <>
      {character.avatar ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img src={character.avatar} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover" />
      ) : (
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-panel-2 text-[11px] font-semibold text-ink-muted">
          {character.name.slice(0, 1).toUpperCase()}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs text-ink">{character.name}</span>
        <span className="block truncate text-[11px] text-ink-faint">
          {[
            character.role,
            `${character.pictures} photo${character.pictures === 1 ? "" : "s"}`,
            described ? "described" : "not described yet",
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </span>
      <span
        className={`flex shrink-0 items-center gap-1 text-[10px] ${
          described ? "text-emerald-300/80" : "text-amber-300/80"
        }`}
      >
        {described ? <Icon.Check width={11} height={11} /> : <Icon.Bulb width={11} height={11} />}
        {described ? "sheet" : "no sheet"}
      </span>
    </>
  );
}

/**
 * One reference in the @ menu.
 *
 * The thumbnail is the point — it turns "@Subject 2" from a number the owner
 * has to keep in their head into the picture they are looking at. The second
 * line says which file, how long a clip runs, or what the browser actually
 * measured off a track, so a row never leaves them guessing which of two songs
 * they are about to score a three-hour render with.
 */
function RefRow({ reference }: { reference: ReferenceMention }) {
  const detail =
    [reference.name, reference.durationSec ? `${Math.round(reference.durationSec)}s` : "", measured(reference.note)]
      .filter(Boolean)
      .join(" · ") || "attached to this conversation";
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={reference.thumb} alt="" className="h-8 w-10 shrink-0 rounded object-cover" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs text-ink">{reference.label}</span>
        <span className="block truncate text-[11px] text-ink-faint">{detail}</span>
      </span>
      <span className="flex shrink-0 items-center gap-1 text-[10px] capitalize text-ink-faint">
        {reference.kind === "audio" ? (
          <Icon.Waveform width={11} height={11} />
        ) : reference.kind === "video" ? (
          <Icon.Film width={11} height={11} />
        ) : (
          <Icon.Image width={11} height={11} />
        )}
        {reference.kind === "audio" ? "track" : reference.kind}
      </span>
    </>
  );
}

/** One workflow in the @ menu, under its own card art. */
function WorkflowRow({ mention }: { mention: Mention }) {
  return (
    <>
      <span className="relative h-7 w-6 shrink-0 overflow-hidden rounded">
        <span className="st-art" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs text-ink">{mention.label}</span>
        <span className="block truncate text-[11px] text-ink-faint">
          {mention.variant ? mention.variant.brief : mention.workflow.blurb}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-1 text-[10px] capitalize text-ink-faint">
        {mention.workflow.medium === "video" ? (
          <Icon.Film width={11} height={11} />
        ) : (
          <Icon.Image width={11} height={11} />
        )}
        {mention.workflow.medium}
      </span>
    </>
  );
}

/** The two lines of a measured audio note a one-line menu row has room for. */
export function measured(note?: string): string {
  if (!note) return "";
  return note
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("Tempo:") || l.startsWith("Key:"))
    .map((l) => l.replace(/\s*\(confidence[^)]*\)/, ""))
    .join(" · ");
}
