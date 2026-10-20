"use client";

// Overview: the persona's profile, its setup checklist (so a new persona is
// never a blank page — U4/O6), and its accounts with their sign-ins.

import type { ConnectablePlatform } from "@/lib/social-personas/types";
import { useState } from "react";
import { Icon } from "../icons";
import { usePasswordVault } from "@/lib/passwords/usePasswordVault";
import type { Status } from "./api";
import { Accounts } from "./Accounts";
import { Btn } from "./bits";
import type { TabId, TabProps } from "./Workspace";

export function OverviewTab({
  status,
  syncAccount,
  onEdit,
  onDelete,
  go,
  openSetup,
  ...props
}: TabProps & {
  openSetup: (p: ConnectablePlatform) => void;
  status: Status | null;
  syncAccount: (personaId: string, accountId: string) => Promise<void>;
  onEdit: () => void;
  onDelete: () => void;
  go: (t: TabId) => void;
}) {
  const { persona: p } = props;
  const vault = usePasswordVault();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const steps = [
    { done: Boolean(p.overview || p.niche), label: "Write the profile overview", act: onEdit },
    { done: p.accounts.length > 0, label: "Add its accounts", act: undefined },
    { done: p.accounts.length > 0 && p.accounts.every((a) => a.loginItemId), label: "Save each account's sign-in", act: undefined },
    { done: p.accounts.some((a) => a.connectionId), label: "Connect an account (one sign-in: stats sync in, posts go out by themselves)", act: undefined },
    { done: p.drafts.length > 0, label: "Plan the first post", act: () => go("ideas") },
  ];
  const left = steps.filter((s) => !s.done);

  return (
    <div className="mx-auto grid max-w-6xl gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
      <div className="space-y-4">
        <section className="rounded-xl border border-line bg-panel">
          <div className="flex items-center border-b border-line px-3 py-2">
            <h3 className="text-[11px] font-medium uppercase tracking-wider text-ink-faint">Profile overview</h3>
            <button onClick={onEdit} className="ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-ink-muted hover:bg-panel-2 hover:text-ink">
              <Icon.Edit width={11} height={11} /> Edit
            </button>
          </div>
          <div className="space-y-2 px-3 py-2.5 text-xs">
            {p.overview ? (
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">{p.overview}</p>
            ) : (
              <button onClick={onEdit} className="text-sm text-ink-muted hover:text-brand">
                Who is {p.name}? Add a few sentences — every idea and caption follows it.
              </button>
            )}
            {p.contentTypes.length > 0 && (
              <div className="flex flex-wrap gap-1 pt-1">
                {p.contentTypes.map((t) => (
                  <span key={t} className="rounded-md bg-panel-2 px-1.5 py-0.5 text-[11px] text-ink-muted">
                    {t}
                  </span>
                ))}
              </div>
            )}
            <dl className="grid grid-cols-[72px_1fr] gap-x-2 gap-y-1 pt-1">
              <Row k="Niche" v={p.niche} />
              <Row k="Audience" v={p.audience} />
              <Row k="Voice" v={p.tone} />
              <Row k="Goals" v={p.goals} />
              <Row k="Never" v={p.avoid} />
            </dl>
          </div>
        </section>

        {left.length > 0 && (
          <section className="rounded-xl border border-line bg-panel px-3 py-2.5">
            <h3 className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-ink-faint">
              Setup · {steps.length - left.length} of {steps.length}
            </h3>
            <div className="mb-2 h-1 overflow-hidden rounded-full bg-panel-2">
              <div className="h-full rounded-full bg-brand transition-[width] duration-500" style={{ width: `${((steps.length - left.length) / steps.length) * 100}%` }} />
            </div>
            <ul className="space-y-1 text-xs">
              {steps.map((s) => (
                <li key={s.label} className="flex items-center gap-2">
                  <span className={"inline-flex h-4 w-4 items-center justify-center rounded-full border " + (s.done ? "border-emerald-500 bg-emerald-500/20 text-emerald-400" : "border-line text-transparent")}>
                    <Icon.Check width={10} height={10} />
                  </span>
                  {s.act && !s.done ? (
                    <button onClick={s.act} className="text-ink hover:text-brand">
                      {s.label} →
                    </button>
                  ) : (
                    <span className={s.done ? "text-ink-faint line-through" : "text-ink"}>{s.label}</span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <div className="space-y-4">
        <Accounts persona={p} status={status} vault={vault} mutate={props.mutate} flash={props.flash} syncAccount={syncAccount} openSetup={openSetup} />
        <div className="border-t border-line pt-3">
          {confirmDelete ? (
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-ink-muted">
              Delete {p.name}, its plan and its scheduled posts? Saved sign-ins stay in Passwords.
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
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  if (!v) return null;
  return (
    <>
      <dt className="text-ink-faint">{k}</dt>
      <dd className="min-w-0 text-ink-muted">{v}</dd>
    </>
  );
}
