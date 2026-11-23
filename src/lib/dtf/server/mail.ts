// ---------------------------------------------------------------------------
// Order emails. With RESEND_API_KEY they are sent; without it they are logged
// to the server console as "[would send]" — the flow still runs end to end
// and nothing pretends a message went out.
// ---------------------------------------------------------------------------

import "server-only";

import { money } from "../pricing";
import { STAGES } from "../pipeline";
import { getColor, getGarment } from "../garments";
import type { Order } from "../types";

const RESEND = process.env.RESEND_API_KEY?.trim();
const FROM = process.env.DTF_EMAIL_FROM?.trim() || process.env.EMAIL_FROM?.trim() || "DTF Studio <orders@bighomieai.com>";
const SITE = (process.env.NEXT_PUBLIC_SITE_URL || process.env.OPENROUTER_SITE_URL || "https://bighomieai.com").replace(/\/$/, "");

export function emailConfigured(): boolean {
  return Boolean(RESEND);
}

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function shell(shop: string, heading: string, body: string, cta?: { label: string; href: string }) {
  return `<!doctype html><html><body style="margin:0;background:#0b0c0e;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#eceef2">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" style="max-width:540px;background:#14161a;border:1px solid #23262c;border-radius:16px">
<tr><td style="padding:26px 28px 6px;font-size:13px;letter-spacing:.14em;text-transform:uppercase;color:#8d939e">${esc(shop)}</td></tr>
<tr><td style="padding:4px 28px 22px"><h1 style="margin:6px 0 14px;font-size:24px;letter-spacing:-.02em;color:#fff">${esc(heading)}</h1>${body}
${cta ? `<p style="margin:22px 0 0"><a href="${esc(cta.href)}" style="display:inline-block;background:#5ee1ff;color:#04141a;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:600">${esc(cta.label)}</a></p>` : ""}
</td></tr>
<tr><td style="padding:16px 28px 24px;border-top:1px solid #23262c;font-size:12px;color:#8d939e;line-height:1.6">You're receiving this because you placed an order. <a style="color:#8d939e" href="${SITE}/legal/dtf-terms">Terms of sale</a> · <a style="color:#8d939e" href="${SITE}/legal/privacy">Privacy</a></td></tr>
</table></td></tr></table></body></html>`;
}

function itemsTable(order: Order) {
  return `<table role="presentation" width="100%" style="border-collapse:collapse;font-size:14px;margin:6px 0 4px">${order.items
    .map((it) => {
      const g = getGarment(it.garmentId);
      const c = getColor(g, it.colorId);
      return `<tr><td style="padding:8px 0;border-bottom:1px solid #23262c;color:#eceef2">${esc(g.name)} · ${esc(c.name)} · ${esc(it.size)} × ${it.quantity}</td><td align="right" style="padding:8px 0;border-bottom:1px solid #23262c;font-family:ui-monospace,monospace">${money(it.unitCents * it.quantity)}</td></tr>`;
    })
    .join("")}<tr><td style="padding:10px 0;color:#8d939e">Total</td><td align="right" style="padding:10px 0;font-family:ui-monospace,monospace;color:#fff">${money(order.payment.amountCents)}</td></tr></table>`;
}

async function send(to: string, subject: string, html: string): Promise<{ sent: boolean }> {
  if (!RESEND) {
    console.info(`[dtf][would send] ${subject} -> ${to}`);
    return { sent: false };
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM, to: [to], subject, html }),
    });
    if (!res.ok) console.error("[dtf] email failed", res.status, await res.text().catch(() => ""));
    return { sent: res.ok };
  } catch (e) {
    console.error("[dtf] email failed", e);
    return { sent: false };
  }
}

const trackUrl = (o: Order) => `${SITE}/apps/dtf-studio?order=${encodeURIComponent(o.id)}`;

export async function sendOrderReceived(order: Order, shop: string) {
  const paid = order.payment.state === "paid";
  const body = `<p style="margin:0 0 12px;color:#a2a8b3;line-height:1.6">Order <b style="color:#fff">${esc(order.number)}</b> is in. ${
    paid
      ? "Payment received — your artwork goes to production review next."
      : "We'll confirm payment with you before it prints."
  } Every design is checked by a person before it's printed.</p>${itemsTable(order)}`;
  return send(order.email, `${shop}: order ${order.number} received`, shell(shop, "We've got your order.", body, { label: "Track your order", href: trackUrl(order) }));
}

export async function sendStatusUpdate(order: Order, shop: string) {
  const stage = STAGES.find((s) => s.id === order.status);
  if (!stage) return { sent: false };
  const notable = ["print_ready", "completed", "shipped"].includes(order.status);
  if (!notable) return { sent: false };
  const line =
    order.status === "shipped"
      ? `It's on its way${order.trackingNumber ? ` — tracking number <b style="color:#fff">${esc(order.trackingNumber)}</b>` : ""}.`
      : order.status === "completed" && order.shipping.method === "pickup"
        ? "It's pressed, checked and ready to pick up."
        : order.status === "completed"
          ? "It's pressed and passed final inspection. Shipping next."
          : "Your artwork passed review and is approved for print.";
  const body = `<p style="margin:0 0 12px;color:#a2a8b3;line-height:1.6">Order <b style="color:#fff">${esc(order.number)}</b>: ${line}</p>`;
  return send(order.email, `${shop}: ${stage.customer} — ${order.number}`, shell(shop, stage.customer, body, { label: "View order", href: trackUrl(order) }));
}
