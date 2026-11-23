// ---------------------------------------------------------------------------
// DTF Studio — the one set of types every part of the app agrees on.
//
// The customer studio, the 3D mockup, the AI designer, the print-readiness
// engine, the production dashboard and the Windows print station all read and
// write these shapes. Change one here and the compiler finds every caller.
//
// Units. Everything physical is in CENTIMETRES in "side space": the flat
// coordinate system of one printable side of a garment, seen the way the
// customer edits it. Origin is the centre of the collar line (top of the
// neck opening at the centre front / centre back), +x to the viewer's right,
// +y UP — so a chest print sits at negative y. Sleeves use the sleeve's own
// unwrapped space: x = distance around the sleeve from its outer line, y =
// distance down from the shoulder seam (negative). Pixels only exist at the
// edges: a source image's natural size, a render's resolution.
// ---------------------------------------------------------------------------

export type GarmentId =
  | "tee"
  | "oversized-tee"
  | "hoodie"
  | "sweatshirt"
  | "long-sleeve"
  | "tank"
  | "tote";

export type SideId = "front" | "back" | "sleeve-left" | "sleeve-right";

export type ZoneId =
  | "full-front"
  | "front-chest"
  | "left-chest"
  | "right-chest"
  | "back"
  | "upper-back"
  | "sleeve"
  | "sleeve-long"
  | "tote-front"
  | "tote-back";

