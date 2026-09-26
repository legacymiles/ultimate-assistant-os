# The sheet UI

One tall production document, dark studio chrome around paper-white stock. The reason it reads as
professional is not decoration — it is that the layout is a call sheet's layout, the type is
technical (monospace caps headers, tight letter-spacing, thin rules), and the pictures are large
enough to actually judge.

## Layout

```
┌ toolbar ── "Shot plan · 4 cuts · 15s" + editable title ──── Draw missing | Sheet | Brief | ▶ Create video ┐
├──────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ SHARED CHOICES | Cut Count: 4 | Aspect: 16:9 | Lighting: WARM AMBER | Lens: ANAMORPHIC PRIME |            │
│                  Palette: ▪▪▪▪▪ warm amber + cobalt… | Environment Fingerprint: …                         │
├────────────────────────────────┬─────────────────────────────────────────────────────────────────────────┤
│ SECTION 1: CHARACTER /         │ SECTION 2: ENVIRONMENT / SET DESIGN                                     │
│ PRODUCT REFERENCE              │  [ plate 16:9 ] [ plate 16:9 ]                                          │
│  GIRL                          │  ───────────────────────────────────────────                            │
│  [ 1:1 turnaround sheet ]      │  TOP-DOWN FLOOR PLAN            | CUT 4 — SIDE ELEVATION (ARC)          │
│  ▪▪▪▪ swatches                 │  [ floor plan 16:9, 3fr ]       | [ elevation 3:4, 1fr ]                │
│  look…  wardrobe…              │  ① Cut 1: DOLLY-IN ② Cut 2: …   |                                       │
│  NOIRÉ BAR                     │  ───────────────────────────────────────────                            │
│  [ 16:9 product sheet ]        │  SET NOTES …            PROPS …                                         │
│  1. FRONT 2. 3/4 3. SIDE …     │                                                                         │
│  TEXTURE: …  FINISH: …         │                                                                         │
├────────────────────────────────┴─────────────────────────────────────────────────────────────────────────┤
│ SECTION 3: STORYBOARD (4 SEQUENTIAL CUTS · 15s)                                        [+ add cut]       │
│ ┌ Cut 1  ‹ › ✎ 🗑 ┐ ┌ Cut 2 ┐ ┌ Cut 3 ┐ ┌ Cut 4 ┐                                                        │
│ │ [ big frame  ]  │ …                                                                                    │
│ │ 50mm anamorphic | f/2 | 4s | DOLLY-IN | WIDE                                                            │
│ │ caption, editable…                                                                                      │
├──────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ SECTION 4: LIGHTING / MOOD / STYLE NOTES                                                                  │
│ [4:3][4:3][4:3][4:3]  | MOOD KEYWORDS (italic serif)  | CINEMATOGRAPHY NOTES                              │
│  captions…            | STYLE ESSENCE                 | SOUND · MUSIC                                     │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────┘
        ▲ Happy with the storyboard?   [Edit with AI]  [▶ Create video]        │ director chat docked right │
```

Sections 1 and 2 sit side by side (`grid-template-columns: minmax(0,1fr) minmax(0,1.15fr)`); sections
3 and 4 run full width. Below ~1100px everything stacks. The director chat is a docked column beside
the sheet, not a modal — the user reads the sheet while they ask for changes.

## The rules that make it feel right

**Big images.** Every panel is a full-column box with a fixed `aspect-ratio` and `object-fit: cover`:
16:9 for plates, floor plan, product sheets and cut frames; 1:1 for character sheets; 3:4 for the
elevation; 4:3 for lighting. Cut cards are `repeat(auto-fit, minmax(200px, 1fr))` so four cuts fill
the row at full width and wrap on a laptop — never a fixed thumbnail strip.

