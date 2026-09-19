"use client";

// ---------------------------------------------------------------------------
// The hub's AI switchboard: which provider the apps use (OpenRouter or the
// Vercel AI Gateway), whether a failed call falls back to the other, what the
// Game Creator builder runs on (Claude plan or OpenRouter), and a plain-English
// list of anything broken — no credit, a bad key, the Claude plan failing on
// the PC, a missing optional key. Settings live on the server (one document),
// so the choice holds on every device.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from "react";
import type { AiStatus, Level } from "@/lib/ai/status";
import { ModelPicker } from "./ModelPicker";

type Settings = AiStatus["settings"];

const DOT: Record<Level, string> = { ok: "bg-emerald-400", warn: "bg-amber-400", error: "bg-red-500" };

export function useAiStatus(pollMs = 60_000) {
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/ai/status", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      setStatus((await res.json()) as AiStatus);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);
  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), pollMs);
    return () => clearInterval(id);
  }, [load, pollMs]);
  return { status, failed, reload: load, setStatus };
}

function worst(status: AiStatus | null): Level {
  if (!status) return "ok";
  if (status.problems.some((p) => p.level === "error")) return "error";
  return status.problems.length ? "warn" : "ok";
}

/** A slim red strip for anything that is actually broken. Dismissible per tab. */
export function AiProblemStrip({ status, only }: { status: AiStatus | null; only?: "builder" }) {
  const [hidden, setHidden] = useState<string | null>(null);
  useEffect(() => {
    try {
      setHidden(sessionStorage.getItem("ai-strip-hidden"));
    } catch {}
  }, []);
  const errors = (status?.problems ?? []).filter(
    (p) => p.level === "error" && (!only || p.text.startsWith("Game builder")),
  );
  const key = errors.map((e) => e.text).join("|");
  if (!errors.length || hidden === key) return null;
  return (
    <div role="alert" className="flex items-start gap-2 border-b border-red-500/40 bg-red-500/10 px-3 py-1.5 text-xs text-red-200">
      <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-red-500" aria-hidden />
      <div className="flex-1 space-y-0.5">
        {errors.map((e) => (
          <p key={e.text}>{e.text}</p>
        ))}
      </div>
      <button
        type="button"
        className="shrink-0 rounded px-1.5 text-red-200/70 hover:text-red-100"
        aria-label="Hide this warning"
        onClick={() => {
          setHidden(key);
          try {
            sessionStorage.setItem("ai-strip-hidden", key);
          } catch {}
        }}
      >
        ✕
      </button>
    </div>
  );
}

