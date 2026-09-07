"use client";

import { useState } from "react";
import { Icon } from "../icons";
import { CREDENTIAL_FIELDS } from "@/lib/recall/schemas";
import {
  createItem,
  deleteItem,
  setItemFields,
  setItemPassword,
  updateItem,
} from "@/lib/recall/store";
import { copyEphemeral } from "@/lib/recall/clipboard";
import type { Item, RecallData } from "@/lib/recall/types";
import { RowAction } from "./Section";

// ---------------------------------------------------------------------------
// Logins & Passwords.
//
// Everything on a credential — username, email, URL and the password itself —
// is stored in the clear on this device. There is no second password to get
// past: a saved password can always be revealed here, or recovered from
// Settings › Saved passwords. Being able to get it back is the whole point of
// writing it down.
//
// A folder holds as many logins as you like: + adds another, every time.
// ---------------------------------------------------------------------------

function PasswordsNotice() {
  return (
    <div className="mb-2 flex gap-2 rounded-lg border border-amber-400/25 bg-amber-400/[0.07] px-3 py-2">
      <Icon.Shield width={14} height={14} className="mt-0.5 shrink-0 text-amber-300/90" />
      <p className="text-[11px] leading-relaxed text-amber-100/70">
        <span className="font-semibold text-amber-200/90">Stored in the clear.</span> Saved
        passwords are readable here — no master password, nothing to forget, and every one of them
        is recoverable from Settings. That also means anyone using this device unlocked can read
        them, so for bank, email and root accounts keep the real secret in 1Password or Bitwarden
        and store only a pointer here.
      </p>
    </div>
  );
}

// ----- one credential ------------------------------------------------------

