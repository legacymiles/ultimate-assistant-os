/**
 * Pure calculation core. No I/O, no React — so the numbers the whole product
 * turns on can be tested exactly.
 */

import type {
  Comp,
  Confidence,
  Dimension,
  Material,
  Project,
  Receipt,
  ResaleEstimate,
  Verdict,
} from "./types";

export const money = (n: number) => Math.round(n * 100) / 100;

export function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

/** Format cents-accurate currency. Always 2dp under $1000, 0dp above, for density. */
export function fmtMoney(n: number, opts: { cents?: boolean } = {}) {
  const abs = Math.abs(n);
  const cents = opts.cents ?? abs < 1000;
  return (
    (n < 0 ? "-$" : "$") +
    abs.toLocaleString("en-US", {
      minimumFractionDigits: cents ? 2 : 0,
      maximumFractionDigits: cents ? 2 : 0,
    })
  );
}

export function fmtPct(n: number) {
  return `${(n * 100).toFixed(n === 0 || Math.abs(n) >= 0.1 ? 0 : 1)}%`;
}

/**
 * The one way an hourly rate is ever rendered. Hours are genuinely unknown on
 * some plans, and "unknown" must read as unknown rather than as a big number.
 */
export function fmtRate(rate: number | null, fallback = "—") {
  if (rate == null || !Number.isFinite(rate)) return fallback;
  return `${fmtMoney(rate, { cents: false })}/hr`;
}

export function fmtHours(h: number) {
  if (h < 1) return `${Math.round(h * 60)} min`;
  const whole = Math.floor(h);
  const mins = Math.round((h - whole) * 60);
  return mins ? `${whole}h ${mins}m` : `${whole}h`;
}

/* ---------------------------------------------------------------- quantities */

/**
 * Re-count a material when a driving dimension changes.
 * `linear` scales with the ratio, `area` with its square, `fixed` never moves.
 * Quantities are always rounded UP to whole units for discrete goods — you
 * cannot buy 3.2 boards.
 */
export function scaleQuantity(
  material: Material,
  dimensions: Dimension[],
): number {
  // Always scale from the ORIGINAL costed quantity. Scaling from the current
  // one would compound: size a build up, then back down, and it would never
  // return to where it started.
  const base = material.baseQuantity ?? material.quantity;
  if (material.scaling === "fixed") return base;

  const ratioFor = (key: string | undefined): number | null => {
    if (!key) return null;
    const dim = dimensions.find((d) => d.key === key);
    if (!dim || !dim.baseline || dim.baseline <= 0) return null;
    return dim.value / dim.baseline;
  };

  let factor: number;
  if (material.scaling === "area") {
    /**
     * Area scales with TWO dimensions when we know both. Squaring a single
     * one is only right for a square: on a 48×36 frame, doubling the height
     * alone doubles the glazing area, but a one-driver model either ignores
     * the change entirely or quadruples it when the width moves.
     */
    const a = ratioFor(material.driver);
    const b = ratioFor(material.driver2);
    if (a != null && b != null) factor = a * b;
    else if (a != null) factor = a * a;
    else if (b != null) factor = b * b;
    else return base;
  } else {
    const a = ratioFor(material.driver);
    if (a == null) return base;
    factor = a;
  }

  const raw = base * factor;

  // Continuous goods (feet of trim, quarts of finish) keep one decimal;
  // discrete goods round up to the next whole unit.
  const continuous = /^(ft|foot|feet|in|inch|yd|yard|m|sq ?ft|sqft|lb|oz|qt|gal|l|ml)$/i.test(
    material.unit.trim(),
  );
  if (continuous) return Math.max(0.1, Math.round(raw * 10) / 10);
  return Math.max(1, Math.ceil(raw - 1e-9));
}

/** Apply current dimensions to every material and recompute line totals. */
export function recostMaterials(
  materials: Material[],
  dimensions: Dimension[],
): Material[] {
  return materials.map((m) => {
    const quantity = scaleQuantity(m, dimensions);
    return { ...m, quantity, lineTotal: money(quantity * m.unitPrice) };
  });
}

export function materialsTotal(materials: Material[], includeOptional = false) {
  return money(
    materials
      .filter((m) => includeOptional || !m.optional)
      .reduce((sum, m) => sum + money(m.quantity * m.unitPrice), 0),
  );
}

/* --------------------------------------------------------------------- comps */

/**
 * Build a resale range from comps. Only *completed sales* feed the range —
 * asking prices are kept for display but never averaged in. That is the single
 * most common way flippers fool themselves.
 */
