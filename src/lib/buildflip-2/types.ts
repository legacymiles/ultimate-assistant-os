/**
 * BuildFlip 2 domain types.
 *
 * Every number a user sees carries a `Provenance`. That is the product's
 * central promise: nothing is presented as fact unless we can say where it
 * came from, when it was checked, and how sure we are.
 */

export type Confidence = "high" | "medium" | "low";

/** Where a number came from. Attached to every price, comp and estimate. */
export interface Provenance {
  /** "Home Depot", "eBay (sold)", "BuildFlip estimate", "Demo catalog" */
  source: string;
  /** Live listing or sold record. Null only for derived/estimated values. */
  url: string | null;
  /** ISO timestamp of when this was actually checked. */
  checkedAt: string;
  confidence: Confidence;
  /** Plain-English reason the confidence is what it is. */
  note?: string;
  /** True when this came from the bundled demo catalog, not the live web. */
  demo?: boolean;
}

export type MaterialCategory =
  | "lumber"
  | "sheet"
  | "fasteners"
  | "hardware"
  | "adhesive"
  | "finish"
  | "electrical"
  | "plumbing"
  | "fabric"
  | "glass"
  | "metal"
  | "consumable"
  | "other";

export interface Material {
  id: string;
  name: string;
  /** What it's for, in the user's words. */
  spec?: string;
  category: MaterialCategory;
  /** Which hardware-store aisle this lives in — drives the shopping list. */
  aisle: string;
  /** The quantity at the CURRENT dimensions. Derived — never the source of truth. */
  quantity: number;
  /**
   * The quantity the plan was originally costed at, at `Dimension.baseline`.
   * Scaling always works from this, never from `quantity`: if it worked from
   * the current value, every dimension change would compound on the last one
   * and sizing a build up and back down again would leave it permanently
   * inflated.
   */
  baseQuantity: number;
  unit: string;
  unitPrice: number;
  /** quantity * unitPrice, rounded to cents. Always derived, never stored raw. */
  lineTotal: number;
  provenance: Provenance;
  /**
   * How quantity scales when a dimension changes.
   *  - "linear"  : scales with the driving dimension
   *  - "area"    : scales with the square of the driving dimension
   *  - "fixed"   : never changes (e.g. one tube of glue)
   */
  scaling: "linear" | "area" | "fixed";
  /** Which dimension key drives this material's quantity. */
  driver?: string;
  /**
   * The second dimension, for `area` goods. Sheet goods and finishes scale
   * with width × height; with only one driver we can do no better than
   * squaring it, which is only correct for a square.
   */
  driver2?: string;
  /** Marked true when the user edits the price by hand. */
  userOverride?: boolean;
  optional?: boolean;
}

export interface CutListItem {
  id: string;
  part: string;
  qty: number;
  /** Human-readable finished size, e.g. '2 @ 48" × 3½" × ¾"' */
  dimensions: string;
  material: string;
  notes?: string;
}

export interface BuildStep {
  id: string;
  index: number;
  title: string;
  body: string;
  tools: string[];
  /** Estimated minutes for this step. */
  minutes: number;
  safety?: string[];
  cutList?: CutListItem[];
  /** User checks steps off as they build. */
  done?: boolean;
}

export interface Comp {
  id: string;
  title: string;
  /** What it actually sold for. */
  price: number;
  /** true = a completed sale. false = an asking price (shown separately, never averaged in). */
  sold: boolean;
  /** ISO date of the sale, when known. */
  soldAt: string | null;
  marketplace: string;
  url: string | null;
  condition?: string;
  provenance: Provenance;
}

export interface ResaleEstimate {
  low: number;
  mid: number;
  high: number;
  /** Number of completed sales behind the range. */
  soldCount: number;
  /** True when there aren't enough real sales to be confident. Says so plainly. */
  thin: boolean;
  thinReason?: string;
  confidence: Confidence;
  comps: Comp[];
  provenance: Provenance;
}

export interface Dimension {
  key: string;
  label: string;
  value: number;
  unit: string;
  min: number;
  max: number;
  step: number;
  /** The dimension the plan was originally costed at. */
  baseline: number;
}

export interface Receipt {
  id: string;
  /** Material id this receipt pays for, or null for an unplanned purchase. */
  materialId: string | null;
  label: string;
  amount: number;
  /** ISO date the user actually paid. */
  paidAt: string;
  store?: string;
  note?: string;
}