function Seg<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { id: T; label: string; disabled?: boolean; title?: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[11px] text-ink-muted">{label}</span>
      <div className="inline-flex rounded-lg border border-line p-0.5" role="group" aria-label={label}>
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            disabled={o.disabled}
            title={o.title}
            aria-pressed={value === o.id}
            onClick={() => onChange(o.id)}
            className={`rounded-md px-2 py-0.5 text-[11px] transition disabled:opacity-40 ${
              value === o.id ? "bg-brand text-white" : "text-ink-muted hover:text-ink"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 text-[11px] text-ink-muted">
      {label}
      <input type="checkbox" className="accent-[var(--color-brand)]" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

export function AiPanel() {
  const { status, failed, reload, setStatus } = useAiStatus();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  const save = async (patch: Partial<Settings>) => {
    if (!status) return;
    setSaving(true);
    setSaveError("");
    setStatus({ ...status, settings: { ...status.settings, ...patch } });
    try {
      const res = await fetch("/api/ai/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; settings?: Partial<Settings> };
      if (!res.ok) throw new Error(body.error ?? `Save failed (${res.status})`);
      // Show exactly what the server stored — never quietly swap in something else.
      if (body.settings) setStatus((cur) => (cur ? { ...cur, settings: { ...cur.settings, ...body.settings } } : cur));
      setSaving(false);
    } catch (err) {
      setSaveError(`Not saved: ${(err as Error).message}`);
      setSaving(false);
      void reload();
    }
  };

  const level = failed ? "warn" : worst(status);
  const active = status?.providers.find((p) => p.active);
  const s = status?.settings;
  const or = status?.providers.find((p) => p.id === "openrouter");
  const gw = status?.providers.find((p) => p.id === "vercel-gateway");

  return (
    <>
      <div className="fixed inset-x-0 top-0 z-30">
        <AiProblemStrip status={status} />
      </div>
      <div ref={box} className="fixed right-[112px] top-3 z-40">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label="AI provider and API status"
          className="hubv2-toggle__btn inline-flex items-center gap-1.5 rounded-full border border-line bg-[hsl(228_20%_8%/0.78)] !px-3 !py-[7px] backdrop-blur"
        >
          <span className={`h-2 w-2 rounded-full ${DOT[level]}`} aria-hidden />
          AI · {active?.label.replace("Vercel AI ", "") ?? (status ? "offline" : "…")}
          {status && status.problems.length > 0 && (
            <span className="text-ink-faint" title={`${status.problems.length} to look at`}>
              {" "}
              · {status.problems.length}
            </span>
          )}
        </button>

        {open && (
          <div className="fixed inset-x-3 top-14 max-h-[calc(100dvh-72px)] overflow-y-auto rounded-xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-10 sm:w-[400px] border border-line bg-panel p-3 text-xs text-ink shadow-2xl">
            {!status ? (
              <p className="text-ink-muted">{failed ? "Could not load the AI status." : "Checking…"}</p>
            ) : (
              <div className="space-y-3">
                {status.problems.length > 0 && (
                  <ul className="space-y-1 rounded-lg border border-line bg-canvas p-2">
                    {status.problems.map((p) => (
                      <li key={p.text} className="flex gap-2">
                        <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${DOT[p.level]}`} aria-hidden />
                        <span className={p.level === "error" ? "text-red-300" : "text-amber-200"}>{p.text}</span>
                      </li>
                    ))}
                  </ul>
                )}

                <section className="space-y-2">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-faint">Website AI — every app on this site</p>
                  <Seg
                    label="Provider"
                    value={s!.choice}
                    onChange={(choice) => void save({ choice })}
                    options={[
                      { id: "auto", label: "Auto", title: "OpenRouter when it has a key, else the gateway" },
                      { id: "openrouter", label: "OpenRouter", disabled: !or?.configured },
                      { id: "vercel-gateway", label: "Vercel", disabled: !gw?.configured, title: "Vercel AI Gateway" },
                    ]}
                  />
                  <Toggle label="If it fails, retry on the other provider" checked={s!.fallback} onChange={(fallback) => void save({ fallback })} />
                  <ModelPicker
                    label="Model"
                    value={s!.model}
                    emptyLabel={`App defaults (${status.defaultModel})`}
                    onChange={(model) => void save({ model })}
                  />
                  {[0, 1].map((i) => (
                    <ModelPicker
                      key={i}
                      label={`If it fails, try ${i === 0 ? "" : "then "}`}
                      value={s!.fallbackModels[i] ?? null}
                      emptyLabel="Nothing"
                      onChange={(id) => {
                        const next = [...s!.fallbackModels];
                        if (id) next[i] = id;
                        else next.splice(i, 1);
                        void save({ fallbackModels: next.filter(Boolean) });
                      }}
                    />
                  ))}
                  <p className="text-[10px] leading-snug text-ink-faint">
                    Every app's AI uses this model. Apps that need a specialist (image painting, listening to audio, web search) keep theirs. A request with photos skips models that can't see images.
                  </p>
                  {saveError && <p className="text-[11px] text-red-300">{saveError}</p>}
                  <table className="w-full border-collapse text-[11px]">
                    <tbody>
                      {status.providers.map((p) => (
                        <tr key={p.id} className="border-t border-line">
                          <td className="py-1 pr-2 align-top">
                            <span className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full ${DOT[p.level]}`} aria-hidden />
                            {p.label}
                            {p.active && <span className="ml-1 text-brand">in use</span>}
                          </td>
                          <td className="py-1 text-right align-top text-ink-muted">{p.message}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>

                <section className="space-y-2">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-faint">Game Creator only — Unreal builds on your PC</p>
                  <Seg
                    label="Runs on"
                    value={s!.builder}
                    onChange={(builder) => void save({ builder })}
                    options={[
                      { id: "plan", label: "Claude plan", title: "Claude Code with your subscription login" },
                      {
                        id: "openrouter",
                        label: "OpenRouter",
                        disabled: !status.builder.openrouter,
                        title: status.builder.openrouter ? "Claude models billed to OpenRouter" : "Add OPENROUTER_API_KEY to tools/unreal-builder/.env",
                      },
                    ]}
                  />
                  <Toggle
                    label="If the Claude plan fails, retry through OpenRouter"
                    checked={s!.builderFallback}
                    onChange={(builderFallback) => void save({ builderFallback })}
                  />
                  <p className="flex gap-2 text-[11px] text-ink-muted">
                    <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${DOT[status.builder.level]}`} aria-hidden />
                    {status.builder.message}
                  </p>
                </section>

                <details className="group">
                  <summary className="cursor-pointer text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
                    API keys ({status.keys.filter((k) => k.set).length}/{status.keys.length} set)
                  </summary>
                  <table className="mt-1 w-full border-collapse text-[11px]">
                    <tbody>
                      {status.keys.map((k) => (
                        <tr key={k.name} className="border-t border-line">
                          <td className="py-1 pr-2 font-mono text-[10px]">
                            <span className={k.set ? "text-emerald-400" : "text-ink-faint"}>{k.set ? "✓" : "–"}</span> {k.name}
                          </td>
                          <td className="py-1 text-right text-ink-muted">{k.usedBy}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>

                {(saving || saveError) && <p className={saveError ? "text-red-300" : "text-ink-faint"}>{saveError || "Saving…"}</p>}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
