---
name: capcut-design
description: Design system skill for capcut. Activate when building UI components, pages, or any visual elements. Provides exact color tokens, typography scale, spacing grid, component patterns, and craft rules. Read references/DESIGN.md before writing any CSS or JSX.
---

# capcut Design System

You are building UI for **capcut**. Light-themed, cool palette, sans-serif typography (Inter Medium), compact density on a 4px grid, expressive motion.

## Visual Reference

**IMPORTANT**: Study ALL screenshots below before writing any UI. Match colors, typography, spacing, layout, and motion exactly as shown.

### Homepage

![capcut Homepage](screenshots/homepage.png)

> Read `references/DESIGN.md` for full token details.

## Design Philosophy

- **Layered depth** — use shadow tokens to create a sense of physical layering. Each elevation level has a specific shadow.
- **Gradient accents** — gradients are used thoughtfully for emphasis, not decoration.
- **Type pairing** — Inter Medium for body/UI text, Inter Regular for headings/display. Never introduce a third typeface.
- **compact density** — 4px base grid. Every dimension is a multiple of 4.
- **cool palette** — the color temperature runs cool, matching the sans-serif typography.
- **Restrained accent** — `#00cae0` is the only pop of color. Used exclusively for CTAs, links, focus rings, and active states.
- **Expressive motion** — animations are an integral part of the experience. Use spring physics and layout animations.

## Color System

### Core Palette

| Role | Token | Hex | Use |
|------|-------|-----|-----|
| Background | `--background` | `#ffffff` | Page/app background |
| Surface | `--surface` | `#edf1ff` | Cards, panels, modals |
| Text Primary | `--text-primary` | `#090c14` | Headings, body text |
| Text Muted | `--text-muted` | `#1c283d` | Captions, placeholders |
| Accent | `--accent` | `#00cae0` | CTAs, links, focus rings |
| Border | `--border` | `#202123` | Dividers, card borders |

### Extended Palette

- **awesome-active-icon-color:** `#000000` — Deep background layer or shadow color
- **awesome-footer-policy-text:** `#bdd1db`
- **awesome-text-divider:** `#111a20` — Deep background layer or shadow color
- `#40daf5`
- `#e8e8ed` — Light surface or highlight color
- **btn-background-color:** `#283f59`
- `#01e0f8`
- `#57d5ff`

### CSS Variable Tokens

```css
--awesome-background-color: #fff;
--awesome-text-primary: #090c14;
--awesome-text-negative-primary: #fdfffe;
--awesome-text-secondary: #1c283d80;
--awesome-header-card-bg-color: #f4f7fb;
--btn-background-color: var(--awesome-fill-bg-0);
--btn-background-color: #424242;
--btn-background-color: var(--awesome-fill-bg-1);
--btn-background-color: rgba(40,63,89,.16);
--wap-card-media-h: 213px;
--wap-card-title-mt: 16px;
--wap-card-title-h: 19.2px;
--wap-card-title-mb: 8px;
--wap-card-subtitle-h: 70px;
--btn-border-radius: 8px;
--btn-background: #fff;
--btn-border-color: #fff;
--btn-mask-background-color: #000;
--btn-background: #000;
--btn-border-color: #bdd1db80;
```

## Typography

### Font Stack

- **Inter Medium** — Heading 1, Heading 2, Heading 3
- **Inter Regular** — Body, Caption

### Font Sources

