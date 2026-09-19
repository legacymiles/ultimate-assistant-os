"use client";

// ---------------------------------------------------------------------------
// Routines: the prompts the owner reuses, run with real context instead of
// pasted by hand.
//
// Each is editable and each keeps its last runs with their dates, so a weekly
// review can be compared with the last one. Runs are manual — nothing here is
// scheduled, and nothing a routine produces is saved or sent on its own.
// ---------------------------------------------------------------------------

import { useState } from "react";
import { Icon } from "../icons";
import { briefInputs } from "@/lib/jarvis/brief";
import { uid } from "@/lib/jarvis/store";
import type { JarvisStore, Routine } from "@/lib/jarvis/types";
import type { Profile } from "@/lib/new-dashboard/types";

const btn =
  "inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-ink-muted transition hover:bg-panel-2 hover:text-ink disabled:opacity-50";

/** The records a routine says it needs, gathered honestly — gaps included. */
function contextFor(routine: Routine, store: JarvisStore, profile: Profile | null): string {
  const brief = briefInputs(profile, store);
  const parts: string[] = [];
  if (routine.needs.includes("profile")) {
    parts.push(
      profile
        ? `PROFILE\nName: ${profile.name}\nWork: ${profile.intake.q1 || "(not filled in)"}\nPriorities: ${
            profile.intake.q3.filter(Boolean).join(" | ") || "(none saved)"
          }`
        : "PROFILE: none saved.",
    );
  }
  if (routine.needs.includes("calendar")) {
    parts.push(
      store.events.length
        ? `CALENDAR (${store.events.length} events stored)\n${brief.nextEvents
            .map((e) => `${e.date} ${e.start || "all day"}–${e.end} ${e.title}`)
            .join("\n")}`
        : "CALENDAR: no calendar is connected and no events are stored. Do not treat this as proof of free time.",
    );
  }
  if (routine.needs.includes("inbox")) {
    parts.push(
      store.messages.length
        ? `INBOX (${brief.unread.length} unread)\n${store.messages
            .slice(0, 10)
            .map((m) => `[${m.label}] ${m.from}: ${m.subject}`)
            .join("\n")}`
        : "INBOX: no mailbox is connected, so there are no messages to work from.",
    );
  }
  return parts.join("\n\n");
}

export function RoutinesTab({
  store,
  commit,
  profile,
}: {
  store: JarvisStore;
  commit: (s: JarvisStore) => void;
  profile: Profile | null;
}) {
  const [openId, setOpenId] = useState<string | null>(store.routines[0]?.id ?? null);
  const [running, setRunning] = useState<string | null>(null);
  const [error, setError] = useState("");

  const update = (id: string, fn: (r: Routine) => Routine) =>
    commit({ ...store, routines: store.routines.map((r) => (r.id === id ? fn(r) : r)) });

  const run = async (routine: Routine) => {
    setRunning(routine.id);
    setError("");
    try {
      const res = await fetch("/api/jarvis/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: routine.prompt }],
          ownerName: profile?.name ?? "",
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          extraContext: contextFor(routine, store, profile),
        }),
      });
      const data = (await res.json()) as { text?: string; error?: string };
      if (!res.ok || data.error) {
        setError(data.error ?? `Failed (${res.status}).`);
        return;
      }
      update(routine.id, (r) => ({
        ...r,
        runs: [{ id: uid(), at: new Date().toISOString(), output: data.text ?? "" }, ...r.runs].slice(0, 10),
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't reach Jarvis.");
    } finally {
      setRunning(null);
    }
  };

  return (
    <div className="p-3 sm:p-4">
      <p className="mb-3 text-[11px] text-ink-faint">
        Prompts you reuse, run with whatever Jarvis actually has. Every run is manual and nothing is
        saved, sent or scheduled on its own.
      </p>
      <div className="space-y-2">
        {store.routines.map((r) => {
          const open = openId === r.id;
          return (
            <section key={r.id} className="rounded-xl border border-line bg-panel">
              <div className="flex flex-wrap items-center gap-2 px-3 py-2">
                <button
                  onClick={() => setOpenId(open ? null : r.id)}
                  className="flex items-center gap-1.5 text-xs font-semibold text-ink"
                >
                  <Icon.Chevron
                    width={12}
                    height={12}
                    className={`transition ${open ? "rotate-90" : ""}`}
                  />
                  {r.name}
                </button>
                <span className="text-[10px] text-ink-faint">
                  needs {r.needs.join(", ")}
                  {r.runs[0] ? ` · last run ${new Date(r.runs[0].at).toLocaleDateString()}` : " · never run"}
                </span>
                <button
                  className={`${btn} ml-auto`}
                  onClick={() => void run(r)}
                  disabled={running === r.id}
                >
                  <Icon.Sparkles width={13} height={13} /> {running === r.id ? "Running…" : "Run"}
                </button>
              </div>

              {open && (
                <div className="space-y-2 border-t border-line px-3 py-2">
                  <textarea
                    value={r.prompt}
                    onChange={(e) => update(r.id, (x) => ({ ...x, prompt: e.target.value }))}
                    rows={5}
                    className="w-full rounded-md border border-line bg-panel-2 px-2 py-1.5 text-[11px] leading-relaxed text-ink focus:border-ink-faint focus:outline-none"
                  />
                  {r.runs.length > 0 ? (
                    <div>
                      <p className="mb-1 text-[10px] uppercase tracking-wide text-ink-faint">Runs</p>
                      <ul className="space-y-2">
                        {r.runs.map((run) => (
                          <li key={run.id} className="rounded-lg border border-line-soft p-2">
                            <p className="mb-1 text-[10px] text-ink-faint">
                              {new Date(run.at).toLocaleString()}
                            </p>
                            <p className="whitespace-pre-wrap text-[11px] leading-relaxed text-ink">
                              {run.output}
                            </p>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <p className="text-[11px] text-ink-muted">No runs yet.</p>
                  )}
                </div>
              )}
            </section>
          );
        })}
      </div>
      {error && <p className="mt-3 text-[11px] text-amber-400">{error}</p>}
    </div>
  );
}
