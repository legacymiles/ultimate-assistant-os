"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Icon } from "../icons";

interface Props {
  value: string;
  options: string[];
  onChange: (value: string) => void;
  /** Optional colour dot per option (used for moods). */
  hueFor?: (label: string) => number;
  className?: string;
  ariaLabel?: string;
}

export function Dropdown({ value, options, onChange, hueFor, className, ariaLabel }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  return (
    <div ref={ref} className={cn("relative", className)}>
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex w-full items-center gap-2 rounded-lg border bg-panel-2 px-2.5 py-1.5 text-left text-xs font-medium text-ink transition",
          open ? "border-accent" : "border-line hover:border-line-soft",
        )}
      >
        {hueFor && <ColorDot hue={hueFor(value)} />}
        <span className="min-w-0 flex-1 truncate">{value}</span>
        <Icon.Chevron
          width={13}
          height={13}
          className={cn("shrink-0 text-ink-faint transition", open ? "rotate-90" : "rotate-90 opacity-60")}
        />
      </button>

      {open && (
        <ul
          role="listbox"
          className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-line bg-elevated p-1 shadow-[0_6px_16px_0_rgba(0,0,0,0.4)]"
        >
          {options.map((opt) => {
            const active = opt === value;
            return (
              <li key={opt}>
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => {
                    onChange(opt);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition",
                    active ? "bg-accent/15 text-accent" : "text-ink-muted hover:bg-panel-2 hover:text-ink",
                  )}
                >
                  {hueFor && <ColorDot hue={hueFor(opt)} />}
                  <span className="min-w-0 flex-1 truncate">{opt}</span>
                  {active && <Icon.Check width={12} height={12} className="shrink-0" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function ColorDot({ hue }: { hue: number }) {
  return (
    <span
      className="h-2.5 w-2.5 shrink-0 rounded-full"
      style={{ background: `hsl(${hue} 70% 55%)` }}
    />
  );
}
