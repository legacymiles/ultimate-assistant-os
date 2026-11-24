# DTF Studio

Route: `/apps/dtf-studio` · Category: Apps · Live

Record reviewed: 2026-11-24 — placement pass: hanging and back mockups recentred, bigger sleeve zone, dotted centre guides with a magnet, artwork held inside its placeholder

> **This file is the truth about this app.** Read it before changing the app and update it in the
> same commit. Everything above the "From the code" block is written by hand and kept; that block
> is rewritten from the code by `npm run apps:records`, and `npm run check:records` (part of
> `npm run verify`) fails when it is stale. Edit prompt: `npm run change-it -- dtf-studio "what to change"`.

## What it does

A customer-facing apparel studio wired to the shop's real Lancelot M1630 Pro DTF printer. Pick a tee, oversized tee, hoodie, crewneck, long sleeve, tank or tote — shown as a real photo recoloured to the fabric, folds and knit intact — upload art or set type and it is pressed into the cloth as you drag, resize and rotate it. A Preview shows it worn, folded, hanging and laid flat, and each picture downloads. An AI designer reads reference pictures and edits the actual layers when you press Apply. A print-readiness engine checks DPI at the real size, transparency, background boxes, soft edges, hairlines, placement and the 290 mm safe width before anyone can pay. Orders land on a production board (DTF Production): approve the artwork, make an artwork-only 300 DPI PNG for ColorboxRIP, gang several onto one sheet, and send them to a Windows print station that files them by order number and tracks opened and printed — it never prints by itself.

## Features

**Customer studio — `/apps/dtf-studio` (public; sign-in to save, ask the AI, and buy)**
- Real-photo garments, Showroom layout (owner's pick, 2026-11-23): a full-bleed light studio stage with the garment photo large in the middle; a floating dark tool dock on the left (Product, Upload, Text, AI, Layers, Check — the selected layer's inspector opens in the same dock); undo/redo, Preview, Designs, Orders and an oversized Add to bag + price pill along the top; zoom in/out/whole-garment and hide-guides buttons on the right.
- Photos: tee (front/back), oversized tee front and hoodie (front/back) are openmerch-engine's MIT photos; crewneck, long sleeve, tank, tote, oversized back and three side/sleeve views were rendered on the owner's GPU with Flux 2 Klein by editing the real tee photo (`public/dtf/garments/`, credits in `CREDITS.md`). Each photo is calibrated (collar point + px per cm from the real garment length) in `src/lib/dtf/mockups.ts`.
- Colour: the fabric is recoloured in the browser from the photo's own shading — colour × shading^γ with γ rising on dark fabric so folds stay visible, a little sheen on dark cloth, fibre speckle on heathers (`src/components/dtf/mockup/photoRender.ts`).
- Print on the cloth: the artwork is multiplied by the fold shading and the knit detail and clipped to the cloth. Drag, corner-resize anchored to the opposite corner, rotate with snapping, drop-to-upload — directly on the photo.
- Filmstrip along the bottom (`data-standout="live-mockups"`): Front / Back / Left sleeve / Right sleeve tiles that switch the side being edited (a dot marks printed sides), then live mockups of the current design — redrawn a moment after every edit.
- Preview page: worn (front and back), folded, hanging, flat lay (tees), worn + hanging (hoodie), worn (crewneck, long sleeve, tank), carried (tote), plus the product shots of printed sides. Scenes are Flux renders of blank white garments with a cloth mask made from a second "recolour it chroma green" render of the same frame; the print is bent through a perspective quad and the fabric's folds. Download mockup saves a 2000 px PNG.
- Bag, saved designs, orders, AI proposal and production-board thumbnails all use the same photo renderer.
- Layers: images and text, duplicate, delete, lock, hide, reorder, numeric position in cm (across / down from collar), undo/redo with drags collapsed into one step, keyboard nudges.
- Text: nine committed OFL fonts, weight, tracking, line height, alignment, caps, italic, ink colour with a contrast warning.
- Placement zones per garment and side: full front, front chest, left/right chest, full back, upper back, sleeve (10 × 10 cm, centred on the outer sleeve), long sleeve, tote faces — boundary shown while editing, hidden in Preview.
- Centre guides and the magnet (2026-11-24): every placeholder carries a dotted cross through its middle. Artwork drags freely anywhere inside the box; within about 9 screen pixels of a centre line it is pulled onto it and the guide brightens, so dead centre is easy to hit and easy to refuse — hold Alt, or keep dragging. Nothing is forced onto a grid.
- Nothing leaves the placeholder (2026-11-24): every edit goes through `containInZone` in the reducer, so a drag, a keyboard nudge, a rotation, a resize, a typed number in the inspector and an applied AI proposal all stop at the boundary. Artwork bigger than the zone — or turned until its corners need more room — is scaled down to fit rather than cropped.
- AI designer (violet): sees garment, colour, layers, zones, readiness and up to four reference pictures; answers with proposals made of DesignOps, each with a rendered thumbnail; Apply changes the real layers as one undo step; original SVG graphics; palettes; built-in offline designer when no model is configured. 60 turns/day per customer.
- Print readiness (`src/lib/dtf/readiness.ts`): effective DPI at print size, transparency, solid-background detection, soft/semi-transparent edges, stroke-width (fine line) analysis, zone fit, safe/max printer width, file type by bytes, empty design. One-click background removal makes a processed copy; Restore original brings the upload back.
- Drafts autosave on the device (IndexedDB for files) and to the account when signed in; Your designs lists them; a bag with per-design size/colour/quantity; checkout through Stripe when keyed, otherwise an order the shop confirms payment for (says so plainly); order tracking with the eight stages.

