import { errorResponse, HttpError, requireOwner } from "@/lib/dtf/server/access";
import { sendStatusUpdate } from "@/lib/dtf/server/mail";
import { markPaid } from "@/lib/dtf/server/orders";
import { getOrder, getSettings, updateOrder } from "@/lib/dtf/server/store";
import { canMove, STATUS_LABEL } from "@/lib/dtf/pipeline";
import type { Order, OrderStatus } from "@/lib/dtf/types";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireOwner();
    const { id } = await ctx.params;
    const order = await getOrder(id);
    if (!order) throw new HttpError(404, "That order does not exist.");
    return Response.json({ order });
  } catch (e) {
    return errorResponse(e);
  }
}

/**
 * Operator changes: move the stage (one step at a time, or cancel), save
 * production notes, add tracking, mark a manual payment received. Each change
 * lands in the order's history; the customer is emailed at the moments that
 * matter to them (approved, ready, shipped).
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const owner = await requireOwner();
    const { id } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as {
      status?: OrderStatus;
      productionNotes?: string;
      trackingNumber?: string;
      markPaid?: boolean;
    };
    if (body.markPaid) {
      const o = await markPaid(id, "owner", `Payment marked received by ${owner.email || "the shop"}.`);
      if (!o) throw new HttpError(404, "That order does not exist.");
    }
    let movedTo: OrderStatus | null = null;
    const now = () => new Date().toISOString();
    const next = await updateOrder(id, (o: Order) => {
      let changed = false;
      if (typeof body.productionNotes === "string" && body.productionNotes !== o.productionNotes) {
        o.productionNotes = body.productionNotes.slice(0, 4000);
        changed = true;
      }
      if (typeof body.trackingNumber === "string" && body.trackingNumber.trim() !== (o.trackingNumber ?? "")) {
        o.trackingNumber = body.trackingNumber.trim().slice(0, 80) || undefined;
        o.history.push({ at: now(), by: "owner", kind: "tracking", message: o.trackingNumber ? `Tracking number added: ${o.trackingNumber}.` : "Tracking number removed." });
        changed = true;
      }
      if (body.status && body.status !== o.status) {
        if (!canMove(o.status, body.status)) {
          throw new HttpError(409, `An order can't jump from ${STATUS_LABEL[o.status]} to ${STATUS_LABEL[body.status]} — move one stage at a time.`);
        }
        if (body.status === "print_ready" && !o.jobs.every((j) => j.file && j.status !== "awaiting_approval")) {
          throw new HttpError(409, "Approve and generate every print file before marking the order print-ready.");
        }
        o.history.push({ at: now(), by: "owner", kind: "status", message: `${STATUS_LABEL[o.status]} → ${STATUS_LABEL[body.status]}.` });
        o.status = body.status;
        movedTo = body.status;
        changed = true;
      }
      return changed ? o : null;
    });
    if (!next) throw new HttpError(404, "That order does not exist.");
    if (movedTo) await sendStatusUpdate(next, (await getSettings()).shopName);
    return Response.json({ order: next });
  } catch (e) {
    return errorResponse(e);
  }
}
