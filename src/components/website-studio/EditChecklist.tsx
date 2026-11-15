"use client";

// ---------------------------------------------------------------------------
// The checklist the owner watches while Claude works on an edit.
//
// Claude's own task list when it keeps one (the bridge relays TodoWrite and
// TaskCreate as `plan` events), otherwise the lane's own steps ticked off from
// the tools the thread has run. Either way the last line is "Live on the
// site", the one step no tool can prove because Vercel finishes it.
// ---------------------------------------------------------------------------

import type { CheckItem } from "@/lib/website-studio/lane";

export function EditChecklist({ items, title, compact = false }: { items: CheckItem[]; title: string; compact?: boolean }) {
  if (!items.length) return null;
  const done = items.filter((i) => i.state === "done").length;
  return (
    <section className={`ws-checklist${compact ? " compact" : ""}`} aria-label={title}>
      <header>
        <b>{title}</b>
        <span>
          {done} of {items.length}
        </span>
      </header>
      <ol>
        {items.map((item, i) => (
          <li key={`${i}-${item.text}`} className={`is-${item.state}`} aria-current={item.state === "now" ? "step" : undefined}>
            <span className="ws-check" aria-hidden>
              {item.state === "done" ? (
                <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3.5 8.5 6.5 11.5 12.5 4.5" />
                </svg>
              ) : null}
            </span>
            <span className="ws-check-text">{item.text}</span>
            <span className="sr-only">{item.state === "done" ? " — done" : item.state === "now" ? " — working on it" : ""}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
