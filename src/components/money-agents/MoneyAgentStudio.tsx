"use client";

// ---------------------------------------------------------------------------
// Money Agent Studio — agents that make videos that make money.
//
// Clippers cut the best moments out of long videos, Faceless channels write
// and voice their own videos, Campaign clippers work paid clipping campaigns.
// The PC makes the files (In Queue), the owner approves every one, Personas
// Studio posts them, and the money lands in Earnings — and in Financial
// Bible's Money Plays room, which reads the same board.
//
// Radar (owner's ask, Oct 2026) is the market side: the most lucrative
// opportunities right now with the reasoning why, the CPI/jobs/Fed calendar,
// smart companies, and a move bot that runs while the studio is open.
//
// Design skill: interactive-web-studio. The conveyor is the toy; the rest is a
// ledger. On Radar, the radar dish takes the conveyor's place.
// ---------------------------------------------------------------------------

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useMoneyAgents } from "@/lib/money-agents/useMoneyAgents";
import { useRadar } from "@/lib/money-agents/useRadar";
import { STAGES, type ItemStage } from "@/lib/money-agents/types";
import { compact, money } from "@/lib/money-agents/logic";
import { AgentsTab } from "./AgentsTab";
import { ApproveTab } from "./ApproveTab";
import { CampaignsTab } from "./CampaignsTab";
import { EarningsTab } from "./EarningsTab";
import { PipelineTab } from "./PipelineTab";
import { RadarTab } from "./RadarTab";
import "./money-agents.css";

export type TabId = "radar" | "approve" | "pipeline" | "agents" | "campaigns" | "earnings";

const TABS: { id: TabId; label: string }[] = [
  { id: "radar", label: "Radar" },
  { id: "approve", label: "Approve" },
  { id: "pipeline", label: "Pipeline" },
  { id: "agents", label: "Agents" },
  { id: "campaigns", label: "Campaigns" },
  { id: "earnings", label: "Earnings" },
];

const REMEMBERED = "money-agent-studio:tab";