```css
@font-face {
  font-family: "Inter Bold";
  src: url("fonts/InterBold-700.woff2") format("woff2");
  font-weight: 700;
}
@font-face {
  font-family: "Inter SemiBold";
  src: url("fonts/InterSemiBold-600.woff2") format("woff2");
  font-weight: 600;
}
@font-face {
  font-family: "Inter Medium";
  src: url("fonts/InterMedium-500.woff2") format("woff2");
  font-weight: 500;
}
@font-face {
  font-family: "Inter Regular";
  src: url("fonts/InterRegular-Regular.woff2") format("woff2");
  font-weight: 400;
}
@font-face {
  font-family: "Albert Sans ExtraBold";
  src: url("fonts/AlbertSansExtraBold-800.ttf") format("truetype");
  font-weight: 800;
}
@font-face {
  font-family: "Albert Sans Bold";
  src: url("fonts/AlbertSansBold-700.ttf") format("truetype");
  font-weight: 700;
}
@font-face {
  font-family: "Albert Sans SemiBold";
  src: url("fonts/AlbertSansSemiBold-600.ttf") format("truetype");
  font-weight: 600;
}
@font-face {
  font-family: "Albert Sans Medium";
  src: url("fonts/AlbertSansMedium-500.ttf") format("truetype");
  font-weight: 500;
}
@font-face {
  font-family: "Albert Sans Regular";
  src: url("fonts/AlbertSansRegular-Regular.ttf") format("truetype");
  font-weight: 400;
}
```

### Type Scale

| Role | Family | Size | Weight |
|------|--------|------|--------|
| Heading 1 | Inter Medium | 72px | 700 |
| Heading 2 | Inter Medium | 68px | 700 |
| Heading 3 | Inter Medium | 64px | 700 |
| Body | Inter Regular | 14px | 400 |
| Caption | Inter Regular | 16px | 400 |

### Typography Rules

- Body/UI: **Inter Medium**, Headings: **Inter Regular** — these are the only display fonts
- Max 3-4 font sizes per screen
- Headings: weight 600-700, body: weight 400
- Use color and opacity for text hierarchy, not additional font sizes
- Line height: 1.5 for body, 1.2 for headings

## Spacing & Layout

### Base Grid: 4px

Every dimension (margin, padding, gap, width, height) must be a multiple of **4px**.

### Spacing Scale

`2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24` px

### Spacing as Meaning

| Spacing | Use |
|---------|-----|
| 4-8px | Tight: related items (icon + label, avatar + name) |
| 12-16px | Medium: between groups within a section |
| 24-32px | Wide: between distinct sections |
| 48px+ | Vast: major page section breaks |

### Border Radius

Scale: `1px, 2px, 3.667px, 3.67px, 4px, 6px, 8, 8px, 10px, 12px, 12px 12px 0px 0px, 14px, 15px, 16px, 18px, 20px, 28px, 32px, unset, 24px, 33px, 36px, 40px, 100%, 100px, 120px`
Default: `16px`

### Container

Max-width: `1024px`, centered with auto margins.

### Breakpoints

| Name | Value |
|------|-------|
| xs | 436px |
| xs | 480px |
| sm | 481px |
| sm | 600px |
| sm | 640px |
| md | 767px |
| md | 768px |
| lg | 960px |
| lg | 961px |
| lg | 1023px |
| lg | 1024px |
| xl | 1025px |
| xl | 1200px |
| xl | 1201px |
| xl | 1240px |
| xl | 1260px |
| xl | 1279px |
| xl | 1280px |
| 2xl | 1281px |
| 2xl | 1320px |
| 2xl | 1321px |
| 2xl | 1439px |
| 2xl | 1440px |
| 2xl | 1441px |
| 2xl | 1520px |
| 2xl | 1521px |
| 2xl | 1920px |
| 2xl | 1921px |

Mobile-first: design for small screens, layer on responsive overrides.

## Component Patterns

### Card

```css
.card {
  background: #edf1ff;
  border: 1px solid #202123;
  border-radius: 16px;
  padding: 16px;
  box-shadow: inset 0-1px 0 0 hsla(0,0%,100%,.2);
}
```

```html
<div class="card">
  <h3>Card Title</h3>
  <p>Card content goes here.</p>
</div>
```

### Button

```css
/* Primary */
.btn-primary {
  background: #00cae0;
  color: #090c14;
  border-radius: 16px;
  padding: 8px 16px;
  font-weight: 500;
  transition: opacity 150ms ease;
}
.btn-primary:hover { opacity: 0.9; }

/* Ghost */
.btn-ghost {
  background: transparent;
  border: 1px solid #202123;
  color: #090c14;
  border-radius: 16px;
  padding: 8px 16px;
}
```

```html
<button class="btn-primary">Get Started</button>
<button class="btn-ghost">Learn More</button>
```

### Input

