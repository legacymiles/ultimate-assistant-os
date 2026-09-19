"use client";

import { Icon } from "../icons";
import { localDay } from "@/lib/social-personas/logic";
import type { Persona } from "@/lib/social-personas/types";
import { Avatar, PlatformDot } from "./bits";

export function PersonaGrid({
  personas,
  loaded,
  onOpen,
  onNew,
}: {
  personas: Persona[];
  loaded: boolean;
  onOpen: (id: string) => void;
  onNew: () => void;
}) {
  const today = localDay();
  return (
    <div className="mx-auto w-full max-w-6xl px-3 py-5 sm:px-5 sm:py-7">
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold text-ink">Social Personas</h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-muted">
            One persona per creator identity, with its TikTok, Instagram and Facebook accounts. The AI reads what each one posts and
            brings daily ideas and a brainstorm partner that knows the niche.
          </p>
        </div>
        <button
          onClick={onNew}
          className="inline-flex items-center gap-1.5 rounded-xl bg-brand px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-brand-2"
        >
          <Icon.Plus width={15} height={15} /> New persona
        </button>
      </div>

      {loaded && personas.length === 0 ? (
        <button
          onClick={onNew}
          className="flex w-full flex-col items-center gap-2 rounded-2xl border border-dashed border-line px-6 py-16 text-center transition hover:border-brand hover:bg-panel"
        >
          <Icon.Users width={28} height={28} className="text-ink-faint" />
          <span className="text-sm font-semibold text-ink">Make your first persona</span>
          <span className="max-w-md text-xs text-ink-muted">
            e.g. a rap channel, an explainer page, a baby-growth diary. Add its accounts next and the AI learns from what you post.
          </span>
        </button>
      ) : (
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {personas.map((p) => {
            const ideas = p.ideaDays.find((d) => d.date === today)?.ideas ?? [];
            const fresh = ideas.filter((i) => i.status === "new").length;
            const views = p.posts.reduce((s, x) => s + (x.stats?.views ?? 0), 0);
            return (
              <button
                key={p.id}
                onClick={() => onOpen(p.id)}
                className="group flex flex-col gap-2.5 rounded-xl border border-line bg-panel p-3 text-left transition hover:border-brand/60 hover:bg-panel-2"
              >
                <div className="flex items-center gap-2.5">
                  <Avatar name={p.name} hue={p.hue} size={38} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-ink">{p.name}</div>
                    <div className="truncate text-xs text-ink-muted">{p.niche || "No niche set"}</div>
                  </div>
                  {fresh > 0 && (
                    <span className="rounded-full bg-brand/15 px-2 py-0.5 text-[11px] font-semibold text-brand" title="Ideas waiting today">
                      {fresh} new
                    </span>
                  )}
                </div>
                <div className="flex min-h-5 flex-wrap gap-1">
                  {p.accounts.length === 0 ? (
                    <span className="text-[11px] text-ink-faint">No accounts yet</span>
                  ) : (
                    p.accounts.map((a) => (
                      <span key={a.id} className="inline-flex items-center gap-1 rounded-md border border-line px-1.5 py-0.5 text-[11px] text-ink-muted">
                        <PlatformDot platform={a.platform} />@{a.handle || "…"}
                        {a.connectionId && <Icon.Check width={10} height={10} className="text-emerald-400" />}
                      </span>
                    ))
                  )}
                </div>
                <div className="grid grid-cols-3 border-t border-line pt-2 text-[11px] text-ink-faint">
                  <Stat label="posts" value={p.posts.length} />
                  <Stat label="views" value={views} />
                  <Stat label="ideas today" value={ideas.length} />
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <span>
      <span className="font-semibold tabular-nums text-ink">{compact(value)}</span> {label}
    </span>
  );
}

export function compact(n: number): string {
  return Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}
