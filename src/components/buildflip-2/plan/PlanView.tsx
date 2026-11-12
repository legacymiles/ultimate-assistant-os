"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowLeft,
  Check,
  ClipboardList,
  Copy,
  ExternalLink,
  FlaskConical,
  Link2,
  ListOrdered,
  Package,
  Receipt as ReceiptIcon,
  Share2,
  Trash2,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { useApp, write } from "../AppState";
import { useToast } from "../Providers";
import Paywall from "../Paywall";
import { Badge, Button, Card, ErrorNote, Sheet } from "../ui";
import Comps from "./Comps";
import Materials from "./Materials";
import Receipts from "./Receipts";
import ShoppingList from "./ShoppingList";
import Steps from "./Steps";
import VerdictCard from "./VerdictCard";
import { STAGES, type Project, type ProjectStage } from "@/lib/buildflip-2/types";
import { fmtHours } from "@/lib/buildflip-2/calc";
import { ago, cn, ease } from "@/lib/buildflip-2/ui";

/**
 * The plan — everything the user came for, in one scroll on a phone and one
 * screen on a laptop. The verdict is always above the fold, because it is the
 * answer; the detail is in tabs below it, because that is what you work from.
 */

type Tab = "steps" | "materials" | "resale" | "shopping" | "receipts";

// `LucideIcon` rather than a bare `React.ElementType`: under the hub's
// @types/react an unparameterised ElementType resolves its props to `never`,
// so handing one a className is a type error. These are all Lucide icons.
const TABS: { id: Tab; label: string; icon: LucideIcon }[] = [
  { id: "steps", label: "Steps", icon: ListOrdered },
  { id: "materials", label: "Materials", icon: Package },
  { id: "resale", label: "Resale", icon: TrendingUp },
  { id: "shopping", label: "Shopping", icon: ClipboardList },
  { id: "receipts", label: "Real cost", icon: ReceiptIcon },
];