export function estimateResale(
  comps: Comp[],
  checkedAt: string,
  sourceLabel = "Sold listings",
  demo = false,
): ResaleEstimate {
  const sold = comps
    .filter((c) => c.sold && Number.isFinite(c.price) && c.price > 0)
    .sort((a, b) => a.price - b.price);

  if (sold.length === 0) {
    const asking = comps.filter((c) => !c.sold).length;
    return {
      low: 0,
      mid: 0,
      high: 0,
      soldCount: 0,
      thin: true,
      thinReason: asking
        ? `No completed sales found — only ${asking} asking price${asking === 1 ? "" : "s"}, which is not evidence of what it sells for.`
        : "No completed sales found for anything like this. The resale side of this ROI is a guess, so we are not making one.",
      confidence: "low",
      comps,
      provenance: {
        source: sourceLabel,
        url: null,
        checkedAt,
        confidence: "low",
        note: "No sold records found.",
        demo,
      },
    };
  }

  const prices = sold.map((c) => c.price);
  const low = percentile(prices, 0.2);
  const mid = percentile(prices, 0.5);
  const high = percentile(prices, 0.8);

  const spread = mid > 0 ? (high - low) / mid : 1;
  const thin = sold.length < 4;
  const confidence: Confidence =
    sold.length >= 8 && spread < 0.6 ? "high" : sold.length >= 4 ? "medium" : "low";

  return {
    low: money(low),
    mid: money(mid),
    high: money(high),
    soldCount: sold.length,
    thin,
    thinReason: thin
      ? `Only ${sold.length} completed sale${sold.length === 1 ? "" : "s"} found. Treat this range as a hint, not a price.`
      : undefined,
    confidence,
    comps,
    provenance: {
      source: sourceLabel,
      url: null,
      checkedAt,
      confidence,
      note: `${sold.length} completed sale${sold.length === 1 ? "" : "s"}${
        spread >= 0.6 ? ", wide spread" : ""
      }.`,
      demo,
    },
  };
}

/** Linear-interpolated percentile over a sorted ascending array. */
export function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  if (sortedAsc.length === 1) return sortedAsc[0]!;
  const idx = clamp(p, 0, 1) * (sortedAsc.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedAsc[lo]!;
  return sortedAsc[lo]! + (sortedAsc[hi]! - sortedAsc[lo]!) * (idx - lo);
}

/* ------------------------------------------------------------------ receipts */

export function receiptsTotal(receipts: Receipt[]) {
  return money(receipts.reduce((s, r) => s + (Number(r.amount) || 0), 0));
}

/**
 * Estimate vs reality. `delta` is positive when reality cost MORE than we said.
 * Returns null until there is at least one receipt — we never show a 0% error
 * as if it were an achievement.
 */
export function estimateAccuracy(project: Project): {
  estimate: number;
  actual: number;
  delta: number;
  deltaPct: number;
  within15: boolean;
  /** How much of the planned list has actually been bought. */
  coverage: number;
} | null {
  if (project.receipts.length === 0) return null;
  const materials = recostMaterials(project.materials, project.dimensions);
  const estimate = materialsTotal(materials);
  const actual = receiptsTotal(project.receipts);
  const planned = materials.filter((m) => !m.optional);
  const plannedIds = new Set(planned.map((m) => m.id));
  // Only receipts against a PLANNED item count toward coverage. A receipt for
  // an optional extra would otherwise inflate coverage and could trip the
  // "use real spend" switch while the actual list is still unbought.
  const covered = new Set(
    project.receipts
      .map((r) => r.materialId)
      .filter((id): id is string => Boolean(id) && plannedIds.has(id!)),
  );
  const coverage = planned.length ? covered.size / planned.length : 0;
  const delta = money(actual - estimate);
  return {
    estimate,
    actual,
    delta,
    deltaPct: estimate > 0 ? delta / estimate : 0,
    within15: estimate > 0 ? Math.abs(delta / estimate) <= 0.15 : false,
    coverage: clamp(coverage, 0, 1),
  };
}

/* ------------------------------------------------------------------- verdict */

/**
 * The ROI verdict. This is the answer the product exists to give, so it is
 * deliberately conservative:
 *  - real receipts beat estimates the moment they exist
 *  - the resale figure is the MIDPOINT of completed sales, never the high
 *  - a thin market downgrades the call rather than inflating the profit
 */
