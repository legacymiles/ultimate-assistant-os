"use client";

import { useState } from "react";
import { Icon } from "../icons";
import { daysUntilExpiry, WEBSITE_FIELDS, primaryFields } from "@/lib/recall/schemas";
import { createItem, deleteItem, setItemFields, updateItem } from "@/lib/recall/store";
import { normalizeUrl } from "@/lib/recall/media";
import type { Item, RecallData } from "@/lib/recall/types";
import { RowAction } from "./Section";

// ---------------------------------------------------------------------------
// Websites — one structured record shape, usable in any folder.
// A site you own, a service you pay for, a dashboard you keep losing: same
// fields every time, so a folder of them reads as a table. Collapsed it is one
// line; expanded it is the full record with copy buttons on every value.
// ---------------------------------------------------------------------------

function RenewalDot({ item }: { item: Item }) {
  const days = daysUntilExpiry(item.fields);
  const [tone, title] =
    days === null
      ? (["bg-ink-faint/40", "No renewal date set"] as const)
      : days < 0
        ? (["bg-red-400", `Expired ${Math.abs(days)}d ago`] as const)
        : days <= 30
          ? (["bg-amber-400", `Renews in ${days}d`] as const)
          : (["bg-emerald-400", `Renews in ${days}d`] as const);
  return <span className={"h-1.5 w-1.5 shrink-0 rounded-full " + tone} title={title} />;
}

