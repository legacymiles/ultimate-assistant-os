import { z } from "zod";

/**
 * Server-side input validation (S4). Nothing from the browser is trusted:
 * every field is checked for type AND size, and the error that comes back is
 * plain English with a next step (R3).
 */

export const MAX_PROMPT = 2000;
export const MAX_IMAGES = 4;
export const MAX_IMAGE_BYTES = 2_500_000; // after client-side resize
export const MAX_RECEIPT = 1_000_000;

/** A URL we are willing to fetch server-side. Blocks private ranges (SSRF). */
export const safeHttpUrl = z
  .string()
  .trim()
  .max(2048, "That link is too long to be a real link.")
  .refine((v) => {
    try {
      const u = new URL(v);
      if (u.protocol !== "https:" && u.protocol !== "http:") return false;
      const host = u.hostname.toLowerCase();
      if (
        host === "localhost" ||
        host === "0.0.0.0" ||
        host.endsWith(".local") ||
        host.endsWith(".internal") ||
        /^127\./.test(host) ||
        /^10\./.test(host) ||
        /^192\.168\./.test(host) ||
        /^169\.254\./.test(host) ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
        /^\[?::1\]?$/.test(host) ||
        /^\[?f[cd]/i.test(host)
      ) {
        return false;
      }
      return host.includes(".");
    } catch {
      return false;
    }
  }, "That doesn't look like a public web link. Paste the link to the post itself.");

export const generateInput = z.object({
  prompt: z
    .string()
    .trim()
    .min(3, "Tell us what you want to build — even a few words is enough.")
    .max(MAX_PROMPT, `Keep the description under ${MAX_PROMPT} characters.`),
  sourceUrl: safeHttpUrl.optional().or(z.literal("")),
  /** Storage paths returned by /api/upload — never raw image data. */
  images: z
    .array(z.string().trim().max(400))
    .max(MAX_IMAGES, `Up to ${MAX_IMAGES} reference photos.`)
    .optional(),
  hourlyTarget: z.coerce.number().min(0).max(1000).optional(),
  /** Set when the user retries a plan that failed, so we reuse the row (R6, D5). */
  projectId: z.string().trim().max(60).optional(),
  /** Idempotency key: the same key never creates a second plan (D5). */
  requestId: z.string().trim().min(8).max(64).optional(),
});
export type GenerateInput = z.infer<typeof generateInput>;

export const dimensionPatch = z.object({
  dimensions: z
    .array(
      z.object({
        key: z.string().max(60),
        value: z.coerce.number().min(0).max(100000),
      }),
    )
    .max(12),
});

export const projectPatch = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  stage: z.enum(["idea", "priced", "shopping", "building", "sold"]).optional(),
  askingPrice: z.coerce.number().min(0).max(10_000_000).nullable().optional(),
  hourlyTarget: z.coerce.number().min(0).max(1000).optional(),
  estimatedHours: z.coerce.number().min(0).max(5000).optional(),
  dimensions: dimensionPatch.shape.dimensions.optional(),
  stepDone: z.object({ id: z.string().max(60), done: z.boolean() }).optional(),
  shopping: z
    .array(z.object({ materialId: z.string().max(60), checked: z.boolean() }))
    .max(300)
    .optional(),
  materialPrice: z
    .object({
      id: z.string().max(60),
      unitPrice: z.coerce.number().min(0).max(1_000_000),
    })
    .optional(),
});

export const receiptInput = z.object({
  materialId: z.string().trim().max(60).nullable().optional(),
  label: z
    .string()
    .trim()
    .min(1, "Give the purchase a name, like “oak boards”.")
    .max(120),
  amount: z.coerce
    .number()
    .min(0, "An amount can't be negative.")
    .max(MAX_RECEIPT, "That amount looks like a typo."),
  paidAt: z.string().trim().max(40).optional(),
  store: z.string().trim().max(80).optional(),
  note: z.string().trim().max(400).optional(),
});

export const leadInput = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(200)
    .refine((v) => /^[^@\s]+@[^@\s.]+\.[^@\s]{2,}$/.test(v), "That email looks incomplete."),
  source: z.string().trim().max(60).optional(),
});

export const accountPatch = z.object({
  hourlyTarget: z.coerce.number().min(0).max(1000).optional(),
  theme: z.enum(["dark", "light", "system"]).optional(),
  emailOptIn: z.boolean().optional(),
  onboarded: z.boolean().optional(),
});

export const clientLog = z.object({
  event: z.string().trim().max(80),
  message: z.string().trim().max(1200).optional(),
  stack: z.string().trim().max(6000).optional(),
  url: z.string().trim().max(1000).optional(),
});

export const uploadInput = z.object({
  /** data: URL of an already-resized WebP/JPEG, under MAX_IMAGE_BYTES. */
  dataUrl: z
    .string()
    .max(MAX_IMAGE_BYTES * 1.4)
    .refine(
      (v) => /^data:image\/(webp|jpeg|png);base64,/.test(v),
      "Only JPEG, PNG or WebP photos, please.",
    ),
});

/** Turn a Zod failure into one sentence a human can act on (R3). */
export function firstError(err: z.ZodError): string {
  const issue = err.issues[0];
  if (!issue) return "Something in that form wasn't right.";
  return issue.message;
}

/** Parse a JSON request body safely — a malformed body is a 400, not a crash. */
export async function readJson<T>(
  req: Request,
  schema: z.ZodType<T>,
  maxBytes = 4_000_000,
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return { ok: false, error: "We couldn't read that request. Try again." };
  }
  if (raw.length > maxBytes) {
    return { ok: false, error: "That was too large to send. Try fewer or smaller photos." };
  }
  let json: unknown;
  try {
    json = raw ? JSON.parse(raw) : {};
  } catch {
    return { ok: false, error: "That request wasn't formatted correctly." };
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  return { ok: true, data: parsed.data };
}

/**
 * Only this user's own reference photos.
 *
 * A stored path is `<userId>/<id>.<ext>` and nothing else: the id is bounded,
 * the extension is one of three, and the whole string is anchored. Anything
 * carrying a slash, a traversal or another account's prefix is dropped rather
 * than corrected, because a path that is not exactly ours is not ours (S1).
 */
export function ownImagesOnly(paths: string[], userId: string): string[] {
  const allowed = new RegExp(
    `^${userId.replace(/[^A-Za-z0-9-]/g, "")}/[A-Za-z0-9_-]{8,40}\.(webp|jpg|jpeg|png)$`,
  );
  return paths.filter((p) => typeof p === "string" && allowed.test(p));
}
