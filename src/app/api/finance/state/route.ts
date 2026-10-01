import { NextResponse } from "next/server";
import { financeContext } from "@/lib/finance/server/context";
import { loadAlerts, loadLedger, setAlertState } from "@/lib/finance/server/store";
import { reconcile } from "@/lib/finance/reconcile";
import { addDays, todayKey } from "@/lib/finance/dates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LOOK_BACK_DAYS = 400;
const LOOK_AHEAD_DAYS = 90;

/**
 * Everything the Finance surface draws, in one read.
 *
 * Reconciliation runs here rather than being stored, so the Due table, the
 * spend figures and the calendar layer are always computed from the live
 * ledgers. Alerts are the one exception and come from their table, because
 * they carry a decision the owner made.
 *
 * With nobody signed in this answers `available: false` and a reason rather
 * than failing, and the surface shows the declared-bills view it can manage
 * without a server.
 */
export async function GET() {
  const ctx = await financeContext();
  if (!ctx.available) {
    return NextResponse.json({ available: false, reason: ctx.reason });
  }

  try {
    const today = todayKey();
    const from = addDays(today, -LOOK_BACK_DAYS);
    const to = addDays(today, LOOK_AHEAD_DAYS);
    const ledger = await loadLedger(ctx, from);
    const result = reconcile({
      bills: ledger.bills,
      accounts: ledger.accounts,
      txns: ledger.txns,
      settings: ledger.settings,
      today,
      from,
      to,
    });
    const alerts = await loadAlerts(ctx);

    return NextResponse.json({
      available: true,
      reason: "",
      today,
      accounts: ledger.accounts,
      bills: ledger.bills,
      settings: ledger.settings,
      // The next 90 days, which is what the Due table and the rail draw.
      occurrences: result.occurrences.filter((o) => o.due >= today),
      matched: result.matched.map((m) => ({
        billId: m.occurrence.billId,
        due: m.occurrence.due,
        amountExpected: m.occurrence.amountExpected,
        paid: m.txn !== null,
        paidOn: m.txn?.date ?? null,
        paidAmount: m.txn?.amount ?? null,
      })),
      spend: result.spend,
      alerts: alerts.filter((a) => a.state === "open" || a.state === "acknowledged"),
      alertHistory: alerts.filter((a) => a.state === "dismissed" || a.state === "resolved"),
      transactions: result.txns.length,
    });
  } catch (e) {
    return NextResponse.json({
      available: false,
      reason: e instanceof Error ? e.message : "Could not read the finance ledger.",
    });
  }
}

/** Answer an alert: that's fine, looks wrong, or I've sorted it. */
export async function POST(req: Request) {
  const ctx = await financeContext();
  if (!ctx.available) {
    return NextResponse.json({ ok: false, reason: ctx.reason }, { status: 401 });
  }
  let body: { id?: string; state?: string; note?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, reason: "Body must be JSON." }, { status: 400 });
  }
  const allowed = ["open", "acknowledged", "dismissed", "resolved"] as const;
  type AlertState = (typeof allowed)[number];
  if (!body.id || !allowed.includes(body.state as AlertState)) {
    return NextResponse.json({ ok: false, reason: "Need an id and a valid state." }, { status: 400 });
  }
  await setAlertState(ctx, body.id, body.state as AlertState, body.note);
  return NextResponse.json({ ok: true });
}
