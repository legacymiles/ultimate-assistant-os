"use client";

import { useEffect, useState } from "react";
import { Icon } from "../icons";
import { allSecrets, applyRekeyedSecrets } from "@/lib/recall/store";
import * as vault from "@/lib/recall/vault";
import type { RecallData } from "@/lib/recall/types";

// ---------------------------------------------------------------------------
// Security settings.
//
// Recall has two passwords and they do different jobs, so they are shown side
// by side with that spelled out:
//   · the app password is a door on the page — it stops someone opening Recall
//   · the vault master password is encryption — it is what actually protects
//     saved logins, and it can never be recovered
// ---------------------------------------------------------------------------

interface GateStatus {
  gated: boolean;
  source: "store" | "env" | "none";
  persistent: boolean;
  updatedAt?: string;
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  autoFocus,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-ink-faint">
        {label}
      </span>
      <input
        type="password"
        autoComplete="new-password"
        autoFocus={autoFocus}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-xs text-ink outline-none placeholder:text-ink-faint focus:border-brand"
      />
    </label>
  );
}

function Note({ tone, children }: { tone: "ok" | "warn" | "error"; children: React.ReactNode }) {
  const cls =
    tone === "ok"
      ? "border-emerald-400/25 bg-emerald-400/[0.07] text-emerald-100/80"
      : tone === "warn"
        ? "border-amber-400/25 bg-amber-400/[0.07] text-amber-100/75"
        : "border-red-400/30 bg-red-400/[0.07] text-red-200/85";
  return (
    <p className={"rounded-lg border px-2.5 py-1.5 text-[11px] leading-relaxed " + cls}>{children}</p>
  );
}

// ----- app password ---------------------------------------------------------

function AppPassword({ onToast }: { onToast: (m: string) => void }) {
  const [gate, setGate] = useState<GateStatus | null>(null);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    fetch("/api/recall-unlock")
      .then((r) => r.json())
      .then((d: GateStatus) => setGate(d))
      .catch(() => setGate(null));

  useEffect(() => {
    void load();
  }, []);

  async function submit(remove = false) {
    setError(null);
    if (!remove) {
      if (next.length < 8) return setError("Use at least 8 characters.");
      if (next !== confirm) return setError("The two passwords do not match.");
    }
    setBusy(true);
    try {
      const res = await fetch("/api/recall-unlock", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current, next: remove ? "" : next }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Could not save.");
        return;
      }
      setCurrent("");
      setNext("");
      setConfirm("");
      await load();
      onToast(remove ? "App password removed" : "App password changed");
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        <Icon.Shield width={14} height={14} className="text-ink-faint" />
        <h3 className="text-[13px] font-semibold text-ink">App password</h3>
      </div>
      <p className="text-[11px] leading-relaxed text-ink-muted">
        Required before Recall will open. This is a door on the page — it is not encryption, and
        anyone holding this device unlocked can still read the stored data in devtools.
      </p>

      {gate && !gate.gated && (
        <Note tone="warn">
          Recall is currently <strong>open</strong> — anyone who reaches this URL can use it. Set a
          password below.
        </Note>
      )}
      {gate?.gated && gate.source === "env" && (
        <Note tone="warn">
          Still using the <code className="font-mono">RECALL_PASSWORD</code> environment variable.
          Setting one here replaces it and can then be changed without touching env vars.
        </Note>
      )}
      {gate?.gated && !gate.persistent && (
        <Note tone="error">
          This deployment&apos;s filesystem is read-only, so a change made here will not be saved.
          Change <code className="font-mono">RECALL_PASSWORD</code> in your hosting environment
          instead.
        </Note>
      )}

      <div className="grid gap-1.5 sm:grid-cols-3">
        {gate?.gated && (
          <Field label="Current" value={current} onChange={setCurrent} autoFocus />
        )}
        <Field label="New" value={next} onChange={setNext} placeholder="min 8 characters" />
        <Field label="Confirm" value={confirm} onChange={setConfirm} />
      </div>

      {error && <p className="text-[11px] text-red-400">{error}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => void submit(false)}
          disabled={busy || !next}
          className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-2 disabled:opacity-40"
        >
          {gate?.gated ? "Change password" : "Set password"}
        </button>
        {gate?.gated && (
          <button
            onClick={() => {
              if (window.confirm("Remove the app password? Recall will open without one.")) {
                void submit(true);
              }
            }}
            disabled={busy}
            className="rounded-lg border border-line px-3 py-1.5 text-xs text-ink-muted transition hover:border-red-500/40 hover:text-red-400 disabled:opacity-40"
          >
            Remove password
          </button>
        )}
      </div>
      <p className="text-[10px] text-ink-faint">
        Changing it signs out every other device, since the session is derived from the password.
      </p>
    </section>
  );
}

