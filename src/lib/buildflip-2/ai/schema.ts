import { z } from "zod";

/**
 * The shapes the model must return. Every model answer is parsed through these
 * before it touches a user's plan — a model that drifts gets rejected, not
 * rendered.
 */

export const specMaterial = z.object({
  name: z.string().min(1).max(160),
  spec: z.string().max(200).optional(),
  category: z
    .enum([
      "lumber",
      "sheet",
      "fasteners",
      "hardware",
      "adhesive",
      "finish",
      "electrical",
      "plumbing",
      "fabric",
      "glass",
      "metal",
      "consumable",
      "other",
    ])
    .catch("other"),
  aisle: z.string().max(60).catch("General"),
  quantity: z.coerce.number().min(0).max(100000),
  unit: z.string().min(1).max(30),
  scaling: z.enum(["linear", "area", "fixed"]).catch("fixed"),
  driver: z.string().max(40).optional(),
  /** Second dimension for `area` goods — sheet goods scale with w × h. */
  driver2: z.string().max(40).optional(),
  optional: z.boolean().optional(),
});
export type SpecMaterial = z.infer<typeof specMaterial>;

export const specCutItem = z.object({
  part: z.string().max(120),
  qty: z.coerce.number().min(1).max(1000),
  dimensions: z.string().max(200),
  material: z.string().max(120),
  notes: z.string().max(240).optional(),
});

export const specStep = z.object({
  title: z.string().min(1).max(140),
  body: z.string().min(1).max(2000),
  tools: z.array(z.string().max(60)).max(12).catch([]),
  minutes: z.coerce.number().min(1).max(10000),
  safety: z.array(z.string().max(300)).max(8).optional(),
  cutList: z.array(specCutItem).max(40).optional(),
});

export const specDimension = z.object({
  key: z.string().min(1).max(40),
  label: z.string().min(1).max(60),
  value: z.coerce.number().min(0).max(100000),
  unit: z.string().min(1).max(20),
  min: z.coerce.number().min(0).max(100000),
  max: z.coerce.number().min(0).max(100000),
  step: z.coerce.number().min(0.01).max(1000).catch(1),
});

export const buildSpec = z.object({
  title: z.string().min(1).max(160),
  summary: z.string().min(1).max(600),
  buildType: z.string().max(60).optional(),
  skillLevel: z.enum(["beginner", "intermediate", "advanced"]).catch("intermediate"),
  estimatedHours: z.coerce.number().min(0.25).max(5000),
  dimensions: z.array(specDimension).min(1).max(6),
  tools: z.array(z.string().max(80)).max(25),
  safety: z.array(z.string().max(400)).max(12),
  materials: z.array(specMaterial).min(1).max(60),
  steps: z.array(specStep).min(2).max(40),
});
export type BuildSpec = z.infer<typeof buildSpec>;

/**
 * A URL the MODEL produced. Only http(s) is allowed through: the model's
 * output is reachable by prompt injection (a pasted page's title and
 * description go into the prompt), and these strings become `href`s on a page
 * that can be SHARED with someone else.
 */
const modelUrl = z
  .string()
  .max(1200)
  .refine((v) => /^https?:\/\//i.test(v), "not an http(s) url")
  .nullable()
  .catch(null);

/**
 * A string field that is TRIMMED when it runs long, never rejected.
 *
 * `.max(n)` throws, and a ZodError anywhere in a model answer fails the WHOLE
 * pass: one chatty note and a plan comes back with no prices at all. Observed
 * on the first live run of the search-then-generate pricing pass, where the
 * prompt asks the model to explain in the note when a price is an estimate —
 * it wrote 300 characters and cost every other material its price. A long note
 * is cosmetic; losing the prices is not.
 *
 * Written as a union rather than a `.transform()` so the field stays OPTIONAL
 * in the inferred type: a transform makes the key required, and the demo
 * catalog's rows do not carry these fields at all.
 */
function trimmedTo(max: number) {
  return z.string().max(max).or(z.string().transform((v) => v.slice(0, max)));
}

export const pricedMaterial = z.object({
  name: z.string().min(1).max(160),
  unitPrice: z.coerce.number().min(0).max(1_000_000),
  retailer: z.string().max(80).catch("Unknown retailer"),
  url: modelUrl,
  /** Trimmed when it runs long, never rejected — see `trimmedTo`. */
  note: trimmedTo(240).optional(),
  /** The model's own read on how solid the price is. */
  confidence: z.enum(["high", "medium", "low"]).optional(),
});
export type PricedMaterial = z.infer<typeof pricedMaterial>;

export const pricingResult = z.object({
  materials: z.array(pricedMaterial).max(80),
});

export const specComp = z.object({
  // Trimmed, not rejected (see `trimmedTo`): one overlong field must not cost a
  // plan its whole resale band.
  title: trimmedTo(220).refine((v) => v.length > 0, "empty"),
  price: z.coerce.number().min(0).max(10_000_000),
  /** true only for a completed sale. */
  sold: z.boolean(),
  soldAt: z.string().max(40).nullable().catch(null),
  marketplace: z.string().max(80).catch("Unknown"),
  url: modelUrl,
  condition: trimmedTo(60).optional(),
});
export type SpecComp = z.infer<typeof specComp>;

export const compsResult = z.object({
  comps: z.array(specComp).max(40),
  /**
   * The model's note on how thin the market is, in its own words. Trimmed, not
   * rejected: asked to explain why it found nothing, it wrote 700 characters
   * and `.max(600)` threw away the entire comps answer with it (`trimmedTo`).
   */
  marketNote: trimmedTo(600).optional(),
});
