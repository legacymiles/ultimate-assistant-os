"use client";

import type { ImageAgent } from "@/lib/image-studio/agents";

export function AgentPicker({
  agents,
  selected,
  onSelect,
}: {
  agents: ImageAgent[];
  selected: string;
  onSelect: (id: string) => void;
}) {
  return (
    <section>
      <h2 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-ink-faint">Pick an agent</h2>
      <div className="grid grid-cols-2 gap-2">
        {agents.map((a) => {
          const on = a.id === selected;
          return (
            <button
              key={a.id}
              type="button"
              onClick={() => onSelect(a.id)}
              aria-pressed={on}
              className={`group relative overflow-hidden rounded-xl border p-3 text-left transition ${
                on ? "border-[var(--color-brand)] ring-1 ring-[var(--color-brand)]" : "border-line hover:border-ink-faint"
              }`}
              style={{
                background: `linear-gradient(135deg, hsl(${a.hue[0]} 70% 50% / ${on ? 0.28 : 0.14}), hsl(${a.hue[1]} 60% 40% / ${on ? 0.16 : 0.06}))`,
              }}
            >
              <span className="block text-xl leading-none">{a.icon}</span>
              <span className="mt-1.5 block text-[13px] font-semibold text-ink">{a.name}</span>
              <span className="mt-0.5 line-clamp-2 block text-[11px] leading-snug text-ink-muted">{a.pitch}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
