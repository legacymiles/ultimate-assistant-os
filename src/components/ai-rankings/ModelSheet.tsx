"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "../icons";
import { CATEGORIES, FAMILIES, categoryOf, releasedLabel } from "@/lib/ai-rankings/leaderboard";
import type { Model, PublicScore, RankedModel } from "@/lib/ai-rankings/leaderboard";
import { ACCESS_LABEL, CONTENT_LABEL } from "@/lib/ai-rankings/types";
import type { Access, ContentRating } from "@/lib/ai-rankings/types";
import { ModelFlags } from "./parts";

interface Props {
  /** An existing model, or a draft to create (no id). */
  ranked: RankedModel | null;
  draft: Partial<Model> | null;
  canEdit: boolean;
  now: number;
  startEditing?: boolean;
  busy: boolean;
  error: string;
  onSave: (model: Partial<Model>) => void;
  onDelete: (id: string) => void;
  onRate: (id: string, rating: number | null) => void;
  onClose: () => void;
  /**
   * Hands the parent a question to ask before it closes the sheet: true means
   * "go ahead". The edit form answers false once it holds unsaved changes, and
   * shows its own Discard / Keep editing bar instead.
   */
  onGuard?: (guard: (() => boolean) | null) => void;
}

export function ModelSheet(props: Props) {
  const { ranked, draft, canEdit, startEditing } = props;
  const [editing, setEditing] = useState(Boolean(draft) || Boolean(startEditing));
  const id = ranked?.model.id ?? "draft";
  useEffect(() => setEditing(Boolean(draft) || Boolean(startEditing)), [id, draft, startEditing]);

  if (canEdit && (editing || draft)) {
    return <EditForm {...props} initial={ranked?.model ?? draft ?? {}} onCancel={() => (draft ? props.onClose() : setEditing(false))} />;
  }
  if (!ranked) return null;
  return <View {...props} ranked={ranked} onEdit={() => setEditing(true)} />;
}

// ----- reading ---------------------------------------------------------------------

