"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  CreditCard,
  Download,
  LogOut,
  Monitor,
  Moon,
  ShieldCheck,
  Sun,
  Target,
  Trash2,
} from "lucide-react";
import { useApp, write } from "./AppState";
import { useTheme, useToast } from "./Providers";
import { Badge, Button, Card, ErrorNote, Label, Sheet, fieldClass } from "./ui";
import { TIERS } from "@/lib/buildflip-2/billing/plans";
import { fmtMoney, fmtPct } from "@/lib/buildflip-2/calc";
import type { Account } from "@/lib/buildflip-2/types";
import { cn, shortDate } from "@/lib/buildflip-2/ui";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

/** End the hub session and land back on the front door. */
async function signOutOfHub() {
  await getSupabaseBrowserClient()?.auth.signOut();
  window.location.href = "/login";
}

/**
 * Settings: profile, what their time is worth, theme, billing, export, and a
 * delete that genuinely deletes (D4). Everything here is honest about what is
 * connected and what isn't.
 */
export default function Settings({ email }: { email: string }) {
  const { projects, accuracy, capabilities, missing, refresh } = useApp();
  const { theme, setTheme } = useTheme();
  /** Is the money layer switched on at all? Off on this hub — the app is free. */
  const money = Boolean(capabilities?.monetization);
  const { toast } = useToast();

  const [account, setAccount] = useState<Account | null>(null);
  const [hourly, setHourly] = useState("25");
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/buildflip-2/account", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { account: Account };
      setAccount(data.account);
      setHourly(String(data.account.hourlyTarget));
    })();
  }, []);

  const saveHourly = async () => {
    const value = Number(hourly);
    if (!Number.isFinite(value) || value < 0 || value > 1000) {
      setError("Put in what an hour of your time is worth, between $0 and $1000.");
      return;
    }
    setError(null);
    setSaving(true);
    const res = await write<{ account: Account }>("/api/buildflip-2/account", {
      method: "PATCH",
      body: JSON.stringify({ hourlyTarget: value }),
    });
    setSaving(false);
    if (res.ok && res.data?.account) {
      setAccount(res.data.account);
      void refresh({ quiet: true });
      toast({
        tone: "success",
        message: "Saved. Every verdict now judges against that rate.",
      });
    } else {
      setError(res.error ?? "That didn't save. Try again.");
    }
  };

  const billing = async () => {
    const res = await write<{ url?: string; simulated?: boolean; message?: string }>(
      "/api/buildflip-2/billing/portal",
      { method: "POST" },
    );
    if (res.ok && res.data?.url) {
      window.location.href = res.data.url;
      return;
    }
    if (res.ok && res.data?.simulated) {
      toast({ tone: "success", message: res.data.message ?? "Cancelled." });
      setTimeout(() => window.location.reload(), 700);
      return;
    }
    toast({ tone: "error", message: res.error ?? "Couldn't open billing." });
  };

  const exportData = () => {
    const blob = new Blob([JSON.stringify({ email, projects }, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `buildflip-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast({ tone: "success", message: "Downloaded every plan as a JSON file." });
  };

  const deleteAccount = async () => {
    setDeleting(true);
    const res = await write<{ deleted: boolean }>("/api/buildflip-2/account/delete", {
      method: "DELETE",
      body: JSON.stringify({ confirm }),
      timeoutMs: 60_000,
    });
    setDeleting(false);
    if (res.ok) {
      window.location.href = "/?deleted=1";
    } else {
      toast({ tone: "error", message: res.error ?? "Couldn't delete. Nothing was removed." });
    }
  };

  const pro = TIERS.find((t) => t.id === "pro")!;
  const isPro = account?.plan === "pro";

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 px-4 pb-16 pt-6 sm:px-6 sm:pt-8">
      <div className="mb-1">
        <h1 className="text-[clamp(1.5rem,4.5vw,2rem)] font-semibold tracking-[-0.035em]">
          Settings
        </h1>
        <p className="mt-1 text-[13.5px] text-[var(--ink-2)]">{email}</p>
      </div>

      {/* ----------------------------------------------------- your hourly */}
      <Card className="p-4">
        <div className="mb-3 flex items-center gap-2">
          <Target aria-hidden className="h-4 w-4 text-[var(--accent)]" />
          <h2 className="text-[14px] font-semibold text-[var(--ink)]">
            What your time is worth
          </h2>
        </div>
        <p className="mb-3 text-[13px] leading-relaxed text-[var(--ink-2)]">
          Every verdict is judged against this. If a build can&apos;t clear it, BuildFlip says
          skip — however good the margin looks.
        </p>
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Label htmlFor="hourly">Target hourly rate</Label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[14px] text-[var(--ink-4)]">
                $
              </span>
              <input
                id="hourly"
                type="number"
                inputMode="decimal"
                min={0}
                max={1000}
                step="1"
                value={hourly}
                onChange={(e) => setHourly(e.target.value)}
                className={cn(fieldClass, "pl-7")}
              />
            </div>
          </div>
          <Button variant="primary" loading={saving} onClick={saveHourly}>
            Save
          </Button>
        </div>
        {error && (
          <div className="mt-3">
            <ErrorNote>{error}</ErrorNote>
          </div>
        )}
      </Card>

      {/* ------------------------------------------------------- accuracy */}
      {accuracy && (
        <Card className="p-4">
          <h2 className="mb-1 text-[14px] font-semibold text-[var(--ink)]">
            How accurate your estimates have been
          </h2>
          <p className="mb-3 text-[13px] leading-relaxed text-[var(--ink-2)]">
            Measured against the receipts you logged, on builds where you bought most of the
            list.
          </p>
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Builds measured" value={String(accuracy.builds)} />
            <Stat
              label="Median error"
              value={`±${fmtPct(accuracy.medianErrorPct)}`}
              tone={accuracy.medianErrorPct <= 0.15 ? "profit" : "warn"}
            />
            <Stat
              label="Within 15%"
              value={`${accuracy.within15}/${accuracy.builds}`}
              tone={accuracy.within15 / accuracy.builds >= 0.5 ? "profit" : "warn"}
            />
          </div>
        </Card>
      )}

      {/* -------------------------------------------------------- billing
          Only when the money layer is switched on. On this hub it is off and
          the app is free, so a plan-and-billing card would be a price tag on
          something nobody can buy. The Stripe plumbing is still wired behind
          MONETIZATION_ENABLED — see src/lib/buildflip-2/flags.ts. */}
      {money && (
      <Card className="p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <CreditCard aria-hidden className="h-4 w-4 text-[var(--ink-3)]" />
            <h2 className="text-[14px] font-semibold text-[var(--ink)]">Plan and billing</h2>
          </div>
          <Badge tone={isPro ? "profit" : "neutral"}>{isPro ? "Pro" : "Free"}</Badge>
        </div>

        {isPro ? (
          <>
            <p className="mb-3 text-[13px] leading-relaxed text-[var(--ink-2)]">
              {account?.subscription?.status === "trialing"
                ? `You're on the free trial. First charge ${
                    account.subscription.currentPeriodEnd
                      ? shortDate(account.subscription.currentPeriodEnd)
                      : "at the end of the trial"
                  } — ${fmtMoney(pro.monthly!, { cents: false })}/month.`
                : account?.subscription?.status === "simulated"
                  ? "Pro is unlocked in demo mode. No card was ever asked for and nothing has been charged."
                  : `${fmtMoney(pro.monthly!, { cents: false })}/month${
                      account?.subscription?.currentPeriodEnd
                        ? `, next charge ${shortDate(account.subscription.currentPeriodEnd)}`
                        : ""
                    }.`}
            </p>
            <Button variant="secondary" onClick={billing}>
              {account?.subscription?.status === "simulated"
                ? "Cancel the simulated subscription"
                : "Manage billing, invoices or cancel"}
            </Button>
            <p className="mt-2 text-[11.5px] text-[var(--ink-4)]">
              Cancelling is one click and takes effect at the end of the period you&apos;ve
              already paid for. Your plans stay yours either way.
            </p>
          </>
        ) : (
          <>
            <p className="mb-3 text-[13px] leading-relaxed text-[var(--ink-2)]">
              You&apos;re on the free plan — one full plan, everything included. Pro is{" "}
              {fmtMoney(pro.monthly!, { cents: false })}/month for unlimited plans,
              re-pricing and real-cost tracking.
            </p>
            <Link href="/apps/buildflip-2/pricing">
              <Button variant="primary">See what Pro adds</Button>
            </Link>
          </>
        )}
      </Card>
      )}

      {/* ---------------------------------------------------------- theme */}
      <Card className="p-4">
        <h2 className="mb-3 text-[14px] font-semibold text-[var(--ink)]">Appearance</h2>
        <div
          role="radiogroup"
          aria-label="Theme"
          className="grid grid-cols-3 gap-2"
        >
          {(
            [
              ["dark", "Dark", Moon],
              ["light", "Light", Sun],
              ["system", "System", Monitor],
            ] as const
          ).map(([value, label, Icon]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={theme === value}
              onClick={() => setTheme(value)}
              className={cn(
                "flex min-h-11 items-center justify-center gap-1.5 rounded-[var(--radius-ctl)] border text-[13px] font-medium transition",
                theme === value
                  ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--ink)]"
                  : "border-[var(--line)] text-[var(--ink-2)] hover:border-[var(--accent-line)]",
              )}
            >
              <Icon aria-hidden className="h-4 w-4" />
              {label}
            </button>
          ))}
        </div>
      </Card>

      {/* -------------------------------------------------- what's connected */}
      {capabilities && (
        <Card className="p-4">
          <div className="mb-3 flex items-center gap-2">
            <ShieldCheck aria-hidden className="h-4 w-4 text-[var(--ink-3)]" />
            <h2 className="text-[14px] font-semibold text-[var(--ink)]">
              What&apos;s connected
            </h2>
          </div>
          <ul className="space-y-2">
            {(
              [
                ["auth", "Accounts and sign-in"],
                ["database", "Saved plans, synced across devices"],
                ["storage", "Reference photo upload"],
                ["liveResearch", "Live prices and sold listings"],
                ["payments", "Card payments"],
                ["email", "Account emails"],
              ] as const
            ).map(([key, label]) => {
              const on = capabilities[key];
              const gap = missing.find((m) => m.id === key);
              return (
                <li key={key} className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <span className="text-[13px] text-[var(--ink)]">{label}</span>
                    {!on && gap && (
                      <span className="mt-0.5 block text-[11.5px] leading-relaxed text-[var(--ink-4)]">
                        Connecting this unlocks {gap.unlocks}.
                      </span>
                    )}
                  </div>
                  <Badge tone={on ? "profit" : "warn"}>{on ? "on" : "demo"}</Badge>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {/* --------------------------------------------------- your data */}
      <Card className="p-4">
        <h2 className="mb-3 text-[14px] font-semibold text-[var(--ink)]">Your data</h2>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={exportData}
            icon={<Download aria-hidden className="h-4 w-4" />}
          >
            Download all my plans
          </Button>
          {/* BuildFlip had a POST /auth/signout route of its own. The hub signs
              out in the browser, the way every other app here does, so there is
              one session and one way to end it. */}
          <Button
            variant="ghost"
            onClick={() => void signOutOfHub()}
            icon={<LogOut aria-hidden className="h-4 w-4" />}
          >
            Sign out
          </Button>
        </div>
        <div className="mt-4 border-t border-[var(--line-soft)] pt-4">
          <h3 className="text-[13px] font-semibold text-[var(--loss)]">Delete my account</h3>
          <p className="mt-1 text-[12.5px] leading-relaxed text-[var(--ink-2)]">
            This removes every plan, every receipt, every photo you uploaded, your
            subscription and your sign-in — genuinely deleted, not hidden. It can&apos;t be
            undone.
          </p>
          <Button
            variant="danger"
            className="mt-3"
            onClick={() => setDeleteOpen(true)}
            icon={<Trash2 aria-hidden className="h-4 w-4" />}
          >
            Delete my account
          </Button>
        </div>
      </Card>

      <p className="pt-2 text-center text-[11.5px] text-[var(--ink-4)]">
        <Link href="/apps/buildflip-2/legal/terms" className="underline-offset-2 hover:underline">
          Terms
        </Link>{" "}
        ·{" "}
        <Link href="/apps/buildflip-2/legal/privacy" className="underline-offset-2 hover:underline">
          Privacy
        </Link>{" "}
        ·{" "}
        <Link href="/apps/buildflip-2/legal/refunds" className="underline-offset-2 hover:underline">
          Refunds
        </Link>
      </p>

      <Sheet
        open={deleteOpen}
        onClose={() => {
          setDeleteOpen(false);
          setConfirm("");
        }}
        title="Delete your account?"
        description="Everything goes: plans, receipts, photos, your subscription and your sign-in."
        footer={
          <div className="flex gap-2">
            <Button
              variant="secondary"
              className="flex-1"
              onClick={() => {
                setDeleteOpen(false);
                setConfirm("");
              }}
            >
              Keep my account
            </Button>
            <Button
              variant="danger"
              className="flex-1"
              disabled={confirm !== "DELETE"}
              loading={deleting}
              onClick={deleteAccount}
            >
              Delete everything
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <p className="text-[13.5px] leading-relaxed text-[var(--ink-2)]">
            You have {projects.length} plan{projects.length === 1 ? "" : "s"}. Download them
            first if you want to keep them — once this is done we can&apos;t get them back.
          </p>
          <Button variant="secondary" size="sm" onClick={exportData}>
            Download them first
          </Button>
          <div>
            <Label htmlFor="confirm-delete">Type DELETE to confirm</Label>
            <input
              id="confirm-delete"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value.toUpperCase())}
              autoComplete="off"
              placeholder="DELETE"
              className={fieldClass}
            />
          </div>
        </div>
      </Sheet>
    </div>
  );
}

function Stat({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "profit" | "warn";
}) {
  return (
    <div>
      <div className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-[var(--ink-3)]">
        {label}
      </div>
      <div
        className={cn(
          "num mt-0.5 text-[1.0625rem] font-semibold",
          tone === "profit" && "text-[var(--profit)]",
          tone === "warn" && "text-[var(--warn)]",
          tone === "neutral" && "text-[var(--ink)]",
        )}
      >
        {value}
      </div>
    </div>
  );
}
