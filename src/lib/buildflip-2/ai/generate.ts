import { buildTypeKey, money, recostMaterials } from "../calc";
import { log } from "../log";
import type {
  Comp,
  Confidence,
  Dimension,
  Material,
  Project,
  Provenance,
  ResaleEstimate,
  BuildStep,
} from "../types";
import { estimateResale } from "../calc";
import { pickDemoPlan } from "./demo-catalog";
import { readLink, type LinkRead } from "./link-reader";
import { aiConfigured, chat, extractJson } from "./chat";
import {
  buildSpec,
  compsResult,
  pricingResult,
  type BuildSpec,
  type PricedMaterial,
  type SpecComp,
} from "./schema";
import {
  COMPS_SYSTEM,
  PRICING_SYSTEM,
  SPEC_SYSTEM,
  compsUser,
  pricingUser,
  specUser,
} from "./prompts";

/**
 * The generation pipeline. Three model passes, two of them in parallel, so a
 * full plan lands inside the 60-second target:
 *
 *   1. READ    — open the pasted link, resize-checked photos in hand
 *   2. SPEC    — vision + reasoning produce the buildable spec
 *   3. PRICE ∥ COMPS — one live web search each, running at the same time
 *   4. VERDICT — pure arithmetic in calc.ts, no model involved
 *
 * The verdict is deliberately NOT model-generated. The numbers are computed
 * from the sourced prices and the sourced sales, so the answer the user acts on
 * is arithmetic they can check, not a model's opinion.
 */

export type Stage =
  | "reading"
  | "sizing"
  | "materials"
  | "pricing"
  | "comps"
  | "verdict"
  | "done";

export interface Progress {
  stage: Stage;
  label: string;
  detail?: string;
  /** 0–1 */
  pct: number;
}

export type OnProgress = (p: Progress) => void | Promise<void>;

export interface GenerateArgs {
  prompt: string;
  sourceUrl?: string | null;
  /** https or data: URLs for the vision pass. Already resized by the client. */
  imageUrls?: string[];
  hourlyTarget?: number;
  /** Pooled real-receipt calibration for this build type, if we have any. */
  calibration?: { factor: number; sampleSize: number } | null;
  signal?: AbortSignal;
  onProgress?: OnProgress;
}

export interface GenerateResult {
  spec: BuildSpec;
  materials: Material[];
  steps: BuildStep[];
  dimensions: Dimension[];
  resale: ResaleEstimate;
  link: LinkRead | null;
  buildType: string;
  /** True when any part of this came from the demo catalog rather than the web. */
  demo: boolean;
  /**
   * Why we fell back, in words for the user. Falling back silently would mean
   * showing demo prices to someone who thinks they are live — so whenever a
   * live pass fails, the reason travels with the plan and is shown on it.
   */
  fallbackReason: string | null;
  costUsd: number;
  calibration: { factor: number; sampleSize: number } | null;
}

/** Turn a model/provider failure into one sentence a user can act on. */
function fallbackMessage(err: unknown): string {
  const m = (err as Error)?.message ?? "";
  if (/out of credit|402/i.test(m)) {
    return "The live pricing service is out of credit, so this plan is priced from our demo catalog. Every demo number is labelled. Topping up the AI account switches live prices back on.";
  }
  if (/rate|429/i.test(m)) {
    return "The live pricing search was rate-limited, so this plan is priced from our demo catalog. Re-price it in a few minutes for real current prices.";
  }
  if (/timeout|abort/i.test(m)) {
    return "The live pricing search timed out, so this plan is priced from our demo catalog. Re-price it to try again.";
  }
  if (/readable|JSON/i.test(m)) {
    return "The pricing search came back unreadable, so this plan is priced from our demo catalog. Re-price it to try again.";
  }
  return "We couldn't reach the live pricing search, so this plan is priced from our demo catalog. Every demo number is labelled.";
}

