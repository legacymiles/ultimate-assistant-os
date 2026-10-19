"use client";

// ---------------------------------------------------------------------------
// Jarvis Profile — Jarvis's own side of the profile, next to the owner's.
//
// The owner's Profile says who they are. This one says what Jarvis has learned
// about building for them: the self-learning build checklist (the "common
// sense" rules they shouldn't have to repeat), where Jarvis uses it, and the
// other habits it has picked up (Camera Autopilot's filing rules).
//
// Dense rows, not cards — the owner prefers database-style screens. Styling
// is Jarvis's own HUD (deck.css), so it reads as part of the same machine.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useState } from "react";
import { Icon } from "../icons";
import { RULE_AREAS, SKILL_NAME, type ChecklistRule, type RuleArea } from "@/lib/jarvis-profile/checklist";
import type { UseJarvisProfile } from "@/lib/jarvis-profile/useJarvisProfile";
import { AUTOPILOT_CHANGED, getAutopilot, type AutopilotData } from "@/lib/recall/photos/autopilot";
import { CHECKLIST as PRO_CHECKLIST } from "@/lib/new-jarvis/felix";

const SOURCE_LABEL: Record<ChecklistRule["source"], string> = {
  starter: "basic",
  learned: "learned",
  you: "yours",
};

function ago(t: number | null | undefined): string {
  if (!t) return "never";
  const m = Math.round((Date.now() - t) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function JarvisProfile({ api }: { api: UseJarvisProfile }) {
  const { state } = api;
  const [area, setArea] = useState<RuleArea | "all" | "new">("all");
  const [draft, setDraft] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [camera, setCamera] = useState<AutopilotData>({ rules: [], examples: [] });
  const [proOpen, setProOpen] = useState(false);

  useEffect(() => {
    const r = () => setCamera(getAutopilot());
    r();
    window.addEventListener(AUTOPILOT_CHANGED, r);
    return () => window.removeEventListener(AUTOPILOT_CHANGED, r);
  }, []);

  // "New" marks clear once the owner has had a few seconds with them.
  const freshCount = state.rules.filter((r) => r.fresh).length;
  const { seen } = api;
  useEffect(() => {
    if (!freshCount) return;
    const t = window.setTimeout(seen, 8000);
    return () => window.clearTimeout(t);
  }, [freshCount, seen]);

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of state.rules) m.set(r.area, (m.get(r.area) ?? 0) + 1);
    return m;
  }, [state.rules]);

  const shown = useMemo(() => {
    const order = new Map(RULE_AREAS.map((a, i) => [a.id, i]));
    return state.rules
      .filter((r) => (area === "all" ? true : area === "new" ? r.fresh || r.source === "learned" : r.area === area))
      .sort(
        (a, b) =>
          Number(Boolean(b.fresh)) - Number(Boolean(a.fresh)) ||
          (order.get(a.area) ?? 9) - (order.get(b.area) ?? 9) ||
          b.said - a.said,
      );
  }, [state.rules, area]);

  const on = state.rules.filter((r) => r.on).length;
  const learned = state.rules.filter((r) => r.source === "learned").length;
  const cameraOn = camera.rules.filter((r) => r.on);

  const submit = () => {
    if (!draft.trim()) return;
    api.add(draft);
    setDraft("");
  };

  return (
    <div className="deck h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl px-3 py-4 sm:px-5">
        {/* Header */}
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-0">
            <p className="deck-kicker">Jarvis Profile · self-learning</p>
            <h2 className="mt-1 text-[19px] font-semibold tracking-tight text-ink">What Jarvis knows about building for you</h2>
            <p className="mt-1 max-w-2xl text-[12px] leading-snug text-ink-muted">
              The common-sense rules you shouldn&apos;t have to say twice. Jarvis follows every rule that&apos;s on whenever it builds or
              changes an app or website, learns new ones from your chats, and counts the ones you keep repeating.
            </p>
          </div>
          <button
            type="button"
            className="deck-btn deck-btn--go ml-auto"
            onClick={() => void api.learnNow()}
            disabled={api.learning}
            title="Read your recent chats for new rules"
          >
            <Icon.Sparkles width={13} height={13} aria-hidden />
            {api.learning ? "Learning…" : `Learn from my chats${api.waiting ? ` · ${api.waiting} new` : ""}`}
          </button>
        </div>

        {/* Stats strip */}
        <dl className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line-soft bg-line-soft sm:grid-cols-4">
          {[
            ["Rules on", `${on} of ${state.rules.length}`],
            ["Learned from chats", String(learned)],
            ["Last learned", ago(state.learnedAt)],
            ["Claude Code skill", api.publishing ? "updating…" : state.publishedAt ? `synced ${ago(state.publishedAt)}` : "not yet"],
          ].map(([k, v]) => (
            <div key={k} className="bg-panel px-3 py-2">
              <dt className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-ink-faint">{k}</dt>
              <dd className="mt-0.5 text-[13px] text-ink" data-num>
                {v}
              </dd>
            </div>
          ))}
        </dl>
        {(api.notice || api.publishNotice) && (
          <p className="mt-2 text-[11.5px] text-ink-muted" role="status">
            {api.notice}
            {api.notice && api.publishNotice ? " · " : ""}
            {api.publishNotice}
          </p>
        )}

        {/* Teach it */}
        <form
          className="mt-4 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Teach Jarvis a rule — e.g. if it has multiple users then it needs a login"
            aria-label="New rule"
            className="h-9 min-w-0 flex-1 rounded-lg border border-line bg-panel-2 px-3 text-[12.5px] text-ink placeholder:text-ink-faint"
          />
          <button type="submit" className="deck-btn" disabled={!draft.trim()}>
            <Icon.Plus width={13} height={13} aria-hidden /> Add
          </button>
        </form>

        {/* Area filter */}
        <div className="mt-3 flex flex-wrap gap-1" role="tablist" aria-label="Filter rules">
          {[
            { id: "all" as const, label: "All", n: state.rules.length },
            ...(learned || freshCount ? [{ id: "new" as const, label: "Learned", n: learned }] : []),
            ...RULE_AREAS.map((a) => ({ id: a.id, label: a.label, n: counts.get(a.id) ?? 0 })).filter((a) => a.n > 0),
          ].map((c) => (
            <button
              key={c.id}
              type="button"
              role="tab"
              aria-selected={area === c.id}
              onClick={() => setArea(c.id)}
              className={`rounded-md border px-2 py-1 text-[11px] transition ${
                area === c.id ? "border-[var(--hud)] text-ink" : "border-line-soft text-ink-muted hover:text-ink"
              }`}
            >
              {c.label} <span className="font-mono text-[10px] text-ink-faint">{c.n}</span>
            </button>
          ))}
        </div>

        {/* The checklist */}
        <ul className="mt-2 divide-y divide-line-soft overflow-hidden rounded-lg border border-line-soft bg-panel">
          {shown.length === 0 && <li className="px-3 py-4 text-[12px] text-ink-faint">No rules here yet.</li>}
          {shown.map((r) => {
            const open = openId === r.id;
            return (
              <li key={r.id} className={r.on ? "" : "opacity-55"}>
                <div className="flex items-center gap-2.5 px-3 py-2">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={r.on}
                    aria-label={`Follow: ${r.then}`}
                    className="deck-switch"
                    onClick={() => api.toggle(r.id)}
                  />
                  <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setOpenId(open ? null : r.id)} aria-expanded={open}>
                    <span className="block truncate text-[10.5px] text-ink-faint">{r.when}</span>
                    <span className="block text-[12.5px] leading-snug text-ink">{r.then}</span>
                  </button>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {r.fresh && (
                      <span className="rounded border border-[var(--hud-green)] px-1 font-mono text-[9px] uppercase text-[var(--hud-green)]">new</span>
                    )}
                    {r.said > 1 && (
                      <span className="font-mono text-[10px] text-[var(--hud-amber)]" title="Times you've asked for this" data-num>
                        said {r.said}×
                      </span>
                    )}
                    <span className="hidden font-mono text-[9.5px] uppercase tracking-wider text-ink-faint sm:inline">{SOURCE_LABEL[r.source]}</span>
                    <button
                      type="button"
                      aria-label={`Remove: ${r.then}`}
                      className="grid h-7 w-7 place-items-center rounded text-ink-faint hover:text-ink"
                      onClick={() => api.remove(r.id)}
                    >
                      <Icon.Trash width={12} height={12} aria-hidden />
                    </button>
                  </div>
                </div>
                {open && (
                  <div className="space-y-1 px-3 pb-2.5 pl-[62px] text-[11px] text-ink-muted">
                    <p>
                      {r.source === "starter"
                        ? "A basic every app needs — here from the start."
                        : r.source === "you"
                          ? `You added this${r.addedAt ? ` ${ago(r.addedAt)}` : ""}.`
                          : `Learned from your chats${r.lastSaid ? `, last seen ${ago(r.lastSaid)}` : ""}.`}{" "}
                      Removing it means Jarvis won&apos;t learn it back.
                    </p>
                    {r.evidence?.length ? (
                      <ul className="space-y-0.5">
                        {r.evidence.map((e, i) => (
                          <li key={i} className="font-mono text-[10.5px] text-ink-faint">
                            “{e}”
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        {/* Where it's used + other learning */}
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <section className="rounded-lg border border-line-soft bg-panel p-3">
            <p className="deck-kicker">Where Jarvis uses this</p>
            <ul className="mt-2 space-y-2 text-[12px]">
              <li className="flex gap-2">
                <Icon.Check width={13} height={13} className="mt-0.5 shrink-0 text-[var(--hud-green)]" aria-hidden />
                <span className="text-ink-muted">
                  <b className="font-medium text-ink">Jarvis chat</b> — every build or change follows the rules that are on.
                </span>
              </li>
              <li className="flex gap-2">
                {state.publishedAt ? (
                  <Icon.Check width={13} height={13} className="mt-0.5 shrink-0 text-[var(--hud-green)]" aria-hidden />
                ) : (
                  <Icon.Clock width={13} height={13} className="mt-0.5 shrink-0 text-[var(--hud-amber)]" aria-hidden />
                )}
                <span className="text-ink-muted">
                  <b className="font-medium text-ink">Claude Code on your PC and VPS</b> — kept up to date by itself as the skill{" "}
                  <code className="font-mono text-[11px] text-ink">{SKILL_NAME}</code>
                  {state.publishedAt ? `, synced ${ago(state.publishedAt)}.` : " once you're signed in."}
                </span>
              </li>
            </ul>
          </section>

          <section className="rounded-lg border border-line-soft bg-panel p-3">
            <p className="deck-kicker">Also learned · Camera Autopilot</p>
            {cameraOn.length ? (
              <ul className="mt-2 space-y-1">
                {cameraOn.slice(0, 6).map((r) => (
                  <li key={r.id} className="flex items-start gap-2 text-[12px] text-ink-muted">
                    <span className="mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--hud)]" aria-hidden />
                    <span className="min-w-0 flex-1">{r.text}</span>
                    <span className="font-mono text-[9.5px] uppercase text-ink-faint">{r.source}</span>
                  </li>
                ))}
                {cameraOn.length > 6 && <li className="text-[11px] text-ink-faint">+{cameraOn.length - 6} more in Camera Autopilot</li>}
              </ul>
            ) : (
              <p className="mt-2 text-[12px] text-ink-faint">No photo habits yet — file a few photos and Jarvis picks them up.</p>
            )}
            <p className="mt-2 font-mono text-[10px] text-ink-faint" data-num>
              {camera.examples.length} recent filings remembered
            </p>
          </section>
        </div>

        {/* The technical standard Felix holds every build to, alongside the owner's rules. */}
        <section className="mt-3 rounded-lg border border-line-soft bg-panel">
          <button
            type="button"
            className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
            onClick={() => setProOpen((o) => !o)}
            aria-expanded={proOpen}
          >
            <span className="deck-kicker">Pro backend standard · Felix</span>
            <span className="font-mono text-[10px] text-ink-faint" data-num>
              {PRO_CHECKLIST.filter((c) => c.level === "Must").length} must · {PRO_CHECKLIST.length} lines
            </span>
            <Icon.Chevron width={12} height={12} className={`ml-auto text-ink-faint transition ${proOpen ? "rotate-90" : ""}`} aria-hidden />
          </button>
          {proOpen && (
            <ul className="divide-y divide-line-soft border-t border-line-soft">
              {PRO_CHECKLIST.map((c) => (
                <li key={c.id} className="flex items-start gap-2.5 px-3 py-1.5 text-[11.5px]">
                  <span className="w-7 shrink-0 font-mono text-[10px] text-ink-faint">{c.id}</span>
                  <span className="min-w-0 flex-1 text-ink-muted">{c.text}</span>
                  <span
                    className={`shrink-0 font-mono text-[9.5px] uppercase ${
                      c.level === "Must" ? "text-[var(--hud-amber)]" : "text-ink-faint"
                    }`}
                  >
                    {c.level}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
