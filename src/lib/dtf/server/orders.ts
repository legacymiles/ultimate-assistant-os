// ---------------------------------------------------------------------------
// Orders: building one from a cart, taking payment, and what a customer may
// see of it. Prices are always recomputed here from ./pricing — a browser's
// total is never trusted.
// ---------------------------------------------------------------------------

import "server-only";

import Stripe from "stripe";
import { getColor, getGarment } from "../garments";
import { orderNumber } from "../pipeline";
import { CURRENCY, quote, shippingFor } from "../pricing";
import { activeZone, sideLayers, unionBounds } from "../project";
import { checkProject } from "../readiness";
import { getPrinter } from "../printers";
import type { CustomerOrderView, Order, OrderEvent, OrderItem, PrintJob, ReadinessReport, ShippingDetails } from "../types";
import { newId } from "./access";
import { sendOrderReceived } from "./mail";
import { createOrder, getAsset, getSettings, nextOrderSeq, updateOrder } from "./store";
import { assetIdsOf, cleanProject, InvalidProject } from "./validate";

const STRIPE_KEY = process.env.STRIPE_SECRET_KEY?.trim();
export const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET?.trim();

let stripeClient: Stripe | null = null;
export function stripe(): Stripe | null {
  if (!STRIPE_KEY) return null;
  if (!stripeClient) stripeClient = new Stripe(STRIPE_KEY, { apiVersion: "2025-08-27.basil", appInfo: { name: "DTF Studio" } });
  return stripeClient;
}
export const stripeTestMode = () => Boolean(STRIPE_KEY?.startsWith("sk_test_"));

export interface CartLine {
  project: unknown;
  quantity: number;
  mockups?: Record<string, string>;
  readiness?: ReadinessReport;
}

export interface CheckoutInput {
  lines: CartLine[];
  shipping: ShippingDetails;
  note?: string;
}

const event = (by: OrderEvent["by"], kind: string, message: string): OrderEvent => ({ at: new Date().toISOString(), by, kind, message });

function cleanShipping(s: Partial<ShippingDetails> | undefined): ShippingDetails {
  const t = (v: unknown, n = 120) => (typeof v === "string" ? v.trim().slice(0, n) : "");
  const method = s?.method === "pickup" ? "pickup" : "ship";
  const out: ShippingDetails = { method, name: t(s?.name), phone: t(s?.phone, 40) || undefined };
  if (!out.name) throw new InvalidProject("Add the name for the order.");
  if (method === "ship") {
    Object.assign(out, { line1: t(s?.line1), line2: t(s?.line2) || undefined, city: t(s?.city, 80), region: t(s?.region, 80), postal: t(s?.postal, 20), country: t(s?.country, 2).toUpperCase() || "US" });
    if (!out.line1 || !out.city || !out.postal) throw new InvalidProject("Add a street, city and postcode for shipping.");
  }
  return out;
}

export async function placeOrder(user: { id: string; email: string }, input: CheckoutInput, origin: string): Promise<{ order: Order; checkoutUrl: string | null }> {
  if (!Array.isArray(input.lines) || !input.lines.length) throw new InvalidProject("Your bag is empty.");
  if (input.lines.length > 20) throw new InvalidProject("That's more than 20 designs in one order — split it in two.");
  const settings = await getSettings();
  const printer = getPrinter(settings.printerId);
  const shipping = cleanShipping(input.shipping);
  const orderId = newId("ord");

  const items: OrderItem[] = [];
  const jobs: PrintJob[] = [];
  for (const line of input.lines) {
    const project = cleanProject(line.project, true);
    // Every file the design uses must be this customer's own upload.
    for (const id of assetIdsOf(project)) {
      const a = await getAsset(id);
      if (!a || a.userId !== user.id) throw new InvalidProject("One of the images in this design isn't available any more. Re-upload it and try again.");
    }
    // The server's own readiness pass (no pixels here — the dimension, DPI,
    // width and placement checks). A blocking problem stops the sale.
    const serverCheck = checkProject({ project, printer, safeWidthMm: settings.safeWidthMm, stats: {} });
    if (serverCheck.verdict === "block") {
      throw new InvalidProject(serverCheck.issues.find((i) => i.severity === "block")?.message ?? "This design can't be printed as it is.");
    }
    const q = quote(project);
    const quantity = Math.max(1, Math.min(50, Math.round(Number(line.quantity) || 1)));
    const itemId = newId("itm");
    const mockups: OrderItem["mockups"] = {};
    for (const [side, assetId] of Object.entries(line.mockups ?? {})) {
      const a = typeof assetId === "string" ? await getAsset(assetId).catch(() => null) : null;
      if (a && a.userId === user.id && a.kind === "mockup" && ["front", "back", "sleeve-left", "sleeve-right"].includes(side)) {
        mockups[side as keyof OrderItem["mockups"]] = assetId;
      }
    }
    items.push({ id: itemId, project, garmentId: project.garmentId, colorId: project.colorId, size: project.size, quantity, unitCents: q.unitCents, mockups });
    for (const { side, zoneId } of q.printed) {
      const b = unionBounds(sideLayers(project, side))!;
      const zone = activeZone(project, side);
      jobs.push({
        id: newId("job"),
        orderId,
        orderNumber: "",
        itemId,
        side,
        zoneId: zone?.id ?? zoneId,
        artworkWidthCm: Math.round((b.maxX - b.minX) * 100) / 100,
        artworkHeightCm: Math.round((b.maxY - b.minY) * 100) / 100,
        pressTopCm: Math.round(-b.maxY * 10) / 10,
        pressCenterOffsetCm: Math.round(((b.minX + b.maxX) / 2) * 10) / 10,
        status: "awaiting_approval",
        // The customer's browser ran the pixel checks; the server ran the
        // physical ones. The operator sees both.
        readiness: mergeReadiness(serverCheck, line.readiness),
      });
    }
  }

  const subtotal = items.reduce((s, it) => s + it.unitCents * it.quantity, 0);
  const ship = shippingFor(subtotal, shipping.method);
  const total = subtotal + ship;
  const seq = await nextOrderSeq();
  const number = orderNumber(seq);
  jobs.forEach((j) => (j.orderNumber = number));
  const now = new Date().toISOString();
  const s = stripe();
  const order: Order = {
    id: orderId,
    number,
    userId: user.id,
    email: user.email,
    createdAt: now,
    updatedAt: now,
    status: "incoming",
    payment: { state: "awaiting_payment", method: s ? "stripe" : "manual", amountCents: total, currency: CURRENCY },
    items,
    jobs,
    shipping,
    customerNote: typeof input.note === "string" ? input.note.trim().slice(0, 600) || undefined : undefined,
    productionNotes: "",
    history: [event("customer", "placed", `Order placed — ${items.length} design${items.length > 1 ? "s" : ""}, ${jobs.length} print file${jobs.length === 1 ? "" : "s"}.`)],
  };

  let checkoutUrl: string | null = null;
  if (s) {
    const session = await s.checkout.sessions.create({
      mode: "payment",
      customer_email: user.email || undefined,
      client_reference_id: orderId,
      metadata: { dtf_order_id: orderId, dtf_order_number: number },
      line_items: [
        ...items.map((it) => {
          const g = getGarment(it.garmentId);
          return {
            quantity: it.quantity,
            price_data: {
              currency: CURRENCY,
              unit_amount: it.unitCents,
              product_data: { name: `${g.name} — custom DTF print`, description: `${getColor(g, it.colorId).name} · ${it.size} · ${it.project.name}`.slice(0, 300) },
            },
          };
        }),
        ...(ship ? [{ quantity: 1, price_data: { currency: CURRENCY, unit_amount: ship, product_data: { name: "Shipping" } } }] : []),
      ],
      success_url: `${origin}/apps/dtf-studio?order=${orderId}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/apps/dtf-studio?order=${orderId}&cancelled=1`,
    });
    order.payment.stripeSessionId = session.id;
    checkoutUrl = session.url;
  } else {
    order.history.push(event("system", "manual-payment", "No card processor is connected — the shop will confirm payment directly."));
  }
  await createOrder(order);
  if (!s) await sendOrderReceived(order, settings.shopName);
  return { order, checkoutUrl };
}