/** A rectangle in side space, in cm. (x, y) is the CENTRE. */
export interface RectCm {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PlacementZone {
  id: ZoneId;
  label: string;
  side: SideId;
  rect: RectCm;
  /** One line for the placement picker: where it sits on the body. */
  hint: string;
}

export interface FabricColor {
  id: string;
  name: string;
  hex: string;
  /** Mélange yarn — the 3D shader adds fibre-level variation. */
  heather?: boolean;
}

// ----- Layers ---------------------------------------------------------------

interface LayerBase {
  id: string;
  name: string;
  side: SideId;
  /** Centre, side space, cm. */
  x: number;
  y: number;
  /** Size on the garment, cm. */
  w: number;
  h: number;
  /** Degrees, clockwise. */
  rotation: number;
  opacity: number;
  locked: boolean;
  hidden: boolean;
}

/** Where an image's pixels came from. Each origin is a separate asset class. */
export type ImageOrigin = "upload" | "ai" | "processed";

export interface ImageLayer extends LayerBase {
  kind: "image";
  assetId: string;
  /** URL the browser can draw (blob:, data: or a signed/served URL). */
  src: string;
  mime: string;
  /** Source pixel size. Drives every resolution check. */
  naturalW: number;
  naturalH: number;
  origin: ImageOrigin;
  /**
   * The untouched original this was derived from (background removed, AI
   * edit). The original is never overwritten; this is how you get back to it.
   */
  sourceAssetId?: string;
}

export type FontId =
  | "geist"
  | "inter"
  | "space-grotesk"
  | "syne"
  | "oxanium"
  | "chakra-petch"
  | "archivo-black"
  | "instrument-serif"
  | "jetbrains-mono";

export interface TextLayer extends LayerBase {
  kind: "text";
  text: string;
  font: FontId;
  weight: number;
  color: string;
  /** Em size on the garment, cm. */
  fontSizeCm: number;
  /** Tracking, in em. */
  letterSpacing: number;
  lineHeight: number;
  align: "left" | "center" | "right";
  uppercase: boolean;
  italic: boolean;
}

export type Layer = ImageLayer | TextLayer;

// ----- Projects ---------------------------------------------------------------

export interface DesignProject {
  id: string;
  name: string;
  garmentId: GarmentId;
  colorId: string;
  size: string;
  /** Which zone each printed side uses. A side with layers must have one. */
  placements: Partial<Record<SideId, ZoneId>>;
  /** Bottom first. */
  layers: Layer[];
  /** Reference pictures handed to the AI designer. Never printed. */
  references: AssetRef[];
  createdAt: string;
  updatedAt: string;
}

// ----- Assets -------------------------------------------------------------------

/**
 * Five classes, five storage prefixes, never mixed:
 *   original   — exactly the bytes the customer uploaded
 *   ai         — artwork the AI designer generated
 *   processed  — a derived copy (background removed); points at its original
 *   reference  — an inspiration picture for the AI; never printed
 *   mockup     — a garment preview render; never printed
 *   production — a print file made by the export engine; artwork only
 */
export type AssetKind = "original" | "ai" | "processed" | "reference" | "mockup" | "production";

export interface AssetRef {
  id: string;
  kind: AssetKind;
  mime: string;
  bytes: number;
  width: number;
  height: number;
  /** Browser-drawable URL (served by /api/dtf/assets/<id>). */
  url: string;
  name?: string;
  sourceAssetId?: string;
}

export interface StoredAsset extends AssetRef {
  userId: string;
  /** Path inside the private dtf-assets bucket. */
  key: string;
  createdAt: string;
}

// ----- Print readiness -------------------------------------------------------

export type Severity = "ok" | "info" | "warn" | "block";

export type CheckId =
  | "resolution"
  | "dimensions"
  | "transparency"
  | "edges"
  | "background"
  | "placement"
  | "printer-width"
  | "file-type"
  | "fine-detail"
  | "empty";

export interface ReadinessIssue {
  check: CheckId;
  severity: Severity;
  /** Plain English, one sentence, written for the customer. */
  message: string;
  /** What to do about it. */
  fix?: string;
  layerId?: string;
  side?: SideId;
  /** Numbers the operator wants to see (dpi, cm, %). */
  data?: Record<string, number | string | boolean>;
}

export interface ReadinessReport {
  checkedAt: string;
  /** Worst severity found. "block" stops checkout. */
  verdict: Severity;
  issues: ReadinessIssue[];
  /** Per printed side: artwork size and the lowest effective DPI on it. */
  sides: Partial<Record<SideId, { widthCm: number; heightCm: number; minDpi: number | null; layers: number }>>;
}

// ----- Printers ------------------------------------------------------------------

export interface PrinterProfile {
  id: string;
  name: string;
  rip: string;
  printhead: string;
  inks: string;
  media: string;
  /** Manufacturer's listed maximum print width, mm. */
  maxWidthMm: number;
  /** Default safe working width, mm (the operator can change it). */
  safeWidthMm: number;
  /** Sheet modes, mm. Roll = width × any length up to maxRollLengthMm. */
  sheets: { id: string; label: string; widthMm: number; heightMm: number }[];
  maxRollLengthMm: number;
  targetDpi: number;
  /** Below this effective DPI a print visibly softens. */
  minGoodDpi: number;
  /** Below this it will look blurry — warn hard. */
  minAcceptableDpi: number;
  /** Finest line that holds through powder + press, mm. */
  minLineMm: number;
  /** What the export deliberately does NOT do — the RIP owns these. */
  ripOwns: string[];
}

// ----- Orders and production -------------------------------------------------

export type OrderStatus =
  | "incoming"
  | "artwork_review"
  | "print_ready"
  | "printing"
  | "heat_transfer"
  | "quality_control"
  | "completed"
  | "shipped"
  | "cancelled";

export type PaymentState = "awaiting_payment" | "paid" | "refunded";

export type PrintJobStatus =
  /** Generated file waits for the operator's approval. */
  | "awaiting_approval"
  /** Approved; the print file exists. Not yet sent to the station. */
  | "file_ready"
  /** In the local production queue, waiting for the station. */
  | "queued"
  /** The station downloaded it into the export folder. */
  | "downloaded"
  /** The operator opened it in ColorboxRIP from the station. */
  | "opened"
  /** The operator marked it printed. Never set by software on its own. */
  | "printed"
  | "failed";

export interface PrintFile {
  key: string;
  widthPx: number;
  heightPx: number;
  dpi: number;
  widthCm: number;
  heightCm: number;
  bytes: number;
  createdAt: string;
  /** True when any layer had to be upsampled to reach the export DPI. */
  upsampled: boolean;
  /** Lowest effective source DPI on this file. */
  minSourceDpi: number | null;
}

export interface PrintJob {
  id: string;
  orderId: string;
  orderNumber: string;
  itemId: string;
  side: SideId;
  zoneId: ZoneId;
  /** Artwork bounding box on the garment, cm (after trimming transparent padding). */
  artworkWidthCm: number;
  artworkHeightCm: number;
  /** Where the transfer goes when pressing: top edge below the collar, centre offset. */
  pressTopCm: number;
  pressCenterOffsetCm: number;
  status: PrintJobStatus;
  file?: PrintFile;
  readiness?: ReadinessReport;
  /** Station bookkeeping. */
  exportedAt?: string;
  openedAt?: string;
  printedAt?: string;
  stationPath?: string;
  error?: string;
}

export interface OrderItem {
  id: string;
  /** A frozen copy of the design at purchase. Later edits never touch an order. */
  project: DesignProject;
  garmentId: GarmentId;
  colorId: string;
  size: string;
  quantity: number;
  unitCents: number;
  /** Garment preview renders, per side (asset ids). Never printed. */
  mockups: Partial<Record<SideId, string>>;
}

export interface OrderEvent {
  at: string;
  by: "customer" | "owner" | "station" | "system" | "stripe";
  kind: string;
  message: string;
}

export interface ShippingDetails {
  method: "ship" | "pickup";
  name: string;
  line1?: string;
  line2?: string;
  city?: string;
  region?: string;
  postal?: string;
  country?: string;
  phone?: string;
}

export interface Order {
  id: string;
  /** Human order number, e.g. DTF-24117. */
  number: string;
  userId: string;
  email: string;
  createdAt: string;
  updatedAt: string;
  status: OrderStatus;
  payment: {
    state: PaymentState;
    method: "stripe" | "manual";
    amountCents: number;
    currency: string;
    stripeSessionId?: string;
    paidAt?: string;
  };
  items: OrderItem[];
  jobs: PrintJob[];
  shipping: ShippingDetails;
  /** Customer's note at checkout. */
  customerNote?: string;
  /** Operator's production notes. Owner-only. */
  productionNotes: string;
  trackingNumber?: string;
  history: OrderEvent[];
}

/** What a customer may see of an order — no production notes, no file keys. */
export type CustomerOrderView = Omit<Order, "productionNotes" | "jobs"> & {
  jobs: Pick<PrintJob, "id" | "side" | "zoneId" | "artworkWidthCm" | "artworkHeightCm" | "status">[];
};

// ----- AI designer -------------------------------------------------------------

/**
 * Edits the AI designer may propose. They are DATA, applied by the same
 * reducer the editor uses (./ops.ts), so an approved suggestion changes the
 * real layers and lands on the undo stack like any hand edit.
 */
export type DesignOp =
  | { op: "move"; layerId: string; dx?: number; dy?: number; x?: number; y?: number }
  | { op: "resize"; layerId: string; scale?: number; w?: number; h?: number }
  | { op: "rotate"; layerId: string; rotation: number }
  | { op: "set-text"; layerId: string; text?: string; font?: FontId; weight?: number; color?: string; fontSizeCm?: number; letterSpacing?: number; lineHeight?: number; uppercase?: boolean; italic?: boolean; align?: "left" | "center" | "right" }
  | { op: "add-text"; side: SideId; text: string; x: number; y: number; font?: FontId; weight?: number; color?: string; fontSizeCm?: number; letterSpacing?: number; uppercase?: boolean; italic?: boolean }
  | { op: "add-svg"; side: SideId; name: string; svg: string; x: number; y: number; w: number }
  | { op: "set-opacity"; layerId: string; opacity: number }
  | { op: "delete"; layerId: string }
  | { op: "duplicate"; layerId: string; dx?: number; dy?: number }
  | { op: "reorder"; layerId: string; to: "front" | "back" | "forward" | "backward" }
  | { op: "set-color"; colorId: string }
  | { op: "set-garment"; garmentId: GarmentId }
  | { op: "set-placement"; side: SideId; zoneId: ZoneId }
  | { op: "remove-background"; layerId: string; tolerance?: number }
  | { op: "center"; layerId: string; axis?: "x" | "y" | "both" };

export interface AiProposal {
  id: string;
  title: string;
  /** Why — one or two sentences. */
  rationale: string;
  ops: DesignOp[];
}

export interface AiReply {
  message: string;
  proposals: AiProposal[];
  /** Advice that is not an edit (palette, print risks, typography). */
  notes?: string[];
  /** Colour suggestions that work on the current garment. */
  palette?: { hex: string; name: string }[];
  /** "live" when a model answered; "offline" when the built-in planner did. */
  engine: "live" | "offline";
}
