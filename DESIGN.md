---
name: Ultimate Assistant OS
description: A near-black instrument panel where colour is reserved for state and monospace is reserved for machine truth.
colors:
  canvas: "#0a0b0f"
  panel: "#12141c"
  panel-2: "#181b25"
  elevated: "#1d212d"
  line: "#262a38"
  line-soft: "#1e222e"
  ink: "#e9ecf3"
  ink-muted: "#9aa3b5"
  ink-faint: "#6b7385"
  brand: "#6366f1"
  brand-2: "#4f46e5"
  brand-press: "color-mix(in oklab, #4f46e5 82%, black)"
  core: "#22c55e"
  core-2: "#16a34a"
  support: "#3b82f6"
  support-2: "#2563eb"
  state-waiting: "#f59e0b"
  state-failed: "#ef4444"
  state-failed-ink: "#f87171"
  accent-cyan: "#00cae0"
  accent-cyan-2: "#00a5b8"
typography:
  display:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
    fontSize: "30px"
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "-0.01em"
  title:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.3
  body:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.625
  dense:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.4
  mono:
    fontFamily: "JetBrains Mono, ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, Liberation Mono, monospace"
    fontSize: "11.5px"
    fontWeight: 400
    lineHeight: 1.625
    fontFeature: "tnum 1"
  label:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
    fontSize: "10.5px"
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: "0.025em"
  micro:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
    fontSize: "9.5px"
    fontWeight: 400
    lineHeight: 1
rounded:
  sm: "4px"
  md: "6px"
  lg: "8px"
  block: "10px"
  xl: "12px"
  full: "9999px"
spacing:
  hair: "2px"
  xs: "4px"
  sm: "6px"
  md: "8px"
  lg: "10px"
  xl: "12px"
  xxl: "16px"
components:
  button-primary:
    backgroundColor: "{colors.brand-2}"
    textColor: "#ffffff"
    rounded: "{rounded.md}"
    padding: "6px 12px"
    typography: "{typography.dense}"
  button-primary-hover:
    backgroundColor: "{colors.brand-press}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink-muted}"
    rounded: "{rounded.md}"
    padding: "6px 12px"
    typography: "{typography.dense}"
  button-ghost-hover:
    backgroundColor: "{colors.elevated}"
    textColor: "{colors.ink}"
  button-outline:
    backgroundColor: "transparent"
    textColor: "{colors.ink-muted}"
    rounded: "{rounded.md}"
    padding: "6px 12px"
    typography: "{typography.dense}"
  chip-mode:
    backgroundColor: "transparent"
    textColor: "{colors.ink-muted}"
    rounded: "{rounded.sm}"
    padding: "2px 6px"
    typography: "{typography.label}"
  chip-mode-selected:
    backgroundColor: "{colors.brand-2}"
    textColor: "#ffffff"
  panel-strip:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.block}"
    padding: "8px 12px"
  input-text:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "4px 8px"
    typography: "{typography.mono}"
  command-line:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "8px 10px"
    typography: "{typography.body}"
  table-header:
    backgroundColor: "{colors.panel-2}"
    textColor: "{colors.ink-muted}"
    padding: "6px 12px"
    typography: "{typography.label}"
  rail-item:
    backgroundColor: "transparent"
    textColor: "{colors.ink-muted}"
    rounded: "{rounded.md}"
    padding: "6px 0"
    typography: "{typography.micro}"
    width: "56px"
  rail-item-selected:
    backgroundColor: "{colors.elevated}"
    textColor: "{colors.ink}"
  status-dot:
    rounded: "{rounded.full}"
    width: "7px"
    height: "7px"
---

# Design System: Ultimate Assistant OS

## Overview

**Creative North Star: "The Night Console"**

