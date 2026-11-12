import { fail, guardRate, requireUser } from "@/lib/buildflip-2/api";
import { getProject, saveProject } from "@/lib/buildflip-2/db/projects";
import { UPGRADE_MOMENTS } from "@/lib/buildflip-2/billing/plans";
import { MONETIZATION_ENABLED } from "@/lib/buildflip-2/flags";
import { withLogging, log } from "@/lib/buildflip-2/log";
import { aiConfigured, chat, extractJson } from "@/lib/buildflip-2/ai/chat";
import {
  COMPS_SYSTEM,
  PRICING_SYSTEM,
  compsUser,
  pricingUser,
} from "@/lib/buildflip-2/ai/prompts";
import { compsResult, pricingResult } from "@/lib/buildflip-2/ai/schema";
import { estimateResale, money, recostMaterials } from "@/lib/buildflip-2/calc";
import type { Comp, Material } from "@/lib/buildflip-2/types";

export const runtime = "nodejs";
export const maxDuration = 300;

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/plan/[id]/reprice — re-check every material price and every comp
 * against today's listings, so a plan made last month is still a number you can
 * trust. Pro only, server-enforced, and rate limited because it costs per call.
 *
 * A price the user set by hand is never overwritten.
 */
export const POST = withLogging("plan_reprice", async (_req: Request, ctx: Params) => {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  if (MONETIZATION_ENABLED && auth.ctx.account.plan !== "pro") {
    return fail(402, UPGRADE_MOMENTS.reprice.body, { paywall: true, moment: "reprice" });
  }
  if (!aiConfigured()) {
    return fail(503, "Live re-pricing needs an AI key. Right now prices come from the demo catalog.");
  }

  const limited = await guardRate(auth.ctx.user.id, "reprice", { costly: true });
  if (limited) return limited;

  const { id } = await ctx.params;
  const project = await getProject(auth.ctx.user.id, id);
  if (!project) return fail(404, "That plan doesn't exist, or isn't yours.");
  if (!project.materials.length) return fail(400, "That plan has no materials to re-price.");

  const checkedAt = new Date().toISOString();
  const repriceable = project.materials.filter((m) => !m.userOverride);

  // Keep the first real failure so we can tell the user WHY, not just "nope".
  let failure: string | null = null;
  const noteFailure = (err: unknown) => {
    const m = (err as Error)?.message ?? "";
    if (failure) return;
    failure = /out of credit|402/i.test(m)
      ? "The live pricing service is out of credit, so prices can't be re-checked right now. Nothing on your plan was changed."
      : /rate|429/i.test(m)
        ? "The pricing search is rate-limited right now. Nothing was changed — try again in a minute."
        : /timeout|abort/i.test(m)
          ? "The pricing search timed out. Nothing was changed — try again."
          : "The pricing search didn't answer. Nothing was changed — try again in a minute.";
  };

  const [priceOut, compsOut] = await Promise.all([
    chat({
      system: PRICING_SYSTEM,
      user: pricingUser(repriceable),
      webSearchResults: Math.min(12, Math.max(6, repriceable.length)),
      maxTokens: 6000,
      timeoutMs: 110_000,
    })
      .then((r) => pricingResult.parse(extractJson(r.text)).materials)
      .catch(async (err) => {
        await log({ level: "warn", event: "reprice_prices_failed", message: (err as Error)?.message });
        noteFailure(err);
        return null;
      }),
    chat({
      system: COMPS_SYSTEM,
      user: compsUser(project),
      webSearchResults: 10,
      maxTokens: 4000,
      timeoutMs: 110_000,
    })
      .then((r) => compsResult.parse(extractJson(r.text)))
      .catch(async (err) => {
        await log({ level: "warn", event: "reprice_comps_failed", message: (err as Error)?.message });
        noteFailure(err);
        return null;
      }),
  ]);

  if (!priceOut && !compsOut) {
    return fail(
      502,
      failure ?? "The pricing search didn't answer. Nothing was changed — try again in a minute.",
    );
  }

  let changed = 0;
  let materials: Material[] = project.materials;

  if (priceOut) {
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    materials = project.materials.map((m) => {
      if (m.userOverride) return m;
      const hit = priceOut.find((p) => norm(p.name) === norm(m.name));
      if (!hit) return m;
      const unitPrice = money(hit.unitPrice);
      if (unitPrice > 0 && Math.abs(unitPrice - m.unitPrice) > 0.009) changed++;
      return {
        ...m,
        unitPrice: unitPrice > 0 ? unitPrice : m.unitPrice,
        provenance: {
          source: hit.retailer,
          url: hit.url ?? null,
          checkedAt,
          confidence: hit.confidence ?? (hit.url ? "high" : "low"),
          note: hit.note ?? (hit.url ? undefined : "Market estimate, no listing found."),
          demo: false,
        },
      };
    });
  }

  let resale = project.resale;
  let compsReplaced = false;
  if (compsOut) {
    const comps: Comp[] = compsOut.comps.map((c, i) => ({
      id: `k${i.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      title: c.title,
      price: money(c.price),
      sold: c.sold,
      soldAt: c.soldAt,
      marketplace: c.marketplace,
      url: c.url,
      condition: c.condition,
      provenance: {
        source: `${c.marketplace}${c.sold ? " (sold)" : " (asking)"}`,
        url: c.url,
        checkedAt,
        confidence: c.sold ? (c.url ? "high" : "medium") : "low",
        note: c.sold ? undefined : "This is an asking price, not a sale. Shown but never counted.",
        demo: false,
      },
    }));
    const fresh = estimateResale(
      comps,
      checkedAt,
      "Completed sales across marketplaces",
      false,
    );
    /**
     * An empty answer is not evidence the market vanished.
     *
     * `compsResult` allows `comps: []`, and overwriting unconditionally turned
     * a plan with nine sold comps and a "Build it" into "No sold market" — with
     * no way back except another search. A search that finds nothing leaves
     * what we already knew alone.
     */
    if (fresh.soldCount > 0 || (project.resale?.soldCount ?? 0) === 0) {
      resale = fresh;
      compsReplaced = true;
      if (compsOut.marketNote && resale.thin) {
        resale.thinReason = `${resale.thinReason ?? ""} ${compsOut.marketNote}`.trim();
      }
    }
  }

  const saved = await saveProject({
    ...project,
    materials: recostMaterials(materials, project.dimensions),
    resale,
  });

  return Response.json({
    project: saved,
    changed,
    // Say which half actually ran. Reporting "nothing has moved" when the
    // price search never answered presents a month-old price as fresh.
    pricesRechecked: Boolean(priceOut),
    compsRechecked: compsReplaced,
    warning: failure as string | null,
    repricedAt: checkedAt,
  });
});