```css
.input {
  background: #ffffff;
  border: 1px solid #202123;
  border-radius: 16px;
  padding: 8px 12px;
  color: #090c14;
  font-size: 14px;
}
.input:focus { border-color: #00cae0; outline: none; }
```

```html
<input class="input" type="text" placeholder="Search..." />
```

### Badge / Chip

```css
.badge {
  display: inline-flex;
  align-items: center;
  padding: 4px 8px;
  border-radius: 9999px;
  font-size: 12px;
  font-weight: 500;
  background: #edf1ff;
  color: #1c283d;
}
```

```html
<span class="badge">New</span>
<span class="badge">Beta</span>
```

### Modal / Dialog

```css
.modal-backdrop { background: rgba(0, 0, 0, 0.6); }
.modal {
  background: #edf1ff;
  border: 1px solid #202123;
  border-radius: 120px;
  padding: 24px;
  max-width: 480px;
  width: 90vw;
  box-shadow: 0 6px 16px 0 rgba(4,4,4,.059);
}
```

```html
<div class="modal-backdrop">
  <div class="modal">
    <h2>Dialog Title</h2>
    <p>Dialog content.</p>
    <button class="btn-primary">Confirm</button>
    <button class="btn-ghost">Cancel</button>
  </div>
</div>
```

### Table

```css
.table { width: 100%; border-collapse: collapse; }
.table th {
  text-align: left;
  padding: 8px 12px;
  font-weight: 500;
  font-size: 12px;
  color: #1c283d;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  border-bottom: 1px solid #202123;
}
.table td {
  padding: 12px;
  border-bottom: 1px solid #202123;
}
```

```html
<table class="table">
  <thead><tr><th>Name</th><th>Status</th><th>Date</th></tr></thead>
  <tbody>
    <tr><td>Item One</td><td>Active</td><td>Jan 1</td></tr>
    <tr><td>Item Two</td><td>Pending</td><td>Jan 2</td></tr>
  </tbody>
</table>
```

### Navigation

```css
.nav {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  border-bottom: 1px solid #202123;
}
.nav-link {
  color: #1c283d;
  padding: 8px 12px;
  border-radius: 16px;
  transition: color 150ms;
}
.nav-link:hover { color: #090c14; }
.nav-link.active { color: #00cae0; }
```

```html
<nav class="nav">
  <a href="/" class="nav-link active">Home</a>
  <a href="/about" class="nav-link">About</a>
  <a href="/pricing" class="nav-link">Pricing</a>
  <button class="btn-primary" style="margin-left: auto">Get Started</button>
</nav>
```

### Extracted Components

These components were found in the codebase:

**Button** (`html`)
- Variants: `c2887`

**Card** (`html`)
- Variants: `LLJ0Zm`, `image-box-nOsaiT`, `image-ElYn5L`, `title-EeRfiI`, `subtitle-fhsqBd`

**Navigation** (`html`)

## Page Structure

The following page sections were detected:

- **Navigation** — Top navigation bar (6 items)
- **Hero** — Hero section (detected from heading structure)
- **Footer** — Page footer with links and info (51 items)
- **Faq** — FAQ/accordion section
- **Hero** — Hero/banner section with headline and CTAs
- **Cta** — Call-to-action section
- **Cards** — Grid of 30 card elements (30 items)
- **Features** — Feature/benefit cards grid (30 items)

When building pages, follow this section order and structure.

## Animation & Motion

This project uses **expressive motion**. Animations are part of the design language.

### CSS Animations

- `xcannc`
- `MnK_85`
- `fade-in`
- `fade-out`
- `uMCYK0`

### Motion Tokens

- **Duration scale:** `0ms`, `.01s`, `.15s`, `.2s`, `.25s`, `.3s`, `.4s`, `.5s`, `.6s`, `10ms`, `100ms`, `150ms`, `200ms`, `220ms`, `240ms`, `250ms`, `300ms`, `350ms`, `400ms`, `500ms`, `2500ms`
- **Easing functions:** `ease-in-out`, `ease`, `cubic-bezier(.4,0,.6,1)`, `cubic-bezier(0,1.1,0,1.1)`, `linear`, `cubic-bezier(.22,1,.36,1)`, `ease-out`, `cubic-bezier(.25,1.02,.5,1)`

