"use client";

// ---------------------------------------------------------------------------
// Asking, and being asked.
//
// The incoming side leads with a preview of exactly what approving would show,
// because "approve" is meaningless if you have to remember what is on your own
// card. The outgoing side never distinguishes a denial from silence: a denied
// request simply stops appearing, so refusing is not itself a disclosure.
// ---------------------------------------------------------------------------

import { useState } from "react";
import type { DerivedStatus } from "@/lib/stdsafe/status";
import type { InboxRequest } from "@/lib/stdsafe/client";
import { relativeTime } from "@/lib/utils";
import { StatusCard } from "./StatusCard";

function expiresIn(iso?: string): string {
  if (!iso) return "";
  const ms = Date.parse(iso) - Date.now();
  if (ms <= 0) return "expired";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m left`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m left`;
}

function Who({ request }: { request: InboxRequest }) {
  return (
    <span className="text-[14px] text-ink">
      {request.who.displayName || request.who.handle}
      {request.who.displayName && <span className="ml-1.5 text-[12px] text-ink-faint">@{request.who.handle}</span>}
    </span>
  );
}

interface Props {
  incoming: InboxRequest[];
  outgoing: InboxRequest[];
  myStatus: DerivedStatus;
  busy: boolean;
  onAnswer: (id: string, approve: boolean) => void;
  onRevoke: (id: string) => void;
  onView: (id: string) => void;
}

export function RequestInbox({ incoming, outgoing, myStatus, busy, onAnswer, onRevoke, onView }: Props) {
  const [previewing, setPreviewing] = useState<string | null>(null);

  const pending = incoming.filter((r) => r.status === "pending");
  const granted = incoming.filter((r) => r.status === "approved");

  return (
    <div className="space-y-8">
      <section>
        <h3 className="mb-3 text-[13px] font-medium uppercase tracking-widest text-ink-faint">
          Asking you {pending.length > 0 && <span className="text-amber-300">· {pending.length} waiting</span>}
        </h3>

        {pending.length === 0 && granted.length === 0 ? (
          <p className="rounded-xl border border-line bg-panel px-5 py-6 text-center text-[13px] text-ink-muted">
            Nobody is asking. Share your code and their request lands here.
          </p>
        ) : (
          <ul className="space-y-3">
            {pending.map((request) => (
              <li key={request.id} className="rounded-xl border border-amber-500/25 bg-amber-500/[0.04]">
                <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                  <div>
                    <Who request={request} />
                    <p className="mt-0.5 text-[12px] text-ink-faint">
                      asked {relativeTime(request.createdAt)} · they see it for 24 hours
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setPreviewing(previewing === request.id ? null : request.id)}
                      className="rounded-lg border border-line px-3 py-1.5 text-[12px] text-ink-muted transition hover:text-ink"
                    >
                      {previewing === request.id ? "Hide preview" : "Preview what they'd see"}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onAnswer(request.id, false)}
                      className="rounded-lg border border-line px-3 py-1.5 text-[12px] text-ink-muted transition hover:text-ink disabled:opacity-50"
                    >
                      Deny
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onAnswer(request.id, true)}
                      className="rounded-lg bg-emerald-500/90 px-3 py-1.5 text-[12px] font-medium text-black transition hover:bg-emerald-400 disabled:opacity-50"
                    >
                      Approve
                    </button>
                  </div>
                </div>

                {previewing === request.id && (
                  <div className="animate-fade-in border-t border-amber-500/20 px-5 py-4">
                    <StatusCard status={myStatus} name="Exactly what they will see" showCaveats={false} compact />
                  </div>
                )}

                <p className="border-t border-amber-500/20 px-5 py-2.5 text-[11px] text-ink-faint">
                  Denying is silent — they see no answer at all, not a refusal.
                </p>
              </li>
            ))}

            {granted.map((request) => (
              <li
                key={request.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-panel px-5 py-4"
              >
                <div>
                  <Who request={request} />
                  <p className="mt-0.5 text-[12px] text-emerald-300/80">
                    can see your card · {expiresIn(request.grantExpiresAt)}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onRevoke(request.id)}
                  className="rounded-lg border border-line px-3 py-1.5 text-[12px] text-ink-muted transition hover:text-ink disabled:opacity-50"
                >
                  Cut it off now
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="mb-3 text-[13px] font-medium uppercase tracking-widest text-ink-faint">You asked</h3>
        {outgoing.length === 0 ? (
          <p className="rounded-xl border border-line bg-panel px-5 py-6 text-center text-[13px] text-ink-muted">
            Nothing outstanding. Enter someone's code above to ask.
          </p>
        ) : (
          <ul className="space-y-3">
            {outgoing.map((request) => (
              <li
                key={request.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-panel px-5 py-4"
              >
                <div>
                  <Who request={request} />
                  <p className="mt-0.5 text-[12px] text-ink-faint">
                    {request.status === "pending"
                      ? `waiting since ${relativeTime(request.createdAt)}`
                      : request.status === "approved"
                        ? `approved · ${expiresIn(request.grantExpiresAt)}`
                        : "no longer available"}
                  </p>
                </div>
                {request.status === "approved" ? (
                  <button
                    type="button"
                    onClick={() => onView(request.id)}
                    className="rounded-lg bg-brand px-3 py-1.5 text-[12px] font-medium text-white transition hover:bg-brand-2"
                  >
                    Open their card
                  </button>
                ) : (
                  <span className="text-[12px] text-ink-faint">
                    {request.status === "pending" ? "waiting on them" : "expired"}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