**Production — `/apps/dtf-production` (owner only)**
- KPI row, a board by stage, and a full order record: mockups, flat previews, customer references, print jobs with a fresh pixel-level readiness pass, press position, payment, shipping, tracking number, production notes, history.
- Approve & make print file: the browser renders the artwork-only PNG at 300 DPI; the server refuses it unless the PNG's pHYs DPI and pixel size match the stated physical size and it fits the printer. Low-resolution sources must be acknowledged by the operator first.
- Print queue: send to station, take back, mark printed / failed, download PNGs, CSV job sheet, gang sheet (300 mm roll or A3/A3+, shelf packing, 90° turns, quantities, nothing scaled) exported at 300 DPI with pHYs.
- Print bridge pairing (token shown once, only its SHA-256 stored) and settings (safe width, gang gap/margin, shop name, pickup note).

**Print station — `tools/dtf-print-station/` (Windows, Node ≥ 22, no dependencies)**
- Polls the queue with its token, files each PNG under the export folder by order number with `job.json` and `PRODUCTION.txt`, watches the folder, serves a 127.0.0.1-only page with Open in ColorboxRIP / Show in folder / Mark printed / Report problem, survives the website being offline. Never starts a print; no ColorboxRIP API is assumed.

**Printer profile — `src/lib/dtf/printers.ts`**: Lancelot M1630 Pro, ColorboxRIP, Epson F1080/XP600, CMYK+W, 300 mm max, 290 mm safe. The export never converts to CMYK, generates white, sets ink limits, mirrors or underbases — ColorboxRIP and its profile own those.

## Must keep working

- An empty design, or one wider than the printer, can't be added to the bag or ordered (server re-checks; it never trusts the browser's price or readiness).
- A customer only ever sees their own designs, uploads and orders; the customer order view never includes production notes or storage keys.
- Uploads are judged by their bytes (PNG/JPEG/WebP/SVG only); SVGs are sanitised; every file class (original, ai, processed, reference, mockup, production) keeps its own storage prefix.
- A print file is only stored with matching pHYs DPI and physical size; low-res enlargement needs the operator's tick.
- Station routes need the paired token; nothing a station does can start a print; Stripe webhook verifies the signature.
- Files over 4.5 MB move through signed storage URLs in production (uploads, print files, station downloads).

## Setup the owner must do once

1. Paste `supabase/migrations/20261123000000_dtf_studio.sql` into the Supabase SQL editor (tables, RLS, order sequence, private `dtf-assets` bucket).
2. Optional: `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` (webhook → `/api/dtf/webhook/stripe`, event `checkout.session.completed`) to take cards; `RESEND_API_KEY` + `DTF_EMAIL_FROM` to send order emails; `NEXT_PUBLIC_SITE_URL` for links in emails.
3. Pair the print station from DTF Production › Print bridge and run `tools/dtf-print-station/start-station.cmd` on the printer PC.

## Requested, not built yet

- More lifestyle scenes per garment (a woman wearing the tee was dropped: its mask kept catching skin and denim).
- A 3D spin view was removed in the Showroom rebuild; bring back only as a real-photo 360 if asked.

<!-- code:start -->
## From the code

_Rewritten by `npm run apps:records` from the source — do not edit by hand. `npm run check:records` fails when it is out of date._

### Where it lives

- Page `/apps/dtf-production` — owner's sign-in
- Page `/apps/dtf-studio` — public
- `src/app/api/dtf/`
- `src/components/dtf/`
- `src/lib/dtf/`

