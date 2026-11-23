import { errorResponse, requireOwner } from "@/lib/dtf/server/access";
import { getStation, listOrders, getSettings, remoteConfigured } from "@/lib/dtf/server/store";

export const dynamic = "force-dynamic";

/** Every order, newest first, plus the numbers the dashboard leads with. */
export async function GET() {
  try {
    await requireOwner();
    const [orders, settings, station] = await Promise.all([listOrders({ limit: 500 }), getSettings(), getStation()]);
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const paidThisMonth = orders
      .filter((o) => o.payment.state === "paid" && o.payment.paidAt && Date.parse(o.payment.paidAt) >= monthStart.getTime())
      .reduce((s, o) => s + o.payment.amountCents, 0);
    const jobs = orders.filter((o) => o.status !== "cancelled").flatMap((o) => o.jobs);
    const seen = station?.lastSeenAt ? Date.parse(station.lastSeenAt) : NaN;
    return Response.json({
      orders,
      settings,
      storage: remoteConfigured() ? "cloud" : "local",
      station: {
        paired: Boolean(station && /^[0-9a-f]{64}$/.test(station.tokenHash)),
        online: Number.isFinite(seen) && Date.now() - seen < 120_000,
        lastSeenAt: station?.lastSeenAt ?? null,
        host: station?.lastSeenHost ?? null,
      },
      stats: {
        awaitingReview: orders.filter((o) => o.status === "incoming" || o.status === "artwork_review").length,
        awaitingPayment: orders.filter((o) => o.payment.state === "awaiting_payment" && o.status !== "cancelled").length,
        inQueue: jobs.filter((j) => j.status === "queued" || j.status === "downloaded" || j.status === "opened").length,
        readyToQueue: jobs.filter((j) => j.status === "file_ready").length,
        pressing: orders.filter((o) => o.status === "heat_transfer" || o.status === "quality_control").length,
        paidThisMonthCents: paidThisMonth,
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