export default function PlanView({
  initial,
  readOnly,
  shareToken,
}: {
  initial: Project;
  /** True on a shared read-only link. */
  readOnly?: boolean;
  shareToken?: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const { account, projects, putProject, dropProject, refresh } = useApp();
  const [project, setProject] = useState(initial);
  const [tab, setTab] = useState<Tab>("steps");
  const [repricing, setRepricing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [paywall, setPaywall] = useState<{ moment: string; message: string } | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const isPro = account?.plan === "pro";

  useEffect(() => setProject(initial), [initial]);

  /**
   * Stay current by itself (A1). The board's provider already refreshes on
   * focus and on a heartbeat; this picks up any newer copy of THIS plan — so a
   * plan still generating finishes on screen, and an edit made on the phone
   * appears on the laptop, with nobody pressing a button.
   */
  useEffect(() => {
    if (readOnly) return;
    const fresh = projects.find((p) => p.id === initial.id);
    if (fresh && fresh.updatedAt > project.updatedAt) setProject(fresh);
  }, [projects, initial.id, project.updatedAt, readOnly]);

  // While a plan is still building, poll a little faster than the heartbeat.
  useEffect(() => {
    if (readOnly || !project.generating) return;
    const timer = setInterval(() => void refresh({ quiet: true }), 4000);
    return () => clearInterval(timer);
  }, [readOnly, project.generating, refresh]);

  const apply = useCallback(
    (next: Project) => {
      setProject(next);
      putProject(next);
    },
    [putProject],
  );

  /* ------------------------------------------------------------- writes */

  const patch = useCallback(
    async (body: Record<string, unknown>, optimistic?: Partial<Project>) => {
      if (readOnly) return;

      // Snapshot ONLY the fields this call is changing. Reverting the whole
      // object would also undo anything that succeeded in between — log a
      // receipt while a dimension save is in flight and a failure on the
      // dimension would make the receipt disappear.
      const touched = Object.keys(optimistic ?? {}) as (keyof Project)[];
      const before: Partial<Project> = {};
      for (const k of touched) before[k] = project[k] as never;

      // Functional updates so two optimistic writes in one render cycle don't
      // each compute from the same stale snapshot.
      if (optimistic) setProject((prev) => ({ ...prev, ...optimistic }));

      const res = await write<{ project: Project }>(`/api/buildflip-2/plan/${project.id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });

      if (res.ok && res.data?.project) {
        apply(res.data.project);
        setProblem(null);
      } else {
        setProject((prev) => ({ ...prev, ...before }));
        setProblem(res.error ?? "That change didn't save. Nothing was lost — try again.");
      }
    },
    [project, readOnly, apply],
  );

  const reprice = async () => {
    if (!isPro) {
      setPaywall({ moment: "reprice", message: "" });
      return;
    }
    setRepricing(true);
    const res = await write<{
      project: Project;
      changed: number;
      pricesRechecked: boolean;
      compsRechecked: boolean;
      warning: string | null;
    }>(`/api/buildflip-2/plan/${project.id}/reprice`, { method: "POST", timeoutMs: 180_000 });
    setRepricing(false);
    if (res.ok && res.data?.project) {
      apply(res.data.project);
      const d = res.data;
      // Only claim prices were re-checked if they actually were — saying
      // "nothing has moved" after a failed search presents a stale price as
      // a fresh one, which is the one thing this product must not do.
      toast({
        tone: d.warning ? "info" : "success",
        message: d.warning
          ? d.warning
          : d.changed > 0
            ? `${d.changed} price${d.changed === 1 ? "" : "s"} changed since last time.`
            : d.pricesRechecked
              ? "Re-checked against today's listings — nothing has moved."
              : "Re-checked the resale comps. Prices couldn't be re-checked this time.",
      });
    } else if (res.paywall) {
      setPaywall({ moment: res.paywall.moment, message: res.paywall.message });
    } else {
      toast({ tone: "error", message: res.error ?? "Re-pricing didn't go through." });
    }
  };

  const addReceipt = async (input: {
    materialId: string | null;
    label: string;
    amount: number;
    store?: string;
  }): Promise<string | null> => {
    setBusy(true);
    const res = await write<{ project: Project }>(`/api/buildflip-2/plan/${project.id}/receipts`, {
      method: "POST",
      body: JSON.stringify(input),
    });
    setBusy(false);
    if (res.ok && res.data?.project) {
      apply(res.data.project);
      toast({ tone: "success", message: "Logged. The verdict above has updated." });
      return null;
    }
    if (res.paywall) {
      setPaywall({ moment: res.paywall.moment, message: res.paywall.message });
      return null;
    }
    return res.error ?? "That didn't save. Try again.";
  };

  const deleteReceipt = async (receiptId: string) => {
    const res = await write<{ project: Project }>(`/api/buildflip-2/plan/${project.id}/receipts`, {
      method: "DELETE",
      body: JSON.stringify({ receiptId }),
    });
    if (res.ok && res.data?.project) apply(res.data.project);
    else toast({ tone: "error", message: res.error ?? "Couldn't remove that." });
  };

  const removePlan = async () => {
    setBusy(true);
    const res = await write(`/api/buildflip-2/plan/${project.id}`, { method: "DELETE" });
    setBusy(false);
    setDeleteOpen(false);
    if (res.ok) {
      dropProject(project.id);
      toast({ tone: "success", message: `“${project.title}” deleted.` });
      router.push("/apps/buildflip-2/board");
    } else {
      toast({ tone: "error", message: res.error ?? "Couldn't delete that. Try again." });
    }
  };

  const demo =
    project.resale?.provenance.demo || project.materials.some((m) => m.provenance.demo);

  /* ------------------------------------------------- still building / failed */

  if (project.generating) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10 text-center sm:px-6">
        <div className="skel mx-auto mb-4 h-3 w-40 rounded-full" />
        <h1 className="text-[20px] font-semibold">{project.title}</h1>
        <p className="mx-auto mt-2 max-w-sm text-[13.5px] leading-relaxed text-[var(--ink-2)]">
          This plan is still being built. It keeps going on the server even with this tab
          closed — the page updates by itself when it lands.
        </p>
        <div className="mt-6 space-y-2.5">
          <div className="skel h-24 rounded-[var(--radius-card)]" />
          <div className="skel h-16 rounded-[var(--radius-card)]" />
        </div>
      </div>
    );
  }

  if (project.error) {
    return (
      <div className="mx-auto max-w-xl px-4 py-12 sm:px-6">
        <Link
          href="/apps/buildflip-2/board"
          className="mb-5 inline-flex items-center gap-1.5 text-[13px] text-[var(--ink-3)] hover:text-[var(--ink)]"
        >
          <ArrowLeft aria-hidden className="h-3.5 w-3.5" />
          Back to the board
        </Link>
        <h1 className="text-[22px] font-semibold tracking-[-0.03em]">{project.title}</h1>
        <p className="mt-2 text-[13.5px] text-[var(--ink-2)]">
          Your idea is saved exactly as you typed it. Nothing was charged against your free
          plan.
        </p>
        <div className="mt-4">
          <ErrorNote
            onRetry={() => {
              void (async () => {
                setBusy(true);
                const res = await fetch("/api/buildflip-2/plan/generate", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    prompt: project.prompt,
                    sourceUrl: project.sourceUrl || undefined,
                    images: project.referenceImages,
                    projectId: project.id,
                  }),
                });
                setBusy(false);
                if (res.ok) {
                  toast({ tone: "info", message: "Re-building. This takes under a minute." });
                  await refresh({ quiet: true });
                  router.refresh();
                } else {
                  toast({ tone: "error", message: "Still not going through. Try again shortly." });
                }
              })();
            }}
          >
            {project.error}
          </ErrorNote>
        </div>
        <div className="mt-4 rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--surface)] p-4">
          <h2 className="mb-1.5 text-[12px] font-semibold uppercase tracking-[0.08em] text-[var(--ink-3)]">
            What you asked for
          </h2>
          <p className="text-[13px] leading-relaxed text-[var(--ink-2)]">{project.prompt}</p>
          {project.sourceUrl && (
            <a
              href={project.sourceUrl}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="mt-2 inline-flex items-center gap-1 text-[12px] text-[var(--accent)] hover:underline"
            >
              <Link2 aria-hidden className="h-3 w-3" />
              the link you pasted
            </a>
          )}
        </div>
      </div>
    );
  }

  /* --------------------------------------------------------------- the plan */

  return (
    <div className="mx-auto w-full max-w-5xl px-4 pb-16 pt-5 sm:px-6 sm:pt-7">
      {/* --------------------------------------------------------- header */}
      {!readOnly ? (
        <Link
          href="/apps/buildflip-2/board"
          className="mb-4 inline-flex min-h-9 items-center gap-1.5 text-[13px] text-[var(--ink-3)] transition hover:text-[var(--ink)]"
        >
          <ArrowLeft aria-hidden className="h-3.5 w-3.5" />
          Board
        </Link>
      ) : (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--surface)] px-4 py-3">
          <p className="text-[12.5px] text-[var(--ink-2)]">
            <strong className="font-semibold text-[var(--ink)]">A shared plan.</strong>{" "}
            Read-only — whoever made it can switch this link off at any time.
          </p>
          <Link href="/apps/buildflip-2">
            <Button size="sm" variant="primary">
              Make your own, free
            </Button>
          </Link>
        </div>
      )}

      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
            <Badge tone="neutral">{STAGES.find((s) => s.id === project.stage)?.label}</Badge>
            <Badge>{project.skillLevel}</Badge>
            <Badge>{fmtHours(project.estimatedHours)}</Badge>
            {demo && (
              <Badge tone="accent">
                <FlaskConical aria-hidden className="h-3 w-3" />
                demo prices
              </Badge>
            )}
          </div>
          <h1 className="text-[clamp(1.375rem,5vw,1.875rem)] font-semibold leading-[1.1] tracking-[-0.035em]">
            {project.title}
          </h1>
          <p className="mt-1.5 max-w-2xl text-[13.5px] leading-relaxed text-[var(--ink-2)]">
            {project.summary}
          </p>

          {project.sourceRead && (
            <p className="mt-2 text-[11.5px] leading-relaxed text-[var(--ink-4)]">
              {project.sourceRead.ok ? (
                <>
                  Read from{" "}
                  {project.sourceUrl ? (
                    <a
                      href={project.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="inline-flex items-center gap-0.5 text-[var(--ink-3)] underline-offset-2 hover:text-[var(--accent)] hover:underline"
                    >
                      the {project.sourceRead.platform} post
                      <ExternalLink aria-hidden className="h-2.5 w-2.5" />
                    </a>
                  ) : (
                    `the ${project.sourceRead.platform} post`
                  )}
                  {project.referenceImages.length > 0 &&
                    ` and ${project.referenceImages.length} of your photos`}
                  .
                </>
              ) : (
                project.sourceRead.reason
              )}
            </p>
          )}
          <p className="mt-1 text-[11px] text-[var(--ink-4)]">
            Made {ago(project.createdAt)}
            {project.calibration &&
              ` · calibrated from ${project.calibration.sampleSize} real receipts for this build type`}
          </p>
        </div>

        {!readOnly && (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor="plan-stage">
              Stage
            </label>
            <select
              id="plan-stage"
              value={project.stage}
              onChange={(e) =>
                void patch({ stage: e.target.value }, { stage: e.target.value as ProjectStage })
              }
              className="min-h-10 rounded-[var(--radius-ctl)] border border-[var(--line)] bg-[var(--surface-2)] px-2.5 text-[13px] text-[var(--ink)]"
            >
              {STAGES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
            <Button
              size="md"
              variant="secondary"
              onClick={() => setShareOpen(true)}
              icon={<Share2 aria-hidden className="h-4 w-4" />}
            >
              Share
            </Button>
            <Button
              size="md"
              variant="ghost"
              onClick={() => setDeleteOpen(true)}
              aria-label="Delete this plan"
              icon={<Trash2 aria-hidden className="h-4 w-4" />}
            />
          </div>
        )}
      </div>

      {problem && (
        <div className="mb-4">
          <ErrorNote onRetry={() => setProblem(null)} retryLabel="Dismiss">
            {problem}
          </ErrorNote>
        </div>
      )}

      {/* Never show demo prices without saying why they're demo prices. */}
      {demo && project.fallbackReason && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-card)] border border-[var(--accent-line)] bg-[var(--accent-soft)] px-4 py-3">
          <p className="flex min-w-0 items-start gap-2 text-[12.5px] leading-relaxed text-[var(--ink-2)]">
            <FlaskConical
              aria-hidden
              className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--accent)]"
            />
            <span>{project.fallbackReason}</span>
          </p>
          {!readOnly && (
            <Button size="sm" variant="secondary" loading={repricing} onClick={reprice}>
              Try live prices
            </Button>
          )}
        </div>
      )}

      {/* --------------------------------------------------------- verdict */}
      <div className="mb-5">
        <VerdictCard
          project={project}
          readOnly={readOnly}
          hourlyTarget={readOnly ? null : account?.hourlyTarget}
          onAskingPrice={
            readOnly
              ? undefined
              : (value) => void patch({ askingPrice: value }, { askingPrice: value })
          }
        />
      </div>

      {/* ------------------------------------------------------------ tabs */}
      <div
        role="tablist"
        aria-label="Plan sections"
        className="swipe-row mb-4 border-b border-[var(--line-soft)] pb-0 sm:gap-1"
      >
        {TABS.filter((t) => !(readOnly && (t.id === "receipts" || t.id === "shopping"))).map(
          (t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                role="tab"
                aria-selected={active}
                aria-controls={`panel-${t.id}`}
                id={`tab-${t.id}`}
                onClick={() => setTab(t.id)}
                className={cn(
                  "relative inline-flex min-h-11 items-center gap-1.5 whitespace-nowrap px-3 text-[13.5px] font-medium transition-colors",
                  active ? "text-[var(--ink)]" : "text-[var(--ink-3)] hover:text-[var(--ink)]",
                )}
              >
                <t.icon aria-hidden className="h-4 w-4" />
                {t.label}
                {t.id === "receipts" && project.receipts.length > 0 && (
                  <span className="num rounded-full bg-[var(--surface-3)] px-1.5 text-[10px]">
                    {project.receipts.length}
                  </span>
                )}
                {active && (
                  <motion.span
                    layoutId="plan-tab"
                    className="absolute inset-x-1 -bottom-px h-[2px] rounded-full bg-[var(--accent)]"
                    transition={{ duration: 0.3, ease }}
                  />
                )}
              </button>
            );
          },
        )}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={tab}
          id={`panel-${tab}`}
          role="tabpanel"
          aria-labelledby={`tab-${tab}`}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.25, ease }}
        >
          {tab === "steps" && (
            <Steps
              project={project}
              readOnly={readOnly}
              onToggle={
                readOnly
                  ? undefined
                  : (stepId, done) =>
                      void patch(
                        { stepDone: { id: stepId, done } },
                        {
                          steps: project.steps.map((s) =>
                            s.id === stepId ? { ...s, done } : s,
                          ),
                        },
                      )
              }
            />
          )}

          {tab === "materials" && (
            <Materials
              project={project}
              readOnly={readOnly}
              canReprice={isPro}
              repricing={repricing}
              onReprice={readOnly ? undefined : reprice}
              onDimensions={
                readOnly ? undefined : (dimensions) => void patch({ dimensions })
              }
              onPrice={
                readOnly
                  ? undefined
                  : (id, unitPrice) => void patch({ materialPrice: { id, unitPrice } })
              }
            />
          )}

          {tab === "resale" && <Comps resale={project.resale} />}

          {tab === "shopping" && (
            <ShoppingList
              project={project}
              readOnly={readOnly}
              onChange={readOnly ? undefined : (shopping) => void patch({ shopping })}
            />
          )}

          {tab === "receipts" && (
            <Receipts
              project={project}
              busy={busy}
              locked={!isPro}
              onUnlock={() => setPaywall({ moment: "receipts", message: "" })}
              onAdd={addReceipt}
              onDelete={deleteReceipt}
            />
          )}
        </motion.div>
      </AnimatePresence>

      {/* ---------------------------------------------------------- sheets */}
      <ShareSheet
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        project={project}
        onProject={apply}
      />

      <Sheet
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Delete this plan?"
        description="This removes the plan, its receipts and its share link. It can't be undone."
        footer={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setDeleteOpen(false)} className="flex-1">
              Keep it
            </Button>
            <Button variant="danger" loading={busy} onClick={removePlan} className="flex-1">
              Delete it
            </Button>
          </div>
        }
      >
        <p className="text-[13.5px] leading-relaxed text-[var(--ink-2)]">
          <strong className="font-semibold text-[var(--ink)]">{project.title}</strong> and
          its {project.receipts.length} logged receipt
          {project.receipts.length === 1 ? "" : "s"} will be gone for good.
        </p>
      </Sheet>

      <Paywall
        open={Boolean(paywall)}
        moment={paywall?.moment ?? "secondPlan"}
        message={paywall?.message}
        onClose={() => setPaywall(null)}
        returnTo={`/apps/buildflip-2/plan/${project.id}`}
      />
    </div>
  );
}

/* ----------------------------------------------------------------- sharing */

function ShareSheet({
  open,
  onClose,
  project,
  onProject,
}: {
  open: boolean;
  onClose: () => void;
  project: Project;
  onProject: (p: Project) => void;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState<string | null>(
    project.share?.enabled
      ? `${typeof location !== "undefined" ? location.origin : ""}/share/${project.share.token}`
      : null,
  );
  const [copied, setCopied] = useState(false);

  const live = project.share?.enabled;

  const enable = async () => {
    setBusy(true);
    const res = await write<{ url: string; project: Project }>(
      `/api/buildflip-2/plan/${project.id}/share`,
      { method: "POST" },
    );
    setBusy(false);
    if (res.ok && res.data) {
      setUrl(res.data.url);
      onProject(res.data.project);
    } else {
      toast({ tone: "error", message: res.error ?? "Couldn't make a link. Try again." });
    }
  };

  const revoke = async () => {
    setBusy(true);
    const res = await write<{ project: Project }>(`/api/buildflip-2/plan/${project.id}/share`, {
      method: "DELETE",
    });
    setBusy(false);
    if (res.ok && res.data?.project) {
      onProject(res.data.project);
      setUrl(null);
      toast({ tone: "success", message: "Link switched off. It stops working immediately." });
    } else {
      toast({ tone: "error", message: res.error ?? "Couldn't switch it off. Try again." });
    }
  };

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      toast({ tone: "error", message: "Your browser blocked the clipboard — select the link instead." });
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Share this plan"
      description="A read-only link with its own address, which you can switch off whenever you like."
    >
      <div className="space-y-4">
        {live && url ? (
          <>
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={url}
                aria-label="Share link"
                onFocus={(e) => e.currentTarget.select()}
                className="min-h-11 min-w-0 flex-1 rounded-[var(--radius-ctl)] border border-[var(--line)] bg-[var(--surface-2)] px-3 font-mono text-[12px] text-[var(--ink-2)]"
              />
              <Button
                variant="primary"
                onClick={copy}
                icon={
                  copied ? (
                    <Check aria-hidden className="h-4 w-4" />
                  ) : (
                    <Copy aria-hidden className="h-4 w-4" />
                  )
                }
              >
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>

            <ul className="space-y-1.5 text-[12.5px] leading-relaxed text-[var(--ink-2)]">
              <li>· Anyone with the link can read the plan — no sign-in needed.</li>
              <li>· Your receipts and what you actually paid are never included.</li>
              <li>· The link carries a proper title and preview image when it&apos;s pasted.</li>
            </ul>

            <Button variant="danger" loading={busy} onClick={revoke} className="w-full">
              Switch this link off
            </Button>
          </>
        ) : (
          <>
            <p className="text-[13.5px] leading-relaxed text-[var(--ink-2)]">
              Make a link you can send to a partner, a buyer or a client. They see the steps,
              the materials and the verdict — never your receipts, and never your other plans.
            </p>
            <Button variant="primary" size="lg" loading={busy} onClick={enable} className="w-full">
              Make a share link
            </Button>
          </>
        )}
      </div>
    </Sheet>
  );
}