function View({ ranked, canEdit, now, busy, onRate, onClose, onEdit }: Props & { ranked: RankedModel; onEdit: () => void }) {
  const { model: m, score, rank } = ranked;
  const cat = categoryOf(m.category);
  const ps = m.publicScore;
  return (
    <>
      <header className="flex items-start gap-3 border-b border-line px-5 py-4">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] text-ink-muted">
            {cat?.label ?? m.category}
            {rank !== undefined && <> · #{rank} in category</>}
          </p>
          <h2 className="mt-0.5 text-xl font-semibold tracking-tight text-ink [text-wrap:balance]">{m.name}</h2>
          <p className="mt-0.5 text-[12px] text-ink-muted">
            {m.maker && <>{m.maker} · </>}released {releasedLabel(m.releasedAt, now)}
            <span className="font-mono text-ink-muted"> ({m.releasedAt})</span>
          </p>
        </div>
        <button onClick={onClose} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-ink-muted transition hover:bg-panel-2 hover:text-ink pointer-coarse:h-11 pointer-coarse:w-11" aria-label="Close">
          <Icon.Close width={14} height={14} />
        </button>
      </header>

      <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
        <div className="flex flex-wrap items-center gap-2">
          <ModelFlags m={m} now={now} />
          {m.license && <span className="font-mono text-[11px] text-ink-muted">{m.license}</span>}
        </div>

        {m.summary ? (
          <p className="max-w-[60ch] text-[13.5px] leading-relaxed text-ink">{m.summary}</p>
        ) : canEdit ? (
          <p className="text-[12px] text-amber-300">No summary yet. Visitors see a blank line here until you add one.</p>
        ) : null}

        <section aria-labelledby="score-h" className="rounded-[10px] border border-line bg-canvas/60 p-4">
          <div className="flex items-baseline justify-between gap-3">
            <h3 id="score-h" className="text-[12px] font-medium text-ink-muted">Score</h3>
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-3xl font-semibold tabular-nums tracking-tight text-ink">
                {score.total === null ? "—" : Math.round(score.total)}
              </span>
              <span className="text-[11px] text-ink-muted">/ 100</span>
            </div>
          </div>
          <div className="mt-3 space-y-2.5">
            <BreakdownRow
              label="Public score"
              value={score.publicPart}
              detail={ps ? `${ps.label} ${ps.kind === "elo" ? Math.round(ps.value) : `${ps.value}%`} · ${ps.source}${ps.asOf ? ` · ${ps.asOf}` : ""}` : "No public benchmark yet"}
              href={ps?.url}
            />
            <BreakdownRow
              label="Curator rating"
              value={score.ownerPart}
              detail={m.myRating !== undefined ? `${m.myRating} / 10` : "Not rated yet"}
            />
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-ink-muted">
            Elo is measured from the category leader, 4 points of Elo per point of score. With both parts the score is their average.
          </p>
          {canEdit && (
            <div className="mt-4 border-t border-line pt-3">
              <p className="mb-1.5 text-[11px] text-ink-muted">Your rating</p>
              <div className="flex flex-wrap gap-1" role="group" aria-label="Your rating out of 10">
                {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                  <button
                    key={n}
                    disabled={busy}
                    onClick={() => onRate(m.id, m.myRating === n ? null : n)}
                    aria-pressed={m.myRating === n}
                    className={`h-9 w-9 rounded-md border font-mono text-[12px] tabular-nums transition active:scale-95 pointer-coarse:h-11 pointer-coarse:w-11 ${
                      m.myRating === n ? "border-brand bg-brand text-white" : "border-line text-ink-muted hover:border-ink-faint hover:text-ink"
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>

        {m.note && (
          <section>
            <h3 className="mb-1.5 text-[12px] font-medium text-ink-muted">Curator&apos;s take</h3>
            <p className="max-w-[60ch] whitespace-pre-line border-l-2 border-brand/60 pl-3 text-[13px] leading-relaxed text-ink">{m.note}</p>
          </section>
        )}

        {m.features.length > 0 && (
          <section>
            <h3 className="mb-2 text-[12px] font-medium text-ink-muted">What sets it apart</h3>
            <ul className="space-y-1.5">
              {m.features.map((f) => (
                <li key={f} className="flex gap-2 text-[13px] text-ink">
                  <Icon.Check width={13} height={13} className="mt-0.5 shrink-0 text-core" aria-hidden="true" />
                  {f}
                </li>
              ))}
            </ul>
          </section>
        )}

        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[12px]">
          <Fact label="Cost">{ACCESS_LABEL[m.access]}</Fact>
          <Fact label="Code or weights">{m.openSource ? "Open" : "Closed"}</Fact>
          <Fact label="Runs on your GPU">{m.runsLocally ? "Yes" : "No"}</Fact>
          <Fact label="Content filter">{CONTENT_LABEL[m.contentRating ?? "unknown"]}</Fact>
          {m.hfId && <Fact label="Hugging Face"><span className="font-mono">{m.hfId}</span></Fact>}
          {m.tags.length > 0 && <Fact label="Tags">{m.tags.join(", ")}</Fact>}
        </dl>
      </div>

      <footer className="flex items-center gap-2 border-t border-line px-5 py-3">
        <a
          href={m.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-md bg-brand-2 px-3 py-1.5 text-[12px] font-semibold text-white transition hover:bg-brand-press active:scale-[0.98]"
        >
          Open {hostOf(m.url)}
          <Icon.Launch width={12} height={12} aria-hidden="true" />
        </a>
        {canEdit && (
          <button onClick={onEdit} className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-[12px] text-ink-muted transition hover:border-ink-faint hover:text-ink">
            <Icon.Edit width={12} height={12} aria-hidden="true" /> Edit
          </button>
        )}
      </footer>
    </>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "site";
  }
}

function BreakdownRow({ label, value, detail, href }: { label: string; value: number | null; detail: string; href?: string }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-[12px]">
        <span className="text-ink">{label}</span>
        <span className="font-mono tabular-nums text-ink">{value === null ? "—" : Math.round(value)}</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-panel-2" aria-hidden="true">
        {value !== null && <div className="h-full rounded-full bg-brand" style={{ width: `${Math.max(2, value)}%` }} />}
      </div>
      <p className="mt-1 text-[11px] text-ink-muted">
        {href ? (
          <a href={href} target="_blank" rel="noopener noreferrer" className="underline decoration-line underline-offset-2 hover:text-ink-muted">
            {detail}
          </a>
        ) : (
          detail
        )}
      </p>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-ink-muted">{label}</dt>
      <dd className="mt-0.5 break-words text-ink">{children}</dd>
    </div>
  );
}

// ----- editing -----------------------------------------------------------------------

const input =
  "w-full rounded-md border border-line bg-canvas px-2.5 py-1.5 text-[13px] text-ink transition placeholder:text-ink-faint focus:border-brand";
const labelCls = "mb-1 block text-[11px] font-medium text-ink-muted";

/** Which field a failed save is about, so focus can go there. */
type BadField = "name" | "category" | "url" | "score" | "rating" | null;

function EditForm({
  initial,
  busy,
  error,
  onSave,
  onDelete,
  onCancel,
  onGuard,
}: Props & { initial: Partial<Model>; onCancel: () => void }) {
  const [f, setF] = useState(() => ({
    name: initial.name ?? "",
    maker: initial.maker ?? "",
    category: initial.category ?? "",
    url: initial.url ?? "",
    hfId: initial.hfId ?? "",
    summary: initial.summary ?? "",
    releasedAt: initial.releasedAt ?? new Date().toISOString().slice(0, 10),
    openSource: initial.openSource ?? false,
    runsLocally: initial.runsLocally ?? false,
    access: (initial.access ?? "paid") as Access,
    license: initial.license ?? "",
    features: (initial.features ?? []).join("\n"),
    tags: (initial.tags ?? []).join(", "),
    note: initial.note ?? "",
    myRating: initial.myRating !== undefined ? String(initial.myRating) : "",
    contentRating: (initial.contentRating ?? "unknown") as ContentRating,
    scoreValue: initial.publicScore ? String(initial.publicScore.value) : "",
    scoreKind: (initial.publicScore?.kind ?? "elo") as PublicScore["kind"],
    scoreLabel: initial.publicScore?.label ?? "",
    scoreSource: initial.publicScore?.source ?? "",
    scoreUrl: initial.publicScore?.url ?? "",
    scoreAsOf: initial.publicScore?.asOf ?? "",
  }));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [local, setLocal] = useState("");
  const [bad, setBad] = useState<BadField>(null);
  const [dirty, setDirty] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => {
    setF((p) => ({ ...p, [k]: v }));
    setLocal("");
    setBad(null);
    setDirty(true);
  };

  // A draft the analyzer just filled in counts as unsaved from the start —
  // Escape on that is exactly the keystroke that used to lose the work.
  const unsaved = dirty || (!initial.id && Boolean(initial.name));
  useEffect(() => {
    onGuard?.(() => {
      if (!unsaved) return true;
      setConfirmDiscard(true);
      return false;
    });
    return () => onGuard?.(null);
  }, [onGuard, unsaved]);
  /** aria-invalid + the pointer to the one message, for the field at fault. */
  const flag = (field: Exclude<BadField, null>) => ({
    "data-field": field,
    "aria-invalid": bad === field || undefined,
    "aria-describedby": bad === field ? "model-form-error" : undefined,
  });

  /** Say what is wrong, and put the cursor in the field that is wrong. */
  const fail = (field: BadField, message: string) => {
    setBad(field);
    setLocal(message);
    form.current?.querySelector<HTMLElement>(`[data-field="${field}"]`)?.focus();
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setBad(null);
    if (!f.name.trim()) return fail("name", "Give it a name.");
    if (!f.category) return fail("category", "Pick a category.");
    if (!f.url.trim()) return fail("url", "Add a link to its page.");
    const scoreNum = f.scoreValue.trim() === "" ? null : Number(f.scoreValue);
    if (scoreNum !== null && !Number.isFinite(scoreNum)) return fail("score", "The public score has to be a number.");
    if (scoreNum !== null && f.scoreKind === "percent" && (scoreNum < 0 || scoreNum > 100)) return fail("score", "A percent score is between 0 and 100.");
    // A rating that isn't a number used to become NaN and save as "no rating",
    // silently wiping one the owner had already given.
    const rating = f.myRating.trim() === "" ? undefined : Number(f.myRating);
    if (rating !== undefined && (!Number.isFinite(rating) || rating < 1 || rating > 10)) {
      return fail("rating", "Your rating is a number from 1 to 10.");
    }
    onSave({
      id: initial.id,
      name: f.name,
      maker: f.maker,
      category: f.category,
      url: f.url,
      hfId: f.hfId,
      summary: f.summary,
      releasedAt: f.releasedAt,
      openSource: f.openSource,
      runsLocally: f.runsLocally,
      access: f.access,
      license: f.license,
      features: f.features.split("\n").map((s) => s.trim()).filter(Boolean),
      tags: f.tags.split(",").map((s) => s.trim()).filter(Boolean),
      note: f.note,
      myRating: rating,
      contentRating: f.contentRating,
      publicScore:
        scoreNum === null
          ? undefined
          : { value: scoreNum, kind: f.scoreKind, label: f.scoreLabel, source: f.scoreSource, url: f.scoreUrl, asOf: f.scoreAsOf || undefined },
    });
  };

  const shown = local || error;
  return (
    <form ref={form} onSubmit={submit} className="flex h-full flex-col" noValidate>
      {confirmDiscard && (
        <div role="alertdialog" aria-label="Unsaved changes" className="flex flex-wrap items-center gap-2 border-b border-amber-400/40 bg-amber-400/10 px-5 py-2.5 text-[12px] text-ink">
          <span className="flex-1">You haven&apos;t saved this yet.</span>
          {/* Drop the guard first, or closing re-asks this same question. */}
          <button
            type="button"
            onClick={() => {
              onGuard?.(null);
              onCancel();
            }}
            className="rounded-md border border-line px-2.5 py-1 text-ink-muted hover:text-ink"
          >
            Discard it
          </button>
          <button type="button" autoFocus onClick={() => setConfirmDiscard(false)} className="rounded-md bg-brand-2 px-2.5 py-1 font-semibold text-white hover:bg-brand-press">
            Keep editing
          </button>
        </div>
      )}
      <header className="flex items-center gap-3 border-b border-line px-5 py-4">
        <h2 className="flex-1 text-base font-semibold text-ink">{initial.id ? `Edit ${initial.name}` : "New model"}</h2>
        <button type="button" onClick={onCancel} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-ink-muted transition hover:bg-panel-2 hover:text-ink pointer-coarse:h-11 pointer-coarse:w-11" aria-label="Close editor">
          <Icon.Close width={14} height={14} />
        </button>
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
        <div className="grid grid-cols-2 gap-3">
          <label className="col-span-2 sm:col-span-1">
            <span className={labelCls}>Name</span>
            <input className={input} value={f.name} onChange={(e) => set("name", e.target.value)} required {...flag("name")} />
          </label>
          <label className="col-span-2 sm:col-span-1">
            <span className={labelCls}>Maker</span>
            <input className={input} value={f.maker} onChange={(e) => set("maker", e.target.value)} placeholder="Hexgrad" />
          </label>
          <label className="col-span-2 sm:col-span-1">
            <span className={labelCls}>Category</span>
            <select className={input} value={f.category} onChange={(e) => set("category", e.target.value)} required {...flag("category")}>
              <option value="">Pick one…</option>
              {FAMILIES.map((fam) => (
                <optgroup key={fam.id} label={fam.label}>
                  {CATEGORIES.filter((c) => c.family === fam.id).map((c) => (
                    <option key={c.id} value={c.id}>{c.label}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <label className="col-span-2 sm:col-span-1">
            <span className={labelCls}>Released</span>
            <input type="date" className={input} value={f.releasedAt} onChange={(e) => set("releasedAt", e.target.value)} />
          </label>
          <label className="col-span-2">
            <span className={labelCls}>Link</span>
            <input className={`${input} font-mono text-[12px]`} value={f.url} onChange={(e) => set("url", e.target.value)} placeholder="https://huggingface.co/hexgrad/Kokoro-82M" inputMode="url" spellCheck={false} autoComplete="off" {...flag("url")} />
          </label>
          <label className="col-span-2">
            <span className={labelCls}>One-line summary</span>
            <input className={input} value={f.summary} onChange={(e) => set("summary", e.target.value)} maxLength={160} placeholder="82M-parameter TTS that runs on a laptop CPU" />
          </label>
        </div>

        <fieldset className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <legend className={labelCls}>Access</legend>
          <label className="col-span-2 flex items-center gap-2 text-[12px] text-ink sm:col-span-1">
            <input type="checkbox" checked={f.openSource} onChange={(e) => set("openSource", e.target.checked)} className="accent-brand" /> Open source
          </label>
          <label className="col-span-2 flex items-center gap-2 text-[12px] text-ink sm:col-span-1">
            <input type="checkbox" checked={f.runsLocally} onChange={(e) => set("runsLocally", e.target.checked)} className="accent-brand" /> Runs locally
          </label>
          <select className={input} value={f.access} onChange={(e) => set("access", e.target.value as Access)} aria-label="Cost">
            {(["free", "freemium", "paid"] as Access[]).map((a) => <option key={a} value={a}>{ACCESS_LABEL[a]}</option>)}
          </select>
          <input className={`${input} font-mono text-[12px]`} value={f.license} onChange={(e) => set("license", e.target.value)} placeholder="apache-2.0" aria-label="License" />
        </fieldset>

        <fieldset className="rounded-[10px] border border-line p-3">
          <legend className="px-1 text-[11px] font-medium text-ink-muted">Public score</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <input className={`${input} font-mono`} value={f.scoreValue} onChange={(e) => set("scoreValue", e.target.value)} placeholder="1204" inputMode="decimal" aria-label="Score value" {...flag("score")} />
            <select className={input} value={f.scoreKind} onChange={(e) => set("scoreKind", e.target.value as PublicScore["kind"])} aria-label="Score kind">
              <option value="elo">Arena Elo</option>
              <option value="percent">Percent (0–100)</option>
            </select>
            <input className={input} value={f.scoreLabel} onChange={(e) => set("scoreLabel", e.target.value)} placeholder="TTS Arena Elo" aria-label="Score label" />
            <input className={input} value={f.scoreSource} onChange={(e) => set("scoreSource", e.target.value)} placeholder="Artificial Analysis" aria-label="Score source" />
            <input type="date" className={input} value={f.scoreAsOf} onChange={(e) => set("scoreAsOf", e.target.value)} aria-label="Score read on" />
            <input className={`${input} font-mono text-[12px]`} value={f.scoreUrl} onChange={(e) => set("scoreUrl", e.target.value)} placeholder="https://…" aria-label="Score source link" />
          </div>
          <p className="mt-2 text-[11px] text-ink-muted">Use one source per category so scores stay comparable. Leave the value blank for none.</p>
        </fieldset>

        <div className="grid grid-cols-2 gap-3">
          <label>
            <span className={labelCls}>Your rating (1–10)</span>
            <input className={`${input} font-mono`} value={f.myRating} onChange={(e) => set("myRating", e.target.value)} inputMode="decimal" placeholder="8.5" {...flag("rating")} />
          </label>
          <label>
            <span className={labelCls}>Content filter</span>
            <select className={input} value={f.contentRating} onChange={(e) => set("contentRating", e.target.value as ContentRating)}>
              {(["unknown", "sfw", "soft", "explicit"] as ContentRating[]).map((r) => <option key={r} value={r}>{CONTENT_LABEL[r]}</option>)}
            </select>
          </label>
        </div>

        <label className="block">
          <span className={labelCls}>What sets it apart (one per line)</span>
          <textarea className={`${input} min-h-[88px]`} value={f.features} onChange={(e) => set("features", e.target.value)} placeholder={"Voice cloning from a 5s sample\nRuns on CPU"} />
        </label>
        <label className="block">
          <span className={labelCls}>Your take, shown to visitors</span>
          <textarea className={`${input} min-h-[72px]`} value={f.note} onChange={(e) => set("note", e.target.value)} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label>
            <span className={labelCls}>Tags (comma separated)</span>
            <input className={input} value={f.tags} onChange={(e) => set("tags", e.target.value)} placeholder="voice-clone, multilingual" />
          </label>
          <label>
            <span className={labelCls}>Hugging Face id</span>
            <input className={`${input} font-mono text-[12px]`} value={f.hfId} onChange={(e) => set("hfId", e.target.value)} placeholder="owner/repo" />
          </label>
        </div>
      </div>

      <footer className="flex flex-wrap items-center gap-2 border-t border-line px-5 py-3">
        {shown && <p id="model-form-error" role="alert" className="w-full text-[12px] text-rose-300">{shown}</p>}
        <button type="submit" disabled={busy} className="rounded-md bg-brand-2 px-3.5 py-1.5 text-[12px] font-semibold text-white transition hover:bg-brand-press active:scale-[0.98] disabled:opacity-50">
          {busy ? "Saving…" : initial.id ? "Save" : "Add to board"}
        </button>
        <button type="button" onClick={onCancel} className="rounded-md px-3 py-1.5 text-[12px] text-ink-muted transition hover:bg-panel-2 hover:text-ink">
          Cancel
        </button>
        {initial.id &&
          (confirmDelete ? (
            <span className="ml-auto flex items-center gap-2 text-[12px] text-ink-muted">
              Remove from the board?
              <button type="button" onClick={() => onDelete(initial.id!)} className="rounded-md bg-rose-600 px-2.5 py-1 font-semibold text-white hover:bg-rose-500">Remove</button>
              <button type="button" onClick={() => setConfirmDelete(false)} className="rounded-md px-2 py-1 hover:text-ink">Keep</button>
            </span>
          ) : (
            <button type="button" onClick={() => setConfirmDelete(true)} className="ml-auto inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] text-ink-muted transition hover:text-rose-300">
              <Icon.Trash width={12} height={12} aria-hidden="true" /> Remove
            </button>
          ))}
      </footer>
    </form>
  );
}