export function computeVerdict(
  project: Project,
  liveHourlyTarget?: number | null,
): Verdict {
  const materials = recostMaterials(project.materials, project.dimensions);
  const materialCost = materialsTotal(materials);

  const receipts = receiptsTotal(project.receipts);
  const acc = estimateAccuracy(project);

  // Once more than 80% of the list is bought, reality replaces the estimate.
  // Below that we blend: receipts for what's bought, estimate for the rest.
  let actualCost = materialCost;
  let costBasis: Verdict["costBasis"] = "estimate";
  if (acc && receipts > 0) {
    if (acc.coverage >= 0.8 || project.stage === "sold") {
      actualCost = receipts;
      costBasis = "actual";
    } else {
      /**
       * Blend: what's been paid, plus the estimate for what hasn't.
       *
       * The subtlety is receipts with no material attached — "Something not on
       * the list" is the default option in the log-a-purchase form, and a
       * hardware-store run is usually logged as one lump. Those have to pay
       * DOWN the unbought remainder, not stack on top of it. Adding a $950
       * unattributed receipt to a $1,000 untouched estimate once produced a
       * $1,950 "cost" and flipped a good build to "Skip it".
       */
      const boughtIds = new Set(
        project.receipts.map((r) => r.materialId).filter(Boolean) as string[],
      );
      const remaining = materials
        .filter((m) => !m.optional && !boughtIds.has(m.id))
        .reduce((s, m) => s + m.lineTotal, 0);
      const unattributed = project.receipts
        .filter((r) => !r.materialId)
        .reduce((s, r) => s + (Number(r.amount) || 0), 0);
      actualCost = money(receipts + Math.max(0, remaining - unattributed));
      costBasis = "mixed";
    }
  }

  /**
   * Materials we could not find a price for. These are the most dangerous
   * number in the product: they total as zero, which makes a build look
   * cheaper and the margin look better. A plan with unpriced lines can never
   * be a "build it", and it can never be reported as confident.
   */
  const unpriced = materials.filter((m) => !m.optional && m.unitPrice <= 0);

  const compMid = project.resale?.mid ?? 0;
  const salePrice = project.askingPrice ?? compMid;
  const salePriceBasis: Verdict["salePriceBasis"] =
    project.askingPrice != null ? "asking" : "comps";

  const hours = Math.max(0, project.estimatedHours || 0);
  const profit = money(salePrice - actualCost);
  const margin = salePrice > 0 ? profit / salePrice : 0;
  /**
   * null, not Infinity, when there are no hours. Infinity formats as "$∞/hr"
   * and compares as greater than every target, which turned a plan with no
   * hours into "Build it — $∞/hr against your $25 target".
   */
  const hourlyRate: number | null = hours > 0 ? money(profit / hours) : null;

  // The live account target wins; the per-plan value is only a fallback, so
  // changing what your time is worth re-judges the plans you already have.
  const target = liveHourlyTarget ?? project.hourlyTarget ?? 25;
  const thin = project.resale?.thin ?? true;
  const noMarket = !project.resale || project.resale.soldCount === 0;

  let call: Verdict["call"];
  let headline: string;
  const drivers: string[] = [];

  const rateText =
    hourlyRate == null ? "no hours set" : `${fmtMoney(hourlyRate)}/hr`;

  if (noMarket) {
    call = "skip";
    headline = "No sold market — we can't call this one";
    drivers.push("0 completed sales found for a comparable finished piece");
    drivers.push(`${fmtMoney(actualCost)} of materials against an unknown resale`);
  } else if (unpriced.length > 0) {
    // A total built on missing prices is a floor, not an estimate. Saying
    // "build it" off it would be the most expensive kind of wrong.
    call = "maybe";
    headline = "Incomplete — some materials have no price";
    drivers.push(
      `${unpriced.length} of ${materials.filter((m) => !m.optional).length} materials have no price, so ${fmtMoney(actualCost)} is a floor, not a total`,
    );
    drivers.push("Set those prices yourself, or re-price the plan, then judge it");
  } else if (profit <= 0) {
    call = "skip";
    headline = "Skip it — this loses money";
    drivers.push(
      `${fmtMoney(actualCost)} in materials vs ${fmtMoney(salePrice)} typical sale`,
    );
    drivers.push(`${fmtMoney(profit)} before you count a single hour`);
  } else if (hourlyRate == null) {
    call = "maybe";
    headline = "No hours set — we can't price your time";
    drivers.push(`${fmtMoney(profit)} profit on ${fmtMoney(actualCost)} of materials`);
    drivers.push("Add the hours this takes and we can tell you the rate it pays");
  } else if (hourlyRate < target * 0.6) {
    // The hourly rate has an absolute veto. A fat margin on a huge number of
    // hours is still a bad job, and pretending otherwise is the exact mistake
    // this product exists to stop.
    call = "skip";
    headline = "Skip it — your hours are worth more elsewhere";
    drivers.push(
      `${rateText} for ${fmtHours(hours)} of work, against your ${fmtMoney(target, { cents: false })} target`,
    );
    drivers.push(
      `${fmtPct(margin)} margin looks fine until you price your own time`,
    );
  } else if (hourlyRate >= target && margin >= 0.4 && !thin) {
    call = "build";
    headline = "Build it — the numbers hold up";
    drivers.push(
      `${rateText} against your ${fmtMoney(target, { cents: false })} target`,
    );
    drivers.push(`${fmtPct(margin)} margin on ${fmtHours(hours)} of work`);
  } else {
    call = "maybe";
    headline = thin
      ? "Worth a shot, but the market is thin"
      : "Marginal — only if you enjoy the build";
    drivers.push(
      hourlyRate != null && hourlyRate >= target
        ? `${rateText} clears your ${fmtMoney(target, { cents: false })} target`
        : `${rateText} is under your ${fmtMoney(target, { cents: false })} target`,
    );
    drivers.push(
      thin
        ? `only ${project.resale?.soldCount ?? 0} sold comps behind the ${fmtMoney(salePrice)} estimate`
        : `${fmtPct(margin)} margin leaves little room for a mistake`,
    );
  }

  const confidence: Confidence =
    unpriced.length > 0 || noMarket
      ? "low"
      : costBasis === "actual" && !thin
        ? "high"
        : thin && costBasis === "estimate"
          ? "low"
          : "medium";

  return {
    materialCost,
    actualCost,
    costBasis,
    salePrice,
    salePriceBasis,
    profit,
    margin,
    hours,
    hourlyRate,
    unpricedCount: unpriced.length,
    call,
    headline,
    drivers,
    confidence,
  };
}

