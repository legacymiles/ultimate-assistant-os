"use client";

// ---------------------------------------------------------------------------
// Financial Bible · Funding room.
//
// A broker's desk reference: qualify a client, find the lender, check the rule,
// say the right thing on the call. Every word on screen comes from
// src/lib/seed-content/financial-bible — this file only arranges it, so the
// layout can be rebuilt without touching the knowledge.
// ---------------------------------------------------------------------------

import { useCallback, useMemo, useState } from "react";
import { LENDERS, LESSONS, READ_ON } from "@/lib/seed-content/financial-bible";
import { search, type FundingTab, type Hit } from "@/lib/bible/funding/search";
import { fileFundingIntoTimeline } from "@/lib/bible/funding/fileToTimeline";
import { QualifyTab } from "./QualifyTab";
import { LendersTab } from "./LendersTab";
import { CheatsTab, LessonsTab, MistakesTab, PlaysTab, ScriptsTab } from "./ReferenceTabs";
import "./funding.css";

const TABS: { id: FundingTab; label: string }[] = [
  { id: "qualify", label: "Qualify a client" },
  { id: "lenders", label: `Lenders (${LENDERS.length})` },
  { id: "cheats", label: "Cheat sheets" },
  { id: "plays", label: "Plays & sequences" },
  { id: "mistakes", label: "Mistakes" },
  { id: "scripts", label: "Scripts & docs" },
  { id: "lessons", label: `Lessons (${LESSONS.length})` },
];

const KIND_LABEL: Record<Hit["kind"], string> = {
  lender: "Lender",
  cheat: "Cheat sheet",
  tip: "Play",
  mistake: "Mistake",
  sequence: "Sequence",
  script: "Script",
  lesson: "Lesson",
  "left-out": "Left out",
};

const readOn = new Date(`${READ_ON}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

export function FundingRoom() {
  const [tab, setTab] = useState<FundingTab>("qualify");
  const [q, setQ] = useState("");
  const [focus, setFocus] = useState<string | null>(null);
  const [filing, setFiling] = useState<"idle" | "busy" | string>("idle");

  const hits = useMemo(() => search(q), [q]);

  const open = useCallback((h: Hit) => {
    setTab(h.tab);
    setFocus(h.id);
    setQ("");
    // Let the tab render, then bring the item into view.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const el = document.querySelector(`[data-kb="${CSS.escape(h.id)}"]`);
        el?.scrollIntoView({ behavior: "smooth", block: "center" });
      }),
    );
  }, []);

  const file = useCallback(async () => {
    setFiling("busy");
    try {
      const r = await fileFundingIntoTimeline();
      setFiling(
        r.added === 0
          ? `Projects Timeline already has all ${r.total} entries`
          : `Filed ${r.added} entries into ${r.projectName} in Projects Timeline`,
      );
    } catch (e) {
      setFiling(`Couldn't file into Projects Timeline: ${e instanceof Error ? e.message : "unknown error"}`);
    }
  }, []);

  return (
    <section className="fund">
      <header className="bible-vault-head">
        <div>
          <h1>Funding</h1>
          <p>
            Lender rules, approval numbers and plays from the 6 Figure Funder course, read {readOn}. Banks change
            rules — confirm a figure with the bank before you promise it.
          </p>
        </div>
        <div className="bible-vault-tools">
          <label className="bible-search fund-search">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search everything — a bank, a rule, 5/24…"
              aria-label="Search the funding knowledge base"
            />
          </label>
          <button type="button" className="bb" data-tone="ghost" onClick={file} disabled={filing === "busy"}>
            {filing === "busy" ? "Filing…" : "File into Projects Timeline"}
          </button>
        </div>
      </header>

      {filing !== "idle" && filing !== "busy" && (
        <p className="fund-flash" role="status">
          {filing}
        </p>
      )}

      {q.trim() ? (
        <div className="fund-hits" role="list">
          {hits.length === 0 && <p className="fund-none">Nothing matches “{q}”. Try a bank name, a bureau (EX, TU, EQ) or a word like utilization.</p>}
          {hits.map((h) => (
            <button key={`${h.kind}-${h.id}`} type="button" role="listitem" className="fund-hit" onClick={() => open(h)}>
              <span className="fund-hit-kind" data-k={h.kind}>
                {KIND_LABEL[h.kind]}
              </span>
              <span className="fund-hit-title">{h.title}</span>
              <span className="fund-hit-line">{h.line}</span>
            </button>
          ))}
        </div>
      ) : (
        <>
          <nav className="fund-tabs" aria-label="Funding sections">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                data-active={t.id === tab}
                aria-current={t.id === tab ? "page" : undefined}
                onClick={() => {
                  setTab(t.id);
                  setFocus(null);
                }}
              >
                {t.label}
              </button>
            ))}
          </nav>

          {tab === "qualify" && <QualifyTab onOpenLender={(id) => open({ kind: "lender", id, title: "", line: "", tab: "lenders" })} />}
          {tab === "lenders" && <LendersTab focus={focus} />}
          {tab === "cheats" && <CheatsTab focus={focus} />}
          {tab === "plays" && <PlaysTab focus={focus} />}
          {tab === "mistakes" && <MistakesTab focus={focus} />}
          {tab === "scripts" && <ScriptsTab focus={focus} />}
          {tab === "lessons" && <LessonsTab focus={focus} />}
        </>
      )}
    </section>
  );
}
