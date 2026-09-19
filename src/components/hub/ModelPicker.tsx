"use client";

// ---------------------------------------------------------------------------
// Searchable LLM dropdown for the hub's AI panel. The list is OpenRouter's
// catalogue (/api/ai/models), newest first, with price and whether the model
// can see images — apps that send photos skip a model that can't.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState } from "react";

export interface ModelOption {
  id: string;
  name: string;
  input: string[];
  promptPrice: number;
  completionPrice: number;
  context: number;
  json: boolean;
}

let shared: Promise<ModelOption[]> | null = null;
function loadModels(): Promise<ModelOption[]> {
  shared ??= fetch("/api/ai/models")
    .then((r) => (r.ok ? r.json() : { models: [] }))
    .then((b: { models?: ModelOption[] }) => b.models ?? [])
    .catch(() => {
      shared = null;
      return [];
    });
  return shared;
}

const price = (n: number) => (n === 0 ? "free" : n < 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(n < 10 ? 1 : 0)}`);

export function ModelPicker({
  label,
  value,
  onChange,
  emptyLabel,
}: {
  label: string;
  value: string | null;
  onChange: (id: string | null) => void;
  /** Shown for null; omit to make null unpickable. */
  emptyLabel?: string;
}) {
  const [models, setModels] = useState<ModelOption[]>([]);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void loadModels().then(setModels);
  }, []);
  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const shown = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return models.filter((m) => words.every((w) => `${m.id} ${m.name}`.toLowerCase().includes(w))).slice(0, 150);
  }, [models, q]);
  const current = models.find((m) => m.id === value);

  return (
    <div ref={box}>
      <div className="flex items-center justify-between gap-3">
      <span className="shrink-0 text-[11px] text-ink-muted">{label}</span>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="min-w-0 max-w-[250px] flex-1 truncate rounded-md border border-line px-2 py-1 text-left text-[11px] text-ink hover:border-brand"
        title={value ?? emptyLabel}
      >
        {value ? (current?.name.replace(/^[^:]+:\s*/, "") ?? value) : emptyLabel} <span className="text-ink-faint">▾</span>
      </button>
      </div>
      {open && (
        <div
          className="mt-1 w-full rounded-lg border border-line bg-canvas p-1.5"
          onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), setOpen(false))}
        >
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={models.length ? `Search ${models.length} models… (gpt, gemini, deepseek)` : "Loading models…"}
            className="mb-1 w-full rounded-md border border-line bg-panel px-2 py-1 text-[11px] text-ink outline-none focus:border-brand"
          />
          <ul className="max-h-72 overflow-y-auto text-[11px]" role="listbox">
            {emptyLabel && (
              <li>
                <button type="button" onClick={() => (onChange(null), setOpen(false))} className={`w-full rounded px-2 py-1 text-left hover:bg-panel ${value === null ? "text-brand" : ""}`}>
                  {emptyLabel}
                </button>
              </li>
            )}
            {shown.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={m.id === value}
                  onClick={() => (onChange(m.id), setOpen(false), setQ(""))}
                  className={`grid w-full grid-cols-[1fr_auto] gap-x-2 rounded px-2 py-1 text-left hover:bg-panel ${m.id === value ? "text-brand" : "text-ink"}`}
                >
                  <span className="truncate">{m.name}</span>
                  <span className="text-ink-faint">
                    {price(m.promptPrice)}/{price(m.completionPrice)}
                  </span>
                  <span className="truncate font-mono text-[10px] text-ink-faint">{m.id}</span>
                  <span className="text-[10px] text-ink-faint">
                    {m.input.includes("image") ? "sees images" : "text only"}
                    {m.json ? "" : " · no JSON"}
                  </span>
                </button>
              </li>
            ))}
            {models.length > 0 && !shown.length && <li className="px-2 py-1 text-ink-faint">No match.</li>}
          </ul>
          <p className="px-2 pt-1 text-[10px] text-ink-faint">Price is $ per million tokens, in/out.</p>
        </div>
      )}
    </div>
  );
}