const id = (prefix: string, n: number) => `${prefix}${n.toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function nowIso() {
  return new Date().toISOString();
}

const normName = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();

/**
 * Match every priced result back to its material, in TWO passes.
 *
 * One pass per material is wrong: a fuzzy match on an early material claims a
 * row that a later material needed exactly. With a spec containing
 * "1/2 in plywood sheet" and "3/4 in plywood sheet" and only the 3/4 priced,
 * the 1/2 would fuzzy-grab the 3/4's price (two shared tokens) and the 3/4
 * would then find it taken and get nothing — the cheap line overpriced, the
 * expensive line free.
 *
 * So: resolve every exact match first, then fuzzy-match only what's left.
 */
function matchPrices(
  materials: { name: string }[],
  priced: PricedMaterial[],
): (PricedMaterial | null)[] {
  const out: (PricedMaterial | null)[] = materials.map(() => null);
  const used = new Set<number>();

  // Pass 1 — exact names.
  materials.forEach((m, mi) => {
    const target = normName(m.name);
    for (let i = 0; i < priced.length; i++) {
      if (used.has(i)) continue;
      if (normName(priced[i]!.name) === target) {
        used.add(i);
        out[mi] = priced[i]!;
        return;
      }
    }
  });

  // Pass 2 — best token overlap for whatever is still unmatched.
  materials.forEach((m, mi) => {
    if (out[mi]) return;
    const targetTokens = new Set(
      normName(m.name).split(" ").filter((t) => t.length > 2),
    );
    if (targetTokens.size === 0) return;

    let best = -1;
    let bestScore = 0;
    for (let i = 0; i < priced.length; i++) {
      if (used.has(i)) continue;
      // Dedupe candidate tokens: "oak oak trim" must not score 2 on "oak".
      const tokens = new Set(normName(priced[i]!.name).split(" "));
      let score = 0;
      for (const t of tokens) if (targetTokens.has(t)) score++;
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    if (best >= 0 && bestScore >= 2) {
      used.add(best);
      out[mi] = priced[best]!;
    }
  });

  return out;
}

export async function generatePlan(args: GenerateArgs): Promise<GenerateResult> {
  const report = async (p: Progress) => {
    try {
      await args.onProgress?.(p);
    } catch {
      /* a closed stream must never fail a generation */
    }
  };

  const live = aiConfigured();
  let costUsd = 0;

  /* ----------------------------------------------------------- 1. read link */
  await report({
    stage: "reading",
    label: args.sourceUrl ? "Opening the post you pasted" : "Reading your idea",
    pct: 0.06,
  });

  let link: LinkRead | null = null;
  if (args.sourceUrl) {
    link = await readLink(args.sourceUrl);
    await report({
      stage: "reading",
      label: link.ok
        ? `Read the ${link.platform} post`
        : `Couldn't open the ${link.platform ?? "link"}`,
      detail: link.ok ? link.title : link.reason,
      pct: 0.12,
    });
  }

  /* ------------------------------------------------- 2. spec (vision pass) */
  await report({
    stage: "sizing",
    label: "Working out dimensions and construction",
    detail: args.imageUrls?.length
      ? `Reading ${args.imageUrls.length} reference photo${args.imageUrls.length === 1 ? "" : "s"}`
      : undefined,
    pct: 0.18,
  });

  let spec: BuildSpec;
  let demo = !live;
  let fallbackReason: string | null = live
    ? null
    : "No AI key is connected on this deployment, so this plan is priced from our demo catalog. Every demo number is labelled.";

  const calibrationNote = args.calibration
    ? `CALIBRATION FROM REAL RECEIPTS: across ${args.calibration.sampleSize} finished builds of this type, actual material spend came in at ${(args.calibration.factor * 100).toFixed(0)}% of the first estimate. Factor that into your quantities and waste allowance.`
    : undefined;

  if (live) {
    try {
      const res = await chat({
        system: SPEC_SYSTEM,
        user: specUser({
          prompt: args.prompt,
          link: link ?? undefined,
          imageCount: args.imageUrls?.length ?? 0,
          calibrationNote,
        }),
        images: [
          ...(args.imageUrls ?? []).map((url) => ({ url })),
          ...(link?.ok && link.image ? [{ url: link.image }] : []),
        ].slice(0, 5),
        maxTokens: 8000,
        timeoutMs: 120_000,
        signal: args.signal,
      });
      costUsd += res.costUsd;
      spec = buildSpec.parse(extractJson(res.text));
    } catch (err) {
      await log({
        level: "warn",
        event: "spec_pass_failed",
        message: (err as Error)?.message,
      });
      // Fall back to the demo catalog rather than leaving the user with nothing,
      // and mark everything that follows as demo so it is never shown as live.
      spec = pickDemoPlan(`${args.prompt} ${link?.title ?? ""}`).spec;
      demo = true;
      fallbackReason = fallbackMessage(err);
    }
  } else {
    spec = pickDemoPlan(`${args.prompt} ${link?.title ?? ""}`).spec;
  }

  const buildType = spec.buildType?.trim() || buildTypeKey(spec.title, spec.summary);

  const dimensions: Dimension[] = spec.dimensions.map((d) => ({
    key: d.key,
    label: d.label,
    value: d.value,
    unit: d.unit,
    min: Math.min(d.min, d.value),
    max: Math.max(d.max, d.value),
    step: d.step || 1,
    baseline: d.value,
  }));

  await report({
    stage: "materials",
    label: `${spec.materials.length} materials, ${spec.steps.length} steps`,
    detail: spec.title,
    pct: 0.42,
  });

  /* ------------------------------------------- 3. pricing ∥ comps (parallel) */
  await report({
    stage: "pricing",
    label: demo ? "Pricing from the demo catalog" : "Searching live prices",
    detail: demo ? undefined : "Home Depot, Lowe's and specialist retailers",
    pct: 0.5,
  });

  const demoPlan = pickDemoPlan(`${args.prompt} ${spec.title}`);

  const pricePromise: Promise<{ priced: PricedMaterial[]; demo: boolean; cost: number }> =
    demo || !live
      ? Promise.resolve({ priced: demoPlan.prices, demo: true, cost: 0 })
      : chat({
          system: PRICING_SYSTEM,
          user: pricingUser(spec.materials),
          webSearchResults: Math.min(12, Math.max(6, spec.materials.length)),
          maxTokens: 6000,
          timeoutMs: 110_000,
          signal: args.signal,
        })
          .then((res) => ({
            priced: pricingResult.parse(extractJson(res.text)).materials,
            demo: false,
            cost: res.costUsd,
          }))
          .catch(async (err) => {
            await log({
              level: "warn",
              event: "pricing_pass_failed",
              message: (err as Error)?.message,
            });
            if (!fallbackReason) fallbackReason = fallbackMessage(err);
            /**
             * Return NO prices rather than the demo catalog.
             *
             * The demo lists are a dozen hand-written rows for three specific
             * builds; against a real bespoke spec almost nothing matches, so
             * most materials would silently come back at $0 — and a total
             * built from zeros reads as a huge margin and a confident
             * "Build it". An unpriced plan is honest; a cheap one is a lie.
             */
            return { priced: [] as PricedMaterial[], demo: true, cost: 0 };
          });

  const compsPromise: Promise<{
    comps: SpecComp[];
    marketNote?: string;
    demo: boolean;
    cost: number;
  }> =
    demo || !live
      ? Promise.resolve({ comps: demoPlan.comps, demo: true, cost: 0 })
      : chat({
          system: COMPS_SYSTEM,
          user: compsUser(spec),
          webSearchResults: 10,
          maxTokens: 4000,
          timeoutMs: 110_000,
          signal: args.signal,
        })
          .then((res) => {
            const parsed = compsResult.parse(extractJson(res.text));
            return {
              comps: parsed.comps,
              marketNote: parsed.marketNote,
              demo: false,
              cost: res.costUsd,
            };
          })
          .catch(async (err) => {
            await log({
              level: "warn",
              event: "comps_pass_failed",
              message: (err as Error)?.message,
            });
            if (!fallbackReason) fallbackReason = fallbackMessage(err);
            return { comps: demoPlan.comps, demo: true, cost: 0 };
          });

  const [priceOut, compsOut] = await Promise.all([pricePromise, compsPromise]);
  costUsd += priceOut.cost + compsOut.cost;
  const anyDemo = demo || priceOut.demo || compsOut.demo;

  await report({
    stage: "comps",
    label: compsOut.demo
      ? "Resale from the demo catalog"
      : "Checking what finished ones sold for",
    pct: 0.78,
  });

  /* ------------------------------------------------- assemble the materials */
  const checkedAt = nowIso();
  const priceMatches = matchPrices(spec.materials, priceOut.priced);

  let materials: Material[] = spec.materials.map((m, i) => {
    const hit = priceMatches[i];
    const unitPrice = hit ? money(hit.unitPrice) : 0;
    const confidence: Confidence = hit
      ? priceOut.demo
        ? "medium"
        : (hit.confidence ?? (hit.url ? "high" : "low"))
      : "low";

    const provenance: Provenance = {
      source: hit
        ? priceOut.demo
          ? `Demo catalog (${hit.retailer})`
          : hit.retailer
        : "No price found",
      url: hit?.url ?? null,
      checkedAt,
      confidence,
      note: hit
        ? priceOut.demo
          ? "Demo catalog price — connect an AI key for a live price."
          : (hit.note ?? (hit.url ? undefined : "Market estimate, no listing found."))
        : "We couldn't find a price for this. Add your own.",
      demo: priceOut.demo,
    };

    return {
      id: id("m", i),
      name: m.name,
      spec: m.spec,
      category: m.category,
      aisle: m.aisle,
      quantity: m.quantity,
      baseQuantity: m.quantity,
      unit: m.unit,
      unitPrice,
      lineTotal: money(m.quantity * unitPrice),
      provenance,
      scaling: m.scaling,
      driver: m.driver,
      driver2: m.driver2,
      optional: m.optional,
    };
  });

  // Apply the real-receipt calibration to the costed total, transparently.
  if (args.calibration && args.calibration.factor !== 1) {
    materials = materials.map((m) => ({
      ...m,
      unitPrice: money(m.unitPrice * args.calibration!.factor),
      lineTotal: money(m.quantity * money(m.unitPrice * args.calibration!.factor)),
      provenance: {
        ...m.provenance,
        note: `${m.provenance.note ? m.provenance.note + " " : ""}Adjusted ${
          args.calibration!.factor > 1 ? "up" : "down"
        } ${Math.abs(Math.round((args.calibration!.factor - 1) * 100))}% from ${
          args.calibration!.sampleSize
        } real receipts for this build type.`,
      },
    }));
  }

  materials = recostMaterials(materials, dimensions);

  const steps: BuildStep[] = spec.steps.map((s, i) => ({
    id: id("s", i),
    index: i,
    title: s.title,
    body: s.body,
    tools: s.tools,
    minutes: s.minutes,
    safety: s.safety,
    cutList: s.cutList?.map((c, j) => ({ id: id("c", j), ...c })),
    done: false,
  }));

  /* ------------------------------------------------------------- the comps */
  const comps: Comp[] = compsOut.comps.map((c, i) => ({
    id: id("k", i),
    title: c.title,
    price: money(c.price),
    sold: c.sold,
    soldAt: c.soldAt,
    marketplace: compsOut.demo ? `${c.marketplace} (demo)` : c.marketplace,
    url: c.url,
    condition: c.condition,
    provenance: {
      source: compsOut.demo
        ? `Demo catalog (${c.marketplace})`
        : `${c.marketplace}${c.sold ? " (sold)" : " (asking)"}`,
      url: c.url,
      checkedAt,
      confidence: compsOut.demo ? "medium" : c.sold ? (c.url ? "high" : "medium") : "low",
      note: compsOut.demo
        ? "Demo catalog comp — connect an AI key for real sold listings."
        : c.sold
          ? undefined
          : "This is an asking price, not a sale. It is shown but never counted.",
      demo: compsOut.demo,
    },
  }));

  const resale = estimateResale(
    comps,
    checkedAt,
    compsOut.demo ? "Demo catalog" : "Completed sales across marketplaces",
    compsOut.demo,
  );
  if (compsOut.marketNote && resale.thin) {
    resale.thinReason = `${resale.thinReason ?? ""} ${compsOut.marketNote}`.trim();
  }

  await report({ stage: "verdict", label: "Working out the profit", pct: 0.93 });

  return {
    spec,
    materials,
    steps,
    dimensions,
    resale,
    link,
    buildType,
    demo: anyDemo,
    fallbackReason: anyDemo ? (fallbackReason ?? fallbackMessage(null)) : null,
    costUsd,
    calibration: args.calibration ?? null,
  };
}