function mergeReadiness(server: ReadinessReport, client: ReadinessReport | undefined): ReadinessReport {
  if (!client || !Array.isArray(client.issues)) return server;
  const seen = new Set(server.issues.map((i) => `${i.check}:${i.layerId ?? ""}:${i.side ?? ""}`));
  const extra = client.issues
    .filter((i) => i && typeof i.message === "string" && !seen.has(`${i.check}:${i.layerId ?? ""}:${i.side ?? ""}`))
    .slice(0, 40)
    .map((i) => ({ ...i, message: String(i.message).slice(0, 300), data: { ...(i.data ?? {}), source: "customer browser" } }));
  const issues = [...server.issues.filter((i) => i.severity !== "ok"), ...extra.filter((i) => i.severity !== "ok")];
  const rank = { ok: 0, info: 1, warn: 2, block: 3 } as const;
  const verdict = issues.reduce<ReadinessReport["verdict"]>((w, i) => (rank[i.severity] > rank[w] ? i.severity : w), "ok");
  return { ...server, issues, verdict };
}

/** Mark paid (idempotent) and move into artwork review. */
export async function markPaid(orderId: string, by: OrderEvent["by"], detail: string): Promise<Order | null> {
  let wasPaid = false;
  const settings = await getSettings();
  const next = await updateOrder(orderId, (o) => {
    if (o.payment.state === "paid") {
      wasPaid = true;
      return null;
    }
    o.payment.state = "paid";
    o.payment.paidAt = new Date().toISOString();
    o.history.push(event(by, "paid", detail));
    if (o.status === "incoming") {
      o.status = "artwork_review";
      o.history.push(event("system", "status", "Moved to artwork review."));
    }
    return o;
  });
  if (next && !wasPaid) await sendOrderReceived(next, settings.shopName);
  return next;
}

/** Confirm a Stripe session on the customer's return (in case the webhook is not configured). */
export async function confirmStripeReturn(order: Order, sessionId: string): Promise<Order> {
  const s = stripe();
  if (!s || order.payment.state === "paid" || order.payment.stripeSessionId !== sessionId) return order;
  try {
    const session = await s.checkout.sessions.retrieve(sessionId);
    if (session.payment_status === "paid" && session.metadata?.dtf_order_id === order.id) {
      return (await markPaid(order.id, "stripe", `Card payment confirmed (${session.id.slice(-8)}).`)) ?? order;
    }
  } catch (e) {
    console.error("[dtf] stripe confirm", e);
  }
  return order;
}

export function customerView(o: Order): CustomerOrderView {
  // Production notes and file keys stay with the shop.
  const { productionNotes: _notes, jobs, ...rest } = o;
  void _notes;
  return {
    ...rest,
    jobs: jobs.map((j) => ({ id: j.id, side: j.side, zoneId: j.zoneId, artworkWidthCm: j.artworkWidthCm, artworkHeightCm: j.artworkHeightCm, status: j.status })),
    history: o.history.filter((h) => h.by !== "station" || h.kind === "printed"),
  };
}