// ----- vault master password -------------------------------------------------

function VaultPassword({
  onData,
  onToast,
}: {
  onData: (d: RecallData) => void;
  onToast: (m: string) => void;
}) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const exists = vault.vaultExists();

  async function submit() {
    setError(null);
    if (next.length < 8) return setError("Use at least 8 characters.");
    if (next !== confirm) return setError("The two passwords do not match.");
    setBusy(true);
    try {
      // Every saved secret is decrypted with the old key and re-encrypted with
      // the new one in a single pass, then written back together.
      const rekeyed = await vault.changeMasterPassword(current, next, allSecrets());
      onData(applyRekeyedSecrets(rekeyed));
      setCurrent("");
      setNext("");
      setConfirm("");
      onToast(`Master password changed · ${rekeyed.length} logins re-encrypted`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not change it.");
    } finally {
      setBusy(false);
    }
  }

  if (!exists) {
    return (
      <section className="space-y-2">
        <div className="flex items-center gap-2">
          <Icon.Lock width={14} height={14} className="text-ink-faint" />
          <h3 className="text-[13px] font-semibold text-ink">Vault master password</h3>
        </div>
        <p className="text-[11px] leading-relaxed text-ink-muted">
          No vault yet. It is created the first time you add a login, in any folder&apos;s Logins
          &amp; Passwords section.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        <Icon.Lock width={14} height={14} className="text-ink-faint" />
        <h3 className="text-[13px] font-semibold text-ink">Vault master password</h3>
      </div>
      <p className="text-[11px] leading-relaxed text-ink-muted">
        The real encryption. Changing it decrypts every saved login and re-encrypts it under the new
        password in one pass.
      </p>
      <Note tone="warn">
        There is no recovery. Forget this and the saved passwords are unreadable for good.
      </Note>

      <div className="grid gap-1.5 sm:grid-cols-3">
        <Field label="Current" value={current} onChange={setCurrent} />
        <Field label="New" value={next} onChange={setNext} placeholder="min 8 characters" />
        <Field label="Confirm" value={confirm} onChange={setConfirm} />
      </div>

      {error && <p className="text-[11px] text-red-400">{error}</p>}

      <button
        onClick={() => void submit()}
        disabled={busy || !current || !next}
        className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-2 disabled:opacity-40"
      >
        {busy ? "Re-encrypting…" : "Change master password"}
      </button>
    </section>
  );
}

// ----- dialog ----------------------------------------------------------------

export function SecurityDialog({
  onClose,
  onData,
  onToast,
}: {
  onClose: () => void;
  onData: (d: RecallData) => void;
  onToast: (m: string) => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:p-8"
      onClick={onClose}
    >
      <div
        className="animate-fade-in w-full max-w-xl rounded-2xl border border-line bg-panel shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-line px-5 py-3.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand/15 text-brand">
            <Icon.Shield width={15} height={15} />
          </span>
          <span className="text-sm font-semibold text-ink">Security</span>
          <button
            onClick={onClose}
            aria-label="Close"
            className="ml-auto rounded-lg p-1.5 text-ink-faint hover:bg-panel-2 hover:text-ink"
          >
            <Icon.Close width={16} height={16} />
          </button>
        </div>

        <div className="space-y-6 p-5">
          <AppPassword onToast={onToast} />
          <div className="border-t border-line-soft" />
          <VaultPassword onData={onData} onToast={onToast} />
        </div>
      </div>
    </div>
  );
}