### Sign-in & who can use it

- Needs a signed-in user (requireUser / auth.getUser) — `src/app/api/dtf/me/account/route.ts`, `src/app/api/dtf/me/ai/route.ts`, `src/app/api/dtf/me/assets/route.ts` +6 more
- Owner-only check (requireOwner / isOwner) — `src/app/api/dtf/admin/jobs/route.ts`, `src/app/api/dtf/admin/orders/[id]/route.ts`, `src/app/api/dtf/admin/orders/route.ts` +4 more

### Server routes

| Methods | Route | Who can call it |
|---|---|---|
| POST | `/api/dtf/admin/jobs` | owner's sign-in |
| GET | `/api/dtf/admin/orders` | owner's sign-in |
| GET PATCH | `/api/dtf/admin/orders/[id]` | owner's sign-in |
| GET POST | `/api/dtf/admin/print-file` | owner's sign-in |
| GET PUT | `/api/dtf/admin/settings` | owner's sign-in |
| GET POST DELETE | `/api/dtf/admin/station` | owner's sign-in |
| GET | `/api/dtf/assets/[id]` | public |
| GET | `/api/dtf/capabilities` | public |
| DELETE | `/api/dtf/me/account` | public |
| POST | `/api/dtf/me/ai` | public |
| GET POST | `/api/dtf/me/assets` | public |
| POST | `/api/dtf/me/checkout` | public |
| GET | `/api/dtf/me/orders` | public |
| GET | `/api/dtf/me/orders/[id]` | public |
| GET POST | `/api/dtf/me/projects` | public |
| GET DELETE | `/api/dtf/me/projects/[id]` | public |
| GET | `/api/dtf/station/file` | per-account key (no session) |
| GET | `/api/dtf/station/jobs` | per-account key (no session) |
| POST | `/api/dtf/station/status` | per-account key (no session) |
| POST | `/api/dtf/webhook/stripe` | per-account key (no session) |

### Data & database rules

- Table `dtf_assets` (public.dtf_assets) · RLS on — used in `src/lib/dtf/server/store.ts`
  - policy public.dtf_assets · dtf_assets_own_read — for select to authenticated using (user_id = auth.uid())
- Table `dtf_orders` (public.dtf_orders) · RLS on — used in `src/lib/dtf/server/store.ts`
  - policy public.dtf_orders · dtf_orders_own_read — for select to authenticated using (user_id = auth.uid())
- Table `dtf_projects` (public.dtf_projects) · RLS on — used in `src/lib/dtf/server/store.ts`
  - policy public.dtf_projects · dtf_projects_own — for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())
- Table `dtf_settings` (public.dtf_settings) · RLS on — used in `src/lib/dtf/server/store.ts`
- Database function `dtf_next_order_seq` — `src/lib/dtf/server/store.ts`
- Saved data `dtf-studio:bag:v1` — `src/lib/dtf/client.ts`
- Saved data `dtf-studio:draft:v1` — `src/lib/dtf/client.ts`

### Keys & outside services

- `AI_MODEL` — `src/app/api/dtf/me/ai/route.ts`
- `DTF_EMAIL_FROM` — `src/lib/dtf/server/mail.ts`
- `EMAIL_FROM` — `src/lib/dtf/server/mail.ts`
- `HUB_OWNER_EMAILS` — `src/lib/dtf/server/access.ts`
- `NEXT_PUBLIC_SITE_URL` — `src/lib/dtf/server/mail.ts`
- `NEXT_PUBLIC_SUPABASE_URL` — `src/lib/dtf/server/store.ts`
- `OPENROUTER_SITE_URL` — `src/lib/dtf/server/mail.ts`
- `RESEND_API_KEY` — `src/lib/dtf/server/mail.ts`
- `STRIPE_SECRET_KEY` — `src/lib/dtf/server/orders.ts`
- `STRIPE_WEBHOOK_SECRET` — `src/lib/dtf/server/orders.ts`
- `SUPABASE_SERVICE_ROLE_KEY` — `src/lib/dtf/server/store.ts`
- AI calls through `src/lib/ai/provider.ts` — `src/app/api/dtf/capabilities/route.ts`, `src/app/api/dtf/me/ai/route.ts`

### Tests

- `src/lib/dtf/ai/offline.test.ts`
- `src/lib/dtf/ai/schema.test.ts`
- `src/lib/dtf/ai/svg.test.ts`
- `src/lib/dtf/engine.test.ts`
- `src/lib/dtf/server/jobs.test.ts`
- `src/lib/dtf/station-lib.test.ts`
<!-- code:end -->
