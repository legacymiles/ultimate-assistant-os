"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, Minus, Sparkles } from "lucide-react";
import { useApp, write } from "./AppState";
import { useToast } from "./Providers";
import { Badge, Button, Card } from "./ui";
import { ANNUAL_MONTHS_FREE, PRICING_FAQ, TIERS, TRIAL_DAYS } from "@/lib/buildflip-2/billing/plans";
import { fmtMoney } from "@/lib/buildflip-2/calc";
import { cn } from "@/lib/buildflip-2/ui";

/**
 * The pricing page. Honest by construction: the price shown is the price
 * charged, the trial says when billing starts, cancelling is described as the
 * one click it is, and there are no invented testimonials or user counts
 * anywhere on it.
 */
export default function Pricing() {
  const { account, signedIn } = useApp();
  const { toast } = useToast();
  const [interval, setInterval] = useState<"month" | "year">("month");
  const [busy, setBusy] = useState<string | null>(null);

  const isPro = account?.plan === "pro";

  const pick = async (tierId: string) => {
    if (tierId === "free") {
      window.location.href = signedIn ? "/apps/buildflip-2/board" : "/login";
      return;
    }
    if (tierId === "shop") {
      window.location.href = "mailto:hello@buildflip.app?subject=BuildFlip%20Shop%20plan";
      return;
    }
    if (!signedIn) {
      window.location.href = "/login";
      return;
    }
    setBusy(tierId);
    const res = await write<{ url?: string; simulated?: boolean; message?: string; alreadyPro?: boolean }>(
      "/api/buildflip-2/billing/checkout",
      { method: "POST", body: JSON.stringify({ interval, returnTo: "/apps/buildflip-2/board" }) },
    );
    setBusy(null);
    if (res.ok && res.data?.url) {
      window.location.href = res.data.url;
      return;
    }
    if (res.ok && res.data?.alreadyPro) {
      toast({ tone: "info", message: "You're already on Pro." });
      return;
    }
    if (res.ok && res.data?.simulated) {
      toast({ tone: "success", message: res.data.message ?? "Pro unlocked in demo mode." });
      setTimeout(() => (window.location.href = "/apps/buildflip-2/board"), 800);
      return;
    }
    toast({
      tone: "error",
      message: res.error ?? "Couldn't open checkout. You haven't been charged.",
    });
  };

  return (
    <div className="mx-auto w-full max-w-5xl px-4 pb-20 pt-10 sm:px-6 sm:pt-14">
      <div className="mx-auto max-w-2xl text-center">
        <h1 className="text-[clamp(1.875rem,6vw,2.75rem)] font-semibold leading-[1.05] tracking-[-0.04em]">
          One plan free. Then $9 a month.
        </h1>
        <p className="mx-auto mt-3.5 max-w-xl text-[15px] leading-relaxed text-[var(--ink-2)]">
          Your first full plan costs nothing and asks for no card — the whole product, on one
          build. If it earns its keep, Pro is less than one bad board.
        </p>
      </div>

      {/* --------------------------------------------------------- toggle */}
      <div className="mx-auto mt-7 flex max-w-xs rounded-[var(--radius-ctl)] border border-[var(--line)] bg-[var(--surface-2)] p-1">
        {(["month", "year"] as const).map((v) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={interval === v}
            onClick={() => setInterval(v)}
            className={cn(
              "flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-[7px] text-[13px] font-medium transition-all",
              interval === v
                ? "bg-[var(--surface)] text-[var(--ink)] shadow-[var(--shadow-card)]"
                : "text-[var(--ink-3)] hover:text-[var(--ink)]",
            )}
          >
            {v === "month" ? "Monthly" : "Annual"}
            {v === "year" && (
              <span className="rounded-full bg-[var(--profit-soft)] px-1.5 text-[10px] font-semibold text-[var(--profit)]">
                {ANNUAL_MONTHS_FREE} months free
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ---------------------------------------------------------- tiers */}
      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        {TIERS.map((tier) => {
          const price = interval === "year" ? tier.annual : tier.monthly;
          const current = (isPro && tier.id === "pro") || (!isPro && tier.id === "free");
          return (
            <Card
              key={tier.id}
              className={cn(
                "relative flex flex-col p-5",
                tier.featured && "border-[var(--accent-line)] shadow-[var(--shadow-pop)]",
              )}
            >
              {tier.featured && (
                <span className="absolute -top-2.5 left-5">
                  <Badge tone="accent">
                    <Sparkles aria-hidden className="h-3 w-3" />
                    Most popular
                  </Badge>
                </span>
              )}

              <h2 className="text-[17px] font-semibold text-[var(--ink)]">{tier.name}</h2>
              <p className="mt-0.5 text-[12.5px] text-[var(--ink-3)]">{tier.tagline}</p>

              <div className="mt-3.5 flex items-baseline gap-1.5">
                <span className="num text-[2rem] font-semibold leading-none text-[var(--ink)]">
                  {price === 0 ? "Free" : fmtMoney(price ?? 0, { cents: false })}
                </span>
                {price !== 0 && price != null && (
                  <span className="text-[13px] text-[var(--ink-3)]">
                    /{interval === "year" ? "year" : "month"}
                  </span>
                )}
              </div>
              {interval === "year" && price ? (
                <p className="mt-1 text-[11.5px] text-[var(--ink-4)]">
                  {fmtMoney(price / 12)} a month, billed yearly.
                </p>
              ) : (
                <p className="mt-1 text-[11.5px] text-[var(--ink-4)]">
                  {tier.id === "free" ? "No card, ever." : "Cancel in one click."}
                </p>
              )}

              <ul className="mt-4 flex-1 space-y-2">
                {tier.features.map((f) => (
                  <li key={f.text} className="flex items-start gap-2 text-[13px]">
                    {f.included ? (
                      <Check
                        aria-hidden
                        className="mt-0.5 h-4 w-4 shrink-0 text-[var(--profit)]"
                        strokeWidth={2.5}
                      />
                    ) : (
                      <Minus
                        aria-hidden
                        className="mt-0.5 h-4 w-4 shrink-0 text-[var(--ink-4)]"
                      />
                    )}
                    <span
                      className={cn(
                        f.included ? "text-[var(--ink-2)]" : "text-[var(--ink-4)] line-through decoration-[var(--line)]",
                      )}
                    >
                      {f.text}
                    </span>
                  </li>
                ))}
              </ul>

              <Button
                variant={tier.featured ? "primary" : "secondary"}
                size="lg"
                className="mt-5 w-full"
                disabled={current}
                loading={busy === tier.id}
                onClick={() => void pick(tier.id)}
              >
                {current ? "Your current plan" : tier.cta}
              </Button>

              {tier.note && (
                <p className="mt-2.5 text-[11px] leading-relaxed text-[var(--ink-4)]">
                  {tier.note}
                </p>
              )}
            </Card>
          );
        })}
      </div>

      {/* ------------------------------------------------------- honesty */}
      <Card className="mt-6 p-5">
        <h2 className="text-[15px] font-semibold text-[var(--ink)]">
          What we won&apos;t do
        </h2>
        <ul className="mt-2.5 grid gap-2 text-[13px] leading-relaxed text-[var(--ink-2)] sm:grid-cols-2">
          <li>· No invented reviews, user counts or logos. There are none on this site.</li>
          <li>· No countdown timers and no &quot;only 2 left&quot;.</li>
          <li>· No hidden fees. The price above is the price charged.</li>
          <li>· No retention maze. Cancel is one click in your settings.</li>
          <li>· Your plans stay readable and exportable even if you stop paying.</li>
          <li>· We never sell your data, and delete means delete.</li>
        </ul>
      </Card>

      {/* ----------------------------------------------------------- FAQ */}
      <section className="mt-8" aria-label="Frequently asked questions">
        <h2 className="mb-3 text-[17px] font-semibold tracking-[-0.025em]">
          The questions people actually ask
        </h2>
        <div className="space-y-2">
          {PRICING_FAQ.map((item) => (
            <details
              key={item.q}
              className="group rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--surface)] px-4"
            >
              <summary className="flex min-h-[52px] cursor-pointer list-none items-center justify-between gap-3 py-3 text-[13.5px] font-medium text-[var(--ink)] marker:content-none">
                {item.q}
                <span
                  aria-hidden
                  className="shrink-0 text-[var(--ink-4)] transition-transform group-open:rotate-45"
                >
                  +
                </span>
              </summary>
              <p className="pb-4 text-[13px] leading-relaxed text-[var(--ink-2)]">{item.a}</p>
            </details>
          ))}
        </div>
      </section>

      <p className="mt-8 text-center text-[12px] text-[var(--ink-4)]">
        {TRIAL_DAYS}-day trial on Pro ·{" "}
        <Link href="/apps/buildflip-2/legal/refunds" className="underline underline-offset-2">
          Refund policy
        </Link>{" "}
        ·{" "}
        <Link href="/apps/buildflip-2/legal/terms" className="underline underline-offset-2">
          Terms
        </Link>{" "}
        ·{" "}
        <Link href="/apps/buildflip-2/legal/privacy" className="underline underline-offset-2">
          Privacy
        </Link>
      </p>
    </div>
  );
}
