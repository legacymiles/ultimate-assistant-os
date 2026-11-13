"use client";

import { useState } from "react";
import { Icon } from "../icons";
import { isSecret } from "@/lib/profile/redact";
import { newField } from "@/lib/profile/model";
import { packOf, suggestPacks } from "@/lib/profile/packs";
import type { Field, FieldKind, Node } from "@/lib/profile/types";

/**
 * The record view — the last column, and the only one you read rather than scan.
 *
 * A node is both a folder and a record, so this shows its fields AND lets you
 * add children. Values are set in `--font-mono`: a field value is data, and
 * that one typographic choice is most of what makes this read as a database
 * rather than a settings page.
 */

const input =
  "w-full rounded border border-line bg-panel-2 px-2 py-1 font-mono text-xs text-ink placeholder:text-ink-faint focus:border-brand focus:outline-none";
const chip =
  "inline-flex items-center gap-1 rounded border border-line px-1.5 py-0.5 text-[10px] font-medium text-ink-muted transition hover:bg-panel-2 hover:text-ink";

interface Props {
  node: Node;
  childCount: number;
  onChange: (next: Node) => void;
  onDelete: () => void;
  onAddChild: () => void;
}

export function RecordView({ node, childCount, onChange, onDelete, onAddChild }: Props) {
  const [shown, setShown] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const pack = packOf(node.pack);

  const touch = (patch: Partial<Node>) => onChange({ ...node, ...patch, updatedAt: new Date().toISOString() });

  const setField = (id: string, patch: Partial<Field>) =>
    touch({
      fields: node.fields.map((f) =>
        f.id === id
          ? {
              ...f,
              ...patch,
              // Typing over an AI draft IS the confirmation. Making the owner
              // edit and then also click "confirm" is the kind of friction that
              // makes people stop maintaining a profile.
              source: patch.value !== undefined ? "you" : f.source,
              confirmed: patch.value !== undefined ? true : (patch.confirmed ?? f.confirmed),
              updatedAt: new Date().toISOString(),
            }
          : f,
      ),
    });

  /** Revealing a secret is per-view and never persisted. */
  const toggle = (id: string) =>
    setShown((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const addField = (label: string, kind: FieldKind = "text") => {
    const name = label.trim();
    if (!name) return;
    touch({ fields: [...node.fields, newField(name, kind, "", "you")] });
    setNewLabel("");
    setAdding(false);
  };

  // Fields the pack declares that this node has lost — offered back rather than
  // silently missing, because an absent row never gets filled in.
  const missing = (pack?.fields ?? []).filter(
    (f) => !node.fields.some((e) => e.label.toLowerCase() === f.label.toLowerCase()),
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start gap-2 border-b border-line px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <input
            value={node.name}
            onChange={(e) => touch({ name: e.target.value })}
            className="w-full bg-transparent text-sm font-semibold text-ink focus:outline-none"
            aria-label="Folder name"
          />
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] text-ink-faint">
            {pack ? (
              <span className="rounded bg-panel-2 px-1.5 py-0.5 font-medium text-ink-muted">{pack.label}</span>
            ) : (
              <PackPicker onPick={(id) => applyPack(node, id, touch)} />
            )}
            {childCount > 0 && <span>{childCount} inside</span>}
          </div>
        </div>
        <button type="button" onClick={onDelete} className={chip} title="Delete this folder and everything in it">
          <Icon.Trash width={11} height={11} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-2">
        <div className="space-y-1.5">
          {node.fields.map((f) => {
            const secret = isSecret(f.label, f.kind);
            const open = shown.has(f.id);
            return (
              <div key={f.id} className="grid grid-cols-[7.5rem_1fr] items-start gap-2">
                <label htmlFor={f.id} className="pt-1.5 text-[11px] leading-tight text-ink-faint">
                  {f.label}
                  {secret && <Icon.Lock width={9} height={9} className="ml-1 inline opacity-70" />}
                  {!f.confirmed && f.value && (
                    <span className="ml-1 text-amber-400" title="Drafted by AI, not confirmed">
                      •
                    </span>
                  )}
                </label>
                <div className="flex items-start gap-1">
                  {f.kind === "multiline" ? (
                    <textarea
                      id={f.id}
                      rows={2}
                      value={f.value}
                      onChange={(e) => setField(f.id, { value: e.target.value })}
                      className={`${input} resize-y`}
                      placeholder="—"
                    />
                  ) : (
                    <input
                      id={f.id}
                      value={f.value}
                      onChange={(e) => setField(f.id, { value: e.target.value })}
                      type={secret && !open ? "password" : f.kind === "date" ? "date" : "text"}
                      className={input}
                      placeholder={secret ? "••••••" : "—"}
                      autoComplete="off"
                      spellCheck={false}
                    />
                  )}
                  {secret && (
                    <button
                      type="button"
                      onClick={() => toggle(f.id)}
                      className="mt-0.5 rounded p-1 text-ink-faint transition hover:bg-panel-2 hover:text-ink"
                      aria-label={open ? `Hide ${f.label}` : `Reveal ${f.label}`}
                    >
                      {open ? <Icon.EyeOff width={12} height={12} /> : <Icon.Eye width={12} height={12} />}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => touch({ fields: node.fields.filter((x) => x.id !== f.id) })}
                    className="mt-0.5 rounded p-1 text-ink-faint transition hover:bg-panel-2 hover:text-ink"
                    aria-label={`Remove ${f.label}`}
                  >
                    <Icon.Close width={12} height={12} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {missing.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-1">
            {missing.map((f) => (
              <button key={f.label} type="button" onClick={() => addField(f.label, f.kind)} className={chip}>
                <Icon.Plus width={10} height={10} />
                {f.label}
              </button>
            ))}
          </div>
        )}

        <div className="mt-2.5">
          {adding ? (
            <input
              autoFocus
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") addField(newLabel);
                if (e.key === "Escape") setAdding(false);
              }}
              onBlur={() => addField(newLabel)}
              placeholder="Field name, then Enter"
              className={input}
            />
          ) : (
            <button type="button" onClick={() => setAdding(true)} className={chip}>
              <Icon.Plus width={10} height={10} /> Field
            </button>
          )}
          <button type="button" onClick={onAddChild} className={`${chip} ml-1`}>
            <Icon.Folder width={10} height={10} /> Subfolder
          </button>
        </div>

        <div className="mt-3">
          <div className="mb-1 text-[11px] text-ink-faint">Notes</div>
          <textarea
            rows={4}
            value={node.notes}
            onChange={(e) => touch({ notes: e.target.value })}
            placeholder="Anything that isn't a field."
            className="w-full resize-y rounded border border-line bg-panel-2 px-2 py-1.5 text-xs leading-relaxed text-ink placeholder:text-ink-faint focus:border-brand focus:outline-none"
          />
        </div>
      </div>
    </div>
  );
}

/** Give an untyped folder a pack after the fact, keeping whatever is already in it. */
function applyPack(node: Node, id: string, touch: (patch: Partial<Node>) => void) {
  const pack = packOf(id);
  if (!pack) return;
  const add = pack.fields
    .filter((f) => !node.fields.some((e) => e.label.toLowerCase() === f.label.toLowerCase()))
    .map((f) => newField(f.label, f.kind, "", "you"));
  touch({ pack: id, icon: pack.icon, fields: [...node.fields, ...add] });
}

function PackPicker({ onPick }: { onPick: (id: string) => void }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="underline decoration-dotted hover:text-ink">
        set a type
      </button>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <input
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
        placeholder="job, bill, printer…"
        className="w-28 rounded border border-line bg-panel-2 px-1.5 py-0.5 text-[10px] text-ink focus:outline-none"
      />
      {suggestPacks(q, 4).map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={() => {
            onPick(p.id);
            setOpen(false);
          }}
          className="rounded bg-panel-2 px-1.5 py-0.5 font-medium text-ink-muted hover:text-ink"
        >
          {p.label}
        </button>
      ))}
    </span>
  );
}