function WebsiteCard({
  item,
  onData,
  onToast,
}: {
  item: Item;
  onData: (d: RecallData) => void;
  onToast: (m: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const fields = item.fields ?? {};

  if (editing) {
    return (
      <WebsiteForm
        item={item}
        onCancel={() => setEditing(false)}
        onDone={(d) => {
          setEditing(false);
          onData(d);
        }}
        onToast={onToast}
      />
    );
  }

  const summaryBits = primaryFields("website")
    .map((f) => fields[f.key])
    .filter(Boolean);

  return (
    <div className="rounded-xl border border-line bg-panel-2/40">
      <div className="group/site flex items-center gap-2.5 px-3 py-2">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
        >
          <RenewalDot item={item} />
          <Icon.Globe width={14} height={14} className="shrink-0 text-ink-faint" />
          <span className="shrink-0 text-[13px] font-semibold text-ink">{item.title}</span>
          {summaryBits.length > 0 && (
            <span className="min-w-0 truncate font-mono text-[11px] text-ink-faint">
              {summaryBits.join("  ·  ")}
            </span>
          )}
          <Icon.Chevron
            width={12}
            height={12}
            className={"ml-auto shrink-0 text-ink-faint transition-transform " + (open ? "rotate-90" : "")}
          />
        </button>
        <div className="flex shrink-0 gap-0.5 opacity-0 transition group-hover/site:opacity-100">
          {fields.url && (
            <RowAction
              label="Open site"
              onClick={() => window.open(normalizeUrl(fields.url), "_blank", "noopener")}
            >
              <Icon.Launch width={13} height={13} />
            </RowAction>
          )}
          <RowAction label="Edit" onClick={() => setEditing(true)}>
            <Icon.Edit width={13} height={13} />
          </RowAction>
          <RowAction
            label="Delete"
            danger
            onClick={() => {
              if (window.confirm(`Delete “${item.title}”?`)) {
                onData(deleteItem(item.id));
                onToast("Deleted");
              }
            }}
          >
            <Icon.Trash width={13} height={13} />
          </RowAction>
        </div>
      </div>

      {open && (
        <dl className="grid gap-x-4 gap-y-1 border-t border-line-soft px-3 py-2.5 sm:grid-cols-2">
          {WEBSITE_FIELDS.filter((f) => fields[f.key]).length === 0 && (
            <p className="text-[11px] text-ink-faint">
              Nothing filled in yet — hit the pencil to add the details.
            </p>
          )}
          {WEBSITE_FIELDS.filter((f) => fields[f.key]).map((f) => (
            <div key={f.key} className="group/f flex items-center gap-2 text-[11px]">
              <dt className="w-24 shrink-0 text-ink-faint">{f.label}</dt>
              <dd className="min-w-0 flex-1 truncate">
                {f.link ? (
                  <a
                    href={normalizeUrl(fields[f.key])}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-brand hover:underline"
                  >
                    {fields[f.key]}
                  </a>
                ) : (
                  <span className={f.mono ? "font-mono text-ink-muted" : "text-ink-muted"}>
                    {fields[f.key]}
                  </span>
                )}
              </dd>
              <span className="opacity-0 transition group-hover/f:opacity-100">
                <RowAction
                  label={`Copy ${f.label}`}
                  onClick={() => {
                    void navigator.clipboard.writeText(fields[f.key]);
                    onToast(`${f.label} copied`);
                  }}
                >
                  <Icon.Copy width={12} height={12} />
                </RowAction>
              </span>
            </div>
          ))}
          {item.body && (
            <p className="whitespace-pre-wrap pt-1 text-[11px] leading-relaxed text-ink-muted sm:col-span-2">
              {item.body}
            </p>
          )}
        </dl>
      )}
    </div>
  );
}

export function WebsiteForm({
  item,
  folderId,
  onCancel,
  onDone,
  onToast,
}: {
  item?: Item;
  folderId?: string | null;
  onCancel: () => void;
  onDone: (d: RecallData) => void;
  onToast: (m: string) => void;
}) {
  const [title, setTitle] = useState(item?.title ?? "");
  const [fields, setFields] = useState<Record<string, string>>({ ...(item?.fields ?? {}) });
  const [body, setBody] = useState(item?.body ?? "");
  const [err, setErr] = useState<string | null>(null);

  function save() {
    if (!title.trim() && !fields.url?.trim()) {
      setErr("Give it a name or a URL.");
      return;
    }
    const name = title.trim() || fields.url.trim();
    if (item) {
      updateItem(item.id, { title: name, body });
      onDone(setItemFields(item.id, fields));
      onToast("Updated");
    } else {
      const { data } = createItem({
        title: name,
        body,
        summary:
          primaryFields("website")
            .map((f) => fields[f.key])
            .filter(Boolean)
            .join(" · ") || "Website",
        kind: "website",
        source: "manual",
        folderId: folderId ?? null,
        tags: ["website"],
        url: fields.url ? normalizeUrl(fields.url) : null,
        fields,
      });
      onDone(data);
      onToast("Website saved");
    }
  }

  return (
    <div className="rounded-xl border border-brand/30 bg-panel-2/60 p-3">
      <div className="mb-2 flex items-center gap-2">
        <Icon.Globe width={14} height={14} className="text-brand" />
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Name — e.g. AquaFunded dashboard"
          className="min-w-0 flex-1 rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-[13px] font-semibold text-ink outline-none placeholder:font-normal placeholder:text-ink-faint focus:border-brand"
        />
      </div>
      <div className="grid gap-1.5 sm:grid-cols-2">
        {WEBSITE_FIELDS.map((f) => (
          <input
            key={f.key}
            value={fields[f.key] ?? ""}
            onChange={(e) => setFields((s) => ({ ...s, [f.key]: e.target.value }))}
            placeholder={`${f.label} — ${f.placeholder ?? ""}`}
            className={
              "w-full rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-[11px] text-ink outline-none placeholder:text-ink-faint focus:border-brand " +
              (f.mono ? "font-mono" : "")
            }
          />
        ))}
      </div>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={2}
        placeholder="Notes — anything that does not fit a field"
        className="mt-1.5 w-full resize-none rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-[11px] text-ink outline-none placeholder:text-ink-faint focus:border-brand"
      />
      {err && <p className="mt-2 text-[11px] text-red-400">{err}</p>}
      <div className="mt-2.5 flex items-center gap-2">
        <button
          onClick={save}
          className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-2"
        >
          Save
        </button>
        <button
          onClick={onCancel}
          className="rounded-lg border border-line px-3 py-1.5 text-xs text-ink-muted transition hover:text-ink"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

export function WebsitesBody({
  items,
  folderId,
  adding,
  onAddingChange,
  onData,
  onToast,
}: {
  items: Item[];
  folderId: string | null;
  adding: boolean;
  onAddingChange: (v: boolean) => void;
  onData: (d: RecallData) => void;
  onToast: (m: string) => void;
}) {
  return (
    <div className="space-y-1.5 px-1">
      {items.map((it) => (
        <WebsiteCard key={it.id} item={it} onData={onData} onToast={onToast} />
      ))}
      {adding && (
        <WebsiteForm
          folderId={folderId}
          onCancel={() => onAddingChange(false)}
          onDone={(d) => {
            onAddingChange(false);
            onData(d);
          }}
          onToast={onToast}
        />
      )}
    </div>
  );
}
