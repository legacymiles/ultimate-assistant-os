"use client";

// ---------------------------------------------------------------------------
// The camera deck: a row of chips above the prompt box, and the picker behind
// them.
//
// Two different kinds of decision live here, and they are stored differently on
// purpose:
//
//   the look   — genre, era, tempo, body, lens, aperture, palette, light. One
//                choice per rail, held as state, shown on the chips.
//   the moves  — camera moves, which go into the PROMPT TEXT as "#crane-up"
//                because with moves the order is the shot, and a text box is
//                the only honest place to put an ordered list the owner can
//                rearrange, retype and read back.
//
// Three shapes of picker, chosen by what the rail actually is:
//
//   carousel  — Film setup. Genre, era and tempo are each ONE decision along a
//               line, so they get a scrubber: one frame at a time, big, with
//               its neighbours peeking in and a tick per option underneath.
//   wall      — Camera setup, palettes, lighting. Many parallel options that
//               want comparing side by side.
//   movement  — the wall plus search, grouping and the running shot order.
//
// Everything reaches the model through src/lib/studio/cinema.ts → cinemaContext().
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../icons";
import { CHIP_PREVIEW, MoveArt, OptionArt, railHasArt } from "./CinemaArt";
import {
  ASPECTS,
  CINEMA_GROUPS,
  DURATIONS,
  MOVE_FAMILIES,
  MOVES,
  groupSummary,
  isSet,
  movesIn,
  optionById,
  searchMoves,
  withMove,
  withoutMove,
  type CinemaGroup,
  type CinemaMove,
  type CinemaOption,
  type CinemaOutput,
  type CinemaRail,
  type CinemaSelection,
  type GroupId,
  type OutputChoice,
} from "@/lib/studio/cinema";

const GROUP_ICON: Record<GroupId, (p: { width: number; height: number }) => React.ReactNode> = {
  film: (p) => <Icon.Film {...p} />,
  camera: (p) => <Icon.Camera {...p} />,
  style: (p) => <Icon.Brush {...p} />,
  color: (p) => <Icon.Palette {...p} />,
  lighting: (p) => <Icon.Lamp {...p} />,
};

const groupById = (id: GroupId) => CINEMA_GROUPS.find((g) => g.id === id)!;

/** What each rail's pane says it is for, under its heading. */
const RAIL_HINT: Record<string, string> = {
  genre: "Story conventions the model should follow",
  era: "The period the film belongs to",
  tempo: "How many shots, and how long each one holds",
};

// ---------------------------------------------------------------------------
// Where the picker is open. "film/era", "camera/setup", "color"…
// ---------------------------------------------------------------------------

type Section = string;

interface NavEntry {
  id: Section;
  label: string;
  group: GroupId | "moves";
  /** The rail this entry opens, when its group has several. */
  rail?: string;
  sub?: true;
}

const NAV: NavEntry[] = [
  { id: "film", label: "Film setup", group: "film" },
  { id: "film/genre", label: "Genre", group: "film", rail: "genre", sub: true },
  { id: "film/era", label: "Era", group: "film", rail: "era", sub: true },
  { id: "film/tempo", label: "Tempo", group: "film", rail: "tempo", sub: true },
  { id: "camera", label: "Camera", group: "camera" },
  { id: "moves", label: "Movement", group: "moves", sub: true },
  { id: "style", label: "Style", group: "style" },
  { id: "color", label: "Color palette", group: "color" },
  { id: "lighting", label: "Lighting", group: "lighting" },
];

const navOf = (id: Section) => NAV.find((n) => n.id === id) ?? NAV[0];

/** Is anything set in whatever this entry is responsible for? */
function touched(entry: NavEntry, selection: CinemaSelection, moves: CinemaMove[]): boolean {
  if (entry.group === "moves") return moves.length > 0;
  const rails = groupById(entry.group).rails;
  return (entry.rail ? rails.filter((r) => r.id === entry.rail) : rails).some((r) => isSet(selection, r.id));
}

// ---------------------------------------------------------------------------
// The chip row.
// ---------------------------------------------------------------------------