/** Profit per hour — the only honest way to rank two builds against each other. */
/**
 * Profit per hour, or null when the hours are unknown.
 *
 * Deliberately NOT falling back to total profit: that renders as "$450/hr" and
 * sorts to the top of a page whose entire premise is that a big total on a lot
 * of hours loses to a small one on an afternoon.
 */
export function profitPerHour(project: Project): number | null {
  return computeVerdict(project).hourlyRate;
}

/** Sort key: plans with no hours rank last rather than first. */
export function profitPerHourSort(project: Project): number {
  const rate = profitPerHour(project);
  return rate == null ? Number.NEGATIVE_INFINITY : rate;
}

/* --------------------------------------------------------------- calibration */

/**
 * The loop that makes the app sharper over time: pooled real receipts for a
 * build type produce a correction factor applied to new estimates of the same
 * type. Needs at least 3 finished builds before it dares touch a number, and
 * never moves an estimate by more than 35% on its own.
 */
export function calibrationFactor(
  samples: { estimate: number; actual: number }[],
): { factor: number; sampleSize: number } | null {
  const usable = samples.filter(
    (s) => s.estimate > 0 && s.actual > 0 && s.actual / s.estimate < 5,
  );
  if (usable.length < 3) return null;
  const ratios = usable.map((s) => s.actual / s.estimate).sort((a, b) => a - b);
  const median = percentile(ratios, 0.5);
  return {
    factor: clamp(Math.round(median * 1000) / 1000, 0.65, 1.35),
    sampleSize: usable.length,
  };
}

/** Normalise a free-text build idea into a poolable build-type key. */
export function buildTypeKey(title: string, summary = ""): string {
  const text = `${title} ${summary}`.toLowerCase();
  const buckets: [string, RegExp][] = [
    ["picture-frame", /\b(picture|photo)\s*frame|\bframe\b/],
    ["hot-tub-boat", /hot\s*tub\s*boat|tub\s*boat/],
    ["hot-tub", /hot\s*tub|soaking\s*tub|cedar\s*tub/],
    ["fireplace", /fireplace|mantel|mantle|fire\s*pit|firepit/],
    ["table", /\btable\b|desk|workbench|bench\b/],
    ["bed", /\bbed\b|headboard|bunk/],
    ["shelving", /shelf|shelves|shelving|bookcase/],
    ["cabinet", /cabinet|cupboard|vanity|dresser|wardrobe/],
    ["planter", /planter|raised\s*bed|garden\s*box/],
    ["shed", /\bshed\b|cabin|tiny\s*house|she\s*shed/],
    ["sauna", /sauna/],
    ["pergola", /pergola|gazebo|arbor|arbour/],
    ["deck", /\bdeck\b|decking|boardwalk/],
    ["door", /\bdoor\b|barn\s*door|gate\b/],
    ["sign", /\bsign\b|lettering|neon/],
    ["chair", /chair|stool|adirondack|rocker/],
    ["cutting-board", /cutting\s*board|charcuterie|butcher\s*block/],
    ["trailer", /trailer|teardrop|camper/],
    ["playset", /playhouse|swing\s*set|playset|treehouse/],
    ["mirror", /mirror/],
  ];
  for (const [key, re] of buckets) if (re.test(text)) return key;
  return "other";
}
