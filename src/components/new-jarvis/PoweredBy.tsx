"use client";

// ---------------------------------------------------------------------------
// "Powered by" — which Claude runs a harness job, and who pays for it.
//
// The same menu on 24/7 agents, In Queue and the harness start panel, so a
// pick means one thing everywhere. Grouped by who pays (your plan / the API)
// because that is the real decision: the model names repeat across the two
// groups on purpose, and the group heading is what tells them apart.
//
// A route the PC cannot run is shown greyed with the bridge's own reason,
// never hidden (a menu that silently drops an option reads as a broken
// feature). With the PC asleep nothing is greyed: an agent filed from a phone
// will run later, on whatever the PC has then.
// ---------------------------------------------------------------------------

import { useCallback, useRef, useState } from "react";

import { Icon } from "../icons";
import { Popover } from "../Popover";
import {
  groupedPicks,
  pickModel,
  pickShort,
  routeOf,
  type PickRoute,
  type RouteState,
} from "@/lib/new-jarvis/harness/models";

export function PoweredBy({
  value,
  onChange,
  routes,
  label = "Powered by",
  compact = false,
  id,
}: {
  value: string;
  onChange: (value: string) => void;
  /** From routeStates(); null entries mean "PC not reachable — unknown". */
  routes?: Record<PickRoute, RouteState | null>;
  label?: string;
  /** A chip for a dense row instead of a full-width field. */
  compact?: boolean;
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const close = useCallback(() => setOpen(false), []);
  const current = pickModel(value);
  const route = routeOf(value);
  const state = routes?.[route] ?? null;
  const blocked = state !== null && !state.available;

  const choose = (v: string) => {
    onChange(v);
    setOpen(false);
  };

  return (
    <>
      <button
        ref={trigger}
        id={id}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="listbox"
        title={`${label}: ${current?.label ?? pickShort(value)}`}
        className={
          compact
            ? `inline-flex min-h-[28px] max-w-[190px] items-center gap-1 rounded border px-1.5 text-[10.5px] font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-2 ${
                blocked ? "border-amber-400/50 text-amber-300" : "border-line text-ink hover:bg-line/40"
              }`
            : `flex min-h-[36px] w-full items-center gap-2 rounded border bg-bg px-2 text-left text-[13px] transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-2 ${
                blocked ? "border-amber-400/50" : "border-line hover:border-ink-faint"
              }`
        }
      >
        <Icon.Sparkles width={compact ? 10 : 12} height={compact ? 10 : 12} className="shrink-0 text-brand-2" aria-hidden />
        {compact ? (
          <span className="truncate">{pickShort(value)}</span>
        ) : (
          <span className="min-w-0 flex-1">
            <span className="block truncate text-ink">{current?.label ?? pickShort(value)}</span>
            <span className={`block truncate text-[11px] ${blocked ? "text-amber-300" : "text-ink-faint"}`}>
              {blocked ? state?.why : current?.why ?? "A custom model id."}
            </span>
          </span>
        )}
        <Icon.Chevron width={10} height={10} className="shrink-0 rotate-90 opacity-60" aria-hidden />
      </button>

      <Popover open={open} anchor={trigger} onClose={close} width={330} role="listbox" label={label} className="p-1.5">
        <div className="max-h-[70vh] overflow-y-auto">
          {groupedPicks().map((g) => {
            const gs = routes?.[g.route] ?? null;
            const off = gs !== null && !gs.available;
            return (
              <div key={g.route} className="mb-1 last:mb-0">
                <p className="flex items-center gap-1.5 px-2 pb-0.5 pt-1 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
                  {g.title}
                  {gs?.available ? <span className="size-1.5 rounded-full bg-emerald-400" aria-label="ready on this PC" /> : null}
                </p>
                {off ? <p className="px-2 pb-1 text-[10.5px] leading-snug text-amber-300">{gs?.why}</p> : null}
                <ul>
                  {g.items.map((m) => {
                    const on = value === m.value;
                    return (
                      <li key={m.value}>
                        <button
                          type="button"
                          role="option"
                          aria-selected={on}
                          aria-disabled={off}
                          onClick={() => choose(m.value)}
                          className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition hover:bg-elevated ${
                            on ? "bg-elevated" : ""
                          } ${off ? "opacity-55" : ""}`}
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block text-[12px] text-ink">{m.label}</span>
                            <span className="block text-[10.5px] text-ink-muted">{m.why}</span>
                          </span>
                          {on && <Icon.Check width={12} height={12} className="shrink-0 text-brand" aria-hidden />}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
          <p className="border-t border-line-soft px-2 pt-1.5 text-[10px] leading-snug text-ink-faint">
            Runs Claude Code through your Jarvis harness on the PC. Plan uses your Claude login; API uses the
            OpenRouter key you already gave Jarvis — entered once, shared with every harness run.
          </p>
        </div>
      </Popover>
    </>
  );
}