export function CinemaBar({
  selection,
  onSelection,
  text,
  onText,
  /** Rendered at the start of the row — the References chip belongs to the host. */
  lead,
}: {
  selection: CinemaSelection;
  onSelection: (s: CinemaSelection) => void;
  text: string;
  onText: (t: string) => void;
  lead?: React.ReactNode;
}) {
  const [open, setOpen] = useState<Section | null>(null);
  const moves = useMemo(() => movesIn(text), [text]);

  return (
    <>
      <div className="cin-deck flex items-stretch gap-1.5 overflow-x-auto pb-0.5" aria-label="Camera deck">
        {lead}
        {CINEMA_GROUPS.map((g) => {
          // The first rail the owner actually set is what the chip shows.
          const shown = g.rails.find((r) => isSet(selection, r.id));
          const option = shown ? optionById(selection[shown.id])! : null;
          const fallback = CHIP_PREVIEW[g.id];
          return (
            <Chip
              key={g.id}
              label={g.label}
              value={groupSummary(g, selection)}
              onClick={() => setOpen(g.id === "film" ? "film/genre" : g.id)}
              art={
                <OptionArt
                  railId={shown ? shown.id : fallback.railId}
                  optionId={option ? option.id : fallback.optionId}
                  cuts={option?.cuts ?? (shown ? undefined : optionById(fallback.optionId)?.cuts)}
                />
              }
            />
          );
        })}
        <Chip
          label="Movement"
          value={moves.map((m) => m.name).join(" → ")}
          onClick={() => setOpen("moves")}
          art={<MoveArt glyph={moves[0]?.glyph ?? "orbit"} />}
        />
      </div>

      {open && (
        <CinemaDialog
          section={open}
          onSection={setOpen}
          onClose={() => setOpen(null)}
          selection={selection}
          onSelection={onSelection}
          moves={moves}
          onAddMove={(id) => onText(withMove(text, id))}
          onRemoveMove={(id) => onText(withoutMove(text, id))}
        />
      )}
    </>
  );
}

/**
 * One control on the composer. The thumbnail is the point: it is a picture of
 * the setting itself, so the row reads as five decisions already made rather
 * than five buttons that might do something.
 */
