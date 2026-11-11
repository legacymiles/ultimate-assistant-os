"use client";

import { useEffect, useState } from "react";
import { Modal, Field, inputClass } from "../Modal";
import { Icon } from "../icons";
import { ACCOUNT_KINDS } from "@/lib/recall/profiles";
import type { ProfileAccountInput } from "@/lib/recall/store";
import type { ProfileAccount, ProfileAccountKind, ProfileLiveProvider } from "@/lib/recall/types";

interface Props {
  open: boolean;
  account?: ProfileAccount;
  onSave: (input: ProfileAccountInput) => void;
  onClose: () => void;
}

interface Form {
  label: string;
  provider: string;
  kind: ProfileAccountKind;
  openedDate: string;
  renewalDate: string;
  login: string;
  password: string;
  url: string;
  accountNumber: string;
  value: string;
  currency: string;
  notes: string;
  liveProvider: ProfileLiveProvider;
  endpoint: string;
  jsonPath: string;
}

function emptyForm(): Form {
  return {
    label: "",
    provider: "",
    kind: "account",
    openedDate: "",
    renewalDate: "",
    login: "",
    password: "",
    url: "",
    accountNumber: "",
    value: "",
    currency: "USD",
    notes: "",
    liveProvider: "manual",
    endpoint: "",
    jsonPath: "",
  };
}

const PRESETS: { label: string; hint: string; patch: Partial<Form> }[] = [
  { label: "Bank", hint: "opened, login, balance", patch: { label: "Bank account", kind: "account" } },
  {
    label: "Brokerage",
    hint: "opened, login, value",
    patch: { label: "Brokerage account", kind: "brokerage", currency: "USD" },
  },
  {
    label: "Trump account",
    hint: "opened, login, value",
    patch: { label: "Trump account", provider: "Trump Media", kind: "brokerage", currency: "USD" },
  },
  {
    label: "Domain",
    hint: "registrar, renewal, login",
    patch: { label: "Domain", provider: "Cloudflare", kind: "domain" },
  },
  { label: "SaaS", hint: "renewal, login", patch: { label: "Subscription", kind: "saas" } },
];

/**
 * One account. The point is not to be a banking app — it is to stop the facts
 * scattering. Opened date, login, renewal and value live on the same card, and
 * any one of them may legitimately be blank.
 */