export function MoneyAgentStudio({ initialTab }: { initialTab: TabId | null }) {
  const m = useMoneyAgents();
  const [tab, setTab] = useState<TabId>(initialTab ?? "radar");
  // The move bot lives here so it keeps watching whichever tab is open.
  const radar = useRadar((c) => m.say(`${c.label}: ${c.reason}`, undefined, c.dir === "up" ? "ok" : "warn"));
  const [stage, setStage] = useState<ItemStage | "all">("all");
  const [focusAgent, setFocusAgent] = useState<string | null>(null);

  // Land where it matters: something waiting → Approve; else the last tab used, else Radar.
  useEffect(() => {
    if (initialTab) return;
    let saved: string | null = null;
    try {
      saved = window.localStorage.getItem(REMEMBERED);
    } catch {
      /* storage refused — the default stands */
    }
    if (m.sums.waiting > 0) setTab("approve");
    else if (saved && TABS.some((t) => t.id === saved)) setTab(saved as TabId);
    // Only on arrival: after that the owner drives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const go = (next: TabId) => {
    setTab(next);
    try {
      window.localStorage.setItem(REMEMBERED, next);
    } catch {
      /* a convenience, never a requirement */
    }
    const url = new URL(window.location.href);
    url.searchParams.set("tab", next);
    window.history.replaceState(null, "", url);
  };

  const openAgent = (id: string) => {
    setFocusAgent(id);
    go("agents");
  };

  const pressStage = (s: ItemStage) => {
    if (s === "ready") return go("approve");
    setStage(s);
    go("pipeline");
  };

  return (
    <div className="mas">
      <div className="mas-wrap">
        <header className="mas-bar">
          <Link href="/apps/jarvis#plugins" className="mas-back">
            ← <span className="mas-link-text">App plugins</span>
          </Link>
          <div className="mas-brand">
            <h1>
              Money Agent <em>Studio</em>
            </h1>
            <span>{tab === "radar" ? "The biggest money moves right now, and why" : "Agents that make videos that make money"}</span>
          </div>
          <Link href="/apps/financial-bible?studio=plays" className="mas-link" title="See every money play in Financial Bible">
            <span className="mas-link-text">Financial Bible</span> ↗
          </Link>
        </header>

        {tab !== "radar" && (
        <section className="mas-hero" aria-label="Money and pipeline">
          <div>
            <div className="mas-money-label">Paid this month</div>
            <Odometer value={m.sums.paidThisMonth} />
            <div className="mas-stats">
              <div className="mas-stat" data-tone="gold">
                <strong>{money(m.sums.paidAllTime)}</strong>
                <small>paid, all time</small>
              </div>
              <div className="mas-stat" data-tone="mint">
                <strong>{money(m.sums.estimated)}</strong>
                <small>estimated from views</small>
              </div>
              <div className="mas-stat">
                <strong>{compact(m.sums.views)}</strong>
                <small>views</small>
              </div>
            </div>
          </div>
          <Conveyor counts={m.sums.stageCounts} active={tab === "pipeline" ? stage : tab === "approve" ? "ready" : null} onPress={pressStage} />
        </section>
        )}

        <nav className="mas-tabs" role="tablist" aria-label="Money Agent Studio">
          {TABS.map((t) => (
            <button key={t.id} type="button" role="tab" className="mas-tab" aria-selected={tab === t.id} onClick={() => go(t.id)}>
              {t.label}
              {t.id === "approve" && m.sums.waiting > 0 && <span className="mas-badge">{m.sums.waiting}</span>}
              {t.id === "radar" && radar.catchesToday > 0 && <span className="mas-badge">{radar.catchesToday}</span>}
            </button>
          ))}
        </nav>

        <main>
          {tab === "radar" && <RadarTab r={radar} say={(text, tone) => m.say(text, undefined, tone)} />}
          {tab === "approve" && <ApproveTab m={m} onOpenAgent={openAgent} onGo={go} />}
          {tab === "pipeline" && <PipelineTab m={m} stage={stage} onStage={setStage} onOpenAgent={openAgent} />}
          {tab === "agents" && <AgentsTab m={m} focus={focusAgent} onFocus={setFocusAgent} />}
          {tab === "campaigns" && <CampaignsTab m={m} onOpenAgent={openAgent} />}
          {tab === "earnings" && <EarningsTab m={m} onOpenAgent={openAgent} />}
        </main>
      </div>

      {m.toast && <ToastView key={m.toast.id} toast={m.toast} onClose={m.dismissToast} />}
    </div>
  );
}

/**
 * The month's money on rolling reels, like a pump meter. Each digit is a
 * column of 0-9 that slides to its value, so a payout landing reads as money
 * arriving rather than a number changing.
 */
function Odometer({ value }: { value: number }) {
  const text = money(value);
  return (
    <div className="mas-odo" aria-label={text} role="img">
      {text.split("").map((ch, i) =>
        /\d/.test(ch) ? (
          <span className="mas-odo-digit" key={`${i}-${text.length}`} aria-hidden>
            <span className="mas-odo-reel" style={{ transform: `translateY(-${Number(ch)}em)` }}>
              {Array.from({ length: 10 }, (_, d) => (
                <span key={d}>{d}</span>
              ))}
            </span>
          </span>
        ) : (
          <span className="mas-odo-static" key={`${i}-${text.length}`} aria-hidden>
            {ch}
          </span>
        ),
      )}
    </div>
  );
}

/**
 * The pipeline as a lit track. Tokens drift between stages that have work in
 * them — more work, more tokens — so a busy pipeline LOOKS busy. Every stage is
 * a button: Approve opens the approvals, the rest filter the pipeline.
 */
function Conveyor({
  counts,
  active,
  onPress,
}: {
  counts: Record<ItemStage, number>;
  active: ItemStage | "all" | null;
  onPress: (s: ItemStage) => void;
}) {
  const tokens = useMemo(() => {
    const out: { key: string; from: string; to: string; d: number; delay: number; gold: boolean }[] = [];
    STAGES.forEach((s, i) => {
      if (i === STAGES.length - 1) return;
      const n = Math.min(3, counts[s.id]);
      for (let k = 0; k < n; k++) {
        out.push({
          key: `${s.id}-${k}`,
          from: `calc(${((i + 0.5) / STAGES.length) * 100}% - 5px)`,
          to: `calc(${((i + 1.5) / STAGES.length) * 100}% - 5px)`,
          d: 4.5 + k * 0.9,
          delay: k * 1.4 + i * 0.3,
          gold: s.id === "ready" || s.id === "approved",
        });
      }
    });
    return out;
  }, [counts]);

  return (
    <div className="mas-conveyor">
      <div className="mas-track" aria-hidden />
      <div className="mas-tokens" aria-hidden>
        {tokens.map((t) => (
          <span
            key={t.key}
            className="mas-token"
            data-gold={t.gold}
            style={{ ["--from" as string]: t.from, ["--to" as string]: t.to, ["--d" as string]: `${t.d}s`, ["--delay" as string]: `${t.delay}s` }}
          />
        ))}
      </div>
      <div className="mas-stages">
        {STAGES.map((s) => (
          <button
            key={s.id}
            type="button"
            className="mas-stage"
            data-on={active === s.id}
            data-hot={s.id === "ready" && counts.ready > 0}
            data-zero={counts[s.id] === 0}
            onClick={() => onPress(s.id)}
            aria-label={`${s.label}: ${counts[s.id]} — ${s.hint}`}
          >
            <span className="mas-stage-dot">{counts[s.id]}</span>
            <span className="mas-stage-label">{s.label}</span>
            <span className="mas-stage-hint">{s.hint}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function ToastView({ toast, onClose }: { toast: NonNullable<ReturnType<typeof useMoneyAgents>["toast"]>; onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, toast.undo ? 7000 : 4500);
    return () => clearTimeout(t);
  }, [toast, onClose]);
  return (
    <div className="mas-toast" role="status" data-tone={toast.tone}>
      <span>{toast.text}</span>
      {toast.undo && (
        <button
          type="button"
          onClick={() => {
            toast.undo?.();
            onClose();
          }}
        >
          Undo
        </button>
      )}
    </div>
  );
}
