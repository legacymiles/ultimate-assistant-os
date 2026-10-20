"use client";

// One persona's workspace: a header band in the persona's own hue, then the
// tabs — Overview (profile, accounts, sign-ins), Message inbox (every DM and
// comment, answered here), Ideas, Plan (pipeline + calendar), Analytics,
// Videos, Brainstorm, and what the AI knows.

import { useMemo, useState } from "react";
import { Icon } from "../icons";
import { compact, personaTotals } from "@/lib/social-personas/studio";
import { inboxOf, unreadCounts } from "@/lib/social-personas/inbox";
import type { ConnectablePlatform, Draft, Persona } from "@/lib/social-personas/types";
import type { PublicJob, Status } from "./api";
import { AnalyticsTab } from "./AnalyticsTab";
import { Avatar, Btn } from "./bits";
import { InboxTab } from "./InboxTab";
import { loadInboxCache } from "./inboxCache";
import { OverviewTab } from "./OverviewTab";
import { PlanTab } from "./PlanTab";
import type { Mutate } from "./SocialPersonas";
import { BrainTab, BrainstormTab, ContentTab, TodayTab } from "./tabs";

const TABS = [
  { id: "overview", label: "Overview", icon: Icon.Users },
  { id: "inbox", label: "Message inbox", icon: Icon.Chat },
  { id: "ideas", label: "Ideas", icon: Icon.Bulb },
  { id: "plan", label: "Plan & post", icon: Icon.Calendar },
  { id: "analytics", label: "Analytics", icon: Icon.Target },
  { id: "content", label: "Videos", icon: Icon.Film },
  { id: "brainstorm", label: "Brainstorm", icon: Icon.Sparkles },
  { id: "brain", label: "AI memory", icon: Icon.Bot },
] as const;
export type TabId = (typeof TABS)[number]["id"];

export interface TabProps {
  persona: Persona;
  mutate: Mutate;
  flash: (t: string, bad?: boolean) => void;
  ai: boolean;
}

export function Workspace({
  persona,
  status,
  initialTab,
  mutate,
  flash,
  syncAccount,
  applyJobs,
  onEdit,
  onDelete,
  openSetup,
}: {
  openSetup: (p: ConnectablePlatform, from?: TabId) => void;
  persona: Persona;
  status: Status | null;
  initialTab: TabId;
  mutate: Mutate;
  flash: (t: string, bad?: boolean) => void;
  syncAccount: (personaId: string, accountId: string) => Promise<void>;
  applyJobs: (jobs: PublicJob[]) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [tab, setTab] = useState<TabId>(initialTab);
  const [seed, setSeed] = useState("");
  const [focusDraft, setFocusDraft] = useState<string | null>(null);
  const props: TabProps = { persona, mutate, flash, ai: status?.ai ?? false };
  const t = personaTotals(persona);
  // Unread from this device's last load; recounted whenever read-marks change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const unread = useMemo(() => unreadCounts(loadInboxCache(persona.id), inboxOf(persona).seen).total, [persona.id, persona.inbox, tab]);

  const planDraft = (d: Draft) => {
    mutate(persona.id, (p) => ({ ...p, drafts: [d, ...p.drafts] }));
    setFocusDraft(d.id);
    setTab("plan");
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col" style={{ ["--ps-hue" as string]: persona.hue }}>
      <header className="ps-band border-b border-line px-3 pt-3 sm:px-4">
        <div className="flex flex-wrap items-center gap-3">
          <Avatar name={persona.name} hue={persona.hue} size={44} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-lg font-bold text-ink">{persona.name}</h1>
              <button onClick={onEdit} className="rounded-md p-1 text-ink-muted hover:bg-panel-2 hover:text-ink" title="Edit profile" aria-label="Edit profile">
                <Icon.Edit width={14} height={14} />
              </button>
            </div>
            <div className="truncate text-xs text-ink-muted">{persona.niche || "No niche set"}</div>
          </div>
          <dl className="flex gap-3 text-right text-[11px] text-ink-faint sm:gap-4">
            <Stat k="followers" v={t.followers} />
            <Stat k="views 7d" v={t.views7d} />
            <Stat k="scheduled" v={t.scheduled} />
          </dl>
        </div>
        <nav className="-mb-px mt-3 flex gap-0.5 overflow-x-auto" aria-label="Persona sections">
          {TABS.map((x) => (
            <button
              key={x.id}
              onClick={() => setTab(x.id)}
              aria-current={tab === x.id ? "page" : undefined}
              className={
                "inline-flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] font-medium transition " +
                (tab === x.id ? "border-[hsl(var(--ps-hue)_80%_62%)] text-ink" : "border-transparent text-ink-muted hover:text-ink")
              }
            >
              <x.icon width={14} height={14} />
              {x.label}
              {x.id === "content" && <span className="text-[11px] text-ink-faint">{persona.posts.length}</span>}
              {x.id === "inbox" && unread > 0 && <span className="rounded-full bg-[hsl(var(--ps-hue)_80%_58%)] px-1.5 text-[10px] font-bold text-white">{unread}</span>}
              {x.id === "plan" && persona.drafts.some((d) => d.results.some((r) => r.status === "failed")) && <span className="h-1.5 w-1.5 rounded-full bg-rose-400" aria-label="needs attention" />}
            </button>
          ))}
        </nav>
      </header>

      <div className="min-h-0 flex-1 overflow-auto p-3 sm:p-4">
        {tab === "overview" && <OverviewTab {...props} status={status} syncAccount={syncAccount} onEdit={onEdit} onDelete={onDelete} go={setTab} openSetup={openSetup} />}
        {tab === "inbox" && <InboxTab {...props} status={status} openSetup={(p) => openSetup(p, "inbox")} />}
        {tab === "ideas" && (
          <TodayTab
            {...props}
            onPlan={planDraft}
            onBrainstorm={(s) => {
              setSeed(s);
              setTab("brainstorm");
            }}
          />
        )}
        {tab === "plan" && <PlanTab {...props} status={status} applyJobs={applyJobs} focusId={focusDraft} clearFocus={() => setFocusDraft(null)} />}
        {tab === "analytics" && <AnalyticsTab {...props} />}
        {tab === "content" && <ContentTab {...props} />}
        {tab === "brainstorm" && <BrainstormTab {...props} seed={seed} clearSeed={() => setSeed("")} />}
        {tab === "brain" && <BrainTab {...props} />}
      </div>
    </div>
  );
}

function Stat({ k, v }: { k: string; v: number }) {
  return (
    <div>
      <dd className="text-base font-bold tabular-nums text-ink">{v ? compact(v) : "—"}</dd>
      <dt>{k}</dt>
    </div>
  );
}

export { Btn };