This is a dark room with an instrument in it. The canvas is near-black (#0a0b0f) and
almost nothing on it is coloured — panels are separated from the canvas by two or three
points of lightness and a one-pixel hairline, never by a shadow and never by a card.
Colour does not decorate here; it reports. When something on this surface goes indigo,
green, amber or red, a machine is telling you its state, and that is the only reason
those hues ever appear.

The register is dense and factual. The whole working type ramp lives between 9.5px and
14px, and the single largest thing on a typical screen is a 14px semibold word. That is
not an accident of scale — it is the product's stated position: the one person who uses
this reads fast, knows the domain, and would rather see forty real values than eight
pretty cards. Monospace carries the other half of the argument. Every command, path,
ref, count and elapsed time is set in JetBrains Mono with tabular figures, so a column of
numbers can be compared by eye instead of re-measured; prose is set in the system sans so
the two never get confused for one another.

The world rejects two things by name. It rejects the card grid as a way of browsing —
that was tried once in the AI Rankings app and had to be rebuilt as a table. And it
rejects depth-as-rank: there is not one `shadow-*` utility in the entire component layer,
because a raised surface implies an importance the data has not earned. Depth is tonal
(canvas → panel → panel-2 → elevated) and boundaries are hairlines.

**Key Characteristics:**
- Near-black canvas with four tonal surface steps, separated by 1px hairlines
- A working type ramp that tops out at 14px; display type is exceptional, not structural
- Monospace with tabular figures for every machine fact; sans for every human sentence
- One indigo for what is armed or current; green/amber/red strictly for state
- Flat by construction — no drop shadows in the component layer
- Tables and bordered strips over cards and grids

## Colors

A muted blue-black neutral ramp carrying a single saturated indigo, plus three signal
hues that are only ever allowed to mean something.

### Primary
- **Armed Indigo** (`brand`): the one accent. It marks what is armed, current, selected
  or in flight — the lit left edge of a command line with text in it, the live dot on the
  tab that is running, the `@@` hunk header in a diff, the caret and the selection
  highlight. It is never used to make something look important.
- **Action Indigo** (`brand-2`): the darker sibling, and the only fill under white text.
  Primary buttons and the selected mode chip sit on this, not on `brand` — white on
  `brand-2` clears contrast where white on `brand` does not.
- **Pressed Indigo** (`brand-press`): the hover and press state for anything filled with
  `brand-2`, derived from it with `color-mix(in oklab, … 82%, black)` rather than invented
  beside it. Hover goes **darker**, so contrast improves under the pointer instead of
  degrading.

### Secondary
- **Up Green** (`core`): a capability that is reachable, a step that returned ok, added
  lines in a diff, the wave while it is hearing you. Its darker pair (`core-2`) is for
  fills under light text.
- **Thinking Blue** (`support`): work in progress that is neither success nor failure —
  the wave while the assistant is composing. Paired with `support-2` for fills.

### Tertiary
- **Waiting Amber** (`state-waiting`): exactly one meaning — *this is waiting on you*.
  It borders the block holding an unanswered confirm gate, tints that gate's background at
  6%, and colours the shield icon beside it. Nothing decorative is ever amber.
- **Refused Red** (`state-failed`) and **Refused Red Ink** (`state-failed-ink`): the
  failure pair. The saturated value carries borders and backgrounds; the lighter value
  carries text, because the saturated one does not clear contrast on canvas at 11px.
- **Editor Cyan** (`accent-cyan` / `accent-cyan-2`): scoped, not systemic. It is the
  CapCut-editor accent belonging to the video surfaces. Treat it as that app's local
  colour and do not reach for it as a general accent.

### Neutral
- **Void** (`canvas`): the page. Also the inset background for anything that should read
  as *input* or *machine output* — text fields, `<pre>` blocks, diff panes — so a field
  reads as a hole in the panel rather than a tile on it.
- **Panel** (`panel`): chrome and content surfaces — the header, the rail, the right-hand
  column, and the body of a block.
- **Panel Raised** (`panel-2`): a half-step above panel for table headers, page-frame
  chrome, and the hover state of a rail item.
- **Elevated** (`elevated`): the top tonal step, used almost exclusively for the hover and
  selected state of a control — not for containers.
- **Hairline** (`line`): every visible boundary. Structural edges — around a block,
  between columns, under the header.
- **Hairline Soft** (`line-soft`): the quieter rule used *inside* a container, so a table
  row divider does not compete with the container's own edge.
- **Ink** (`ink`): primary text, and only primary text. It is the brightest thing on the
  surface and is spent sparingly.
- **Ink Muted** (`ink-muted`): the workhorse. Labels, secondary rows, explanatory lines,
  every inactive control. Most text on a given screen is this colour.
- **Ink Faint** (`ink-faint`): structural punctuation only — separator dots, a directory
  slash, an off capability's indicator. Never a sentence anyone has to read.

### Named Rules

**The State-Only Rule.** Green, amber and red are reserved for machine state — reachable,
waiting on you, failed. If a hue is being chosen because it looks good next to the one
beside it, the wrong palette is open. Neutrals and one indigo carry everything else.

**The Darker-On-Hover Rule.** A filled control's hover state is derived from its rest
colour by mixing toward black, never by stepping to the lighter sibling. Moving `brand-2`
to `brand` on hover relocates a contrast breach to the exact moment the pointer is on the
control; `brand-press` removes it.

**The Ink Budget Rule.** `ink` is for the thing being read right now. If a screen has more
than a handful of `ink` strings on it, the hierarchy has collapsed and everything is
shouting — demote the rest to `ink-muted`.

**The Reason-Not-A-Colour Rule.** A status indicator never carries meaning alone. Every
dot is accompanied by a word, and every *off* state is accompanied by the reason it is off
in a plain sentence. A red dot sends the owner to a log file; "the local agent is not
running" sends them to the fix.

## Typography

**Display Font:** none — the system sans, scaled up, on the rare page that needs a headline
**Body Font:** the platform's own UI sans (`ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, …`)
**Label/Mono Font:** JetBrains Mono (loaded via `next/font`, with `ui-monospace, SFMono-Regular, Menlo, Consolas` behind it)

**Character:** Two voices, cleanly divided. The system sans is deliberately anonymous — it
is there to be read, not admired, and it makes the interface feel native to whatever
machine is showing it. JetBrains Mono is the machine's voice: wide, even, unambiguous
between `1`/`l` and `0`/`O`, and set with tabular figures so numbers stack into columns.
The pairing works because the split is semantic rather than decorative — you can tell what
kind of thing you are looking at before you read a word of it.

### Hierarchy
- **Display** (600, 30px, 1.15): rare, and exceptional by design. Roughly two dozen uses
  across the whole codebase — the hub's front page, an app's own landing header. A working
  surface does not have one.
- **Title** (600, 14px, 1.3): the name of the surface you are on, and section headings
  inside a dense panel. This is the largest type on a normal screen.
- **Body** (400, 13px, 1.625): answers, prose, anything written in sentences by a person
  or a model. Generous leading because this is the only text anyone reads at length.
- **Dense** (400, 12px, 1.4): the workhorse row — step summaries, list items, secondary
  controls. Most of the interface is this size.
- **Mono** (400, 11.5px, 1.625, tabular): commands, paths, shell output, diffs, table
  cells, IDs, byte counts. Always JetBrains Mono, always `font-variant-numeric: tabular-nums`.
- **Label** (500, 10.5px, +0.025em, uppercase): panel headings, table column headers, mode
  chips, metadata. Uppercase and tracked so a two-word label reads as a *classification*
  rather than as a short sentence.
- **Micro** (400, 9.5px, 1): the rail's icon captions and similar sub-labels, where the
  word exists to disambiguate an icon and nothing more.

### Named Rules

**The Machine Voice Rule.** If a string came out of a machine and a human would have to
compare it to another string — a command, a path, a ref, a count, an elapsed time, a file
size, a PID — it is monospace with tabular figures. If a human wrote it, it is sans.
There is no third case.

**The Fourteen-Pixel Ceiling Rule.** On a working surface, 14px semibold is the top of the
ramp. Reaching for 20px or 24px to signal importance is the card-grid instinct wearing
different clothes; signal importance with position and colour instead.

**The Loaded-Not-Asked Rule.** Naming a font in a token does not load it. `--font-mono`
asked for JetBrains Mono for a long time while every string on every machine quietly fell
through to Consolas. A surface that names a face must load it (`next/font`) and bind it
into the token, or the design's named voice is fiction.

## Layout

The spatial model is **fixed frame, scrolling middle**. A surface claims the full viewport
height (`100dvh`) with `overflow: hidden` at the root, and exactly one region inside it
scrolls. The rest — header, rail, right column, command line — is pinned and never scrolls
away, because what those regions say (what can I do, what is running, where am I) is worth
nothing if you have to scroll back to it.

The canonical three-column arrangement is a **56px icon rail** hard left, a fluid centre
column, and a **300px fixed right column**. Both flanking widths are tokens
(`--nj-rail`, `--nj-aside`) so the centre's bounds are computed rather than guessed. The
rail is icon-over-caption, not icon-only: at 56px there is room for a 15px icon and a
9.5px word, and the word is worth more than the eight pixels it costs.

**Spacing rhythm.** A 2px base with a compressed early scale — 4 / 6 / 8 / 10 / 12 / 16.
The interface lives almost entirely in the 6–12 band: `12px` horizontal padding and `8px`
vertical on a container, `6px` vertical on a table row, `8px` gaps between siblings,
`6px` between rows in a list. Anything past 16px is either a deliberate section break or a
mistake.

**Responsive behaviour.** One breakpoint does the real work: at `lg` (1024px) the right
column appears. Below it, the fixed column is replaced by a single tappable summary strip
that reports the same two facts in one line ("Voice off · 4 of 4 ready on this PC") and
expands to the full panels on tap. The rail survives at every width. Inside the centre
column, `sm` (640px) handles the reflow of any row that cannot stay on one line —
a control row wraps to two, with the text field taking the whole of the second line rather
than being squeezed to forty pixels. Wide-only table columns (a "Changed" date, say) are
dropped below `sm` rather than being scrolled to.

### Named Rules

**The Nothing-Scrolls-Away Rule.** Exactly one region scrolls. If a status, a capability
list or the input itself can leave the screen, the arrangement has failed regardless of
how it looks at rest.

**The Same-X Rule.** Every element in a column shares its left edge — the command line,
each block, the empty state, the section headings. Centring one thing "because it's the
empty state" makes it the only object on the surface that does not line up with the column
it belongs to.

## Elevation & Depth

**This system is flat.** There is not a single `shadow-*` utility in the component layer.
Depth is entirely tonal: four surface steps (`canvas` → `panel` → `panel-2` → `elevated`)
with a 1px hairline (`line`, or `line-soft` when nested) marking every boundary. A
container does not float above the page; it is a differently-lit region of it.

`box-shadow` is not banned — it is repurposed. The one systemic use is the **inset edge
marker**: `inset 2px 0 0 <state colour>` lights the left edge of a control to say it is
armed or current, a device the hub already uses for a selected nav item and a selected
table row. It is a state marker drawn with the shadow property, not elevation.

Outer glows and drop shadows do appear in several per-app legacy stylesheets inside
`globals.css` (the `mcl-*` and `ds-*` blocks). Those are that app's own vocabulary and
predate this record; they are not the shared system and should not be copied into new
surfaces.

### Shadow Vocabulary
- **Armed edge** (`box-shadow: inset 2px 0 0 0 var(--color-brand)`): this control has
  content and is ready to fire. Paired with a border mixed 32% toward `brand`.
- **Hearing edge** (`box-shadow: inset 2px 0 0 0 var(--color-core)`): this control is
  currently taking dictation.
- **Dot cap** (`background: var(--color-panel); padding: 1px; border-radius: 50%`): not a
  shadow, but the same job — a status dot sitting on a ledger rail is given a one-pixel
  ring of panel colour so the rail passes behind it rather than through it.

### Named Rules

**The Flat-By-Construction Rule.** Surfaces never lift. If two things need separating,
step the tone or draw a hairline; if something needs marking, light its edge from inside.
A drop shadow in a new component is a bug, not a style choice.

## Shapes

Rectangles with small, consistent radii, and hairlines doing the structural work.

The radius scale is tight: **4px** for the smallest controls (chips, micro-buttons, inline
inputs), **6px** for standard buttons and inset result panes, **8px** for the command line
and most bordered containers, **10px** for a block — the one recurring composite object —
and **12px** for the largest chrome. `9999px` is reserved for things that are genuinely
circular: status dots (7px), avatars, pills. Nothing in this world is a rounded-2xl card.

Borders are uniformly **1px** and uniformly one of two colours. `line` is structural: the
outside edge of a block, the divider between columns, the underline of the header.
`line-soft` is internal: the rule between a block's header and its ledger, the border of a
result pane, a table row divider. A container drawn with `line` whose children are drawn
with `line-soft` reads as one object with parts; two `line` borders touching read as two
objects and are almost always wrong.

The recurring silhouette is the **bordered strip on canvas**: full-width, 1px `line`
border, `panel` fill, 10px corners, internal sections divided by `line-soft` rules. Strips
stack with an 8px gap. They do not nest — a strip inside a strip is the beginning of a
card, and cards are what this system is arguing against.

### Named Rules

**The Two-Hairlines Rule.** `line` for the edge of a thing, `line-soft` for the edges
inside it. Never the reverse, and never two `line` borders adjacent.

**The No-Nesting Rule.** A bordered strip contains sections, not other strips. If content
needs a second frame, give it a `line-soft` inset pane on `canvas` — a hole, not a tile.

## Components

### Buttons
- **Shape:** small, tight corners (6px `rounded-md`; 4px on micro-controls), 1px border or
  none, never a pill unless it is genuinely a chip.
- **Primary:** `brand-2` fill, white text, 6px × 12px padding, 12px medium weight. This is
  the only white-on-colour fill in the system and it is rationed — typically one per
  decision point.
- **Hover / Focus:** primary hovers to `brand-press` (darker). Ghost and outline buttons
  hover to an `elevated` background with text promoted from `ink-muted` to `ink`.
  Transitions are 160ms on the exponential ease.
- **Ghost:** transparent, `ink-muted`, no border. The default for anything that is not the
  one decision on screen — every icon button, every toolbar control.
- **Outline:** transparent with a 1px `line` border and `ink-muted` text. Used where a
  secondary action must be visibly a *target* — the "No" beside a "Do it".
- **Disabled:** `opacity: 0.3`–`0.4` plus `cursor: not-allowed`. The control stays in
  place and stays readable as a shape; it does not vanish.

### Chips
- **Style:** 4px corners, 2px × 6px padding, 10.5px uppercase tracked label.
- **State:** selected is a `brand-2` fill with white text; unselected is bare `ink-muted`
  that hovers to `elevated`/`ink`. Selection is announced with `aria-pressed`, not implied
  by colour alone.

### Cards / Containers
There are no cards. The container primitive is the **bordered strip** (see Shapes).
- **Corner Style:** 10px for a block, 8px for smaller framed regions.
- **Background:** `panel` for the strip; `canvas` for inset panes inside it.
- **Shadow Strategy:** none — see Elevation & Depth.
- **Border:** 1px `line` outside, 1px `line-soft` for internal divisions.
- **Internal Padding:** 12px horizontal, 8px vertical. Sections inside a strip are divided
  by a `line-soft` rule and repeat the same padding rather than being indented.
- **State:** a strip's border is the status channel — mixed 34% toward `brand` while
  running, 44% toward `state-waiting` while it needs an answer, 34% toward `state-failed`
  when it failed. The fill never changes.

### Inputs / Fields
- **Style:** `canvas` background inside a `panel` container — a field is a hole, not a
  tile. 1px `line` border, 4–8px corners, monospace at 11.5px for anything machine-shaped,
  `ink-muted` placeholder.
- **Focus:** one focus ring for the whole surface, keyboard-only:
  `outline: 2px solid var(--color-brand); outline-offset: 2px; border-radius: 6px` on
  `:focus-visible`. It is declared once at the surface root so every control gets it,
  including ones sitting on `panel` rather than `canvas`.
- **Caret and selection:** `caret-color: brand`; `::selection` is `brand` mixed 38% into
  transparent with `ink` text. The browser's defaults belong to no design system and are
  overridden at the surface root.
- **Auto-growing text:** a multi-line command field grows with its content between a 22px
  floor and a 200px ceiling rather than scrolling inside three lines. Measure in a frame
  (`requestAnimationFrame`) and re-measure on `document.fonts.ready` — measured inline on
  mount, `scrollHeight` reports the container and pins the field open at the ceiling.

### Navigation
- **Style:** a 56px vertical icon rail on `panel`, separated from the centre by a 1px
  `line`. Each item is a 15px stroke icon over a 9.5px caption, in a 6px-radius hit area
  inset 6px from the rail's edges.
- **States:** rest is `ink-muted` on transparent; hover is `panel-2` with `ink` text;
  current is `elevated` with `ink` text plus `aria-current="page"`. A per-tab live dot
  (`brand`, pulsing) sits top-right of the item when that section has work in flight.
- **Icons:** one inline SVG set (`src/components/icons.tsx`) — 24 viewBox, `currentColor`,
  2px round-capped strokes, rendered at 11–15px. There is no icon font and no emoji.

### Tables
- **Header:** `panel-2` background, sticky, 10px uppercase tracked `ink-muted` labels,
  medium weight.
- **Rows:** monospace 11.5px, 4px vertical padding, separated by `line-soft` with the last
  border removed. Numeric cells carry `data-num` for tabular figures and align on their
  digits.
- **Density:** tables are the default way to show a list of records. They scroll inside a
  bounded pane (`max-h-72`) rather than growing the page.

### Signature Component: the Block
The system's one composite object. A bordered strip whose header carries the request in
monospace with its elapsed time right-aligned, then a numbered **step ledger**, then each
step's result rendered inline at full size.

- **The ledger rail:** a 1px `line` spine at `left: 10px` running the height of the list,
  with each step's 7px status dot sitting on it inside a 1px `panel` ring. The rail is what
  turns six rows into one run.
- **Results are rendered, not printed:** shell output as output, a diff coloured per line,
  a folder as a real table, a screenshot as a picture, everything else as a key/value
  table. JSON is never shown as JSON.
- **Auto-open:** once a block settles, its last result opens by itself. The moment the
  owner touches any row, their choice wins and the surface stops deciding.
- **Waiting:** between a finished step and the next, a hollow 7px `brand` ring pulses on
  the rail with the words "Working out the next step…", so a thinking gap is not read as
  a stall.

### Signature Component: the Confirm Gate
A `state-waiting` section appended inside the block it belongs to — 6% amber wash, a
top border at 45% amber, a 15px shield icon, a one-sentence summary of what will happen
and a quieter line of why. The refusal is focused on mount, and the two buttons are a
`brand-2` primary and a `line`-outlined secondary.

### Signature Component: the Capability Panel
One row per capability, each with its own dot, its own word (`ready` / `off`), and beneath
it either what it can do in plain language ("opens pages, reads them, clicks and fills") or
the specific reason it cannot, plus the command that fixes it. It is the system's clearest
expression of the Reason-Not-A-Colour rule.

### Motion
One easing curve and two durations for the whole system:
`cubic-bezier(0.16, 1, 0.3, 1)` at **160ms** for state transitions (border, background,
colour) and **220ms** for arrival. Nothing else moves.

The arrival grammar is deliberate: a row **arrives already visible and settles** —
`translateY(-3px)` and `opacity: 0.55` to rest — rather than fading up from zero. Fading in
from nothing is the spinner's grammar and says "wait"; arriving and settling says "this
happened", which is what a completed step is.

Anything animating continuously animates `transform` or `opacity` only. A thirteen-bar
waveform scales one fixed height rather than resizing thirteen elements sixty times a
second, because the one moment that decoration is on screen is the moment the main thread
is already busy running an agent.

Every animation is disabled under `prefers-reduced-motion: reduce`.

### Named Rules

**The Settle-Don't-Fade Rule.** New content enters at full opacity and travels the last
few pixels. If it fades up from zero, it reads as a loading state even after it has
loaded.

**The One-Curve Rule.** `cubic-bezier(0.16, 1, 0.3, 1)`, 160ms or 220ms. A second easing
curve on a surface is a second opinion about what kind of machine this is.

## Do's and Don'ts

### Do:
- **Do** take every colour from the `@theme` block in `src/app/globals.css`. It is the
  single source; a new hex in a component is a bug unless it is a documented state value.
- **Do** set every command, path, ref, count, size and elapsed time in JetBrains Mono with
  tabular figures, and load the face rather than only naming it in a token.
- **Do** separate surfaces by tone and a 1px hairline: `line` for a container's own edge,
  `line-soft` for everything inside it.
- **Do** make hover on a filled control go **darker**, using `color-mix(… , black)` from
  the rest colour rather than a lighter sibling.
- **Do** pair every status indicator with a word, and every off state with the specific
  reason it is off and the command that fixes it.
- **Do** keep the whole working ramp between 9.5px and 14px, and reach for position,
  weight and colour before size.
- **Do** declare `:focus-visible` once at a surface's root (2px `brand`, 2px offset) so
  every control is reachable and visible by keyboard.
- **Do** let new content arrive at full opacity and settle, on the one curve, at 160 or
  220ms — and disable it under `prefers-reduced-motion`.
- **Do** render a machine result as what it is: a table as a table, a diff coloured per
  line, a picture as a picture.
- **Do** pin the things that say *where am I*, *what can I do* and *what is running*, and
  scroll exactly one region.

### Don't:
- **Don't** add a drop shadow. There is not one in the component layer; depth is tonal.
  `box-shadow` is permitted only as the inset left-edge state marker.
- **Don't** build a card grid to browse records. It was rejected once already and rebuilt
  as a table. Dense rows, real values, one screen.
- **Don't** nest a bordered strip inside a bordered strip. Use a `line-soft` inset pane on
  `canvas` when content needs its own frame.
- **Don't** use green, amber or red for anything that is not machine state, and don't use
  `brand` to make something look important rather than to mark it as armed or current.
- **Don't** use `ink` for body text in bulk. Most text on a screen is `ink-muted`; `ink` is
  for the thing being read right now.
- **Don't** let a focus ring and a state indicator wear the same appearance. Armed is a lit
  left edge; focus is the outline ring. Two meanings in one appearance means neither reads.
- **Don't** print JSON at a person, and don't flatten a multi-step run into one sentence.
  The steps and their outputs are the product.
- **Don't** introduce a second easing curve, a second radius scale, or a font size outside
  the ramp because one component "needs" it.
- **Don't** animate `height`, `width` or `top` on anything that runs continuously — scale
  and translate a fixed box instead.
- **Don't** copy the glows, pill radii or saturated pinks and cyans from the `mcl-*` and
  `ds-*` blocks in `globals.css`. Those are individual apps' local vocabularies, not this
  system.
