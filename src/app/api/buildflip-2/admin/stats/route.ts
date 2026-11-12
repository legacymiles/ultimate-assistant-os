import { requireOwner } from "@/lib/buildflip-2/api";
import { estimateAccuracy, money } from "@/lib/buildflip-2/calc";
import { keys, listAllByPrefix, serviceStore } from "@/lib/buildflip-2/db/store";
import { ownerUserId } from "@/lib/buildflip-2/db/owner";
import { capabilities } from "@/lib/buildflip-2/flags";
import { persistedErrors, recentLogs, withLogging, type LogEntry } from "@/lib/buildflip-2/log";
import { supabaseService } from "@/lib/buildflip-2/supabase/service";
import type { Account, Project } from "@/lib/buildflip-2/types";
import { TIERS } from "@/lib/buildflip-2/billing/plans";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/stats — the owner dashboard's data.
 * Locked to OWNER_EMAIL on the SERVER (S3). A non-owner gets a 404, not a 403,
 * so the route's existence isn't even confirmed.
 */
export const GET = withLogging("admin_stats", async () => {
  const auth = await requireOwner();
  if (!auth.ok) return auth.response;

  const [projects, accounts, leads] = await Promise.all([
    listAllByPrefix<Project>(keys.projectPrefix(), 1000),
    listAllByPrefix<Account>(keys.account(), 1000),
    listAllByPrefix<{ email: string; createdAt: string; source?: string }>(
      keys.leadPrefix(),
      1000,
    ),
  ]);

  const realProjects = projects
    .map((r) => r.data)
    .filter((p): p is Project => Boolean(p?.id && p.materials));

  let signups = 0;
  try {
    const sb = supabaseService();
    if (sb) {
      const { data } = await sb.auth.admin.listUsers({ page: 1, perPage: 1 });
      signups = (data as { total?: number } | undefined)?.total ?? 0;
    }
  } catch {
    /* non-fatal */
  }

  const accountRows = accounts
    .map((r) => r.data)
    .filter((a): a is Account => Boolean(a?.userId));
  const payers = accountRows.filter((a) => a.plan === "pro");
  const monthly = TIERS.find((t) => t.id === "pro")?.monthly ?? 9;

  const day = 864e5;
  const now = Date.now();
  const since = (d: number) => new Date(now - d * day).toISOString();

  const withReceipts = realProjects.filter((p) => p.receipts?.length);
  const accuracies = withReceipts
    .map((p) => estimateAccuracy(p))
    .filter((a): a is NonNullable<ReturnType<typeof estimateAccuracy>> => Boolean(a));
  const errs = accuracies.map((a) => Math.abs(a.deltaPct)).sort((x, y) => x - y);

  const byType = new Map<string, { builds: number; receipts: number }>();
  for (const p of realProjects) {
    const row = byType.get(p.buildType) ?? { builds: 0, receipts: 0 };
    row.builds++;
    if (p.receipts?.length) row.receipts++;
    byType.set(p.buildType, row);
  }

  // The owner's error ring: persisted rows first, in-process as a fallback.
  let errors: LogEntry[] = await persistedErrors();
  if (errors.length === 0) errors = recentLogs().filter((l) => l.level === "error");

  return Response.json({
    funnel: {
      signups,
      accounts: accountRows.length,
      // The aha action: a plan that actually produced a verdict.
      ahaUsers: new Set(realProjects.filter((p) => p.resale).map((p) => p.ownerId)).size,
      returning: new Set(
        realProjects.filter((p) => p.updatedAt > since(1) && p.createdAt < since(1)).map((p) => p.ownerId),
      ).size,
      leads: leads.length,
    },
    plans: {
      total: realProjects.length,
      last7: realProjects.filter((p) => p.createdAt > since(7)).length,
      last30: realProjects.filter((p) => p.createdAt > since(30)).length,
      withReceipts: withReceipts.length,
      sold: realProjects.filter((p) => p.stage === "sold").length,
      shared: realProjects.filter((p) => p.share?.enabled).length,
    },
    revenue: {
      payers: payers.length,
      mrr: money(payers.length * monthly),
      conversion: accountRows.length ? payers.length / accountRows.length : 0,
      trialing: payers.filter((a) => a.subscription?.status === "trialing").length,
      simulated: payers.filter((a) => a.subscription?.status === "simulated").length,
    },
    accuracy: {
      samples: errs.length,
      medianErrorPct: errs.length ? errs[Math.floor(errs.length / 2)]! : null,
      within15: accuracies.filter((a) => a.within15).length,
    },
    buildTypes: [...byType.entries()]
      .map(([type, v]) => ({ type, ...v }))
      .sort((a, b) => b.builds - a.builds)
      .slice(0, 12),
    recent: realProjects
      .slice()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 12)
      .map((p) => ({
        id: p.id,
        title: p.title,
        buildType: p.buildType,
        stage: p.stage,
        createdAt: p.createdAt,
        soldComps: p.resale?.soldCount ?? 0,
        demo: p.resale?.provenance.demo ?? false,
      })),
    errors: errors.slice(0, 25),
    capabilities: capabilities(),
  });
});
