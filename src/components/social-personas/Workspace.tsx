"use client";

import { useState } from "react";
import { Icon } from "../icons";
import type { Persona } from "@/lib/social-personas/types";
import type { Status } from "./api";
import { Accounts } from "./Accounts";
import { Avatar, Btn } from "./bits";
import type { Mutate } from "./SocialPersonas";
import { BrainTab, BrainstormTab, ContentTab, TodayTab } from "./tabs";

const TABS = [
  { id: "today", label: "Today's ideas", icon: Icon.Bulb },
  { id: "brainstorm", label: "Brainstorm", icon: Icon.Sparkles },
  { id: "content", label: "Content", icon: Icon.Film },
  { id: "brain", label: "What the AI knows", icon: Icon.Bot },
] as const;
type Tab = (typeof TABS)[number]["id"];

export interface TabProps {
  persona: Persona;
  mutate: Mutate;
  flash: (t: string, bad?: boolean) => void;
  ai: boolean;
}

export function Workspace({
  persona,
  status,
  mutate,
  flash,
  syncAccount,
  onEdit,
  onDelete,
}: {
  persona: Persona;
  status: Status | null;
  mutate: Mutate;
  flash: (t: string, bad?: boolean) => void;
  syncAccount: (personaId: string, accountId: string) => Promise<void>;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [tab, setTab] = useState<Tab>("today");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [seed, setSeed] = useState("");
  const props: TabProps = { persona, mutate, flash, ai: status?.ai ?? false };

  return (
    <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      <aside className="w-full shrink-0 space-y-4 border-b border-line bg-panel/50 p-3 lg:w-80 lg:overflow-auto lg:border-b-0 lg:border-r">
        <div className="flex items-start gap-2.5">
          <Avatar name={persona.name} hue={persona.hue} size={44} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-base font-bold text-ink">{persona.name}</div>
            <div className="text-xs text-ink-muted">{persona.niche || "No niche set"}</div>
          </div>
          <button onClick={onEdit} className="rounded-lg p-1.5 text-ink-muted hover:bg-panel-2 hover:text-ink" title="Edit persona">
            <Icon.Edit width={14} height={14} />
          </button>
        </div>
        <dl className="space-y-1 text-xs">
          {persona.contentTypes.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {persona.contentTypes.map((t) => (
                <span key={t} className="rounded-md bg-panel-2 px-1.5 py-0.5 text-[11px] text-ink-muted">
                  {t}
                </span>
              ))}
            </div>
          )}
          <Row k="Audience" v={persona.audience} />
          <Row k="Tone" v={persona.tone} />
          <Row k="Goals" v={persona.goals} />
          <Row k="Avoid" v={persona.avoid} />
        </dl>
        <Accounts persona={persona} status={status} mutate={mutate} flash={flash} syncAccount={syncAccount} />
        <div className="border-t border-line pt-3">
          {confirmDelete ? (
            <div className="flex items-center gap-1.5 text-xs text-ink-muted">
              Delete {persona.name}?
              <Btn className="!border-rose-500/50 !text-rose-400" onClick={onDelete}>
                Delete
              </Btn>
              <Btn onClick={() => setConfirmDelete(false)}>Keep</Btn>
            </div>
          ) : (
            <button onClick={() => setConfirmDelete(true)} className="text-[11px] text-ink-faint hover:text-rose-400">
              Delete persona
            </button>
          )}
        </div>
      </aside>

      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        <nav className="flex gap-1 overflow-x-auto border-b border-line px-2 pt-2">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={
                "inline-flex shrink-0 items-center gap-1.5 rounded-t-lg border-b-2 px-3 py-2 text-sm font-medium transition " +
                (tab === t.id ? "border-brand text-ink" : "border-transparent text-ink-muted hover:text-ink")
              }
            >
              <t.icon width={14} height={14} />
              {t.label}
              {t.id === "content" && <span className="text-[11px] text-ink-faint">{persona.posts.length}</span>}
            </button>
          ))}
        </nav>
        <div className="min-h-0 flex-1 overflow-auto p-3 sm:p-4">
          {tab === "today" && (
            <TodayTab
              {...props}
              onBrainstorm={(s) => {
                setSeed(s);
                setTab("brainstorm");
              }}
            />
          )}
          {tab === "brainstorm" && <BrainstormTab {...props} seed={seed} clearSeed={() => setSeed("")} />}
          {tab === "content" && <ContentTab {...props} />}
          {tab === "brain" && <BrainTab {...props} />}
        </div>
      </main>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  if (!v) return null;
  return (
    <div className="flex gap-2">
      <dt className="w-16 shrink-0 text-ink-faint">{k}</dt>
      <dd className="min-w-0 text-ink-muted">{v}</dd>
    </div>
  );
}