/** Assemble a full Project record from a generation result. */
export function toProject(args: {
  id: string;
  ownerId: string;
  input: { prompt: string; sourceUrl?: string | null; images?: string[] };
  result: GenerateResult;
  hourlyTarget: number;
  createdAt?: string;
}): Project {
  const { result } = args;
  const totalMinutes = result.steps.reduce((s, st) => s + st.minutes, 0);
  const hours =
    totalMinutes > 0
      ? Math.round((totalMinutes / 60) * 10) / 10
      : result.spec.estimatedHours;

  return {
    id: args.id,
    ownerId: args.ownerId,
    title: result.spec.title,
    summary: result.spec.summary,
    prompt: args.input.prompt,
    sourceUrl: args.input.sourceUrl ?? null,
    sourceRead: result.link
      ? {
          ok: result.link.ok,
          title: result.link.title,
          description: result.link.description,
          image: result.link.image,
          platform: result.link.platform,
          reason: result.link.reason,
        }
      : null,
    referenceImages: args.input.images ?? [],
    stage: "priced",
    dimensions: result.dimensions,
    materials: result.materials,
    steps: result.steps,
    tools: result.spec.tools,
    safety: result.spec.safety,
    skillLevel: result.spec.skillLevel,
    estimatedHours: hours,
    hourlyTarget: args.hourlyTarget,
    resale: result.resale,
    askingPrice: null,
    receipts: [],
    shopping: result.materials.map((m) => ({ materialId: m.id, checked: false })),
    share: null,
    fallbackReason: result.fallbackReason,
    buildType: result.buildType,
    calibration: result.calibration,
    createdAt: args.createdAt ?? nowIso(),
    updatedAt: nowIso(),
    error: null,
    generating: false,
  };
}
