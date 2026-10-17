"use client";

// ---------------------------------------------------------------------------
// The Chat's model picker: one tap to think with DeepSeek (or anything else on
// OpenRouter) instead of the default, through the owner's own OpenRouter key.
//
// Presets first, each with the one reason to pick it. Under them, a search
// over OpenRouter's whole live list (/api/ai/models), and a box to paste any
// model id. The pick is synced, so the phone and the laptop think alike.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../icons";
import { AUTO_MODEL, CHAT_MODELS, isModelId, modelLabel } from "@/lib/new-jarvis/chatModels";

interface Listed {
  id: string;
  name: string;
  input: string[];
  promptPrice: number;
}

const READ_ICON: Record<string, string> = { image: "🖼", audio: "🎧", video: "🎬" };

export function ModelPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [all, setAll] = useState<Listed[] | null>(null);
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

  const pick = (id: string) => {
    onChange(id);
    setOpen(false);
    setQ("");
  };

  const typedId = q.trim();

  return (
    <div ref={box} className="relative order-1 shrink-0">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        title="Which model Jarvis thinks with"
        className={`inline-flex max-w-[170px] items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] font-medium transition ${
          value ? "bg-brand-2/15 text-ink" : "text-ink-muted hover:bg-elevated hover:text-ink"
        }`}
      >
        <Icon.Sparkles width={11} height={11} aria-hidden />
        <span className="truncate">{modelLabel(value)}</span>
        <Icon.Chevron width={10} height={10} className="rotate-90 opacity-60" aria-hidden />
      </button>

      {open && (
        <div className="absolute left-0 top-7 z-30 w-[320px] max-w-[88vw] rounded-lg border border-line bg-panel p-1.5 shadow-2xl">
          <p className="px-2 pb-1 pt-0.5 text-[10px] uppercase tracking-wider text-ink-faint">Jarvis's brain</p>
          <ul>
            {CHAT_MODELS.map((m, i) => (
              <li key={m.id || "auto"} className={i === 2 ? "mt-1 border-t border-line-soft pt-1" : ""}>
                {i === 2 && <p className="px-2 pb-0.5 text-[10px] uppercase tracking-wider text-ink-faint">Cloud models · your OpenRouter key</p>}
                <button
                  type="button"
                  onClick={() => pick(m.id)}
                  className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition hover:bg-elevated ${value === m.id ? "bg-elevated" : ""}`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12px] text-ink">{m.label}</span>
                    <span className="block text-[10.5px] text-ink-muted">{m.why}</span>
                  </span>
                  <span className="shrink-0 text-[11px]" aria-label={`Reads ${m.reads.join(", ")}`}>
                    {m.reads.filter((r) => r !== "text").map((r) => READ_ICON[r]).join(" ")}
                  </span>
                  {value === m.id && <Icon.Check width={12} height={12} className="shrink-0 text-brand" aria-hidden />}
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-1 border-t border-line-soft px-1 pt-1.5">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && isModelId(typedId)) pick(typedId);
              }}
              placeholder="Search every OpenRouter model, or paste an id…"
              aria-label="Search models"
              className="w-full rounded border border-line bg-canvas px-2 py-1 text-[11.5px] text-ink outline-none placeholder:text-ink-faint focus:border-brand-2"
            />
            {q && (
              <ul className="mt-1 max-h-56 overflow-y-auto">
                {all === null && <li className="px-2 py-1 text-[11px] text-ink-faint">Loading the list…</li>}
                {found.map((m) => (
                  <li key={m.id}>
                    <button type="button" onClick={() => pick(m.id)} className="flex w-full items-center gap-2 rounded px-2 py-1 text-left hover:bg-elevated">
                      <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink">{m.name}</span>
                      <span className="shrink-0 text-[10px]">{m.input.filter((r) => r !== "text").map((r) => READ_ICON[r] ?? "").join("")}</span>
                      <span className="shrink-0 font-mono text-[9.5px] text-ink-faint">{m.promptPrice ? `$${m.promptPrice.toFixed(2)}/M` : "free"}</span>
                    </button>
                  </li>
                ))}
                {all && !found.length && isModelId(typedId) && (
                  <li>
                    <button type="button" onClick={() => pick(typedId)} className="w-full rounded px-2 py-1 text-left text-[11.5px] text-brand hover:bg-elevated">
                      Use “{typedId}”
                    </button>
                  </li>
                )}
                {all && !found.length && !isModelId(typedId) && <li className="px-2 py-1 text-[11px] text-ink-faint">No match.</li>}
              </ul>
            )}
            {value && !CHAT_MODELS.some((m) => m.id === value) && (
              <p className="px-1 pt-1 text-[10.5px] text-ink-muted">
                Using <span className="font-mono text-ink">{value}</span> ·{" "}
                <button type="button" className="text-brand hover:underline" onClick={() => pick(AUTO_MODEL.id)}>
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
