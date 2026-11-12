"use client";

import { useState } from "react";
import { Check, Sparkles } from "lucide-react";
import { write } from "./AppState";
import { useToast } from "./Providers";
import { Button, Sheet } from "./ui";
import { TIERS, TRIAL_DAYS, UPGRADE_MOMENTS, type UpgradeMoment } from "@/lib/buildflip-2/billing/plans";
import { fmtMoney } from "@/lib/buildflip-2/calc";
import { cn } from "@/lib/buildflip-2/ui";

/**
 * The upgrade moment, in context — never a dead end.
 *
 * Appears at the exact point the user wanted the paid thing, says what it
 * unlocks right there, and has one button. The confirm before any charge is
 * Stripe's own page, which shows the price and the first-charge date (S7); with
 * no Stripe key it says plainly that the upgrade is simulated and no card was
 * asked for.
 */
export default function Paywall({
  open,
  moment,
  message,
  onClose,
  returnTo,
}: {
  open: boolean;
  moment: UpgradeMoment | string;
  message?: string;
  onClose: () => void;
  returnTo?: string;
}) {
  const { toast } = useToast();
  const [interval, setInterval] = useState<"month" | "year">("month");
  const [busy, setBusy] = useState(false);

  const copy =
    UPGRADE_MOMENTS[moment as UpgradeMoment] ?? UPGRADE_MOMENTS.secondPlan;
  const pro = TIERS.find((t) => t.id === "pro")!;
  const price = interval === "year" ? pro.annual! : pro.monthly!;

  const go = async () => {
    setBusy(true);
    const res = await write<{ url?: string; simulated?: boolean; message?: string }>(
      "/api/buildflip-2/billing/checkout",
      { method: "POST", body: JSON.stringify({ interval, returnTo }) },
    );
    setBusy(false);

    if (res.ok && res.data?.url) {
      window.location.href = res.data.url;
      return;
    }
    if (res.ok && res.data?.simulated) {
      toast({
        tone: "success",
        message:
          res.data.message ??
          "Pro unlocked in demo mode — nothing was charged.",
      });
      onClose();
      // A full reload so every server component sees the new plan.
      setTimeout(() => window.location.reload(), 600);
      return;
    }
    toast({
      tone: "error",
      message: res.error ?? "We couldn't open checkout. You haven't been charged.",
    });
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={copy.title}
      description={message || copy.body}
      footer={
        <div className="space-y-2">
          <Button
            variant="primary"
            size="lg"
            loading={busy}
            onClick={go}
            icon={<Sparkles aria-hidden className="h-4 w-4" />}
            className="w-full"
          >
            {`Start ${TRIAL_DAYS}-day free trial`}
          </Button>
          <p className="text-center text-[11.5px] leading-relaxed text-[var(--ink-4)]">
            {TRIAL_DAYS} days free, then {fmtMoney(price, { cents: false })}/
            {interval === "year" ? "year" : "month"}. Stripe shows the exact first-charge
            date before you confirm. Cancel in one click.
          </p>
        </div>
      }
    >
      <div className="space-y-4">
        {/* monthly / annual */}
        <div
          role="radiogroup"
          aria-label="Billing period"
          className="flex rounded-[var(--radius-ctl)] border border-[var(--line)] bg-[var(--surface-2)] p-1"
        >
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
                  2 months free
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="rounded-[var(--radius-ctl)] border border-[var(--accent-line)] bg-[var(--accent-soft)] px-3.5 py-3">
          <div className="flex items-baseline gap-1.5">
            <span className="num text-[26px] font-semibold leading-none text-[var(--ink)]">
              {fmtMoney(price, { cents: false })}
            </span>
            <span className="text-[13px] text-[var(--ink-2)]">
              /{interval === "year" ? "year" : "month"}
            </span>
          </div>
          <p className="mt-1 text-[12px] text-[var(--ink-2)]">
            {interval === "year"
              ? `That's ${fmtMoney(price / 12)} a month.`
              : "Billed monthly. Stop whenever."}
          </p>
        </div>

        <ul className="space-y-2">
          {pro.features
            .filter((f) => f.included)
            .map((f) => (
              <li key={f.text} className="flex items-start gap-2.5 text-[13.5px]">
                <Check
                  aria-hidden
                  className="mt-0.5 h-4 w-4 shrink-0 text-[var(--profit)]"
                  strokeWidth={2.5}
                />
                <span className="text-[var(--ink-2)]">{f.text}</span>
              </li>
            ))}
        </ul>

        <p className="rounded-[10px] bg-[var(--surface-2)] px-3 py-2.5 text-[12px] leading-relaxed text-[var(--ink-3)]">
          Every plan you&apos;ve already made stays yours either way — readable, exportable
          and shareable, forever, free.
        </p>
      </div>
    </Sheet>
  );
}
