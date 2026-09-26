"use client";

// ---------------------------------------------------------------------------
// The Record tab: the facts an application asks for, and the document reader
// that fills them in without typing.
//
// Built as a dense ledger rather than a form. A form is something you sit down
// and complete; this is something you top up over months, a fact at a time, so
// what matters at a glance is which rows are still empty and where each filled
// row came from. Hence: one line per fact, the gap count in the header, the
// source on every value, and no card anywhere.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../icons";
import { useRemotePull } from "@/lib/sync/useSync";
import { RecordCaptures } from "./RecordCaptures";
import {
  addEntry,
  completeness,
  entryTitle,
  gaps,
  getRecord,
  maskValue,
  removeEntry,
  saveRecord,
  setField,
  updateEntry,
  RECORD_KEY,
} from "@/lib/jarvis/record/store";
import {
  GROUPS,
  SECTIONS,
  SOURCE_LABEL,
  type FieldDef,
  type GroupDef,
  type LifeRecord,
  type Need,
} from "@/lib/jarvis/record/types";
import type { Proposal } from "@/lib/jarvis/record/extract";

type Scope = Need | "all";

const SCOPES: { id: Scope; label: string }[] = [
  { id: "all", label: "Everything" },
  { id: "job", label: "Job applications" },
  { id: "benefits", label: "Medicaid & benefits" },
];

const btn =
  "inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-ink-muted transition hover:bg-panel-2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40";
const btnPrimary =
  "inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-2 disabled:cursor-not-allowed disabled:opacity-40";

