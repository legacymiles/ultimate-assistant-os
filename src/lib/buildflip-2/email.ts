import { EMAIL_FROM, RESEND_KEY, appUrl } from "./flags";
import { log } from "./log";

/**
 * Account emails. With no RESEND_API_KEY these are logged to the server console
 * instead of sent, so the flow is testable and nothing crashes (R4).
 * Every email is plain English and says why it arrived.
 */

export interface Mail {
  to: string;
  subject: string;
  heading: string;
  lines: string[];
  cta?: { label: string; href: string };
  footer?: string;
}

function render(mail: Mail): string {
  const body = mail.lines.map((l) => `<p style="margin:0 0 14px;color:#3c4752;font-size:15px;line-height:1.6">${esc(l)}</p>`).join("");
  const cta = mail.cta
    ? `<a href="${esc(mail.cta.href)}" style="display:inline-block;background:#14181c;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:600;font-size:15px">${esc(mail.cta.label)}</a>`
    : "";
  return `<!doctype html><html><body style="margin:0;background:#f6f3ec;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" style="max-width:520px;background:#fffdf8;border:1px solid #ddd6c6;border-radius:14px">
<tr><td style="padding:28px 28px 8px"><span style="font-weight:700;letter-spacing:-0.02em;font-size:17px;color:#14181c">BuildFlip</span></td></tr>
<tr><td style="padding:0 28px 20px">
<h1 style="margin:8px 0 16px;font-size:22px;letter-spacing:-0.03em;color:#14181c">${esc(mail.heading)}</h1>
${body}${cta ? `<div style="margin-top:8px">${cta}</div>` : ""}
</td></tr>
<tr><td style="padding:16px 28px 26px;border-top:1px solid #e8e2d5;color:#6e7881;font-size:12px;line-height:1.6">
${esc(mail.footer ?? "You're getting this because you have a BuildFlip account.")}<br>
<a href="${appUrl("/settings")}" style="color:#6e7881">Email settings</a> · <a href="${appUrl("/legal/privacy")}" style="color:#6e7881">Privacy</a>
</td></tr></table></td></tr></table></body></html>`;
}

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export async function sendMail(mail: Mail): Promise<{ sent: boolean; demo: boolean }> {
  if (!RESEND_KEY) {
    await log({
      level: "info",
      event: "email_demo_mode",
      message: `[would send] ${mail.subject} -> ${mail.to}`,
      meta: { heading: mail.heading },
    });
    return { sent: false, demo: true };
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: EMAIL_FROM,
        to: [mail.to],
        subject: mail.subject,
        html: render(mail),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Resend ${res.status}`);
    return { sent: true, demo: false };
  } catch (err) {
    await log({
      level: "warn",
      event: "email_failed",
      message: (err as Error)?.message,
      meta: { subject: mail.subject },
    });
    return { sent: false, demo: false };
  }
}

export const templates = {
  welcome: (to: string): Mail => ({
    to,
    subject: "Your first BuildFlip plan is free",
    heading: "Know before you buy a single board",
    lines: [
      "Paste a link to any build you've seen, add a line about what you want, and BuildFlip comes back with the steps, the priced materials and a real profit number.",
      "Your first full plan is free — no card.",
    ],
    cta: { label: "Make your first plan", href: `${appUrl("/board")}` },
    footer: "You're getting this because you just created a BuildFlip account.",
  }),

  welcomePro: (to: string, firstCharge?: string | null): Mail => ({
    to,
    subject: "You're on BuildFlip Pro",
    heading: "Pro is on",
    lines: [
      "Unlimited plans, re-pricing against today's listings, and real-cost tracking are all unlocked.",
      firstCharge
        ? `Your free trial runs until ${firstCharge}, and that's the first date your card is charged. Cancel before then and you pay nothing.`
        : "You can cancel any time in Settings — one click, no email needed.",
      "One favour: log what you actually pay as you buy. Those receipts are what make the next estimate sharper, for you and for everyone building the same thing.",
    ],
    cta: { label: "Open your board", href: `${appUrl("/board")}` },
  }),

  planReady: (to: string, title: string, projectId: string): Mail => ({
    to,
    subject: `Your plan for ${title} is ready`,
    heading: title,
    lines: [
      "Your build plan is priced and has a verdict.",
      "Open it on your phone in the workshop — the steps and the shopping list are built for one hand.",
    ],
    cta: { label: "Open the plan", href: `${appUrl(`/plan/${projectId}`)}` },
  }),

  cancelled: (to: string, until: string | null): Mail => ({
    to,
    subject: "Your BuildFlip Pro is cancelled",
    heading: "Cancelled — no further charges",
    lines: [
      until
        ? `You keep Pro until ${until}, which you've already paid for. After that you're back on the free plan.`
        : "You're back on the free plan.",
      "Every plan you made stays yours. You can read, export and share all of them.",
    ],
    cta: { label: "Your plans", href: `${appUrl("/board")}` },
  }),
};
