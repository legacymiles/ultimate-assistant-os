# DTF Studio — spec

**End goal beyond the goal:** a customer goes from "I have an idea / a picture" to a garment they
are proud of without needing a designer, and the owner goes from paid order to a correctly sized,
ColorboxRIP-ready transfer on the Lancelot M1630 Pro without re-touching a file. The website is the
front half of a real print shop, not a toy.

**Named quality bars:** customer studio — *Nike By You's 3D configurator*; editor — *Figma's canvas
+ layers panel*; production — *Linear's board view*.

**Depth:** `commercial` (customers sign in, pay, and data reaches a server). Purchasing physical
goods is the product, so prices exist; no subscriptions, no paywalls on the studio itself.

## Features (the hard one is starred)

1. ★ **Live 3D garment** (R3F): 7 procedural garments with real folds, fabric weave normal map and
   sheen; the garment material itself changes colour (dye-sweep); artwork projected onto the fabric
   through the folds from the same canvas the editor draws; front/back/sleeve views, orbit, zoom.
2. **Editor**: upload PNG/JPG/SVG/WebP, drag/resize/rotate, duplicate, delete, text with 9 committed
   fonts, colour, tracking, line height, layers with lock/hide/reorder, undo/redo, numeric
   position in cm, placement zones (full front, front chest, left/right chest, back, upper back,
   sleeve, long sleeve, tote faces); boundary visible while editing, hidden in preview.
3. **AI designer**: knows garment, colour, layers, zones and readiness; reads reference images;
   returns proposals as `DesignOp[]` that apply to the real layers on Approve (undoable); generates
   original SVG graphics; palette + typography advice; print-risk notes; offline planner fallback.
4. **Print readiness**: effective DPI per layer at print size, physical size, transparency,
   solid-background detection, soft/semi-transparent edges, fine-line detection (< 0.5 mm),
   zone fit, safe printer width, file type (magic bytes). One-click background removal that keeps
   the original.
5. **Export engine** (Lancelot M1630 Pro · ColorboxRIP profile): artwork-only PNG per print side,
   300 DPI with pHYs, exact cm, trimmed, never silently upsampled (flagged + operator approval),
   sRGB untouched — no CMYK, white, ink limit, mirror or underbase.
6. **Print bridge**: server-side job queue + a Windows print-station companion
   (`tools/dtf-print-station`) that pulls authorised jobs, files them by order number, shows
   details on a localhost page, opens files with ColorboxRIP, tracks exported/opened/printed.
   Never prints by itself.
7. **Production dashboard** (owner): board by stage, order record (previews, references, print
   files, garment, placement, notes, history), approvals, batch export, gang-sheet builder.
8. **Customer**: browse, design, save projects, return to drafts, cart → checkout (Stripe when
   keyed; otherwise "pay on pickup / invoice" orders the owner marks paid), order tracking.
9. **Foundation**: sign-in (hub Supabase), per-user rows with RLS, roles (customer / owner /
   station), owner dashboard, Stripe wired (test-mode labelled), order emails (Resend or logged),
   terms of sale + artwork rights page, account data deletion.

## API contract

All under `/api/dtf`. JSON errors are `{ error: "plain English" }`.

| Route | Who | What |
|---|---|---|
| `GET/POST /api/dtf/me/projects` | customer | list / upsert a `DesignProject` |
| `GET/DELETE /api/dtf/me/projects/[id]` | customer | one project |
| `POST /api/dtf/me/assets` | customer | multipart upload (`file`, `kind`), magic-byte checked → `AssetRef` |
| `GET /api/dtf/assets/[id]` | owner of asset or shop owner (or station for production) | bytes |
| `POST /api/dtf/me/ai` | customer | AI designer turn → `AiReply` |
| `POST /api/dtf/me/checkout` | customer | create order (+ Stripe session) |
| `GET /api/dtf/me/orders` · `[id]` | customer | `CustomerOrderView` |
| `DELETE /api/dtf/me/account` | customer | delete projects + uploads |
| `GET /api/dtf/capabilities` | anyone | what is connected (Stripe, AI, storage, station) |
| `POST /api/dtf/webhook/stripe` | Stripe | payment confirmation |
| `/api/dtf/admin/*` | owner | orders, status, jobs, approvals, files, settings, station pairing |
| `/api/dtf/station/*` | station token | `jobs`, `jobs/[id]/file`, `jobs/[id]/status` |

Access: `/apps/dtf-studio` and `/api/dtf/{me,assets,capabilities}` are public prefixes in
`src/lib/hubAccess.ts` (every route checks the session itself); station + webhook are exact
token paths in `src/middleware.ts`; `/apps/dtf-production` and `/api/dtf/admin` stay behind the
owner gate AND check the owner in the route.