/** Shown on the row a value came from. Typed beats read beats inferred. */
function SourceChip({ source, origin }: { source: string; origin?: string }) {
  const label = SOURCE_LABEL[source as keyof typeof SOURCE_LABEL] ?? source;
  return (
    <span
      title={origin ? `${label} — ${origin}` : label}
      className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium tracking-wide ${
        source === "you"
          ? "bg-core/10 text-core"
          : source === "document"
            ? "bg-support/10 text-support"
            : "bg-brand/12 text-brand"
      }`}
    >
      {source === "you" ? "typed" : source === "document" ? "read" : "Jarvis"}
    </span>
  );
}

/** One editable cell. Click to edit, Enter or blur to keep, Escape to drop it. */
function ValueCell({
  def,
  value,
  onSave,
  autoFocus,
}: {
  def: FieldDef;
  value: string;
  onSave: (v: string) => void;
  autoFocus?: boolean;
}) {
  const [editing, setEditing] = useState(Boolean(autoFocus));
  const [draft, setDraft] = useState(value);
  const [shown, setShown] = useState(false);

  useEffect(() => setDraft(value), [value]);

  const commit = () => {
    setEditing(false);
    if (draft.trim() !== value) onSave(draft.trim());
  };

  if (editing) {
    const shared = {
      value: draft,
      autoFocus: true,
      onChange: (e: { target: { value: string } }) => setDraft(e.target.value),
      onBlur: commit,
      className:
        "w-full rounded-md border border-brand/60 bg-canvas px-2 py-1 text-sm text-ink outline-none ring-2 ring-brand/20 placeholder:text-ink-faint",
    };
    return (
      <div>
        {def.type === "longtext" ? (
          <textarea
            {...shared}
            rows={3}
            placeholder={def.hint ?? ""}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setDraft(value);
                setEditing(false);
              }
            }}
          />
        ) : (
          <input
            {...shared}
            list={def.options ? `opt-${def.key}` : undefined}
            type={def.type === "date" ? "date" : def.type === "email" ? "email" : def.type === "phone" ? "tel" : "text"}
            inputMode={def.type === "money" ? "decimal" : undefined}
            placeholder={def.hint ?? ""}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commit();
              }
              if (e.key === "Escape") {
                setDraft(value);
                setEditing(false);
              }
            }}
          />
        )}
        {def.options && (
          <datalist id={`opt-${def.key}`}>
            {def.options.map((o) => (
              <option key={o} value={o} />
            ))}
          </datalist>
        )}
        {def.hint && <p className="mt-1 text-[11px] leading-snug text-ink-faint">{def.hint}</p>}
      </div>
    );
  }

  if (!value) {
    return (
      // The hint belongs in the input, not in this cell: hints are different
      // lengths, and showing them here turned an even ledger column into a
      // ragged wall of sentences with the empty rows lost inside it.
      <button
        type="button"
        onClick={() => setEditing(true)}
        title={def.hint ?? ""}
        // The visible cell is an em dash, which a screen reader either skips or
        // replaces with the title — announcing a stray hint sentence attached to
        // no field. The label is what carries the row.
        aria-label={`${def.label}: empty. Activate to fill it in.`}
        className="w-full rounded-md px-2 py-1 text-left text-sm text-ink-faint transition hover:bg-panel-2 hover:text-ink-muted"
      >
        —
      </button>
    );
  }

  return (
    <div className="flex items-start gap-1.5">
      <button
        type="button"
        onClick={() => setEditing(true)}
        aria-label={`${def.label}: ${def.sensitive && !shown ? "hidden" : value}. Activate to edit.`}
        className={`min-w-0 flex-1 rounded-md px-2 py-1 text-left text-sm text-ink transition hover:bg-panel-2 ${
          def.type === "date" || def.type === "money" ? "tabular-nums" : ""
        } ${def.type === "longtext" ? "whitespace-pre-wrap" : "truncate"}`}
      >
        {def.sensitive && !shown ? maskValue(def, value) : value}
      </button>
      {def.sensitive && (
        <button
          type="button"
          onClick={() => setShown((s) => !s)}
          title={shown ? "Hide it again" : "Show it on this screen"}
          className="mt-0.5 shrink-0 rounded p-1 text-ink-faint transition hover:bg-panel-2 hover:text-ink-muted"
        >
          {shown ? <Icon.EyeOff className="h-3.5 w-3.5" /> : <Icon.Eye className="h-3.5 w-3.5" />}
        </button>
      )}
    </div>
  );
}

function FieldRow({
  def,
  record,
  onChange,
}: {
  def: FieldDef;
  record: LifeRecord;
  onChange: (r: LifeRecord) => void;
}) {
  const held = record.fields[def.key];
  return (
    <div className="grid grid-cols-[minmax(9rem,15rem)_1fr_auto] items-start gap-3 border-t border-line-soft px-3 py-1.5 transition hover:bg-panel/60">
      <div className="flex items-center gap-1.5 pt-1">
        {def.sensitive && <Icon.Lock className="h-3 w-3 shrink-0 text-ink-faint" />}
        <span className="truncate text-xs text-ink-muted" title={def.label}>
          {def.label}
        </span>
      </div>
      <ValueCell def={def} value={held?.value ?? ""} onSave={(v) => onChange(setField(record, def.key, v))} />
      <div className="flex items-center gap-2 pt-1">
        {def.sensitive && held?.value && (
          <code className="hidden text-[10px] text-ink-faint sm:inline" title="Jarvis writes this token; this device swaps the real value in.">
            {`{{${def.key}}}`}
          </code>
        )}
        {held && <SourceChip source={held.source} origin={held.origin} />}
      </div>
    </div>
  );
}

function GroupBlock({
  group,
  record,
  onChange,
}: {
  group: GroupDef;
  record: LifeRecord;
  onChange: (r: LifeRecord) => void;
}) {
  const rows = record.groups[group.id] ?? [];
  const [open, setOpen] = useState<string | null>(null);

  return (
    <section className="rounded-xl border border-line bg-panel">
      <header className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-2.5">
        <div>
          <h3 className="text-sm font-semibold text-ink">
            {group.label}
            <span className="ml-2 text-xs font-normal tabular-nums text-ink-faint">{rows.length}</span>
          </h3>
          <p className="mt-0.5 max-w-[68ch] text-[11px] leading-snug text-ink-faint">{group.blurb}</p>
        </div>
        <button
          type="button"
          className={btn}
          onClick={() => {
            const next = addEntry(record, group.id, {});
            onChange(next);
            const added = (next.groups[group.id] ?? []).at(-1);
            if (added) setOpen(added.id);
          }}
        >
          <Icon.Plus className="h-3.5 w-3.5" />
          Add {/^[aeiou]/i.test(group.singular) ? "an" : "a"} {group.singular}
        </button>
      </header>

      {!rows.length ? (
        <p className="border-t border-line-soft px-3 py-3 text-xs text-ink-faint">
          Nothing here yet. Add one, or drop a document above and let Jarvis read it.
        </p>
      ) : (
        <ul>
          {rows.map((entry) => {
            const isOpen = open === entry.id;
            return (
              <li key={entry.id} className="border-t border-line-soft">
                <div className="flex items-center gap-2 px-3 py-2 transition hover:bg-panel/60">
                  <button
                    type="button"
                    onClick={() => setOpen(isOpen ? null : entry.id)}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    <Icon.Chevron
                      className={`h-3.5 w-3.5 shrink-0 text-ink-faint transition-transform duration-200 ${isOpen ? "rotate-90" : ""}`}
                    />
                    <span className="truncate text-sm text-ink">{entryTitle(group, entry)}</span>
                  </button>
                  <SourceChip source={entry.source} origin={entry.origin} />
                  <button
                    type="button"
                    title={`Remove this ${group.singular}`}
                    onClick={() => onChange(removeEntry(record, group.id, entry.id))}
                    className="shrink-0 rounded p-1 text-ink-faint transition hover:bg-panel-2 hover:text-ink"
                  >
                    <Icon.Trash className="h-3.5 w-3.5" />
                  </button>
                </div>
                {isOpen && (
                  <div className="border-t border-line-soft bg-canvas/40 pb-1">
                    {group.fields.map((f) => (
                      <div
                        key={f.key}
                        className="grid grid-cols-[minmax(9rem,15rem)_1fr] items-start gap-3 border-t border-line-soft px-3 py-1.5 first:border-t-0"
                      >
                        <div className="flex items-center gap-1.5 pt-1">
                          {f.sensitive && <Icon.Lock className="h-3 w-3 shrink-0 text-ink-faint" />}
                          <span className="truncate text-xs text-ink-muted">{f.label}</span>
                        </div>
                        <ValueCell
                          def={f}
                          value={entry.values[f.key] ?? ""}
                          onSave={(v) => onChange(updateEntry(record, group.id, entry.id, { [f.key]: v }))}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** The document reader: pick or drop files, then confirm what it found. */
function Intake({
  record,
  onChange,
}: {
  record: LifeRecord;
  onChange: (r: LifeRecord) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [document, setDocument] = useState("");
  const [queue, setQueue] = useState<Proposal[]>([]);
  const [dragging, setDragging] = useState(false);
  const [paste, setPaste] = useState("");
  const [pasting, setPasting] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const read = useCallback(
    async (images: string[], text: string) => {
      setBusy(true);
      setError(null);
      setNote(null);
      try {
        const res = await fetch("/api/jarvis/record/extract", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ images, text }),
        });
        const data = (await res.json()) as {
          proposals?: Proposal[];
          document?: string;
          note?: string;
          error?: string;
        };
        if (!res.ok || data.error) {
          setError(data.error ?? `Reading that failed (${res.status}).`);
          return;
        }
        setDocument(data.document ?? "");
        setNote(data.note || null);
        setQueue(data.proposals ?? []);
        if (!data.proposals?.length && !data.note) setNote("Nothing on it matched a record field.");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Reading that failed.");
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  /** Downsized in the browser: a phone photo is 4 MB and the route caps it. */
  const toDataUrl = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
      reader.onload = () => {
        const img = new window.Image();
        img.onerror = () => reject(new Error(`${file.name} is not an image I can read.`));
        img.onload = () => {
          const scale = Math.min(1, 1800 / Math.max(img.width, img.height));
          const canvas = window.document.createElement("canvas");
          canvas.width = Math.round(img.width * scale);
          canvas.height = Math.round(img.height * scale);
          const g = canvas.getContext("2d");
          if (!g) return reject(new Error("This browser would not give me a canvas."));
          g.drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL("image/jpeg", 0.86));
        };
        img.src = String(reader.result);
      };
      reader.readAsDataURL(file);
    });

  const take = async (files: FileList | null) => {
    if (!files?.length) return;
    const picked = Array.from(files).filter((f) => f.type.startsWith("image/")).slice(0, 4);
    if (!picked.length) {
      setError("Photos and screenshots only for now — a PDF has to be screenshotted first.");
      return;
    }
    try {
      const urls = await Promise.all(picked.map(toDataUrl));
      await read(urls, "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read those files.");
    }
  };

  const accept = (p: Proposal, i: number) => {
    onChange(
      p.kind === "field"
        ? setField(record, p.key, p.value, "document", document || "a document you uploaded")
        : addEntry(record, p.group, p.values, "document", document || "a document you uploaded"),
    );
    setQueue((q) => q.filter((_, n) => n !== i));
  };

  const acceptAll = () => {
    let next = record;
    for (const p of queue) {
      next =
        p.kind === "field"
          ? setField(next, p.key, p.value, "document", document || "a document you uploaded")
          : addEntry(next, p.group, p.values, "document", document || "a document you uploaded");
    }
    onChange(next);
    setQueue([]);
  };

  return (
    <section className="rounded-xl border border-line bg-panel">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void take(e.dataTransfer.files);
        }}
        className={`flex flex-wrap items-center gap-3 rounded-xl px-3 py-3 transition ${
          dragging ? "bg-brand/10 ring-2 ring-inset ring-brand/50" : ""
        }`}
      >
        <Icon.File className={`h-4 w-4 shrink-0 ${dragging ? "text-brand" : "text-ink-faint"}`} />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-ink">Fill this in from a document</h3>
          <p className="mt-0.5 max-w-[70ch] text-[11px] leading-snug text-ink-faint">
            Photograph a pay stub, an old résumé, a lease, an insurance card or a benefits letter. Jarvis reads
            what is printed and proposes it — you confirm each value before it is saved.
          </p>
        </div>
        <input
          ref={input}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            void take(e.target.files);
            e.target.value = "";
          }}
        />
        <button type="button" className={btn} disabled={busy} onClick={() => input.current?.click()}>
          <Icon.Upload className="h-3.5 w-3.5" />
          {busy ? "Reading…" : "Choose a picture"}
        </button>
        <button type="button" className={btn} disabled={busy} onClick={() => setPasting((p) => !p)}>
          Paste text
        </button>
      </div>

      {pasting && (
        <div className="border-t border-line-soft px-3 py-3">
          <textarea
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            rows={5}
            placeholder="Paste a résumé, a benefits letter, a job description — anything with your details in it."
            className="w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-ink outline-none transition placeholder:text-ink-faint focus:border-brand/60 focus:ring-2 focus:ring-brand/20"
          />
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              className={btnPrimary}
              disabled={busy || !paste.trim()}
              onClick={() => {
                void read([], paste).then(() => setPaste(""));
              }}
            >
              {busy ? "Reading…" : "Read this"}
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="border-t border-line-soft px-3 py-2 text-xs text-rose-300">{error}</p>
      )}
      {note && !error && (
        <p className="border-t border-line-soft px-3 py-2 text-xs text-ink-muted">{note}</p>
      )}

      {queue.length > 0 && (
        <div className="border-t border-line">
          <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
            <p className="text-xs text-ink-muted">
              {document ? <span className="text-ink">{document}</span> : "That document"} — {queue.length} to
              confirm. Check each against the quote before you keep it.
            </p>
            <div className="flex gap-2">
              <button type="button" className={btn} onClick={() => setQueue([])}>
                Discard all
              </button>
              <button type="button" className={btnPrimary} onClick={acceptAll}>
                <Icon.Check className="h-3.5 w-3.5" />
                Keep all {queue.length}
              </button>
            </div>
          </div>
          <ul>
            {queue.map((p, i) => (
              <li
                key={`${p.kind}-${i}`}
                className="grid grid-cols-[1fr_auto] items-start gap-3 border-t border-line-soft px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="text-sm text-ink">
                    <span className="text-ink-muted">{p.kind === "field" ? p.label : p.groupLabel}</span>
                    <span className="mx-1.5 text-ink-faint">→</span>
                    {p.kind === "field" ? (
                      <span className={p.sensitive ? "tracking-wide" : ""}>{p.value}</span>
                    ) : (
                      <span>{p.label}</span>
                    )}
                  </p>
                  {p.kind === "entry" && (
                    <p className="mt-0.5 truncate text-[11px] text-ink-muted">
                      {Object.entries(p.values)
                        .map(([k, v]) => `${k}: ${v}`)
                        .join(" · ")}
                    </p>
                  )}
                  {p.because && (
                    <p className="mt-0.5 max-w-[70ch] text-[11px] leading-snug text-ink-faint">“{p.because}”</p>
                  )}
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <button
                    type="button"
                    title="Discard this one"
                    onClick={() => setQueue((q) => q.filter((_, n) => n !== i))}
                    className="rounded-lg border border-line p-1.5 text-ink-faint transition hover:bg-panel-2 hover:text-ink"
                  >
                    <Icon.Close className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    title="Keep this one"
                    onClick={() => accept(p, i)}
                    className="rounded-lg border border-core/40 bg-core/10 p-1.5 text-core transition hover:bg-core/20"
                  >
                    <Icon.Check className="h-3.5 w-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

export function RecordTab() {
  const [record, setRecord] = useState<LifeRecord>(() => getRecord());
  const [scope, setScope] = useState<Scope>("all");
  const [onlyGaps, setOnlyGaps] = useState(false);

  useRemotePull(RECORD_KEY, () => setRecord(getRecord()));

  const change = useCallback((next: LifeRecord) => {
    const saved = saveRecord(next);
    setRecord(saved);
    // Publish what the extension may type into a form. Sensitive fields are
    // stripped server-side before anything is written down, so this is not the
    // record — it is the fillable part of it.
    void fetch("/api/jarvis/record/snapshot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ record: saved }),
    }).catch(() => {
      // A failed publish only means the extension fills from a slightly older
      // snapshot. It must never cost the owner the edit they just made.
    });
  }, []);

  const done = useMemo(() => completeness(record, scope), [record, scope]);
  const missing = useMemo(() => gaps(record, scope), [record, scope]);
  const wants = useCallback(
    (need: Need) => need !== "optional" && (scope === "all" || need === "core" || need === scope),
    [scope],
  );

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4 p-4 sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-ink">Life Record</h2>
          <p className="mt-1 max-w-[70ch] text-xs leading-relaxed text-ink-muted">
            The facts an application asks for, kept once. Jarvis fills forms, applications and letters from
            this — and asks you for what is missing instead of guessing it.
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-ink-muted">
            <span className="text-base font-semibold tabular-nums text-ink">{done.filled}</span>
            <span className="tabular-nums"> of {done.total} recorded</span>
          </p>
          <div className="mt-1.5 h-[3px] w-40 overflow-hidden rounded-full bg-line">
            <div
              className="h-full rounded-full bg-brand transition-[width] duration-500 ease-out"
              style={{ width: `${done.percent}%` }}
            />
          </div>
        </div>
      </header>

      <RecordCaptures record={record} onChange={change} />

      <Intake record={record} onChange={change} />

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-line p-0.5">
          {SCOPES.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setScope(s.id)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                scope === s.id ? "bg-panel-2 text-ink" : "text-ink-muted hover:text-ink"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setOnlyGaps((v) => !v)}
          className={`${btn} ${onlyGaps ? "border-brand/50 bg-brand/10 text-ink" : ""}`}
          disabled={!missing.length}
        >
          {missing.length ? `${missing.length} still missing` : "Nothing missing"}
        </button>
        {onlyGaps && (
          <p className="text-[11px] text-ink-faint">Showing only what a form would stop on.</p>
        )}
      </div>

      {SECTIONS.map((section) => {
        const fields = section.fields.filter(
          (f) => wants(f.need) && (!onlyGaps || !record.fields[f.key]?.value),
        );
        if (!fields.length) return null;
        return (
          <section key={section.id} className="rounded-xl border border-line bg-panel">
            <header className="px-3 py-2.5">
              <h3 className="text-sm font-semibold text-ink">{section.label}</h3>
              <p className="mt-0.5 max-w-[68ch] text-[11px] leading-snug text-ink-faint">{section.blurb}</p>
            </header>
            {fields.map((f) => (
              <FieldRow key={f.key} def={f} record={record} onChange={change} />
            ))}
          </section>
        );
      })}

      {GROUPS.filter((g) => wants(g.need)).map((g) => (
        <GroupBlock key={g.id} group={g} record={record} onChange={change} />
      ))}

      <footer className="flex items-start gap-2 rounded-xl border border-line bg-panel px-3 py-2.5">
        <Icon.Shield className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-faint" />
        <p className="max-w-[78ch] text-[11px] leading-relaxed text-ink-faint">
          Locked rows — Social Security number, licence number, member ID — are never sent to the AI. Jarvis
          writes a token like <code className="text-ink-muted">{"{{ssn}}"}</code> where the value belongs and
          this device swaps the real one in when you copy the answer out, so he can draft a whole application
          without ever holding the number. Everything here is stored on this device and in your own Supabase
          row, the same as the rest of the hub.
        </p>
      </footer>
    </div>
  );
}