### Motion Guidelines

- **Duration:** Use values from the duration scale above. Short (0ms) for micro-interactions, long (2500ms) for page transitions
- **Easing:** Use `ease-in-out` as the default easing curve
- **Direction:** Elements enter from bottom/right, exit to top/left
- **Reduced motion:** Always respect `prefers-reduced-motion` — disable animations when set

## Depth & Elevation

### Shadow Tokens

- Subtle: `inset 0-1px 0 0 hsla(0,0%,100%,.2)`
- Subtle: `rgba(255, 255, 255, 0.2) 0px -1px 0px 0px inset`
- Floating (dropdowns, popovers): `0 6px 16px 0 rgba(4,4,4,.059)`
- Floating (dropdowns, popovers): `0 4px 12px rgba(0,0,0,.05)`
- Overlay (modals, dialogs): `0 32px 64px -8px hsla(0,0%,100%,.8),0 0 80px 20px hsla(0,0%,100%,.6)`
- Overlay (modals, dialogs): `inset 0 0 20px 2px rgba(133,127,255,.4),0 0 40px 0 rgba(20,224,255,.24)`

### Z-Index Scale

`0, 1, 2, 3, 999`

Use these exact values — never invent z-index values.

## Anti-Patterns (Never Do)

- **No blur effects** — no backdrop-blur, no filter: blur()
- **No zebra striping** — tables and lists use borders for separation
- **No invented colors** — every hex value must come from the palette above
- **No arbitrary spacing** — every dimension is a multiple of 4px
- **No extra fonts** — only Inter Medium and Inter Regular are allowed
- **No arbitrary border-radius** — use the scale: 1px, 2px, 3.667px, 3.67px, 4px, 6px, 8, 8px, 10px, 12px
- **No opacity for disabled states** — use muted colors instead

## Workflow

1. **Read** `references/DESIGN.md` before writing any UI code
2. **Pick colors** from the Color System section — never invent new ones
3. **Set typography** — Inter Medium, Inter Regular only, using the type scale
4. **Build layout** on the 4px grid — check every margin, padding, gap
5. **Match components** to patterns above before creating new ones
6. **Apply elevation** — use shadow tokens
7. **Validate** — every value traces back to a design token. No magic numbers.

## Brand Spec

- **Favicon:** `https://sf16-web-tos-buz.capcutcdn-us.com/obj/capcut-web-buz-tx/common/images/lv_web-2.ico`
- **Site URL:** `https://www.capcut.com`
- **Brand color:** `#00cae0`
- **Brand typeface:** Inter Medium

## Quick Reference

```
Background:     #ffffff
Surface:        #edf1ff
Text:           #090c14 / #1c283d
Accent:         #00cae0
Border:         #202123
Font:           Inter Medium
Spacing:        4px grid
Radius:         16px
Components:     9 detected
```

## When to Trigger

Activate this skill when:
- Creating new components, pages, or visual elements for capcut
- Writing CSS, Tailwind classes, styled-components, or inline styles
- Building page layouts, templates, or responsive designs
- Reviewing UI code for design consistency
- The user mentions "capcut" design, style, UI, or theme
- Generating mockups, wireframes, or visual prototypes

---

# Full Reference Files

> Every output file is embedded below. Claude has full design system context from /skills alone.

## Design System Tokens (DESIGN.md)

# capcut DESIGN.md

> Auto-generated design system — reverse-engineered via static analysis by skillui.
> Frameworks: None detected
> Colors: 20 · Fonts: 2 · Components: 9
> Icon library: not detected · State: not detected
> Primary theme: light · Dark mode toggle: no · Motion: expressive

## Visual Reference

**Match this design exactly** — study colors, fonts, spacing, and component shapes before writing any UI code.

![capcut Homepage](../screenshots/homepage.png)

---

## 1. Visual Theme & Atmosphere