function CredentialCard({
  item,
  onData,
  onToast,
}: {
  item: Item;
  onData: (d: RecallData) => void;
  onToast: (m: string) => void;
}) {
  const [revealed, setRevealed] = useState(false);
  const [editing, setEditing] = useState(false);
  const fields = item.fields ?? {};
  const password = item.password ?? "";
  /** Sealed under the retired master password and not imported yet. */
  const stranded = !password && Boolean(item.secret);

  async function copyPlain(value: string, what: string) {
    await navigator.clipboard.writeText(value);
    onToast(`${what} copied`);
  }

  if (editing) {
    return (
      <CredentialForm
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

  return (
    <div className="rounded-xl border border-line bg-panel-2/50 px-3 py-2.5">
      <div className="group/cred flex items-start justify-between gap-2">
        <p className="min-w-0 truncate text-[13px] font-semibold text-ink">{item.title}</p>
        <div className="flex shrink-0 gap-0.5 opacity-0 transition group-hover/cred:opacity-100">
          <RowAction label="Edit" onClick={() => setEditing(true)}>
            <Icon.Edit width={13} height={13} />
          </RowAction>
          <RowAction
            label="Delete"
            danger
            onClick={() => {
              if (window.confirm(`Delete the login “${item.title}”?`)) {
                onData(deleteItem(item.id));
                onToast("Deleted");
              }
            }}
          >
            <Icon.Trash width={13} height={13} />
          </RowAction>
        </div>
      </div>

      <dl className="mt-1.5 space-y-1">
        {CREDENTIAL_FIELDS.filter((f) => fields[f.key]).map((f) => (
          <div key={f.key} className="flex items-center gap-2 text-[11px]">
            <dt className="w-16 shrink-0 text-ink-faint">{f.label}</dt>
            <dd className="min-w-0 flex-1 truncate">
              {f.link ? (
                <a
                  href={fields[f.key]}
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
            <RowAction label={`Copy ${f.label}`} onClick={() => void copyPlain(fields[f.key], f.label)}>
              <Icon.Copy width={12} height={12} />
            </RowAction>
          </div>
        ))}

        {password && (
          <div className="flex items-center gap-2 text-[11px]">
            <dt className="w-16 shrink-0 text-ink-faint">Password</dt>
            <dd className="min-w-0 flex-1 truncate font-mono text-ink-muted">
              {revealed ? password : "••••••••••"}
            </dd>
            <RowAction label={revealed ? "Hide" : "Reveal"} onClick={() => setRevealed((v) => !v)}>
              {revealed ? <Icon.EyeOff width={12} height={12} /> : <Icon.Eye width={12} height={12} />}
            </RowAction>
            <RowAction
              label="Copy password"
              onClick={() => {
                void copyEphemeral(password);
                onToast("Password copied — clipboard clears in 30s");
              }}
            >
              <Icon.Copy width={12} height={12} />
            </RowAction>
          </div>
        )}

        {stranded && (
          <p className="rounded-lg border border-amber-400/25 bg-amber-400/[0.07] px-2 py-1.5 text-[11px] leading-relaxed text-amber-100/75">
            Still sealed under the old master password. Open Settings ›{" "}
            <span className="font-semibold">Saved passwords</span> and enter it once to bring this
            back — or just type the password in again here.
          </p>
        )}
      </dl>
    </div>
  );
}

// ----- add / edit form -----------------------------------------------------

export function CredentialForm({
  item,
  folderId,
  onCancel,
  onDone,
  onToast,
}: {
  item?: Item;
  folderId?: string | null;
  onCancel: () => void;
  onDone: (data: RecallData) => void;
  onToast: (m: string) => void;
}) {
  const [title, setTitle] = useState(item?.title ?? "");
  const [fields, setFields] = useState<Record<string, string>>({ ...(item?.fields ?? {}) });
  const [password, setPassword] = useState(item?.password ?? "");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function save() {
    if (!title.trim()) {
      setErr("Give it a name.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      if (item) {
        updateItem(item.id, { title: title.trim() });
        setItemFields(item.id, fields);
        // The form starts with the current password in the box, so whatever is
        // there now is the truth — including an emptied box, which clears it.
        onDone(setItemPassword(item.id, password || null));
      } else {
        const { data } = createItem({
          title: title.trim(),
          body: "",
          summary: fields.username || fields.email || fields.url || "Saved login",
          kind: "credential",
          source: "manual",
          folderId: folderId ?? null,
          tags: [],
          fields,
          password: password || null,
        });
        onDone(data);
      }
      onToast(item ? "Login updated" : "Login saved");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-brand/30 bg-panel-2/60 p-3">
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Name — e.g. mql5, Hetzner console"
        className="mb-2 w-full rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-[13px] font-semibold text-ink outline-none placeholder:font-normal placeholder:text-ink-faint focus:border-brand"
      />
      <div className="grid gap-1.5 sm:grid-cols-2">
        {CREDENTIAL_FIELDS.map((f) => (
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
        <div className="relative sm:col-span-2">
          <input
            type={show ? "text" : "password"}
            value={password}
            autoComplete="new-password"
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            className="w-full rounded-lg border border-line bg-canvas px-2.5 py-1.5 pr-8 font-mono text-[11px] text-ink outline-none placeholder:font-sans placeholder:text-ink-faint focus:border-brand"
          />
          <button
            onClick={() => setShow((v) => !v)}
            aria-label={show ? "Hide password" : "Show password"}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-faint hover:text-ink"
          >
            {show ? <Icon.EyeOff width={13} height={13} /> : <Icon.Eye width={13} height={13} />}
          </button>
        </div>
      </div>
      {err && <p className="mt-2 text-[11px] text-red-400">{err}</p>}
      <div className="mt-2.5 flex items-center gap-2">
        <button
          onClick={save}
          disabled={busy}
          className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-2 disabled:opacity-40"
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

// ----- section body --------------------------------------------------------

export function LoginsBody({
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
    <div className="space-y-2 px-1">
      <PasswordsNotice />
      {items.map((it) => (
        <CredentialCard key={it.id} item={it} onData={onData} onToast={onToast} />
      ))}
      {adding ? (
        <CredentialForm
          folderId={folderId}
          onCancel={() => onAddingChange(false)}
          onDone={(d) => {
            onAddingChange(false);
            onData(d);
          }}
          onToast={onToast}
        />
      ) : (
        // The header + is easy to miss, and one login per folder is never the
        // real answer — so the way to add the next one is always on screen.
        <button
          onClick={() => onAddingChange(true)}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-line px-3 py-2 text-[11px] text-ink-faint transition hover:border-brand/40 hover:text-ink"
        >
          <Icon.Plus width={13} height={13} />
          Add another login
        </button>
      )}
    </div>
  );
}