export function Chip({
  art,
  label,
  value,
  onClick,
  children,
}: {
  art: React.ReactNode;
  label: string;
  value: string;
  onClick?: () => void;
  /** Rendered in place of the thumbnail — the References chip uses it. */
  children?: React.ReactNode;
}) {
  const on = Boolean(value);
  return (
    <button
      type="button"
      onClick={onClick}
      title={value ? `${label}: ${value}` : `Set ${label.toLowerCase()}`}
      className={`cin-chip group flex min-w-[8.5rem] flex-1 basis-[8.5rem] items-center gap-2 rounded-xl border p-1.5 text-left transition ${
        on
          ? "border-ink-faint bg-panel-2"
          : "border-line bg-panel hover:border-ink-faint hover:bg-panel-2"
      }`}
    >
      <span
        className={`relative block h-8 w-8 shrink-0 overflow-hidden rounded-lg bg-canvas transition ${
          on ? "" : "opacity-55 group-hover:opacity-80"
        }`}
      >
        {children ?? art}
      </span>
      <span className="min-w-0 pr-1">
        <span className="block truncate text-[10px] leading-none text-ink-faint">{label}</span>
        <span
          className={`mt-1 block truncate text-xs font-medium leading-tight ${on ? "text-ink" : "text-ink-muted group-hover:text-ink"}`}
        >
          {value || "Auto"}
        </span>
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// The picker.
// ---------------------------------------------------------------------------

function CinemaDialog({
  section,
  onSection,
  onClose,
  selection,
  onSelection,
  moves,
  onAddMove,
  onRemoveMove,
}: {
  section: Section;
  onSection: (s: Section) => void;
  onClose: () => void;
  selection: CinemaSelection;
  onSelection: (s: CinemaSelection) => void;
  moves: CinemaMove[];
  onAddMove: (id: string) => void;
  onRemoveMove: (id: string) => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const here = navOf(section);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      // Keep tabbing inside the dialog while it owns the screen.
      if (e.key !== "Tab" || !panel.current) return;
      const stops = panel.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]),input,[href],[tabindex]:not([tabindex="-1"])',
      );
      if (!stops.length) return;
      const first = stops[0];
      const last = stops[stops.length - 1];
      if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  /** Wall tiles toggle: clicking the chosen one (or "Auto") un-chooses it. */
  const pick = (rail: CinemaRail, option: CinemaOption) => {
    const next = { ...selection };
    if (next[rail.id] === option.id || !option.prompt) delete next[rail.id];
    else next[rail.id] = option.id;
    onSelection(next);
  };

  /** The carousel sets: wherever it stops is the value, "Auto" included. */
  const set = (rail: CinemaRail, option: CinemaOption) => {
    const next = { ...selection };
    if (option.prompt) next[rail.id] = option.id;
    else delete next[rail.id];
    onSelection(next);
  };

  /** "Reset all" clears only what this pane is responsible for. */
  const reset = () => {
    if (here.group === "moves") {
      moves.forEach((m) => onRemoveMove(m.id));
      return;
    }
    const next = { ...selection };
    groupById(here.group).rails.forEach((r) => delete next[r.id]);
    onSelection(next);
  };

  const dirty = touched({ ...here, rail: undefined }, selection, moves);
  const title = here.group === "moves" ? "Camera" : groupById(here.group).label;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-canvas/80 p-3 backdrop-blur-sm sm:p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={`${title} settings`}
        className="cin-panel flex h-[min(700px,92vh)] w-[min(1020px,96vw)] flex-col overflow-hidden rounded-2xl border border-line bg-panel"
      >
        <header className="flex shrink-0 items-center gap-3 border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold tracking-tight text-ink">{title}</h2>
          <button
            type="button"
            onClick={reset}
            disabled={!dirty}
            className="ml-auto rounded-lg border border-line px-2.5 py-1 text-[11px] text-ink-muted transition hover:border-ink-faint hover:text-ink disabled:pointer-events-none disabled:opacity-40"
          >
            Reset all
          </button>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-7 w-7 place-items-center rounded-lg border border-line text-ink-muted transition hover:border-ink-faint hover:text-ink"
          >
            <Icon.Close width={13} height={13} />
          </button>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-1 sm:grid-cols-[170px_1fr]">
          <nav
            className="hidden shrink-0 gap-0.5 overflow-y-auto border-r border-line p-2 sm:flex sm:flex-col"
            aria-label="Sections"
          >
            {NAV.map((n) => {
              const on = section === n.id;
              return (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => onSection(n.id)}
                  aria-current={on ? "true" : undefined}
                  className={`flex items-center gap-2 rounded-lg py-1.5 pr-2 text-left text-xs transition ${
                    n.sub ? "ml-3 pl-2" : "pl-2.5"
                  } ${on ? "bg-panel-2 text-ink" : "text-ink-muted hover:bg-panel-2/60 hover:text-ink"}`}
                >
                  {n.sub ? (
                    n.group === "moves" ? (
                      <Icon.Move width={12} height={12} className="shrink-0" />
                    ) : null
                  ) : (
                    <span className="shrink-0">{GROUP_ICON[n.group as GroupId]({ width: 13, height: 13 })}</span>
                  )}
                  <span className="truncate">{n.label}</span>
                  {touched(n, selection, moves) && (
                    <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden />
                  )}
                </button>
              );
            })}
          </nav>

          {/* The same list, as a scroller, when the rail will not fit. */}
          <div className="flex gap-1 overflow-x-auto border-b border-line px-2 py-2 sm:hidden">
            {NAV.filter((n) => n.id !== "film").map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => onSection(n.id)}
                aria-current={section === n.id ? "true" : undefined}
                className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] transition ${
                  section === n.id ? "border-ink-faint bg-panel-2 text-ink" : "border-line text-ink-muted"
                }`}
              >
                {n.label}
              </button>
            ))}
          </div>

          <div className="min-h-0 overflow-y-auto">
            {here.group === "moves" ? (
              <MovementPane moves={moves} onAdd={onAddMove} onRemove={onRemoveMove} />
            ) : here.rail ? (
              <CarouselPane
                rail={groupById(here.group).rails.find((r) => r.id === here.rail)!}
                selection={selection}
                onSet={set}
              />
            ) : (
              <WallPane group={groupById(here.group)} selection={selection} onPick={pick} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Film setup: one decision at a time, along a line.
// ---------------------------------------------------------------------------

function CarouselPane({
  rail,
  selection,
  onSet,
}: {
  rail: CinemaRail;
  selection: CinemaSelection;
  onSet: (rail: CinemaRail, option: CinemaOption) => void;
}) {
  const options = rail.options;
  // "Auto" is index 0 on every carousel rail, and is where an unset rail sits.
  const index = Math.max(0, options.findIndex((o) => o.id === selection[rail.id]));
  const current = options[index];

  // The carousel's position IS the value, so travelling sets it outright —
  // never toggles, which would make the arrows feel broken at the ends.
  const set = (to: number) => {
    const next = options[Math.min(options.length - 1, Math.max(0, to))];
    if (next) onSet(rail, next);
  };

  return (
    <div
      className="flex h-full flex-col p-4"
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") {
          e.preventDefault();
          set(index + 1);
        } else if (e.key === "ArrowLeft") {
          e.preventDefault();
          set(index - 1);
        }
      }}
    >
      <h3 className="text-sm font-semibold text-ink">Select {rail.label.toLowerCase()}</h3>
      <p className="mt-0.5 text-[11px] text-ink-muted">{RAIL_HINT[rail.id] ?? ""}</p>

      <div className="relative mt-5 flex min-h-0 flex-1 items-center justify-center">
        {/* The neighbours, peeking in, clickable. */}
        {[-1, 1].map((d) => {
          const o = options[index + d];
          if (!o) return <span key={d} className="hidden w-[18%] shrink-0 md:block" />;
          return (
            <button
              key={d}
              type="button"
              onClick={() => set(index + d)}
              title={o.name}
              className="hidden w-[18%] shrink-0 overflow-hidden rounded-lg opacity-45 transition hover:opacity-75 md:block"
              style={{ order: d < 0 ? -1 : 1 }}
            >
              <span className="block aspect-[16/10] overflow-hidden rounded-lg border border-line bg-canvas">
                <OptionArt railId={rail.id} optionId={o.id} cuts={o.cuts} />
              </span>
              <span className="sr-only">{o.name}</span>
            </button>
          );
        })}

        <div className="mx-3 w-full max-w-[420px] shrink-0">
          <div className="cin-hero overflow-hidden rounded-xl border border-line bg-canvas" key={current.id}>
            <span className="block aspect-[16/10]">
              <OptionArt railId={rail.id} optionId={current.id} cuts={current.cuts} />
            </span>
          </div>
          <p className="mt-2 text-center text-[11px] text-ink-muted">{current.note}</p>
        </div>
      </div>

      {/* One tick per option; the line itself is the range. */}
      <div
        role="listbox"
        aria-label={rail.label}
        aria-activedescendant={`cin-${current.id}`}
        tabIndex={0}
        className="mt-4 flex items-end justify-center gap-[3px] rounded-lg py-1 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink-faint"
      >
        {options.map((o, i) => (
          <button
            key={o.id}
            id={`cin-${o.id}`}
            type="button"
            role="option"
            aria-selected={i === index}
            title={o.name}
            onClick={() => set(i)}
            className={`w-[7px] shrink-0 rounded-full transition-all ${
              i === index ? "h-6 bg-accent" : "h-3 bg-ink-faint/40 hover:h-4 hover:bg-ink-muted"
            }`}
          >
            <span className="sr-only">{o.name}</span>
          </button>
        ))}
      </div>

      <div className="mt-2 flex items-center justify-center gap-3">
        <span className="hidden w-28 truncate text-right text-xs text-ink-faint sm:block">
          {options[index - 1]?.name ?? ""}
        </span>
        <button
          type="button"
          onClick={() => set(index - 1)}
          disabled={index === 0}
          aria-label={`Previous ${rail.label.toLowerCase()}`}
          className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-line text-ink-muted transition hover:border-ink-faint hover:text-ink disabled:opacity-30"
        >
          <Icon.Chevron width={13} height={13} className="rotate-180" />
        </button>
        <span
          className={`min-w-[7rem] rounded-full border px-3 py-1 text-center text-sm font-semibold ${
            current.prompt ? "border-ink-faint bg-panel-2 text-ink" : "border-transparent text-accent"
          }`}
        >
          {current.name}
        </span>
        <button
          type="button"
          onClick={() => set(index + 1)}
          disabled={index === options.length - 1}
          aria-label={`Next ${rail.label.toLowerCase()}`}
          className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-line text-ink-muted transition hover:border-ink-faint hover:text-ink disabled:opacity-30"
        >
          <Icon.Chevron width={13} height={13} />
        </button>
        <span className="hidden w-28 truncate text-xs text-ink-faint sm:block">{options[index + 1]?.name ?? ""}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Camera setup / palettes / lighting: a wall to compare across.
// ---------------------------------------------------------------------------

function WallPane({
  group,
  selection,
  onPick,
}: {
  group: CinemaGroup;
  selection: CinemaSelection;
  onPick: (rail: CinemaRail, option: CinemaOption) => void;
}) {
  const single = group.rails.length === 1;
  const [query, setQuery] = useState("");
  // Only a long rail earns a search box and shelves; the short ones read fine
  // as one grid, and a filter over twelve tiles is furniture.
  const rail0 = group.rails[0];
  const long = single && rail0.options.length > 20;
  const q = query.trim().toLowerCase();

  return (
    <div className="p-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-ink">Set up {group.label.toLowerCase()}</h3>
          <p className="mt-0.5 text-[11px] text-ink-muted">{group.hint}</p>
        </div>
        {long && (
          <label className="flex items-center gap-1.5 rounded-lg border border-line bg-panel-2 px-2 py-1">
            <Icon.Search width={12} height={12} className="text-ink-faint" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${group.label.toLowerCase()}`}
              aria-label={`Search ${group.label.toLowerCase()}`}
              className="w-28 bg-transparent text-[11px] text-ink placeholder:text-ink-faint focus:outline-none sm:w-40"
            />
          </label>
        )}
      </div>

      <div className={`mt-4 ${single ? "" : "grid gap-x-4 gap-y-6 md:grid-cols-3"}`}>
        {group.rails.map((rail) => (
          <section key={rail.id}>
            <h4 className="mb-2 flex items-baseline gap-2 text-[10px] uppercase tracking-[0.08em] text-ink-faint">
              {rail.label}
              {isSet(selection, rail.id) && (
                <span className="normal-case tracking-normal text-ink-muted">{optionById(selection[rail.id])!.name}</span>
              )}
            </h4>
            <div
              role="radiogroup"
              aria-label={`${group.label} ${rail.label}`}
              className={
                single ? "grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-2.5" : "space-y-2"
              }
            >
              {rail.options
                .filter((o) => !q || `${o.name} ${o.note} ${o.family ?? ""}`.toLowerCase().includes(q))
                .map((o) => (
                  <OptionTile
                    key={o.id}
                    rail={rail}
                    option={o}
                    checked={selection[rail.id] === o.id || (!selection[rail.id] && !o.prompt)}
                    onPick={() => onPick(rail, o)}
                  />
                ))}
            </div>
          </section>
        ))}
      </div>
      {long && !rail0.options.some((o) => !q || `${o.name} ${o.note} ${o.family ?? ""}`.toLowerCase().includes(q)) && (
        <p className="py-12 text-center text-xs text-ink-muted">Nothing matches “{query}”.</p>
      )}
    </div>
  );
}