This is a **light-themed** interface with a cool, approachable feel. The light background emphasizes content clarity. Typography pairs **Inter Regular** for display/headings with **Inter Medium** for body text, creating clear visual hierarchy through type contrast. Spacing follows a **4px base grid** (compact density), with scale: 2, 4, 6, 8, 10, 12, 14, 16px. The palette is predominantly monochromatic with **#00cae0** as the single accent color — used sparingly for interactive elements and emphasis. Motion is expressive — spring physics, layout animations, and staggered reveals are part of the visual language.

---

## 2. Color Palette & Roles

| Token | Hex | Role | Use |
|---|---|---|---|
| awesome-background-color | `#ffffff` | background | Page background, darkest surface |
| awesome-header-card-bg-color | `#edf1ff` | surface | Card and panel backgrounds |
| awesome-text-primary | `#090c14` | text-primary | Headings and body text |
| awesome-text-secondary | `#1c283d` | text-muted | Captions, placeholders, secondary info |
| su-color-text-3 | `#54545c` | text-muted | Captions, placeholders, secondary info |
| border | `#202123` | border | Dividers, card borders, outlines |
| cms-text-color-hover | `#00cae0` | accent | CTAs, links, focus rings, active states |
| awesome-text-divider | `#111a20` | info | Informational highlights |
| awesome-active-icon-color | `#000000` | unknown | Palette color |
| awesome-footer-policy-text | `#bdd1db` | unknown | Palette color |
| unknown | `#40daf5` | unknown | Palette color |
| unknown | `#e8e8ed` | unknown | Palette color |
| btn-background-color | `#283f59` | unknown | Palette color |
| unknown | `#01e0f8` | unknown | Palette color |
| unknown | `#57d5ff` | unknown | Palette color |
| unknown | `#00e5db` | unknown | Palette color |
| unknown | `#18e9c7` | unknown | Palette color |
| su-color-text-4 | `#757580` | unknown | Palette color |
| unknown | `#bef3ff` | unknown | Palette color |
| unknown | `#2f3036` | unknown | Palette color |

### CSS Variable Tokens

```css
--awesome-background-color: #fff;
--awesome-text-primary: #090c14;
--awesome-text-negative-primary: #fdfffe;
--awesome-text-secondary: #1c283d80;
--awesome-header-card-bg-color: #f4f7fb;
--btn-background-color: var(--awesome-fill-bg-0);
--btn-background-color: #424242;
--btn-background-color: var(--awesome-fill-bg-1);
--btn-background-color: rgba(40,63,89,.16);
--wap-card-media-h: 213px;
--wap-card-title-mt: 16px;
--wap-card-title-h: 19.2px;
--wap-card-title-mb: 8px;
--wap-card-subtitle-h: 70px;
--btn-border-radius: 8px;
--btn-background: #fff;
--btn-border-color: #fff;
--btn-mask-background-color: #000;
--btn-background: #000;
--btn-border-color: #bdd1db80;
```


---

## 3. Typography Rules

**Font Stack:**
- **Inter Medium** — Heading 1, Heading 2, Heading 3
- **Inter Regular** — Body, Caption

**Font Sources:**

```css
@font-face {
  font-family: "Inter Bold";
  src: url("fonts/InterBold-700.woff2") format("woff2");
  font-weight: 700;
}
@font-face {
  font-family: "Inter SemiBold";
  src: url("fonts/InterSemiBold-600.woff2") format("woff2");
  font-weight: 600;
}
@font-face {
  font-family: "Inter Medium";
  src: url("fonts/InterMedium-500.woff2") format("woff2");
  font-weight: 500;
}
@font-face {
  font-family: "Inter Regular";
  src: url("fonts/InterRegular-Regular.woff2") format("woff2");
  font-weight: 400;
}
@font-face {
  font-family: "Albert Sans ExtraBold";
  src: url("fonts/AlbertSansExtraBold-800.ttf") format("truetype");
  font-weight: 800;
}
@font-face {
  font-family: "Albert Sans Bold";
  src: url("fonts/AlbertSansBold-700.ttf") format("truetype");
  font-weight: 700;
}
@font-face {
  font-family: "Albert Sans SemiBold";
  src: url("fonts/AlbertSansSemiBold-600.ttf") format("truetype");
  font-weight: 600;
}
@font-face {
  font-family: "Albert Sans Medium";
  src: url("fonts/AlbertSansMedium-500.ttf") format("truetype");
  font-weight: 500;
}
@font-face {
  font-family: "Albert Sans Regular";
  src: url("fonts/AlbertSansRegular-Regular.ttf") format("truetype");
  font-weight: 400;
}
```