**Edit in place, commit on blur.** One `Editable` component used for every string on the sheet: an
`input` or `textarea` that is transparent and borderless until hovered (faint rule + white wash),
focused shows a white field and an accent border. It keeps a local draft and only calls `onChange` on
blur, so React doesn't re-render the plan on every keystroke. Textarea rows are computed from the
content length so long descriptions never scroll inside a tiny box.

**Every picture is redrawable.** A `Recreate image` button pinned bottom-right of each panel, hidden
until hover (always visible when the panel is idle or errored). It redraws that one panel from the
current text — which is the loop the user actually lives in: fix the wardrobe line, redraw the sheet,
redraw the two cuts that show it.

**State is visible.** `drawing` paints a diagonal hatch and a spinner in the box; `error` shows the
message in the box with the redraw button showing; a placeholder image carries an `offline preview`
badge top-left. The toolbar shows `drawing N panels…`, or a `Draw N missing` button when some failed.

**Caps + monospace for anything technical.** Section titles, the `ss-h` sub-headers, the cut spec
line, the cut number chip (white on near-black), the legend markers. Body text is Inter at 10.5px;
mood keywords are italic Georgia at 15px. That contrast — machine type for facts, book type for
feeling — is most of the character of the sheet.

**Section 1's title flips with the content:** `CHARACTER REFERENCE`, `PRODUCT / HERO OBJECT
REFERENCE`, or `CHARACTER + PRODUCT REFERENCE`.

## The cut card

Head: the cut number chip, then reorder ‹ ›, edit ✎, delete 🗑. Body: the frame, the spec line, the
editable caption. The ✎ opens an inline two-column form below the card — lens, aperture, move,
framing, seconds, set, cast checkboxes, action, dialogue, position on the floor plan — with the hint
*"Edits change the video prompt immediately; hit Redraw on the frame to update the picture."* That
sentence prevents the most common confusion: text and picture are deliberately decoupled, because
redrawing costs money.

## Export: the sheet as one image

A "Sheet" button composes the whole document onto a canvas at ~2200px wide and stores it as a media
id: paper background, the shared-choices strip, all four sections with their images and wrapped
captions. It is both the thing the user downloads and **the reference attached to the video
generation** — which is why it must be regenerated (and `sheetMediaId` cleared) whenever any panel or
any text changes.

## CSS worth copying

```css
.ss {
  --ss-bg: #0a0a0c; --ss-panel: #121317; --ss-panel-2: #191a20; --ss-line: #26272f;
  --ss-ink: #ecebe6; --ss-ink-2: #a8a8a3; --ss-ink-3: #6f6f6c; --ss-brand: #6366f1;
  --ss-paper: #f7f6f2; --ss-paper-2: #ecebe5; --ss-paper-line: #cfcdc4;
  --ss-paper-ink: #1b1b1b; --ss-paper-ink-2: #4a4a48;
  --ss-mono: "JetBrains Mono", ui-monospace, Menlo, Consolas, monospace;
  --ss-display: "Anton", "Oswald", "Bebas Neue", Impact, "Arial Narrow", sans-serif;
  background: var(--ss-bg); color: var(--ss-ink); font-size: 13px;
}

.ss-sheet {                                  /* the paper */
  background: var(--ss-paper); color: var(--ss-paper-ink);
  border-radius: 6px; padding: 14px; display: flex; flex-direction: column; gap: 14px;
  box-shadow: 0 30px 80px rgba(0, 0, 0, 0.5);
  font-family: "Inter", system-ui, sans-serif;
}
.ss-strip {                                  /* shared choices */
  display: flex; flex-wrap: wrap; align-items: center; gap: 8px 18px;
  padding: 6px 10px; border: 1px solid var(--ss-paper-line);
  font-size: 11px; font-style: italic; color: var(--ss-paper-ink-2);
}
.ss-strip b { font-style: normal; font-weight: 600; color: var(--ss-paper-ink); margin-right: 4px; }

