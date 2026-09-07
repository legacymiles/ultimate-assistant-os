"use client";

import { useCallback, useEffect, useState } from "react";
import { Icon } from "../icons";
import { allCredentials, applyImportedPasswords, getData, legacySecrets } from "@/lib/recall/store";
import { forgetLegacyVault, hasLegacyVault, importAll } from "@/lib/recall/legacyVault";
import { copyEphemeral } from "@/lib/recall/clipboard";
import type { Cipher, Folder, Item, RecallData } from "@/lib/recall/types";
import { RowAction } from "./Section";

// ---------------------------------------------------------------------------
// Security settings.
//
// Recall has exactly one password: the app password, a door on the page that
// stops someone else opening Recall. Saved logins are NOT behind a second one
// — they are listed here, revealable and copyable, because a password you
// cannot get back is worse than useless.
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

// ----- saved passwords -------------------------------------------------------

function PasswordRow({
  item,
  folderName,
  showAll,
  onToast,
}: {
  item: Item;
  folderName: string;
  showAll: boolean;
  onToast: (m: string) => void;
}) {
  const [shown, setShown] = useState(false);
  const reveal = showAll || shown;
  const password = item.password ?? "";
  const who = item.fields?.username || item.fields?.email || "";

  return (
    <div className="flex items-center gap-2 rounded-lg border border-line-soft px-2.5 py-1.5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12px] font-medium text-ink">{item.title}</p>
        <p className="truncate text-[10px] text-ink-faint">
          {folderName}
          {who && ` · ${who}`}
        </p>
      </div>
      <span className="min-w-0 max-w-[45%] shrink-0 truncate text-right font-mono text-[11px] text-ink-muted">
        {password ? (reveal ? password : "••••••••••") : "encrypted — import below"}
      </span>
      {password && (
        <>
          <RowAction label={reveal ? "Hide" : "Reveal"} onClick={() => setShown((v) => !v)}>
            {reveal ? <Icon.EyeOff width={12} height={12} /> : <Icon.Eye width={12} height={12} />}
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
        </>
      )}
    </div>
  );
}

/**
 * Every saved login in one place, revealable without a second password.
 * This is the recovery path: forget which folder a login went into and you can
 * still find it here.
 */
function SavedPasswords({
  onData,
  onToast,
}: {
  onData: (d: RecallData) => void;
  onToast: (m: string) => void;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  // Anything still sealed under the retired master password.
  const [stranded, setStranded] = useState<{ id: string; title: string; cipher: Cipher }[]>([]);
  const [master, setMaster] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setItems(allCredentials());
    setFolders(getData().folders);
    setStranded(hasLegacyVault() ? legacySecrets() : []);
  }, []);

  useEffect(() => refresh(), [refresh]);

  const folderName = (id: string | null) =>
    (id && folders.find((f) => f.id === id)?.name) || "Unfiled";

  const shown = items.filter((i) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return [i.title, folderName(i.folderId), ...Object.values(i.fields ?? {})]
      .join(" ")
      .toLowerCase()
      .includes(q);
  });

  async function runImport() {
    setError(null);
    setBusy(true);
    try {
      const { imported, failed } = await importAll(master, stranded);
      onData(applyImportedPasswords(imported));
      if (failed === 0) forgetLegacyVault();
      setMaster("");
      refresh();
      onToast(
        `${imported.length} password${imported.length === 1 ? "" : "s"} recovered` +
          (failed ? ` · ${failed} could not be read` : ""),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not import.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        <Icon.Key width={14} height={14} className="text-ink-faint" />
        <h3 className="text-[13px] font-semibold text-ink">Saved passwords</h3>
        {items.length > 0 && (
          <button
            onClick={() => setShowAll((v) => !v)}
            className="ml-auto rounded-lg border border-line px-2 py-1 text-[11px] text-ink-muted transition hover:text-ink"
          >
            {showAll ? "Hide all" : "Reveal all"}
          </button>
        )}
      </div>
      <p className="text-[11px] leading-relaxed text-ink-muted">
        Every login you have saved, in any folder. There is no master password to remember — reveal
        or copy any of them from here.
      </p>

      {stranded.length > 0 && (
        <div className="space-y-2 rounded-lg border border-amber-400/25 bg-amber-400/[0.07] p-2.5">
          <p className="text-[11px] leading-relaxed text-amber-100/80">
            {stranded.length} password{stranded.length === 1 ? " was" : "s were"} saved under the old
            master password. Enter it once and they become readable like the rest — after that the
            master password is gone for good.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="password"
              autoComplete="off"
              value={master}
              placeholder="old master password"
              onChange={(e) => setMaster(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && master && void runImport()}
              className="w-52 rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-xs text-ink outline-none placeholder:text-ink-faint focus:border-brand"
            />
            <button
              onClick={() => void runImport()}
              disabled={busy || !master}
              className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-2 disabled:opacity-40"
            >
              {busy ? "Importing…" : "Import"}
            </button>
            <button
              onClick={() => {
                if (
                  window.confirm(
                    `Forget ${stranded.length} encrypted password${stranded.length === 1 ? "" : "s"}? The logins stay, but those passwords are unrecoverable and you will have to type them again.`,
                  )
                ) {
                  onData(applyImportedPasswords(stranded.map((s) => ({ id: s.id, password: "" }))));
                  forgetLegacyVault();
                  refresh();
                  onToast("Old encrypted passwords discarded");
                }
              }}
              className="rounded-lg border border-line px-3 py-1.5 text-xs text-ink-muted transition hover:border-red-500/40 hover:text-red-400"
            >
              Forget them
            </button>
          </div>
          {error && <p className="text-[11px] text-red-400">{error}</p>}
        </div>
      )}

      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line px-3 py-3 text-center text-[11px] text-ink-faint">
          No logins saved yet. Add one in any folder&apos;s Logins &amp; Passwords section.
        </p>
      ) : (
        <>
          {items.length > 5 && (
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter by name, folder or username"
              className="w-full rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-xs text-ink outline-none placeholder:text-ink-faint focus:border-brand"
            />
          )}
          <div className="max-h-64 space-y-1 overflow-y-auto pr-0.5">
            {shown.map((it) => (
              <PasswordRow
                key={it.id}
                item={it}
                folderName={folderName(it.folderId)}
                showAll={showAll}
                onToast={onToast}
              />
            ))}
            {shown.length === 0 && (
              <p className="px-1 py-2 text-[11px] text-ink-faint">Nothing matches that.</p>
            )}
          </div>
        </>
      )}
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
          <SavedPasswords onData={onData} onToast={onToast} />
        </div>
      </div>
    </div>
  );
}