| Role | Font | Size | Weight |
|---|---|---|---|
| Heading 1 | Inter Medium | 72px | 700 |
| Heading 2 | Inter Medium | 68px | 700 |
| Heading 3 | Inter Medium | 64px | 700 |
| Body | Inter Regular | 14px | 400 |
| Caption | Inter Regular | 16px | 400 |

**Typographic Rules:**
- Limit to 2 font families max per screen
- Use **Inter Medium** for body/UI text, **Inter Regular** for display/headings
- Maintain consistent hierarchy: no more than 3-4 font sizes per screen
- Headings use bold (600-700), body uses regular (400)
- Line height: 1.5 for body text, 1.2 for headings
- Use color and opacity for secondary hierarchy, not additional font sizes


---

## 4. Component Stylings

### Layout (1)

**Footer** — `html`

### Navigation (1)

**Navigation** — `html`

### Data Display (2)

**Card** — `html`
- Variants: `LLJ0Zm`, `image-box-nOsaiT`, `image-ElYn5L`, `title-EeRfiI`, `subtitle-fhsqBd`

**List** — `html`

### Data Input (2)

**Button** — `html`
- Variants: `c2887`
- Animation: 

**Input** — `html`
- State: :focus, :placeholder

### Overlay (1)

**Modal** — `html`

### Media (2)

**Image** — `html`

**Icon** — `html`



---

## 5. Layout Principles

- **Base spacing unit:** 4px
- **Spacing scale:** 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24
- **Border radius:** 1px, 2px, 3.667px, 3.67px, 4px, 6px, 8, 8px, 10px, 12px, 12px 12px 0px 0px, 14px, 15px, 16px, 18px, 20px, 28px, 32px, unset, 24px, 33px, 36px, 40px, 100%, 100px, 120px
- **Max content width:** 1024px

**Spacing as Meaning:**
| Spacing | Use |
|---|---|
| 4-8px | Tight: related items within a group |
| 12-16px | Medium: between groups |
| 24-32px | Wide: between sections |
| 48px+ | Vast: major section breaks |


---

## 6. Depth & Elevation

### Flat — subtle depth hints

- `inset 0-1px 0 0 hsla(0,0%,100%,.2)`
- `rgba(255, 255, 255, 0.2) 0px -1px 0px 0px inset`

### Floating — dropdowns, popovers, modals

- `0 6px 16px 0 rgba(4,4,4,.059)`
- `0 4px 12px rgba(0,0,0,.05)`

### Overlay — full-screen overlays, top-level dialogs

- `0 32px 64px -8px hsla(0,0%,100%,.8),0 0 80px 20px hsla(0,0%,100%,.6)`
- `inset 0 0 20px 2px rgba(133,127,255,.4),0 0 40px 0 rgba(20,224,255,.24)`
- `0 4px 30px rgba(0,0,0,.1)`

### Z-Index Scale

`0, 1, 2, 3, 999`



---

## 7. Animation & Motion

This project uses **expressive motion**. Animations are an integral part of the experience.

### CSS Animations

- `@keyframes xcannc`
- `@keyframes MnK_85`
- `@keyframes fade-in`
- `@keyframes fade-out`
- `@keyframes uMCYK0`
- `@keyframes Jdwj9X`
- `@keyframes QIN1ST`
- `@keyframes qOd1Yd`

### Animated Components

- **Button**: 

### Motion Guidelines

- Duration: 150-300ms for micro-interactions, 300-500ms for page transitions
- Easing: `ease-out` for enters, `ease-in` for exits
- Always respect `prefers-reduced-motion`


---

## 8. Do's and Don'ts

### Do's

