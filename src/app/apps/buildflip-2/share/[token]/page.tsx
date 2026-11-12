import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import PlanView from "@/components/buildflip-2/plan/PlanView";
import { resolveShare } from "@/lib/buildflip-2/db/share";
import { computeVerdict, fmtMoney, fmtRate } from "@/lib/buildflip-2/calc";
import type { Project } from "@/lib/buildflip-2/types";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ token: string }> };

/**
 * Feature 11 — a read-only plan on its own link.
 *
 * Carries a proper title, description and share image so it previews properly
 * wherever it's pasted (U3). The plan is stripped of receipts and the owner's
 * identity before it ever reaches this page, and a switched-off link 404s.
 */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { token } = await params;
  const shared = await resolveShare(token);
  if (!shared) {
    return { title: "Plan not available", robots: { index: false, follow: false } };
  }
  const p = shared.project as unknown as Project;
  const v = computeVerdict(p);
  const description = `${fmtMoney(v.actualCost, { cents: false })} in materials · sells for about ${fmtMoney(
    v.salePrice,
    { cents: false },
  )} · ${fmtMoney(v.profit, { cents: false })} profit at ${fmtRate(
    v.hourlyRate,
    "an unrecorded rate",
  )}. Priced from real listings by BuildFlip.`;

  return {
    title: p.title,
    description,
    openGraph: {
      title: p.title,
      description,
      type: "article",
      
    },
    twitter: { card: "summary_large_image", title: p.title, description },
    // A shared link is for the people it's sent to, not for search engines.
    robots: { index: false, follow: false },
  };
}

export default async function SharePage({ params }: Props) {
  const { token } = await params;
  const shared = await resolveShare(token);
  if (!shared) notFound();

  return (
    <div className="min-h-dvh">
      <header className="border-b border-[var(--line-soft)]">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-3 px-4 sm:px-6">
          <Link
            href="/apps/buildflip-2"
            className="flex items-center gap-2 text-[15px] font-bold tracking-[-0.03em]"
          >
            <span className="relative grid h-6 w-6 place-items-center">
              <span className="absolute h-[5px] w-6 rounded-full bg-[var(--surface-3)]" />
              <span className="absolute left-0 h-[5px] w-[15px] rounded-full bg-[var(--profit)]" />
              <span className="absolute left-[13px] h-[15px] w-[5px] rounded-full bg-[var(--accent)]" />
            </span>
            BuildFlip
          </Link>
          <Link
            href="/apps/buildflip-2"
            className="inline-flex min-h-10 items-center rounded-[10px] bg-[var(--accent)] px-3.5 text-[13px] font-semibold text-[var(--accent-ink)] transition hover:brightness-110"
          >
            Price your own build
          </Link>
        </div>
      </header>
      <PlanView
        initial={shared.project as unknown as Project}
        readOnly
        shareToken={token}
      />
    </div>
  );
}