export function AccountDialog({ open, account, onSave, onClose }: Props) {
  const [form, setForm] = useState<Form>(emptyForm());
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (!open) return;
    setShowPassword(false);
    setForm(
      account
        ? {
            label: account.label,
            provider: account.provider ?? "",
            kind: account.kind,
            openedDate: account.openedDate ?? "",
            renewalDate: account.renewalDate ?? "",
            login: account.login ?? "",
            password: account.password ?? "",
            url: account.url ?? "",
            accountNumber: account.accountNumber ?? "",
            value: account.value ?? "",
            currency: account.currency ?? "USD",
            notes: account.notes ?? "",
            liveProvider: account.live?.provider ?? "manual",
            endpoint: account.live?.endpoint ?? "",
            jsonPath: account.live?.jsonPath ?? "",
          }
        : emptyForm(),
    );
  }, [open, account]);

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }));

  function save() {
    if (!form.label.trim()) return;
    onSave({
      label: form.label,
      provider: form.provider,
      kind: form.kind,
      openedDate: form.openedDate,
      renewalDate: form.renewalDate,
      login: form.login,
      password: form.password,
      url: form.url,
      accountNumber: form.accountNumber,
      value: form.value,
      currency: form.currency,
      notes: form.notes,
      live: {
        provider: form.liveProvider,
        endpoint: form.liveProvider === "json" ? form.endpoint : undefined,
        jsonPath: form.liveProvider === "json" ? form.jsonPath || undefined : undefined,
        currency: form.currency || "USD",
        status:
          form.liveProvider === "json" && form.endpoint === account?.live?.endpoint
            ? account?.live?.status ?? "manual"
            : "manual",
      },
    });
  }

  return (
    <Modal
      open={open}
      title={account ? "Edit account" : "Add account"}
      onClose={onClose}
      wide
      footer={
        <>
          <button
            onClick={onClose}
            className="rounded-xl border border-line px-4 py-2.5 text-sm font-medium text-ink-muted transition hover:text-ink"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={!form.label.trim()}
            className="inline-flex items-center gap-2 rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-2 disabled:opacity-40"
          >
            <Icon.Check width={15} height={15} /> {account ? "Save account" : "Add account"}
          </button>
        </>
      }
    >
      <div className="mb-4 flex flex-wrap gap-1.5">
        {PRESETS.map((preset) => (
          <button
            key={preset.label}
            onClick={() => setForm((f) => ({ ...f, ...preset.patch }))}
            title={preset.hint}
            className="rounded-full border border-line bg-canvas px-2.5 py-1 text-[11px] text-ink-muted transition hover:border-brand/40 hover:text-ink"
          >
            {preset.label}
          </button>
        ))}
      </div>

      <div className="grid gap-x-3 sm:grid-cols-2">
        <Field label="Label">
          <input
            value={form.label}
            onChange={(e) => set("label", e.target.value)}
            placeholder="Trump account"
            className={inputClass}
          />
        </Field>
        <Field label="Type">
          <select
            value={form.kind}
            onChange={(e) => set("kind", e.target.value as ProfileAccountKind)}
            className={inputClass}
          >
            {ACCOUNT_KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Provider">
          <input
            value={form.provider}
            onChange={(e) => set("provider", e.target.value)}
            placeholder="Cloudflare, Fidelity, Chase…"
            className={inputClass}
          />
        </Field>
        <Field label="Account number">
          <input
            value={form.accountNumber}
            onChange={(e) => set("accountNumber", e.target.value)}
            placeholder="Last 4 is enough"
            className={inputClass}
          />
        </Field>
        <Field label="Date opened">
          <input
            type="date"
            value={form.openedDate}
            onChange={(e) => set("openedDate", e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Renewal / next date">
          <input
            type="date"
            value={form.renewalDate}
            onChange={(e) => set("renewalDate", e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Login / username">
          <input
            value={form.login}
            onChange={(e) => set("login", e.target.value)}
            placeholder="you@example.com"
            className={inputClass}
          />
        </Field>
        <Field label="Password" hint="Stored in this browser, like a Dashboard login.">
          <div className="flex gap-1.5">
            <input
              type={showPassword ? "text" : "password"}
              value={form.password}
              onChange={(e) => set("password", e.target.value)}
              className={inputClass}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              className="shrink-0 rounded-xl border border-line px-2.5 text-ink-faint hover:text-ink"
            >
              {showPassword ? <Icon.EyeOff width={14} height={14} /> : <Icon.Eye width={14} height={14} />}
            </button>
          </div>
        </Field>
        <Field label="Website / URL">
          <input
            value={form.url}
            onChange={(e) => set("url", e.target.value)}
            placeholder="https://bighomieai.com"
            className={inputClass}
          />
        </Field>
        <Field label="Current value">
          <div className="flex gap-1.5">
            <input
              value={form.value}
              onChange={(e) => set("value", e.target.value)}
              placeholder="0.00"
              inputMode="decimal"
              className={inputClass}
            />
            <input
              value={form.currency}
              onChange={(e) => set("currency", e.target.value.toUpperCase().slice(0, 4))}
              className="w-16 rounded-xl border border-line bg-canvas px-2 text-center text-xs font-semibold text-ink outline-none focus:border-brand"
              aria-label="Currency"
            />
          </div>
        </Field>
      </div>

      <Field label="Notes">
        <textarea
          value={form.notes}
          onChange={(e) => set("notes", e.target.value)}
          rows={2}
          placeholder="Anything that does not fit above"
          className={inputClass + " resize-y"}
        />
      </Field>

      <div className="rounded-xl border border-line bg-canvas p-3">
        <div className="mb-2 flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-400/10 text-emerald-300">
            <Icon.Refresh width={14} height={14} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-ink">Live number</p>
            <p className="text-[10px] text-ink-faint">
              Manual, or point at a read-only JSON endpoint and Dashboard will pull the value.
            </p>
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <select
            value={form.liveProvider}
            onChange={(e) => set("liveProvider", e.target.value as ProfileLiveProvider)}
            className={inputClass}
          >
            <option value="manual">Manual — I type the number</option>
            <option value="json">Read-only JSON URL</option>
          </select>
          {form.liveProvider === "json" ? (
            <input
              value={form.endpoint}
              onChange={(e) => set("endpoint", e.target.value)}
              placeholder="https://api.example.com/balance"
              className={inputClass}
            />
          ) : (
            <div className="flex items-center rounded-xl border border-dashed border-line px-3 text-[11px] text-ink-faint">
              Use “Update value” on the account card.
            </div>
          )}
        </div>
        {form.liveProvider === "json" && (
          <input
            value={form.jsonPath}
            onChange={(e) => set("jsonPath", e.target.value)}
            placeholder='Dot path, e.g. data.balance (blank = first number found)'
            className={inputClass + " mt-2"}
          />
        )}
      </div>
    </Modal>
  );
}
