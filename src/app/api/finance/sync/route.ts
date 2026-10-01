import { NextResponse } from "next/server";
import { financeContext } from "@/lib/finance/server/context";
import {
  listConnections,
  loadLedger,
  openConnection,
  persistFindings,
  supabaseSyncStore,
} from "@/lib/finance/server/store";
import { plaidProvider } from "@/lib/finance/providers/plaid";
import { syncConnection } from "@/lib/finance/providers/sync";
import { PlaidError } from "@/lib/finance/providers/plaid/client";
import { reconcile } from "@/lib/finance/reconcile";
import { addDays, todayKey } from "@/lib/finance/dates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** How far back and forward the reconciliation window runs. */
const LOOK_BACK_DAYS = 400;
const LOOK_AHEAD_DAYS = 90;

/**
 * Pull every connection up to date, reconcile, and record what it found.
 *
 * Sync and reconcile are deliberately one route: findings are derived from the
 * two ledgers, so persisting them from a stale read would record a "missed
 * bill" for a payment that had in fact just arrived in the page being written.
 */
export async function POST() {
  const ctx = await financeContext();
  if (!ctx.available) {
    return NextResponse.json({ ok: false, reason: ctx.reason }, { status: 401 });
  }

  const store = supabaseSyncStore(ctx);
  const connections = await listConnections(ctx);
  const synced: { id: string; institution: string; added: number; error?: string }[] = [];

  for (const c of connections) {
    if (c.provider !== "plaid" || c.status === "revoked") continue;
    try {
      const conn = await openConnection(ctx, c.id);
      if (!conn) {
        synced.push({ id: c.id, institution: c.institutionName, added: 0, error: "No stored token." });
        continue;
      }
      const r = await syncConnection(plaidProvider, conn, store);
      await store.setStatus(c.id, "active", "");
      synced.push({ id: c.id, institution: c.institutionName, added: r.added });
    } catch (e) {
      // A broken link is a state the owner can act on, not a 500. Record it on
      // the connection so the panel can say "reconnect this bank".
      const plaidCode = e instanceof PlaidError ? e.code : "";
      const status = plaidCode === "ITEM_LOGIN_REQUIRED" ? "needs_reauth" : "error";
      const reason = e instanceof Error ? e.message : "Sync failed.";
      await store.setStatus(c.id, status, reason);
      synced.push({ id: c.id, institution: c.institutionName, added: 0, error: reason });
    }
  }

  const today = todayKey();
  const ledger = await loadLedger(ctx, addDays(today, -LOOK_BACK_DAYS));
  const result = reconcile({
    bills: ledger.bills,
    accounts: ledger.accounts,
    txns: ledger.txns,
    settings: ledger.settings,
    today,
    from: addDays(today, -LOOK_BACK_DAYS),
    to: addDays(today, LOOK_AHEAD_DAYS),
  });
  const { opened, resolved } = await persistFindings(ctx, result.findings);

  return NextResponse.json({
    ok: true,
    connections: synced,
    transactions: result.txns.length,
    findings: result.findings.length,
    opened,
    resolved,
    spend: result.spend,
  });
}
