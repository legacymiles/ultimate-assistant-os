"use client";

import { useCallback, useEffect, useState } from "react";
import { Icon } from "../icons";
import { CREDENTIAL_FIELDS } from "@/lib/recall/schemas";
import { createItem, deleteItem, setItemFields, setItemSecret, updateItem } from "@/lib/recall/store";
import * as vault from "@/lib/recall/vault";
import type { Item, RecallData } from "@/lib/recall/types";
import { RowAction } from "./Section";

// ---------------------------------------------------------------------------
// Logins & Passwords.
// Usernames, emails and URLs are plaintext (searchable, copyable). The password
// is the single encrypted value, sealed with the master password and only ever
// decrypted on an explicit reveal/copy while the vault is unlocked.
// ---------------------------------------------------------------------------

/**
 * Reactive mirror of the module-level vault state.
 * Reports "no vault" until mounted: the server cannot see localStorage, and
 * disagreeing with it on the first client render is a hydration mismatch.
 */
export function useVault() {
  const [, bump] = useState(0);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);
  useEffect(() => vault.subscribe(() => bump((n) => n + 1)), []);

  // Enforce the idle auto-lock on a timer — never during render.
  useEffect(() => {
    const t = setInterval(() => {
      vault.enforceIdleLock();
      bump((n) => n + 1);
    }, 15_000);
    return () => clearInterval(t);
  }, []);

  return {
    exists: mounted && vault.vaultExists(),
    unlocked: mounted && vault.isUnlocked(),
  };
}

export function VaultNotice() {
  return (
    <div className="mb-2 flex gap-2 rounded-lg border border-amber-400/25 bg-amber-400/[0.07] px-3 py-2">
      <Icon.Shield width={14} height={14} className="mt-0.5 shrink-0 text-amber-300/90" />
      <p className="text-[11px] leading-relaxed text-amber-100/70">
        <span className="font-semibold text-amber-200/90">Encrypted for convenience.</span> Passwords
        are sealed with AES-GCM under your master password and never stored in the clear. This still
        is not a hardened password manager — for bank, email and root accounts, keep the real secret
        in 1Password or Bitwarden and store only a pointer here.
      </p>
    </div>
  );
}

// ----- gate ----------------------------------------------------------------

export function VaultGate({ mode }: { mode: "create" | "unlock" }) {
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setErr(null);
    setBusy(true);
    try {
      if (mode === "create") {
        if (pw !== confirm) throw new Error("The two passwords do not match.");
        await vault.createVault(pw);
      } else {
        const ok = await vault.unlock(pw);
        if (!ok) throw new Error("Wrong master password.");
      }
      setPw("");
      setConfirm("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-line bg-panel-2/60 p-4">
      <div className="mb-2 flex items-center gap-2">
        <Icon.Lock width={15} height={15} className="text-brand" />
        <span className="text-[13px] font-semibold text-ink">
          {mode === "create" ? "Set a master password" : "Vault locked"}
        </span>
      </div>
      <p className="mb-3 max-w-md text-[11px] leading-relaxed text-ink-muted">
        {mode === "create" ? (
          <>
            One password unlocks every saved login on this device. It is never stored — there is no
            reset and no recovery, so if you forget it the saved passwords are gone for good.
          </>
        ) : (
          <>Unlock to reveal and copy saved passwords. Re-locks after 5 minutes idle.</>
        )}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="password"
          value={pw}
          autoComplete={mode === "create" ? "new-password" : "current-password"}
          onChange={(e) => setPw(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && mode === "unlock" && void submit()}
          placeholder="master password"
          className="w-52 rounded-lg border border-line bg-canvas px-3 py-2 text-xs text-ink outline-none placeholder:text-ink-faint focus:border-brand"
        />
        {mode === "create" && (
          <input
            type="password"
            value={confirm}
            autoComplete="new-password"
            onChange={(e) => setConfirm(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void submit()}
            placeholder="confirm"
            className="w-40 rounded-lg border border-line bg-canvas px-3 py-2 text-xs text-ink outline-none placeholder:text-ink-faint focus:border-brand"
          />
        )}
        <button
          onClick={() => void submit()}
          disabled={busy || pw.length < 8}
          className="rounded-lg bg-brand px-3 py-2 text-xs font-semibold text-white transition hover:bg-brand-2 disabled:opacity-40"
        >
          {mode === "create" ? "Create vault" : "Unlock"}
        </button>
      </div>
      {pw.length > 0 && pw.length < 8 && (
        <p className="mt-2 text-[11px] text-ink-faint">At least 8 characters.</p>
      )}
      {err && <p className="mt-2 text-[11px] text-red-400">{err}</p>}
    </div>
  );
}

// ----- one credential ------------------------------------------------------

function CredentialCard({
  item,
  unlocked,
  onData,
  onToast,
}: {
  item: Item;
  unlocked: boolean;
  onData: (d: RecallData) => void;
  onToast: (m: string) => void;
}) {
  const [revealed, setRevealed] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const fields = item.fields ?? {};

  // Any lock event must drop a revealed password from the DOM immediately.
  useEffect(() => {
    if (!unlocked) setRevealed(null);
  }, [unlocked]);

  const reveal = useCallback(async () => {
    if (!item.secret) return;
    try {
      setRevealed(await vault.decryptSecret(item.secret));
    } catch {
      onToast("Vault locked");
    }
  }, [item.secret, onToast]);

  async function copySecret() {
    if (!item.secret) return;
    try {
      await vault.copyEphemeral(await vault.decryptSecret(item.secret));
      onToast("Password copied — clipboard clears in 30s");
    } catch {
      onToast("Vault locked");
    }
  }

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

        {item.secret && (
          <div className="flex items-center gap-2 text-[11px]">
            <dt className="w-16 shrink-0 text-ink-faint">Password</dt>
            <dd className="min-w-0 flex-1 truncate font-mono text-ink-muted">
              {revealed ?? "••••••••••"}
            </dd>
            <RowAction
              label={revealed ? "Hide" : "Reveal"}
              onClick={() => (revealed ? setRevealed(null) : void reveal())}
            >
              {revealed ? <Icon.EyeOff width={12} height={12} /> : <Icon.Eye width={12} height={12} />}
            </RowAction>
            <RowAction label="Copy password" onClick={() => void copySecret()}>
              <Icon.Copy width={12} height={12} />
            </RowAction>
          </div>
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
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    if (!title.trim()) {
      setErr("Give it a name.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const secret = password ? await vault.encryptSecret(password) : undefined;
      if (item) {
        let d = updateItem(item.id, { title: title.trim() });
        d = setItemFields(item.id, fields);
        if (secret) d = setItemSecret(item.id, secret);
        onDone(d);
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
          secret: secret ?? null,
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
            placeholder={item?.secret ? "Password — leave blank to keep the current one" : "Password"}
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
          onClick={() => void save()}
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
  const { exists, unlocked } = useVault();

  if (!exists) {
    return (
      <div className="space-y-2 px-1">
        <VaultNotice />
        <VaultGate mode="create" />
      </div>
    );
  }

  if (!unlocked) {
    return (
      <div className="space-y-2 px-1">
        <VaultGate mode="unlock" />
        {items.length > 0 && (
          <p className="px-1 text-[11px] text-ink-faint">
            {items.length} saved {items.length === 1 ? "login" : "logins"} in this folder.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2 px-1">
      <VaultNotice />
      {items.map((it) => (
        <CredentialCard key={it.id} item={it} unlocked={unlocked} onData={onData} onToast={onToast} />
      ))}
      {adding && (
        <CredentialForm
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
