"use client";

// The conversation with Jarvis — the main thread under the stage and the
// per-task one in a task's Talk tab. Your messages carry the reference
// pictures you attached; each Jarvis reply says which model planned it and
// carries a live card for every task it filed or acted on (status, progress,
// next run — read from the same 4-second snapshot as the board). A card opens
// its task.

import { useEffect, useRef } from "react";
import type { Task, TaskMessage } from "@/lib/queue247/types";
import { STATUS_LABEL } from "@/lib/queue247/engine";
import { modelLabel } from "@/lib/new-jarvis/chatModels";
import { currentStepOf, nextRunText, progressOf, toneOf } from "@/lib/queue247/view";
import { ProgressBar, StatusMark } from "./parts";

export function MessageList({
  messages,
  tasks,
  onOpen,
  thinking,
  empty,
  followOnLoad = true,
}: {
  messages: TaskMessage[];
  tasks: Task[];
  onOpen: (id: string) => void;
  thinking?: boolean;
  empty?: React.ReactNode;
  /** Scroll to the newest message when the history first arrives. Off on the
      page's main thread, which must open at the stage, not at its bottom. */
  followOnLoad?: boolean;
}) {
  const end = useRef<HTMLDivElement>(null);
  const seen = useRef(messages.length);
  useEffect(() => {
    const before = seen.current;
    seen.current = messages.length;
    const loaded = before === 0 && messages.length > 0;
    const grew = before > 0 && messages.length > before;
    if (thinking || grew || (loaded && followOnLoad)) end.current?.scrollIntoView({ block: "nearest", behavior: loaded ? "auto" : "smooth" });
  }, [messages.length, thinking, followOnLoad]);
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const now = new Date();

  if (!messages.length && !thinking) return <>{empty ?? null}</>;
  return (
    <ol className="flex flex-col gap-3" aria-live="polite">
      {messages.map((m) => (
        <li key={m.id} className={`flex ${m.role === "you" ? "justify-end" : "justify-start"}`}>
          {m.role === "you" ? (
            <div className="q-bubble-you max-w-[86%] px-3.5 py-2.5">
              {m.attachments && m.attachments.length > 0 && (
                <ul className="mb-2 flex flex-wrap gap-1.5" aria-label="Reference pictures">
                  {m.attachments.map((a) => (
                    <li key={a.key}>
                      {a.url ? (
                        <a href={a.url} target="_blank" rel="noreferrer" className="q-ref" title={a.name}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={a.url} alt={a.name} />
                        </a>
                      ) : (
                        <span className="q-ref q-ref-missing" title="This picture is stored, but there is no Storage link to show it here.">
                          {a.name}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-[var(--q-ink)]">{m.text}</p>
            </div>
          ) : (
            <div className="max-w-[92%]">
              <p className="mb-1 font-mono text-[10.5px] tracking-[0.04em] text-[var(--q-faint)]">
                <span className="text-[var(--q-run)]">JARVIS</span>
                {m.model === "offline" ? " · planned offline" : m.model ? ` · ${modelLabel(m.model)}` : ""}
              </p>
              <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-[var(--q-ink)]">{m.text}</p>
              {m.task_ids.length > 0 && (
                <div className="mt-2.5 flex flex-col gap-1.5">
                  {m.task_ids.map((id) => {
                    const t = byId.get(id);
                    if (!t)
                      return (
                        <button key={id} type="button" onClick={() => onOpen(id)} className="q-taskcard text-[12px] text-[var(--q-muted)]">
                          Open task
                        </button>
                      );
                    const tone = toneOf(t, now);
                    const p = progressOf(t);
                    const step = currentStepOf(t);
                    return (
                      <button key={id} type="button" onClick={() => onOpen(id)} className="q-taskcard" data-tone={tone}>
                        <span className="flex min-w-0 items-center gap-2">
                          <StatusMark tone={tone} />
                          <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-[var(--q-ink)]">{t.title}</span>
                          <span className="flex-none font-mono text-[10.5px] uppercase tracking-[0.05em]" data-tone-ink={tone}>
                            {STATUS_LABEL[t.status]}
                          </span>
                        </span>
                        <span className="mt-1 flex min-w-0 items-center gap-2 pl-[17px] text-[11px] text-[var(--q-muted)]">
                          <span className="min-w-0 flex-1 truncate">{step ?? t.agent}</span>
                          <span className="flex-none text-[var(--q-faint)]" data-num>
                            {nextRunText(t, now)}
                          </span>
                        </span>
                        {p != null && tone === "running" && <ProgressBar value={p} tone={tone} live className="mt-1.5 ml-[17px]" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </li>
      ))}
      {thinking && (
        <li className="flex justify-start">
          <div className="flex items-center gap-2 py-1 text-[12px] text-[var(--q-muted)]">
            <span className="q-thinking" aria-hidden>
              <i />
              <i />
              <i />
            </span>
            Jarvis is planning. This can take up to a minute.
          </div>
        </li>
      )}
      <div ref={end} />
    </ol>
  );
}
