"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import {
  ArrowRight,
  Check,
  ClipboardList,
  GitCompareArrows,
  Link2,
  ListOrdered,
  Receipt,
  Search,
  ShieldCheck,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import DemoBeam from "./DemoBeam";
import WorkbenchCanvas from "../WorkbenchCanvas";
import { useTheme } from "../Providers";
import { Badge, Button, Card, ErrorNote, fieldClass } from "../ui";
import { PRICING_FAQ, TIERS, TRIAL_DAYS } from "@/lib/buildflip-2/billing/plans";
import { fmtMoney } from "@/lib/buildflip-2/calc";
import { cn, ease } from "@/lib/buildflip-2/ui";

/**
 * The landing page: hero → the problem → how it works → what you get →
 * pricing → FAQ → final call to action.
 *
 * The hero shows the actual product — a working, draggable Margin Beam on a
 * real plan — not an illustration. There are no testimonials, no user counts
 * and no logos, because we do not have real ones and we will not invent them.
 */

export default function Landing({ signedIn }: { signedIn: boolean }) {
  const reduced = useReducedMotion();
  const { resolved, setTheme } = useTheme();

  return (
    <div className="relative">
      {/* ------------------------------------------------------------- nav */}
      <header className="sticky top-0 z-40 border-b border-[var(--line-soft)] bg-[color-mix(in_srgb,var(--bg)_82%,transparent)] backdrop-blur-xl">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
          <Link href="/apps/buildflip-2" className="flex items-center gap-2 text-[15px] font-bold tracking-[-0.03em]">
            <span className="relative grid h-6 w-6 place-items-center">
              <span className="absolute h-[5px] w-6 rounded-full bg-[var(--surface-3)]" />
              <span className="absolute left-0 h-[5px] w-[15px] rounded-full bg-[var(--profit)]" />
              <span className="absolute left-[13px] h-[15px] w-[5px] rounded-full bg-[var(--accent)]" />
            </span>
            BuildFlip
          </Link>
          <nav aria-label="Main" className="flex items-center gap-1.5">
            <a
              href="#how"
              className="hidden min-h-9 items-center rounded-[9px] px-2.5 text-[13.5px] font-medium text-[var(--ink-3)] transition hover:text-[var(--ink)] sm:inline-flex"
            >
              How it works
            </a>
            <Link
              href="/apps/buildflip-2/pricing"
              className="hidden min-h-9 items-center rounded-[9px] px-2.5 text-[13.5px] font-medium text-[var(--ink-3)] transition hover:text-[var(--ink)] sm:inline-flex"
            >
              Pricing
            </Link>
            <button
              type="button"
              onClick={() => setTheme(resolved === "dark" ? "light" : "dark")}
              aria-label={`Switch to ${resolved === "dark" ? "light" : "dark"} mode`}
              className="grid h-10 w-10 place-items-center rounded-[10px] text-[var(--ink-3)] transition hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
            >
              {resolved === "dark" ? "☀" : "☾"}
            </button>
            <Link href={signedIn ? "/apps/buildflip-2/board" : "/login"}>
              <Button size="sm" variant="primary">
                {signedIn ? "My board" : "Start free"}
              </Button>
            </Link>
          </nav>
        </div>
      </header>

      {/* ----------------------------------------------------------- hero */}
      <section className="relative overflow-hidden">
        <WorkbenchCanvas className="pointer-events-none absolute inset-0 h-full w-full" />
        <div className="relative mx-auto grid w-full max-w-6xl gap-9 px-4 pb-14 pt-11 sm:px-6 sm:pb-20 sm:pt-16 lg:grid-cols-[1fr_1.08fr] lg:items-center lg:gap-12">
          <div className="min-w-0">
            <motion.div
              initial={reduced ? undefined : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, ease }}
            >
              <Badge tone="accent" className="mb-4">
                <Sparkles aria-hidden className="h-3 w-3" />
                Your first plan is free, no card
              </Badge>

              <h1 className="text-[clamp(2rem,7.5vw,3.5rem)] font-semibold leading-[1.02] tracking-[-0.045em]">
                Know if it makes money
                <br className="hidden sm:block" /> before you buy a single board.
              </h1>

              <p className="mt-4 max-w-xl text-[clamp(0.9375rem,2.2vw,1.0625rem)] leading-relaxed text-[var(--ink-2)]">
                Paste a link to any build you&apos;ve seen. BuildFlip reads it, works out the
                dimensions and the cut list, prices every board and screw from live listings,
                finds what finished ones <em className="not-italic underline decoration-[var(--accent)] decoration-2 underline-offset-2">actually sold for</em>, and
                gives you one number: your real hourly rate.
              </p>
            </motion.div>

            <motion.div
              initial={reduced ? undefined : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, ease, delay: 0.1 }}
              className="mt-6 flex flex-wrap items-center gap-2.5"
            >
              <Link href={signedIn ? "/apps/buildflip-2/board" : "/login"}>
                <Button variant="primary" size="lg" icon={<ArrowRight aria-hidden className="h-4 w-4" />}>
                  Price my first build
                </Button>
              </Link>
              <a href="#how">
                <Button variant="secondary" size="lg">
                  See how it works
                </Button>
              </a>
            </motion.div>

            <motion.ul
              initial={reduced ? undefined : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.7, ease, delay: 0.2 }}
              className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-[12.5px] text-[var(--ink-3)]"
            >
              {[
                "Under a minute per plan",
                "Every price shows its source and date",
                "Sold prices, never asking prices",
              ].map((t) => (
                <li key={t} className="inline-flex items-center gap-1.5">
                  <Check aria-hidden className="h-3.5 w-3.5 text-[var(--profit)]" strokeWidth={3} />
                  {t}
                </li>
              ))}
            </motion.ul>
          </div>

          {/* the real product, playable */}
          <motion.div
            initial={reduced ? undefined : { opacity: 0, y: 20, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.9, ease, delay: 0.15 }}
            className="min-w-0"
          >
            <DemoBeam />
            <p className="mt-2.5 text-center text-[11.5px] text-[var(--ink-4)]">
              That&apos;s the real thing — drag the notch and watch the hourly rate move.
            </p>
          </motion.div>
        </div>
      </section>

      {/* -------------------------------------------------------- problem */}
      <section className="border-y border-[var(--line-soft)] bg-[var(--surface)]">
        <div className="mx-auto w-full max-w-4xl px-4 py-12 sm:px-6 sm:py-16">
          <h2 className="text-[clamp(1.375rem,4vw,2rem)] font-semibold leading-[1.1] tracking-[-0.035em]">
            Flippers lose money in three places. All three are arithmetic.
          </h2>
          <div className="mt-7 grid gap-4 sm:grid-cols-3">
            {[
              {
                n: "01",
                h: "Pricing off asking prices",
                b: "Someone wants $795 for a frame on Etsy, so you plan on $795. The ones that sold went for $385 to $510. BuildFlip only ever counts completed sales, and shows you the asking prices separately so you can see the gap.",
              },
              {
                n: "02",
                h: "Forgetting the small stuff",
                b: "The oak was $126. The glue, the abrasives, the finish, the hangers and the waste were another $108. Our lists include every consumable with a waste allowance, because that is where estimates go wrong.",
              },
              {
                n: "03",
                h: "Not pricing your own hours",
                b: "A 96-hour hot tub boat with a $9,000 margin is $94 an hour. A 6-hour frame with a $190 margin is $31. Both look great until you divide. We divide, every time, and the hourly rate can veto the whole verdict.",
              },
            ].map((item, i) => (
              <motion.div
                key={item.n}
                initial={reduced ? undefined : { opacity: 0, y: 14 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{ duration: 0.6, ease, delay: i * 0.08 }}
              >
                <Card className="h-full p-4">
                  <span className="num text-[11px] font-semibold text-[var(--accent)]">
                    {item.n}
                  </span>
                  <h3 className="mt-1.5 text-[14.5px] font-semibold tracking-[-0.02em] text-[var(--ink)]">
                    {item.h}
                  </h3>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--ink-2)]">
                    {item.b}
                  </p>
                </Card>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ----------------------------------------------------- how it works */}
      <section id="how" className="scroll-mt-16">
        <div className="mx-auto w-full max-w-4xl px-4 py-12 sm:px-6 sm:py-16">
          <h2 className="text-[clamp(1.375rem,4vw,2rem)] font-semibold leading-[1.1] tracking-[-0.035em]">
            Three steps, about fifty seconds.
          </h2>
          <ol className="mt-7 space-y-3">
            {[
              {
                icon: Link2,
                h: "Paste the link, say what you want",
                b: "A TikTok, an Instagram post, a Pinterest pin — or just a sentence. Add reference photos and we read the joinery and proportions off them. Photos are resized on your phone first, so a big camera file never stalls.",
              },
              {
                icon: Search,
                h: "Watch it build",
                b: "The plan assembles itself in front of you: dimensions, the cut list, every material, then live price searching and sold-listing searching running at the same time. No spinner, and it keeps going if you close the tab.",
              },
              {
                icon: TrendingUp,
                h: "Get one number you can check",
                b: "Cost, typical sale price, profit, margin, hours and your real hourly rate, with a build-or-skip call. Tap any figure to see the page it came from and the date it was checked.",
              },
            ].map((step, i) => (
              <motion.li
                key={step.h}
                initial={reduced ? undefined : { opacity: 0, x: -12 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{ duration: 0.6, ease, delay: i * 0.08 }}
              >
                <Card className="flex items-start gap-4 p-4">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[11px] border border-[var(--accent-line)] bg-[var(--accent-soft)] text-[var(--accent)]">
                    <step.icon aria-hidden className="h-4.5 w-4.5" />
                  </span>
                  <div className="min-w-0">
                    <h3 className="text-[14.5px] font-semibold tracking-[-0.02em] text-[var(--ink)]">
                      {step.h}
                    </h3>
                    <p className="mt-1 text-[13px] leading-relaxed text-[var(--ink-2)]">
                      {step.b}
                    </p>
                  </div>
                </Card>
              </motion.li>
            ))}
          </ol>
        </div>
      </section>

      {/* -------------------------------------------------------- features */}
      <section className="border-y border-[var(--line-soft)] bg-[var(--surface)]">
        <div className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
          <h2 className="text-[clamp(1.375rem,4vw,2rem)] font-semibold leading-[1.1] tracking-[-0.035em]">
            What you get, every time.
          </h2>
          <div className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[
              {
                icon: ListOrdered,
                h: "A plan you can follow with your hands",
                b: "Ordered steps with the tools, realistic minutes, a cut list with finished sizes, and the safety notes that matter for that specific build — not generic filler.",
              },
              {
                icon: Receipt,
                h: "Every board and screw, priced",
                b: "Quantity, unit price from a real current listing, a link to buy, and a running total. Change a dimension and the quantities re-count.",
              },
              {
                icon: TrendingUp,
                h: "Resale from completed sales",
                b: "A low-to-high band built only from things that actually sold, with every sale listed. Where the market is thin, it says so instead of guessing.",
              },
              {
                icon: ShieldCheck,
                h: "Every number shows its source",
                b: "Tap any price or comp: where it came from, when it was checked, how confident we are and why. Uncertain numbers are marked uncertain.",
              },
              {
                icon: ClipboardList,
                h: "A list for the aisle",
                b: "Grouped by department, big one-handed tap targets, a running total of what's left to buy, and it exports to your notes or share sheet.",
              },
              {
                icon: GitCompareArrows,
                h: "Your ideas, ranked",
                b: "Every plan sorted by profit per hour, and two put head to head line by line, so you build the better idea instead of the first one.",
              },
            ].map((f, i) => (
              <motion.div
                key={f.h}
                initial={reduced ? undefined : { opacity: 0, y: 14 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-50px" }}
                transition={{ duration: 0.55, ease, delay: (i % 3) * 0.07 }}
              >
                <Card className="h-full p-4">
                  <f.icon aria-hidden className="h-4.5 w-4.5 text-[var(--accent)]" />
                  <h3 className="mt-2.5 text-[14px] font-semibold tracking-[-0.02em] text-[var(--ink)]">
                    {f.h}
                  </h3>
                  <p className="mt-1.5 text-[12.5px] leading-relaxed text-[var(--ink-2)]">
                    {f.b}
                  </p>
                </Card>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------ the loop */}
      <section>
        <div className="mx-auto w-full max-w-4xl px-4 py-12 sm:px-6 sm:py-16">
          <Card className="overflow-hidden border-[var(--accent-line)]">
            <div className="p-5 sm:p-7">
              <Badge tone="accent" className="mb-3">
                The part that compounds
              </Badge>
              <h2 className="text-[clamp(1.25rem,3.6vw,1.75rem)] font-semibold leading-[1.12] tracking-[-0.03em]">
                Log what you actually paid, and the next estimate gets sharper.
              </h2>
              <p className="mt-3 max-w-2xl text-[14px] leading-relaxed text-[var(--ink-2)]">
                As you buy, log each receipt. BuildFlip shows estimate against reality
                side by side — and pools those two numbers anonymously by build type, so the
                next person pricing a picture frame starts from what frames really cost, not
                from a guess. After three finished builds of a type, new estimates for it are
                corrected automatically.
              </p>
              <p className="mt-2.5 max-w-2xl text-[12.5px] leading-relaxed text-[var(--ink-4)]">
                Pooled data is two numbers and a build-type label. Never your titles, your
                photos, your prompts or anything identifying you.
              </p>
            </div>
          </Card>
        </div>
      </section>

      {/* -------------------------------------------------------- pricing */}
      <section className="border-y border-[var(--line-soft)] bg-[var(--surface)]">
        <div className="mx-auto w-full max-w-5xl px-4 py-12 sm:px-6 sm:py-16">
          <div className="mb-7 text-center">
            <h2 className="text-[clamp(1.375rem,4vw,2rem)] font-semibold leading-[1.1] tracking-[-0.035em]">
              One plan free. Then $9 a month.
            </h2>
            <p className="mx-auto mt-2.5 max-w-xl text-[14px] leading-relaxed text-[var(--ink-2)]">
              The free plan is the whole product on one build — not a crippled preview. If it
              saves you one bad buy, it has paid for a year.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {TIERS.map((tier) => (
              <Card
                key={tier.id}
                className={cn(
                  "relative flex flex-col p-5",
                  tier.featured && "border-[var(--accent-line)] shadow-[var(--shadow-pop)]",
                )}
              >
                {tier.featured && (
                  <span className="absolute -top-2.5 left-5">
                    <Badge tone="accent">Most popular</Badge>
                  </span>
                )}
                <h3 className="text-[16px] font-semibold text-[var(--ink)]">{tier.name}</h3>
                <p className="mt-0.5 text-[12px] text-[var(--ink-3)]">{tier.tagline}</p>
                <div className="mt-3 flex items-baseline gap-1.5">
                  <span className="num text-[1.75rem] font-semibold leading-none text-[var(--ink)]">
                    {tier.monthly === 0 ? "Free" : fmtMoney(tier.monthly ?? 0, { cents: false })}
                  </span>
                  {tier.monthly ? (
                    <span className="text-[12.5px] text-[var(--ink-3)]">/month</span>
                  ) : null}
                </div>
                <ul className="mt-3.5 flex-1 space-y-1.5">
                  {tier.features
                    .filter((f) => f.included)
                    .slice(0, 5)
                    .map((f) => (
                      <li key={f.text} className="flex items-start gap-2 text-[12.5px]">
                        <Check
                          aria-hidden
                          className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--profit)]"
                          strokeWidth={3}
                        />
                        <span className="text-[var(--ink-2)]">{f.text}</span>
                      </li>
                    ))}
                </ul>
                <Link href="/apps/buildflip-2/pricing" className="mt-4">
                  <Button variant={tier.featured ? "primary" : "secondary"} className="w-full">
                    {tier.id === "free" ? "Start free" : tier.cta}
                  </Button>
                </Link>
              </Card>
            ))}
          </div>
          <p className="mt-5 text-center text-[12px] text-[var(--ink-4)]">
            {TRIAL_DAYS}-day trial on Pro · Stripe shows the exact first-charge date before you
            confirm · cancel in one click · no invented reviews or user counts anywhere on this
            site
          </p>
        </div>
      </section>

      {/* ------------------------------------------------------------ FAQ */}
      <section>
        <div className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
          <h2 className="mb-5 text-[clamp(1.375rem,4vw,2rem)] font-semibold leading-[1.1] tracking-[-0.035em]">
            The questions people actually ask.
          </h2>
          <div className="space-y-2">
            {[
              {
                q: "Can it really read an Instagram or TikTok link?",
                a: "It reads everything those platforms publish to a crawler — the title, the description and the preview image — and feeds that preview image into the vision pass alongside your own photos. When a post is behind a login, the app says so plainly and works from your description and photos instead. It never invents what the post said.",
              },
              {
                q: "How accurate are the material costs?",
                a: "Prices come from the actual retailer page we found at the moment you generated, with the date shown. Our target is within 15% of the real receipts, and the admin dashboard measures that honestly against logged receipts rather than claiming it. Regional pricing, delivery and tax are not included, and we say so on every plan.",
              },
              ...PRICING_FAQ.slice(0, 4),
            ].map((item) => (
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
        </div>
      </section>

      {/* ------------------------------------------------------- final CTA */}
      <section className="relative overflow-hidden border-t border-[var(--line-soft)]">
        <WorkbenchCanvas className="pointer-events-none absolute inset-0 h-full w-full opacity-80" />
        <div className="relative mx-auto w-full max-w-2xl px-4 py-16 text-center sm:px-6 sm:py-20">
          <h2 className="text-[clamp(1.5rem,5vw,2.5rem)] font-semibold leading-[1.05] tracking-[-0.04em]">
            What are you thinking of building?
          </h2>
          <p className="mx-auto mt-3.5 max-w-lg text-[15px] leading-relaxed text-[var(--ink-2)]">
            Find out in under a minute whether it is worth your weekend. One full plan, free,
            no card.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-2.5">
            <Link href={signedIn ? "/apps/buildflip-2/board" : "/login"}>
              <Button variant="primary" size="lg" icon={<ArrowRight aria-hidden className="h-4 w-4" />}>
                Price my first build
              </Button>
            </Link>
          </div>

          <div className="mx-auto mt-10 max-w-sm">
            <EmailCapture />
          </div>
        </div>
      </section>

      {/* --------------------------------------------------------- footer */}
      <footer className="border-t border-[var(--line-soft)] bg-[var(--surface)]">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-9 sm:flex-row sm:items-start sm:justify-between sm:px-6">
          <div>
            <Link href="/apps/buildflip-2" className="flex items-center gap-2 text-[15px] font-bold tracking-[-0.03em]">
              <span className="relative grid h-6 w-6 place-items-center">
                <span className="absolute h-[5px] w-6 rounded-full bg-[var(--surface-3)]" />
                <span className="absolute left-0 h-[5px] w-[15px] rounded-full bg-[var(--profit)]" />
                <span className="absolute left-[13px] h-[15px] w-[5px] rounded-full bg-[var(--accent)]" />
              </span>
              BuildFlip
            </Link>
            <p className="mt-2 max-w-xs text-[12px] leading-relaxed text-[var(--ink-3)]">
              Know before you buy a single board. An estimating tool, not a contractor — always
              check local rules for anything structural, electrical or on the water.
            </p>
          </div>
          <nav aria-label="Footer" className="grid grid-cols-2 gap-x-10 gap-y-1.5 text-[12.5px]">
            <Link href="/apps/buildflip-2/pricing" className="text-[var(--ink-3)] hover:text-[var(--ink)]">
              Pricing
            </Link>
            <Link href="/apps/buildflip-2/board" className="text-[var(--ink-3)] hover:text-[var(--ink)]">
              My board
            </Link>
            <Link href="/apps/buildflip-2/legal/terms" className="text-[var(--ink-3)] hover:text-[var(--ink)]">
              Terms
            </Link>
            <Link href="/apps/buildflip-2/legal/privacy" className="text-[var(--ink-3)] hover:text-[var(--ink)]">
              Privacy
            </Link>
            <Link href="/apps/buildflip-2/legal/refunds" className="text-[var(--ink-3)] hover:text-[var(--ink)]">
              Refunds
            </Link>
            <a
              href="mailto:hello@buildflip.app"
              className="text-[var(--ink-3)] hover:text-[var(--ink)]"
            >
              Contact
            </a>
          </nav>
        </div>
        <div className="border-t border-[var(--line-soft)] px-4 py-4 text-center text-[11.5px] text-[var(--ink-4)] sm:px-6">
          © {new Date().getFullYear()} BuildFlip. Prices and sold figures come from third-party
          listings and are shown with the date they were checked.
        </div>
      </footer>
    </div>
  );
}

/* ----------------------------------------------------------- email capture */

function EmailCapture() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const liveRef = useRef<HTMLParagraphElement | null>(null);

  useEffect(() => {
    if (state === "done") liveRef.current?.focus();
  }, [state]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s.]+\.[^@\s]{2,}$/.test(clean)) {
      setError("That email looks incomplete — check it and try again.");
      return;
    }
    setError(null);
    setState("busy");
    try {
      const res = await fetch("/api/buildflip-2/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: clean, source: "landing" }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      if (!res.ok) {
        setState("idle");
        setError(body.error ?? "That didn't go through. Try again in a moment.");
        return;
      }
      setMessage(body.message ?? "You're on the list.");
      setState("done");
    } catch {
      setState("idle");
      setError("We couldn't reach the server. Try again in a moment.");
    }
  };

  if (state === "done") {
    return (
      <p
        ref={liveRef}
        tabIndex={-1}
        role="status"
        className="rounded-[var(--radius-ctl)] border border-[color-mix(in_srgb,var(--profit)_35%,transparent)] bg-[var(--profit-soft)] px-3.5 py-3 text-[13px] leading-relaxed text-[var(--ink)]"
      >
        {message}
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <label htmlFor="lead-email" className="block text-[12px] font-medium text-[var(--ink-3)]">
        Not ready yet? We&apos;ll email when there&apos;s something worth reading.
      </label>
      <div className="flex gap-2">
        <input
          id="lead-email"
          type="email"
          inputMode="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className={cn(fieldClass, "min-w-0 flex-1")}
        />
        <Button type="submit" variant="secondary" loading={state === "busy"}>
          Keep me posted
        </Button>
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}
    </form>
  );
}
