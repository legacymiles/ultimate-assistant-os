"use client";

// ---------------------------------------------------------------------------
// The client-review model menu: one tap to choose which model writes the build
// brief, the same way the Chat's model picker chooses its brain.
//
// Three groups, because they fail and bill differently:
//   · the lane (what happens when Claude refuses) — the behaviour that predates
//     this menu, still the default
//   · the owner's own Claude plan, which runs on their PC through the bridge
//   · OpenRouter models on the hub's key, billed per brief
//
// Under the list, the same escape hatch the Chat has: paste any OpenRouter id.
// A pick is saved on the project, so it follows the client, not the browser.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../icons";
import { probe } from "@/lib/new-jarvis/bridge";
import { groupedModels, isBriefModelId, isLaneValue, isSubscriptionValue, labelFor, whyFor } from "@/lib/client-review/models";

interface Listed {
  id: string;
  name: string;
  input: string[];
  promptPrice: number;
}

/** The menu's rows, so the button and the popover agree on the current pick. */
function Check({ on }: { on: boolean }) {
  return on ? <Icon.Check width={12} height={12} className="shrink-0 text-brand" aria-hidden /> : null;
}

export function ModelMenu({
  value,
  onChange,
  compact = false,
}: {
  value: string;
  /** "" hands the brief back to the project's lane. */
  onChange: (value: string) => void;
  /** A shorter button, for the row above the brief textarea. */
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [all, setAll] = useState<Listed[] | null>(null);
  const [bridge, setBridge] = useState<"unknown" | "up" | "off">("unknown");
  const box = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", away);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("mousedown", away);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);

  // Only ask the PC helper when the menu is opened — it is usually off.
  useEffect(() => {
    if (!open || bridge !== "unknown") return;
    let live = true;
    probe()
      .then((h) => live && setBridge(h.up && h.paired ? "up" : "off"))
      .catch(() => live && setBridge("off"));
    return () => {
      live = false;
    };
  }, [open, bridge]);

  useEffect(() => {
    if (!open || all) return;
    fetch("/api/ai/models")
      .then((r) => (r.ok ? r.json() : { models: [] }))
      .then((d: { models?: Listed[] }) => setAll(d.models ?? []))
      .catch(() => setAll([]));
  }, [open, all]);

  const found = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t || !all) return [];
    return all.filter((m) => m.id.toLowerCase().includes(t) || m.name.toLowerCase().includes(t)).slice(0, 12);
  }, [q, all]);

  const pick = (next: string) => {
    onChange(next);
    setOpen(false);
    setQ("");
  };

  const typedId = q.trim();
  const groups = groupedModels();

  return (
    <div ref={box} className="relative min-w-0">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-label="Which model writes the build brief"
        title={whyFor(value)}
        className={
          compact
            ? "inline-flex max-w-[210px] items-center gap-1 rounded border border-line bg-panel-2 px-1.5 py-0.5 text-[11px] font-medium text-ink-muted hover:text-ink"
            : "flex w-full items-center gap-1.5 rounded-md border border-line bg-panel-2 px-2 py-1.5 text-xs text-ink hover:border-brand/50"
        }
      >
        <Icon.Sparkles width={11} height={11} aria-hidden className="shrink-0" />
        <span className="truncate">{labelFor(value)}</span>
        <Icon.Chevron width={10} height={10} className="ml-auto shrink-0 rotate-90 opacity-60" aria-hidden />
      </button>

      {open && (
        <div
          className={`absolute right-0 z-40 mt-1 max-h-[70vh] w-[330px] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-lg border border-line bg-panel p-1.5 shadow-2xl ${
            compact ? "top-7" : "top-full"
          }`}
        >
          {groups.map((g) => (
            <div key={g.group} className="mb-1 border-b border-line-soft pb-1 last:mb-0 last:border-0 last:pb-0">
              <p className="px-2 pb-0.5 pt-1 text-[10px] uppercase tracking-wider text-ink-faint">{g.title}</p>
              {g.note && (
                <p className="px-2 pb-1 text-[10px] leading-snug text-ink-faint">
                  {g.note}
                  {g.group === "subscription" && bridge === "off" && (
                    <span className="text-amber-300"> · not running right now</span>
                  )}
                </p>
              )}
              <ul>
                {g.items.map((m) => (
                  <li key={m.value}>
                    <button
                      type="button"
                      onClick={() => pick(m.value)}
                      className={`flex w-full items-start gap-2 rounded px-2 py-1.5 text-left transition hover:bg-elevated ${
                        value === m.value ? "bg-elevated" : ""
                      }`}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block text-[12px] text-ink">{m.label}</span>
                        <span className="block text-[10.5px] leading-snug text-ink-muted">{m.why}</span>
                      </span>
                      <Check on={value === m.value} />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          <div className="px-1 pt-1">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && isBriefModelId(typedId)) pick(typedId);
              }}
              placeholder="Search every OpenRouter model, or paste an id…"
              aria-label="Search models"
              className="w-full rounded border border-line bg-canvas px-2 py-1 text-[11.5px] text-ink outline-none placeholder:text-ink-faint focus:border-brand-2"
            />
            {q && (
              <ul className="mt-1">
                {all === null && <li className="px-2 py-1 text-[11px] text-ink-faint">Loading the list…</li>}
                {found.map((m) => (
                  <li key={m.id}>
                    <button
                      type="button"
                      onClick={() => pick(m.id)}
                      className="flex w-full items-center gap-2 rounded px-2 py-1 text-left hover:bg-elevated"
                    >
                      <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink">{m.name}</span>
                      <span className="shrink-0 font-mono text-[9.5px] text-ink-faint">
                        {m.promptPrice ? `$${m.promptPrice.toFixed(2)}/M` : "free"}
                      </span>
                    </button>
                  </li>
                ))}
                {all && !found.length && isBriefModelId(typedId) && (
                  <li>
                    <button
                      type="button"
                      onClick={() => pick(typedId)}
                      className="w-full rounded px-2 py-1 text-left text-[11.5px] text-brand hover:bg-elevated"
                    >
                      Use “{typedId}”
                    </button>
                  </li>
                )}
                {all && !found.length && !isBriefModelId(typedId) && (
                  <li className="px-2 py-1 text-[11px] text-ink-faint">No match.</li>
                )}
              </ul>
            )}
            {value && !isLaneValue(value) && !isSubscriptionValue(value) && (
              <p className="px-1 pt-1 text-[10.5px] text-ink-muted">
                Using <span className="font-mono text-ink">{value}</span> ·{" "}
                <button type="button" className="text-brand hover:underline" onClick={() => pick("")}>
                  back to Auto
                </button>
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
