import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { currentUser } from "@/lib/buildflip-2/supabase/server";
import { getAccount } from "@/lib/buildflip-2/db/account";
import { isTestMode } from "@/lib/buildflip-2/billing/stripe";
import { TRIAL_DAYS } from "@/lib/buildflip-2/billing/plans";

export const metadata: Metadata = {
  title: "You're on Pro",
  robots: { index: false, follow: false },
};

/**
 * The success moment after checkout. Stripe's webhook is what actually flips
 * the plan, so this page is honest about the small lag instead of claiming
 * something it can't see yet.
 */
export default async function UpgradedPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const user = await currentUser();
  const account = user ? await getAccount(user.id, user.email) : null;
  const live = account?.plan === "pro";
  const target = next && next.startsWith("/") && !next.startsWith("//") ? next : "/apps/buildflip-2/board";

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-5 px-6 text-center">
      <div className="grid h-14 w-14 place-items-center rounded-full border border-[color-mix(in_srgb,var(--profit)_45%,transparent)] bg-[var(--profit-soft)] text-[var(--profit)]">
        <CheckCircle2 aria-hidden className="h-6 w-6" />
      </div>

      <div>
        <h1 className="text-[26px] font-semibold tracking-[-0.035em]">
          {live ? "You're on Pro" : "Payment received"}
        </h1>
        <p className="mt-2.5 text-[14px] leading-relaxed text-[var(--ink-2)]">
          {live ? (
            <>
              Unlimited plans, re-pricing against today&apos;s listings and real-cost
              tracking are all unlocked. Your {TRIAL_DAYS}-day trial means nothing is
              charged yet, and Settings always shows the exact next charge date.
            </>
          ) : (
            <>
              Stripe has your subscription. It takes a few seconds for that to reach us —
              open your board and it will be live. If it somehow isn&apos;t in a minute,
              email us and we&apos;ll fix it immediately.
            </>
          )}
        </p>
      </div>

      {isTestMode() && (
        <p className="rounded-[10px] border border-[var(--accent-line)] bg-[var(--accent-soft)] px-3.5 py-2.5 text-[12px] leading-relaxed text-[var(--ink-2)]">
          Stripe is in test mode on this deployment, so no real money moved.
        </p>
      )}

      <div className="flex flex-wrap items-center justify-center gap-2.5">
        <Link
          href={target}
          className="inline-flex min-h-11 items-center rounded-[10px] bg-[var(--accent)] px-5 text-[14px] font-semibold text-[var(--accent-ink)] transition hover:brightness-110"
        >
          Open my board
        </Link>
        <Link
          href="/apps/buildflip-2/settings"
          className="inline-flex min-h-11 items-center rounded-[10px] border border-[var(--line)] px-4 text-[14px] font-medium text-[var(--ink)] transition hover:border-[var(--accent-line)]"
        >
          Billing settings
        </Link>
      </div>

      <p className="text-[11.5px] leading-relaxed text-[var(--ink-4)]">
        One favour: log what you actually pay as you buy. Those real receipts are what make
        the next estimate sharper — for you and for everyone building the same thing.
      </p>
    </main>
  );
}