- Use `#00cae0` for interactive elements (buttons, links, focus rings)
- Use `#ffffff` as the primary page background
- Pair **Inter Medium** (body) with **Inter Regular** (display) — these are the only allowed fonts
- Follow the **4px** spacing grid for all margins, padding, and gaps
- Use the defined shadow tokens for elevation — see Section 6
- Use border-radius from the scale: 1px, 2px, 3.667px, 3.67px, 4px
- Reuse existing components from Section 4 before creating new ones

### Don'ts

- Don't introduce colors outside this palette — extend the design tokens first
- Don't introduce additional font families beyond Inter Medium and Inter Regular
- Don't use arbitrary spacing values — stick to multiples of 4px
- Don't create custom box-shadow values outside the system tokens
- Don't use arbitrary border-radius values — pick from the defined scale
- Don't duplicate component patterns — check Section 4 first
- Don't use backdrop-blur or blur effects

### Anti-Patterns (detected from codebase)

- No blur or backdrop-blur effects
- No zebra striping on tables/lists


---

## 9. Responsive Behavior

| Name | Value | Source |
|---|---|---|
| xs | 436px | css |
| xs | 480px | css |
| sm | 481px | css |
| sm | 600px | css |
| sm | 640px | css |
| md | 767px | css |
| md | 768px | css |
| lg | 960px | css |
| lg | 961px | css |
| lg | 1023px | css |
| lg | 1024px | css |
| xl | 1025px | css |
| xl | 1200px | css |
| xl | 1201px | css |
| xl | 1240px | css |
| xl | 1260px | css |
| xl | 1279px | css |
| xl | 1280px | css |
| 2xl | 1281px | css |
| 2xl | 1320px | css |
| 2xl | 1321px | css |
| 2xl | 1439px | css |
| 2xl | 1440px | css |
| 2xl | 1441px | css |
| 2xl | 1520px | css |
| 2xl | 1521px | css |
| 2xl | 1920px | css |
| 2xl | 1921px | css |

**Approach:** Use `@media (min-width: ...)` queries matching the breakpoints above.


---

## 10. Agent Prompt Guide

Use these as starting points when building new UI:

### Build a Card

```
Background: #edf1ff
Border: 1px solid #202123
Radius: 16px
Padding: 16px
Font: Inter Medium
Use shadow tokens from Section 6.
```

### Build a Button

```
Primary: bg #00cae0, text white
Ghost: bg transparent, border #202123
Padding: 8px 16px
Radius: 16px
Hover: opacity 0.9 or lighter shade
Focus: ring with #00cae0
```

### Build a Page Layout

```
Background: #ffffff
Max-width: 1024px, centered
Grid: 4px base
Responsive: mobile-first, breakpoints from Section 9
```

### Build a Stats Card

```
Surface: #edf1ff
Label: #1c283d (muted, 12px, uppercase)
Value: #090c14 (primary, 24-32px, bold)
Status: use success/warning/danger from Section 2
```

### Build a Form

```
Input bg: #ffffff
Input border: 1px solid #202123
Focus: border-color #00cae0
Label: #1c283d 12px
Spacing: 16px between fields
Radius: 16px
```

### General Component

```
1. Read DESIGN.md Sections 2-6 for tokens
2. Colors: only from palette
3. Font: Inter Medium, type scale from Section 3
4. Spacing: 4px grid
5. Components: match patterns from Section 4
6. Elevation: shadow tokens
```

## Bundled Fonts (fonts/)

The following font files are bundled in the `fonts/` directory:

- `fonts/AlbertSansBold-700.ttf`
- `fonts/AlbertSansExtraBold-800.ttf`
- `fonts/AlbertSansMedium-500.ttf`
- `fonts/AlbertSansRegular-Regular.ttf`
- `fonts/AlbertSansSemiBold-600.ttf`
- `fonts/InterBold-700.woff2`
- `fonts/InterMedium-500.woff2`
- `fonts/InterRegular-Regular.woff2`
- `fonts/InterSemiBold-600.woff2`

Use these local font files in `@font-face` declarations instead of fetching from Google Fonts.

## Homepage Screenshots (screenshots/)

![homepage.png](screenshots/homepage.png)