function OptionTile({
  rail,
  option,
  checked,
  onPick,
}: {
  rail: CinemaRail;
  option: CinemaOption;
  checked: boolean;
  onPick: () => void;
}) {
  if (!railHasArt(rail.id)) {
    return (
      <button
        type="button"
        role="radio"
        aria-checked={checked}
        onClick={onPick}
        title={option.prompt || undefined}
        className={`flex w-full items-baseline gap-2 rounded-lg border px-2.5 py-1.5 text-left transition ${
          checked
            ? "border-ink-faint bg-panel-2 text-ink"
            : "border-transparent text-ink-muted hover:border-line hover:bg-panel-2/60 hover:text-ink"
        }`}
      >
        <span className="text-xs font-medium">{option.name}</span>
        <span className="min-w-0 flex-1 truncate text-right text-[10px] text-ink-faint">{option.note}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      onClick={onPick}
      title={option.prompt || undefined}
      className={`cin-tile group block w-full overflow-hidden rounded-xl border text-left transition ${
        checked ? "border-accent" : "border-line hover:border-ink-faint"
      }`}
    >
      <span className="relative block aspect-[16/10] overflow-hidden bg-canvas">
        <OptionArt railId={rail.id} optionId={option.id} cuts={option.cuts} />
        {checked && (
          <span className="absolute right-1.5 top-1.5 grid h-5 w-5 place-items-center rounded-full bg-accent text-canvas">
            <Icon.Check width={11} height={11} />
          </span>
        )}
      </span>
      {option.colors && (
        <span className="flex h-2.5 w-full" aria-hidden>
          {option.colors.map((c, i) => (
            <span key={i} className="flex-1" style={{ background: c }} />
          ))}
        </span>
      )}
      <span className="block px-2 py-1.5">
        <span
          className={`block truncate text-[11px] font-medium ${checked ? "text-ink" : "text-ink-muted group-hover:text-ink"}`}
        >
          {option.name}
        </span>
        <span className="block truncate text-[10px] text-ink-faint">{option.note}</span>
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Movement: the wall of moves, with search, grouping, and the order they were
// put on the prompt.
// ---------------------------------------------------------------------------

type Sort = "family" | "az";

function MovementPane({
  moves,
  onAdd,
  onRemove,
}: {
  moves: CinemaMove[];
  onAdd: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("family");
  const hits = useMemo(() => searchMoves(query), [query]);
  const chosen = new Set(moves.map((m) => m.id));

  const shelves =
    query.trim() || sort === "az"
      ? [{ label: "", items: sort === "az" ? [...hits].sort((a, b) => a.name.localeCompare(b.name)) : hits }]
      : MOVE_FAMILIES.map((f) => ({ label: f, items: MOVES.filter((m) => m.family === f) })).filter((s) => s.items.length);

  return (
    <div className="p-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-ink">Direct a camera move</h3>
          <p className="mt-0.5 text-[11px] text-ink-muted">
            Goes into the prompt box, or type <kbd className="rounded border border-line px-1 font-mono text-[10px]">#</kbd>{" "}
            there. Several per shot — the order is the shot.
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <label className="flex items-center gap-1.5 rounded-lg border border-line bg-panel-2 px-2 py-1">
            <Icon.Search width={12} height={12} className="text-ink-faint" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search moves"
              aria-label="Search camera moves"
              className="w-28 bg-transparent text-[11px] text-ink placeholder:text-ink-faint focus:outline-none sm:w-36"
            />
          </label>
          <button
            type="button"
            onClick={() => setSort((s) => (s === "family" ? "az" : "family"))}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2 py-1.5 text-[11px] text-ink-muted transition hover:border-ink-faint hover:text-ink"
          >
            <Icon.Layers width={12} height={12} />
            {sort === "family" ? "By kind" : "A–Z"}
          </button>
        </div>
      </div>

      {moves.length > 0 && (
        <ol className="mt-3 flex flex-wrap items-center gap-1.5 rounded-lg border border-line bg-panel-2 p-2">
          <li className="text-[10px] uppercase tracking-[0.06em] text-ink-faint">In this shot</li>
          {moves.map((m, i) => (
            <li
              key={m.id}
              className="flex items-center gap-1.5 rounded-md border border-line bg-panel py-0.5 pl-1.5 pr-1 text-[11px] text-ink"
            >
              <span className="font-mono text-[10px] text-ink-faint">{i + 1}</span>
              {m.name}
              <button
                type="button"
                onClick={() => onRemove(m.id)}
                aria-label={`Remove ${m.name}`}
                className="text-ink-faint transition hover:text-ink"
              >
                <Icon.Close width={10} height={10} />
              </button>
            </li>
          ))}
        </ol>
      )}

      {shelves.map((shelf) => (
        <section key={shelf.label || "all"} className="mt-5 first:mt-4">
          {shelf.label && <h4 className="mb-2 text-[10px] uppercase tracking-[0.08em] text-ink-faint">{shelf.label}</h4>}
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2.5">
            {shelf.items.map((m) => {
              const on = chosen.has(m.id);
              const at = moves.findIndex((x) => x.id === m.id);
              return (
                <li key={m.id}>
                  <button
                    type="button"
                    aria-pressed={on}
                    onClick={() => (on ? onRemove(m.id) : onAdd(m.id))}
                    className={`cin-tile group relative block w-full overflow-hidden rounded-xl border text-left transition ${
                      on ? "border-accent" : "border-line hover:border-ink-faint"
                    }`}
                  >
                    <span className="relative block aspect-[16/11] overflow-hidden bg-canvas">
                      <MoveArt glyph={m.glyph} />
                      {on && (
                        <span className="absolute right-1.5 top-1.5 grid h-5 w-5 place-items-center rounded-full bg-accent font-mono text-[10px] font-semibold text-canvas">
                          {at + 1}
                        </span>
                      )}
                      <span className="cin-cta pointer-events-none absolute inset-x-1.5 bottom-1.5 rounded-md bg-ink px-2 py-1 text-center text-[10px] font-semibold text-canvas">
                        {on ? "Take off prompt" : "Put on prompt"}
                      </span>
                    </span>
                    <span className="block px-2 py-1.5">
                      <span
                        className={`block truncate text-[11px] font-medium ${on ? "text-ink" : "text-ink-muted group-hover:text-ink"}`}
                      >
                        {m.name}
                      </span>
                      <span className="block truncate text-[10px] text-ink-faint">{m.note}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {!shelves.some((s) => s.items.length) && (
        <p className="py-12 text-center text-xs text-ink-muted">No camera move matches “{query}”.</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The output row: aspect ratio and clip length, on the composer's own toolbar
// rather than in the picker, because they are what you reach for last, and
// because the model must receive them as exact arguments, not as description.
// ---------------------------------------------------------------------------

export function CinemaOutputRow({
  output,
  onOutput,
}: {
  output: CinemaOutput;
  onOutput: (o: CinemaOutput) => void;
}) {
  return (
    <>
      <Picker
        label="Aspect ratio"
        icon={<Icon.Frame width={12} height={12} />}
        value={output.aspect ?? ""}
        placeholder="Ratio"
        options={ASPECTS}
        width="w-[3.6rem]"
        onChange={(v) => onOutput({ ...output, aspect: v || undefined })}
      />
      <Picker
        label="Clip length"
        icon={<Icon.Clock width={12} height={12} />}
        value={output.duration ? String(output.duration) : ""}
        placeholder="Length"
        options={DURATIONS}
        width="w-[3.2rem]"
        onChange={(v) => onOutput({ ...output, duration: v ? Number(v) : undefined })}
      />
    </>
  );
}

/**
 * A native select styled as a chip. Native on purpose: it is a short list on a
 * crowded toolbar, and the platform's own menu beats anything re-implemented
 * here for keyboard and touch.
 */
function Picker({
  label,
  icon,
  value,
  placeholder,
  options,
  width,
  onChange,
}: {
  label: string;
  icon: React.ReactNode;
  value: string;
  placeholder: string;
  options: OutputChoice[];
  /** Pinned, because a native select is otherwise as wide as its longest option. */
  width: string;
  onChange: (v: string) => void;
}) {
  const on = Boolean(value);
  return (
    <label
      title={label}
      className={`inline-flex items-center gap-1 rounded-lg border px-1.5 py-1 text-[11px] transition ${
        on ? "border-ink-faint bg-panel text-ink" : "border-line text-ink-muted hover:border-ink-faint hover:text-ink"
      }`}
    >
      <span className="sr-only">{label}</span>
      <span className={on ? "text-ink-muted" : "text-ink-faint"}>{icon}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        className={`cursor-pointer appearance-none bg-transparent pr-3 text-inherit focus:outline-none ${width}`}
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 8 5' fill='none' stroke='%239aa3b5' stroke-width='1.2' stroke-linecap='round'><path d='M1 1l3 3 3-3'/></svg>\")",
          backgroundRepeat: "no-repeat",
          backgroundPosition: "right 0 center",
          backgroundSize: "8px 5px",
        }}
      >
        <option value="">{placeholder}</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
            {o.note ? ` — ${o.note}` : ""}
          </option>
        ))}
      </select>
    </label>
  );
}