.ss-row2 { display: grid; grid-template-columns: minmax(0,1fr) minmax(0,1.15fr); gap: 14px; }
.ss-section { border: 1px solid var(--ss-paper-line); padding: 10px; display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.ss-section h3 {
  font-family: var(--ss-mono); font-size: 10.5px; letter-spacing: 0.1em; font-weight: 700;
  margin: 0; padding-bottom: 6px; border-bottom: 1px solid var(--ss-paper-line);
  display: flex; justify-content: space-between; align-items: center;
}
.ss-h { font-family: var(--ss-mono); font-size: 9.5px; letter-spacing: 0.08em; font-weight: 700; }
.ss-small { font-size: 10.5px; color: var(--ss-paper-ink-2); }

/* editable-in-place */
.ss-editable {
  background: transparent; border: 1px solid transparent; border-radius: 4px;
  color: inherit; font: inherit; padding: 2px 4px; width: 100%; resize: vertical; line-height: 1.4;
}
.ss-editable:hover { border-color: var(--ss-paper-line); background: rgba(255,255,255,0.5); }
.ss-editable:focus { outline: none; border-color: var(--ss-brand); background: #fff; }

/* images: big, fixed aspect, never a thumbnail */
.ss-img { position: relative; width: 100%; aspect-ratio: 16/9; background: var(--ss-paper-2); border: 1px solid var(--ss-paper-line); overflow: hidden; }
.ss-img.is-square { aspect-ratio: 1; }
.ss-img.is-tall { aspect-ratio: 3/4; }
.ss-img img { width: 100%; height: 100%; object-fit: cover; display: block; }
.ss-img.drawing .ss-img-empty { background: repeating-linear-gradient(-45deg, #ecebe5 0 8px, #e2e1da 8px 16px); }
.ss-redraw { position: absolute; right: 6px; bottom: 6px; background: rgba(0,0,0,0.7); color: #fff;
  font-family: var(--ss-mono); font-size: 9px; letter-spacing: 0.06em; padding: 4px 7px; border: 0; border-radius: 6px;
  opacity: 0; transition: opacity 0.15s; }
.ss-img:hover .ss-redraw, .ss-img.error .ss-redraw, .ss-img.idle .ss-redraw { opacity: 1; }

.ss-chars, .ss-envs { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 10px; }
.ss-plan  { display: grid; grid-template-columns: minmax(0,3fr) minmax(0,1fr); gap: 10px;
            border-top: 1px solid var(--ss-paper-line); padding-top: 10px; }
.ss-cuts  { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; }
.ss-cutno { background: var(--ss-paper-ink); color: #fff; font-family: var(--ss-mono); font-size: 9.5px; letter-spacing: 0.08em; padding: 2px 7px; }
.ss-cut-spec { font-family: var(--ss-mono); font-size: 9px; letter-spacing: 0.04em; font-weight: 700; }
.ss-swatches span { flex: 1; height: 14px; border: 1px solid rgba(0,0,0,0.15); }
.ss-notes { display: grid; grid-template-columns: minmax(0,1.4fr) minmax(0,1fr) minmax(0,1fr); gap: 12px; }
.ss-lights { display: grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap: 6px; }
.ss-light .ss-img { aspect-ratio: 4/3; }
.ss-moodwords { font-family: Georgia, serif; font-style: italic; font-size: 15px; line-height: 1.7; color: var(--ss-paper-ink); }

@media (max-width: 1100px) { .ss-row2, .ss-notes { grid-template-columns: 1fr; } .ss-plan { grid-template-columns: 1fr; } .ss-lights { grid-template-columns: repeat(2, 1fr); } }
```

Scope everything under one class so the sheet's paper tokens never leak into the surrounding app.

## The footer

Under the sheet, the decision bar: *"Happy with the storyboard?"* with **Edit with AI** (focuses the
chat input) and **Create video** (disabled while panels are drawing). One decision, two doors — and
the primary action is never buried in a toolbar.
