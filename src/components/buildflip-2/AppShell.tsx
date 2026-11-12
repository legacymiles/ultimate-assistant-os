"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  FlaskConical,
  GitCompareArrows,
  LayoutGrid,
  Moon,
  Settings,
  ShieldCheck,
  Sparkles,
  Sun,
} from "lucide-react";
import { useApp } from "./AppState";
import { useTheme } from "./Providers";
import { Badge, Button } from "./ui";
import { cn, ease } from "@/lib/buildflip-2/ui";

/**
 * The shell. Bottom bar on a phone with 44px+ targets, a top bar on a laptop —
 * everything reachable with a thumb, nothing cut off the edge (U1, U9).
 */

const NAV = [
  { href: "/apps/buildflip-2/board", label: "Board", icon: LayoutGrid },
  { href: "/apps/buildflip-2/compare", label: "Compare", icon: GitCompareArrows },
  { href: "/apps/buildflip-2/settings", label: "Settings", icon: Settings },
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { account, entitlement, capabilities, missing, signedIn } = useApp();
  const { resolved, setTheme } = useTheme();
  const [showDemo, setShowDemo] = useState(true);

  const isPro = account?.plan === "pro";
  // Off on this hub, so neither the "free plan left" nudge nor the Pro badge
  // appears: there is nothing to buy and nothing to be upgraded from.
  const money = Boolean(capabilities?.monetization);
  const demoish =
    capabilities && (!capabilities.liveResearch || !capabilities.database);

  return (
    <div className="relative flex min-h-dvh flex-col">
      {/* --------------------------------------------------------- top bar */}
      <header className="sticky top-0 z-40 border-b border-[var(--line-soft)] bg-[color-mix(in_srgb,var(--bg)_82%,transparent)] backdrop-blur-xl">
        <div className="mx-auto flex h-14 w-full max-w-[1480px] items-center gap-3 px-4 sm:px-6">
          <Link
            href="/apps/buildflip-2/board"
            className="flex shrink-0 items-center gap-2 text-[15px] font-bold tracking-[-0.03em] text-[var(--ink)]"
          >
            <span className="relative grid h-6 w-6 place-items-center">
              <span className="absolute h-[5px] w-6 rounded-full bg-[var(--surface-3)]" />
              <span className="absolute left-0 h-[5px] w-[15px] rounded-full bg-[var(--profit)]" />
              <span className="absolute left-[13px] h-[15px] w-[5px] rounded-full bg-[var(--accent)]" />
            </span>
            BuildFlip
          </Link>

          <nav aria-label="Main" className="ml-2 hidden items-center gap-0.5 sm:flex">
            {NAV.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "relative inline-flex min-h-9 items-center gap-1.5 rounded-[9px] px-2.5 text-[13.5px] font-medium transition-colors",
                    active
                      ? "text-[var(--ink)]"
                      : "text-[var(--ink-3)] hover:text-[var(--ink)]",
                  )}
                >
                  <item.icon aria-hidden className="h-4 w-4" />
                  {item.label}
                  {active && (
                    <motion.span
                      layoutId="nav-underline"
                      className="absolute inset-x-1.5 -bottom-[11px] h-[2px] rounded-full bg-[var(--accent)]"
                      transition={{ duration: 0.3, ease }}
                    />
                  )}
                </Link>
              );
            })}
            {account?.role === "admin" && (
              <Link
                href="/apps/buildflip-2/admin"
                className={cn(
                  "inline-flex min-h-9 items-center gap-1.5 rounded-[9px] px-2.5 text-[13.5px] font-medium transition-colors",
                  pathname === "/apps/buildflip-2/admin"
                    ? "text-[var(--ink)]"
                    : "text-[var(--ink-3)] hover:text-[var(--ink)]",
                )}
              >
                <ShieldCheck aria-hidden className="h-4 w-4" />
                Owner
              </Link>
            )}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            {money && signedIn && !isPro && entitlement && (
              <Link href="/apps/buildflip-2/pricing" className="hidden min-[26rem]:block">
                <Badge tone="accent" className="cursor-pointer">
                  <Sparkles aria-hidden className="h-3 w-3" />
                  {entitlement.plansRemaining > 0
                    ? `${entitlement.plansRemaining} free plan left`
                    : "Go Pro"}
                </Badge>
              </Link>
            )}
            {money && isPro && (
              <Badge tone="profit" className="hidden min-[26rem]:inline-flex">
                Pro
              </Badge>
            )}

            <button
              type="button"
              onClick={() => setTheme(resolved === "dark" ? "light" : "dark")}
              aria-label={`Switch to ${resolved === "dark" ? "light" : "dark"} mode`}
              className="grid h-10 w-10 place-items-center rounded-[10px] text-[var(--ink-3)] transition hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
            >
              {resolved === "dark" ? (
                <Sun aria-hidden className="h-4 w-4" />
              ) : (
                <Moon aria-hidden className="h-4 w-4" />
              )}
            </button>

            {!signedIn && (
              <Link href="/login">
                <Button size="sm" variant="primary">
                  Sign in
                </Button>
              </Link>
            )}
          </div>
        </div>
      </header>

      {/* ------------------------------------------------- demo-mode banner */}
      <AnimatePresence>
        {demoish && showDemo && missing.length > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.35, ease }}
            className="overflow-hidden border-b border-[var(--accent-line)] bg-[var(--accent-soft)]"
          >
            <div className="mx-auto flex w-full max-w-[1480px] flex-col gap-2 px-4 py-2.5 sm:flex-row sm:items-center sm:px-6">
              <FlaskConical
                aria-hidden
                className="h-4 w-4 shrink-0 text-[var(--accent)]"
              />
              <p className="min-w-0 flex-1 text-[12.5px] leading-relaxed text-[var(--ink-2)]">
                <strong className="font-semibold text-[var(--ink)]">Demo mode.</strong>{" "}
                {missing.map((m) => m.unlocks).join("; ")}. Everything else works normally,
                and anything from the demo catalog is labelled wherever it appears.
              </p>
              <button
                type="button"
                onClick={() => setShowDemo(false)}
                className="shrink-0 self-start rounded px-1.5 py-0.5 text-[12px] font-medium text-[var(--ink-3)] underline-offset-2 hover:text-[var(--ink)] hover:underline sm:self-auto"
              >
                Got it
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <main id="main" className="relative flex-1 pb-[76px] sm:pb-0">
        {children}
      </main>

      {/* ----------------------------------------------------- bottom bar */}
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--line)] bg-[color-mix(in_srgb,var(--bg)_94%,transparent)] pb-[env(safe-area-inset-bottom)] backdrop-blur-xl sm:hidden"
      >
        <div className="flex items-stretch">
          {NAV.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-[60px] flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors",
                  active ? "text-[var(--accent)]" : "text-[var(--ink-3)]",
                )}
              >
                <item.icon aria-hidden className="h-[18px] w-[18px]" />
                {item.label}
              </Link>
            );
          })}
          {account?.role === "admin" && (
            <Link
              href="/apps/buildflip-2/admin"
              className={cn(
                "flex min-h-[60px] flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors",
                pathname === "/apps/buildflip-2/admin" ? "text-[var(--accent)]" : "text-[var(--ink-3)]",
              )}
            >
              <ShieldCheck aria-hidden className="h-[18px] w-[18px]" />
              Owner
            </Link>
          )}
        </div>
      </nav>
    </div>
  );
}
