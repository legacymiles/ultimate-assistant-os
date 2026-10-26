"use client";

import { useEffect, useState } from "react";
import { Icon } from "../icons";
import { FavoriteStar, OriginBadge } from "./SkillRow";
import type { Skill } from "@/lib/skills/types";
import { skillMeta } from "@/lib/skills/categories";
import { ROUTE_TIERS, TIER_LABEL, capState, controlKey, dollars, routedLabel, spendFor, tokensLabel, type RouteTier } from "@/lib/skills/spend";
import type { SkillSpendState } from "@/lib/skills/useSkillSpend";

interface Props {
  skill: Skill;
  onClose: () => void;
  onEdit: (skill: Skill) => void;
  onDelete: (skill: Skill) => void;
  favorite?: boolean;
  onToggleFavorite?: (skill: Skill) => void;
  /** Spend + the cap / model controls. Left out where spend isn't available. */
  spend?: SkillSpendState;
}

export function SkillDetailModal({ skill, onClose, onEdit, onDelete, favorite = false, onToggleFavorite, spend }: Props) {
  const [copied, setCopied] = useState(false);
  const meta = skillMeta(skill);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(skill.body);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — ignore */
    }
  };

  return (
    <div
      className="fixed inset-0 z-[999] flex items-center justify-center p-3 sm:p-6"
      onMouseDown={onClose}
    >
      <div className="absolute inset-0 bg-black/60" />
      <div
        className="relative flex max-h-[86vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-2xl animate-fade-in"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-lg font-semibold text-ink">{skill.title}</h2>
              {skill.origin && <OriginBadge origin={skill.origin} />}
            </div>
            {skill.overview && (
              <p className="mt-1 text-sm text-ink-muted">{skill.overview}</p>
            )}
            <div className="mt-3 rounded-xl border border-line bg-canvas px-3 py-2.5">
              <p className="text-[11px] font-medium uppercase tracking-wider text-ink-faint">How to call it</p>
              <p className="mt-1 text-sm text-ink">
                Type <code className="rounded bg-elevated px-1.5 py-0.5 font-mono text-[12px]">{meta.command}</code>
                {meta.nicknames.length > 0 ? (
                  <>
                    {" "}or just say{" "}
                    {meta.nicknames.map((n, i) => (
                      <span key={n}>
                        {i > 0 && (i === meta.nicknames.length - 1 ? " or " : ", ")}
                        <span className="text-brand">“{n}”</span>
                      </span>
                    ))}
                  </>
                ) : (
                  <span className="text-ink-muted"> — no nicknames yet. Add “Nicknames: …” to its description so Claude knows them.</span>
                )}
              </p>
              <p className="mt-1.5 text-[11px] text-ink-muted">
                {meta.guessed ? "Category (best guess): " : "Category: "}
                {meta.categories.join(" · ")}
              </p>
            </div>
          </div>
          {onToggleFavorite && (
            <span className={"rounded-lg border " + (favorite ? "border-amber-400/40 bg-amber-400/10" : "border-line")}>
              <FavoriteStar skill={skill} on={favorite} onToggle={onToggleFavorite} size={15} label={favorite ? "Favorite" : "Add to favorites"} />
            </span>
          )}
          <button
            onClick={onClose}
            className="rounded-lg border border-line p-1.5 text-ink-muted transition hover:bg-panel-2 hover:text-ink"
            aria-label="Close"
          >
            <Icon.Close width={16} height={16} />
          </button>
        </div>

        {spend?.spend && <SpendControls skill={skill} state={spend} />}

        {/* Body — raw markdown prompt, ideal for copy/paste */}
        <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
          <pre className="whitespace-pre-wrap break-words rounded-xl border border-line bg-canvas p-4 font-mono text-[13px] leading-relaxed text-ink-muted">
            {skill.body || "This skill has no prompt body."}
          </pre>
        </div>

        {/* Footer actions */}
        <div className="flex items-center gap-2 border-t border-line px-5 py-3">
          <button
            onClick={copy}
            className="inline-flex items-center gap-1.5 rounded-xl bg-brand px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-brand-2"
          >
            {copied ? <Icon.Check width={15} height={15} /> : <Icon.Copy width={15} height={15} />}
            {copied ? "Copied!" : "Copy prompt"}
          </button>

          {skill.source === "studio" ? (
            <>
              <button
                onClick={() => onEdit(skill)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-line px-3.5 py-2 text-sm font-medium text-ink-muted transition hover:bg-panel-2 hover:text-ink"
              >
                <Icon.Edit width={15} height={15} />
                Edit
              </button>
              {skill.sourceUrl && (
                <a
                  href={skill.sourceUrl}
                  className="ml-auto inline-flex items-center gap-1.5 rounded-xl border border-line px-3.5 py-2 text-sm font-medium text-ink-muted transition hover:bg-panel-2 hover:text-ink"
                >
                  <Icon.Film width={15} height={15} />
                  Open in Studio
                </a>
              )}
            </>
          ) : skill.source === "featured" ? (
            <>
              <button
                onClick={() => onEdit(skill)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-line px-3.5 py-2 text-sm font-medium text-ink-muted transition hover:bg-panel-2 hover:text-ink"
              >
                <Icon.Edit width={15} height={15} />
                Edit
              </button>
              {skill.sourceUrl && (
                <a
                  href={skill.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-auto inline-flex items-center gap-1.5 rounded-xl border border-line px-3.5 py-2 text-sm font-medium text-ink-muted transition hover:bg-panel-2 hover:text-ink"
                >
                  <Icon.Launch width={15} height={15} />
                  View on GitHub
                </a>
              )}
            </>
          ) : (
            <>
              <button
                onClick={() => onEdit(skill)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-line px-3.5 py-2 text-sm font-medium text-ink-muted transition hover:bg-panel-2 hover:text-ink"
              >
                <Icon.Edit width={15} height={15} />
                Edit
              </button>
              <button
                onClick={() => onDelete(skill)}
                className="ml-auto inline-flex items-center gap-1.5 rounded-xl border border-line px-3.5 py-2 text-sm font-medium text-ink-muted transition hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-400"
              >
                <Icon.Trash width={15} height={15} />
                Delete
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * What this skill costs, plus the owner's two controls: a weekly dollar cap
 * (over it, Jarvis runs it on the free model until Monday) and a fixed model
 * tier (otherwise Jev picks per run).
 */
function SpendControls({ skill, state }: { skill: Skill; state: SkillSpendState }) {
  const doc = state.spend!;
  const key = controlKey(skill);
  const s = spendFor(skill, doc);
  const cap = capState(doc, key);
  const pin = doc.pins[key] ?? null;
  const [draft, setDraft] = useState(cap.cap != null ? String(cap.cap) : "");
  useEffect(() => setDraft(cap.cap != null ? String(cap.cap) : ""), [cap.cap]);
  const saveCap = () => {
    const n = Number(draft);
    void state.setCap(key, draft.trim() && Number.isFinite(n) && n > 0 ? n : null);
  };
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-5 py-2.5 text-[12px]">
      <span className="text-ink-muted">
        {s ? (
          <>
            <span className="font-mono text-ink">{dollars(s.weekCost)}</span> this week · {tokensLabel(s.weekTokens)} tokens ·{" "}
            <span className="font-mono">{dollars(s.cost)}</span>
            {s.estimated ? " est." : ""} lifetime
            {routedLabel(s) ? ` · ${routedLabel(s)}` : ""}
          </>
        ) : (
          "No metered runs yet."
        )}
      </span>
      <label className="ml-auto flex items-center gap-1.5 text-ink-muted">
        Weekly cap $
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value.replace(/[^0-9.]/g, ""))}
          onBlur={saveCap}
          onKeyDown={(e) => e.key === "Enter" && saveCap()}
          inputMode="decimal"
          placeholder="none"
          aria-label="Weekly dollar cap"
          className="w-16 rounded-md border border-line bg-canvas px-1.5 py-0.5 font-mono text-ink outline-none focus:border-brand"
        />
        {cap.over && <span className="text-red-300">over — free model till Monday</span>}
      </label>
      <label className="flex items-center gap-1.5 text-ink-muted">
        Model
        <select
          value={pin ?? ""}
          onChange={(e) => void state.setPin(key, (e.target.value || null) as RouteTier | null)}
          aria-label="Model tier for this skill"
          className="rounded-md border border-line bg-canvas px-1.5 py-0.5 text-ink outline-none focus:border-brand"
        >
          <option value="">Jev picks</option>
          {ROUTE_TIERS.map((t) => (
            <option key={t} value={t}>
              {TIER_LABEL[t]}
            </option>
          ))}
        </select>
      </label>
      {state.error && <span className="w-full text-red-300">{state.error}</span>}
    </div>
  );
}