export type ProjectStage = "idea" | "priced" | "shopping" | "building" | "sold";

export const STAGES: { id: ProjectStage; label: string; hint: string }[] = [
  { id: "idea", label: "Idea", hint: "Pasted, not costed yet" },
  { id: "priced", label: "Priced", hint: "Has a plan and a verdict" },
  { id: "shopping", label: "Shopping", hint: "Buying the materials" },
  { id: "building", label: "Building", hint: "Hands on the tools" },
  { id: "sold", label: "Sold", hint: "Receipts in, profit real" },
];

export interface ShoppingItem {
  materialId: string;
  checked: boolean;
}

export interface Project {
  id: string;
  ownerId: string;
  title: string;
  /** One line the user would say out loud about this build. */
  summary: string;
  /** What the user typed. */
  prompt: string;
  /** The social link they pasted, if any. */
  sourceUrl: string | null;
  /** What we managed to read from that link. */
  sourceRead: {
    ok: boolean;
    title?: string;
    description?: string;
    image?: string;
    platform?: string;
    reason?: string;
  } | null;
  /** Storage paths of the reference photos. */
  referenceImages: string[];
  stage: ProjectStage;

  dimensions: Dimension[];
  materials: Material[];
  steps: BuildStep[];
  tools: string[];
  safety: string[];
  skillLevel: "beginner" | "intermediate" | "advanced";

  /** Total build hours (sum of step minutes, but the model can override). */
  estimatedHours: number;
  /** What the user values their time at, per hour. */
  hourlyTarget: number;

  resale: ResaleEstimate | null;
  /** The user's own asking price if they dragged the Margin Beam. */
  askingPrice: number | null;

  receipts: Receipt[];
  shopping: ShoppingItem[];

  share: { token: string; enabled: boolean; createdAt: string } | null;

  /**
   * Set when any part of this plan came from the demo catalog instead of the
   * live web, explaining WHY in plain words. Shown on the plan, because demo
   * prices presented without explanation would be a confident guess.
   */
  fallbackReason?: string | null;
  /** Build-type key used to pool real receipts across users for calibration. */
  buildType: string;
  /** Calibration applied at generation time, if any. */
  calibration: { factor: number; sampleSize: number } | null;

  createdAt: string;
  updatedAt: string;
  /**
   * Bumped on every save. A PATCH is a read-modify-write of the whole record,
   * so without a revision two writes in flight at once silently overwrite each
   * other's fields — and the two debounced savers (dimensions at 450ms,
   * shopping at 700ms) overlap routinely.
   */
  rev?: number;
  /** Set when generation failed so we can show a real error + Try again. */
  error?: string | null;
  /** Generation progress, kept so a reload never loses a running plan (R6). */
  generating?: boolean;
}

/** The ROI verdict — the answer the user came for. */
export interface Verdict {
  materialCost: number;
  actualCost: number;
  /** Which cost the verdict used: real receipts once they exist. */
  costBasis: "estimate" | "actual" | "mixed";
  salePrice: number;
  salePriceBasis: "comps" | "asking";
  profit: number;
  /** 0–1. profit / salePrice. */
  margin: number;
  hours: number;
  /** null when the plan has no hours — never Infinity, which formats as "$∞". */
  hourlyRate: number | null;
  /** Non-optional materials we couldn't find a price for. Any means "not confident". */
  unpricedCount: number;
  call: "build" | "maybe" | "skip";
  headline: string;
  /** The one or two numbers that drove the call. */
  drivers: string[];
  confidence: Confidence;
}

export type Plan = "free" | "pro";

export interface Account {
  userId: string;
  email: string;
  plan: Plan;
  role: "user" | "admin";
  /** How many plans they have generated, ever. Drives the paywall. */
  plansGenerated: number;
  stripeCustomerId: string | null;
  subscription: {
    id: string;
    status: string;
    currentPeriodEnd: string | null;
    cancelAt: string | null;
  } | null;
  hourlyTarget: number;
  theme: "dark" | "light" | "system";
  emailOptIn: boolean;
  onboarded: boolean;
  createdAt: string;
  updatedAt: string;
}

export const FREE_PLAN_LIMIT = 1;
