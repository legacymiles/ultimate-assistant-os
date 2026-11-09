"use client";

import { useState } from "react";
import { Icon } from "../icons";
import { ProfileAvatar } from "./ProfileAvatar";
import { AccountDialog } from "./AccountDialog";
import { relativeTime } from "@/lib/utils";
import {
  addProfileAccount,
  deleteProfile,
  deleteProfileAccount,
  folderPathString,
  repairProfileFolder,
  setProfileAvatar,
  setProfileField,
  updateProfile,
  updateProfileAccount,
  type ProfileAccountInput,
} from "@/lib/recall/store";
import {
  accountSubtitle,
  isSensitiveField,
  profileCompleteness,
  profileKindLabel,
  roleLabel,
} from "@/lib/recall/profiles";
import type { Item, Profile, ProfileAccount, RecallData } from "@/lib/recall/types";

interface Props {
  profile: Profile;
  data: RecallData;
  onBack: () => void;
  onData: (data: RecallData) => void;
  onOpenFolder: (folderId: string) => void;
  onOpenItem: (item: Item) => void;
  onOpenMemory: () => void;
  onAsk: (question: string) => void;
  onToast: (message: string) => void;
}

function formatMoney(account: ProfileAccount): string {
  if (!account.value?.trim()) return "—";
  const n = Number(account.value.replace(/[^0-9.-]/g, ""));
  if (!Number.isFinite(n)) return account.value;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: (account.currency || "USD").toUpperCase(),
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `${account.currency ?? ""} ${account.value}`.trim();
  }
}

export function ProfileView({
  profile,
  data,
  onBack,
  onData,
  onOpenFolder,
  onOpenItem,
  onOpenMemory,
  onAsk,
  onToast,
}: Props) {
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [accountDialog, setAccountDialog] = useState<{ account?: ProfileAccount } | null>(null);
  const [busyAccount, setBusyAccount] = useState<string | null>(null);
  const [nameEditing, setNameEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState(profile.displayName);

  const completeness = profileCompleteness(profile);
  const note = profile.itemId ? data.items.find((i) => i.id === profile.itemId) : undefined;
  const folder = profile.folderId ? folderPathString(data.folders, profile.folderId) : null;

  function reveal(id: string) {
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function beginEdit(id: string, value: string) {
    setEditingField(id);
    setEditValue(value);
    setTimeout(() => {
      const el = document.getElementById(`pf-${id}`);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
      (el as HTMLInputElement | null)?.focus();
    }, 30);
  }

  function commitField(fieldId: string, label: string, previous: string) {
    if (editValue !== previous) {
      onData(setProfileField(profile.id, label, editValue));
      onToast("Field saved");
    }
    setEditingField(null);
  }

  function saveName() {
    const next = nameDraft.trim();
    if (next && next !== profile.displayName) {
      onData(updateProfile(profile.id, { displayName: next }));
      onToast("Name updated — folder renamed too");
    }
    setNameEditing(false);
  }

  function editHeadline() {
    const next = window.prompt("Headline", profile.headline ?? "");
    if (next !== null) onData(updateProfile(profile.id, { headline: next }));
  }

  function addCustomField() {
    const label = window.prompt("Field name — e.g. School, Passport, Brokerage PIN place");
    if (!label?.trim()) return;
    const value = window.prompt(`Value for “${label.trim()}” (leave blank for a placeholder)`) ?? "";
    onData(setProfileField(profile.id, label.trim(), value));
    onToast("Field added");
  }

  function remove() {
    if (
      !window.confirm(
        `Delete ${profile.displayName}'s profile? The folder stays only if something else is in it.`,
      )
    )
      return;
    onData(deleteProfile(profile.id));
    onToast("Profile deleted");
    onBack();
  }

  function saveAccount(input: ProfileAccountInput) {
    if (accountDialog?.account) {
      onData(updateProfileAccount(profile.id, accountDialog.account.id, input));
      onToast("Account updated");
    } else {
      const result = addProfileAccount(profile.id, input);
      if (result) {
        onData(result.data);
        onToast("Account added");
      }
    }
    setAccountDialog(null);
  }

  async function syncAccount(account: ProfileAccount) {
    const live = account.live;
    if (live?.provider === "json" && live.endpoint) {
      setBusyAccount(account.id);
      try {
        const res = await fetch("/api/recall", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stage: "live", liveUrl: live.endpoint, jsonPath: live.jsonPath ?? "" }),
        });
        const data = (await res.json()) as {
          value?: string | null;
          currency?: string;
          error?: string;
          fetchedAt?: string;
        };
        if (data.value) {
          onData(
            updateProfileAccount(profile.id, account.id, {
              value: data.value,
              currency: data.currency ?? account.currency,
              live: {
                ...live,
                status: "connected",
                syncedAt: data.fetchedAt ?? new Date().toISOString(),
                note: undefined,
              },
            }),
          );
          onToast("Live value updated");
        } else {
          onData(
            updateProfileAccount(profile.id, account.id, {
              live: { ...live, status: "error", note: data.error ?? "Could not read that endpoint." },
            }),
          );
          onToast(data.error ?? "Could not read that endpoint");
        }
      } catch {
        onToast("Could not reach that endpoint");
      } finally {
        setBusyAccount(null);
      }
      return;
    }
    if (live?.provider === "json" && !live.endpoint) {
      setAccountDialog({ account });
      onToast("Add the JSON endpoint first");
      return;
    }
    const value = window.prompt(`Current value (${account.currency ?? "USD"})`, account.value ?? "");
    if (value !== null) {
      onData(updateProfileAccount(profile.id, account.id, { value }));
      onToast("Value updated");
    }
  }

  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      onToast(`${label} copied`);
    } catch {
      onToast("Could not copy");
    }
  }

  return (
    <div>
      <div className="mb-4 flex items-center gap-2">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-ink-muted transition hover:text-ink"
        >
          <Icon.ArrowLeft width={14} height={14} /> Profiles
        </button>
        {folder && (
          <button
            onClick={() => profile.folderId && onOpenFolder(profile.folderId)}
            className="inline-flex min-w-0 items-center gap-1 rounded-lg border border-line px-2.5 py-1.5 text-xs text-ink-muted transition hover:text-ink"
            title="Open the folder that owns this profile"
          >
            <Icon.Folder width={12} height={12} />
            <span className="truncate">{folder}</span>
          </button>
        )}
        <button
          onClick={onOpenMemory}
          className="ml-auto inline-flex items-center gap-1 rounded-lg border border-line px-2.5 py-1.5 text-xs text-ink-muted transition hover:text-ink"
        >
          <Icon.Network width={12} height={12} /> Memory
        </button>
      </div>

      {!profile.folderId && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-2.5">
          <Icon.Folder width={15} height={15} className="text-amber-300" />
          <p className="min-w-0 flex-1 text-xs text-amber-100/90">
            This profile lost its folder. Repair it to put the record back under Profiles.
          </p>
          <button
            onClick={() => {
              onData(repairProfileFolder(profile.id));
              onToast("Folder repaired");
            }}
            className="rounded-lg bg-amber-400/20 px-2.5 py-1 text-[11px] font-semibold text-amber-100 hover:bg-amber-400/30"
          >
            Repair folder
          </button>
        </div>
      )}

      {/* Hero */}
      <section className="mb-4 overflow-hidden rounded-2xl border border-line bg-gradient-to-br from-panel-2 via-panel to-panel">
        <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start">
          <ProfileAvatar
            profile={profile}
            size={96}
            editable
            onChange={(avatar) => {
              onData(setProfileAvatar(profile.id, avatar));
              onToast("Photo updated");
            }}
            onError={onToast}
          />

          <div className="min-w-0 flex-1">
            <div className="flex items-start gap-2">
              {nameEditing ? (
                <input
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  onBlur={saveName}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveName();
                    if (e.key === "Escape") {
                      setNameDraft(profile.displayName);
                      setNameEditing(false);
                    }
                  }}
                  autoFocus
                  className="min-w-0 flex-1 rounded-lg border border-brand bg-canvas px-2 py-1 text-2xl font-bold tracking-tight text-ink outline-none"
                />
              ) : (
                <h1 className="min-w-0 flex-1 truncate text-2xl font-bold tracking-tight text-ink sm:text-3xl">
                  {profile.displayName}
                </h1>
              )}
              {!nameEditing && (
                <button
                  onClick={() => {
                    setNameDraft(profile.displayName);
                    setNameEditing(true);
                  }}
                  aria-label="Rename profile"
                  className="rounded-lg p-1.5 text-ink-faint transition hover:bg-panel-2 hover:text-ink"
                >
                  <Icon.Edit width={14} height={14} />
                </button>
              )}
            </div>

            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px]">
              <span
                className={
                  "rounded-full px-2 py-0.5 font-semibold uppercase tracking-wider " +
                  (profile.kind === "business"
                    ? "bg-amber-400/15 text-amber-200"
                    : "bg-brand/15 text-brand")
                }
              >
                {profileKindLabel(profile.kind)}
              </span>
              {profile.role && (
                <span className="rounded-full bg-panel-2 px-2 py-0.5 font-medium text-ink-muted">
                  {roleLabel(profile.role)}
                </span>
              )}
              {profile.tags
                .filter((t) => t !== "profile" && t !== profile.kind && t !== profile.role)
                .map((t) => (
                  <span key={t} className="rounded-full border border-line px-2 py-0.5 text-ink-faint">
                    {t}
                  </span>
                ))}
            </div>

            <button
              onClick={editHeadline}
              className="mt-2 block max-w-2xl text-left text-sm leading-relaxed text-ink-muted hover:text-ink"
              title="Edit headline"
            >
              {profile.headline || "Add a one-line description…"}
            </button>

            <div className="mt-3 max-w-sm">
              <div className="mb-1 flex items-center gap-2 text-[10px] text-ink-faint">
                <span className="font-medium tabular-nums text-ink-muted">
                  {completeness.known}/{completeness.total} details
                </span>
                {completeness.missing.length > 0 && <span>· {completeness.missing.length} placeholders</span>}
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-canvas">
                <div
                  className={"h-full rounded-full " + (completeness.pct >= 80 ? "bg-emerald-400" : "bg-brand")}
                  style={{ width: `${completeness.pct}%` }}
                />
              </div>
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap gap-2 sm:flex-col">
            <button
              onClick={() =>
                onAsk(
                  `Help me complete ${profile.displayName}'s profile. Missing: ${
                    completeness.missing.map((f) => f.label).join(", ") || "nothing important"
                  }. Ask me one question at a time and propose the update.`,
                )
              }
              className="inline-flex items-center gap-1.5 rounded-xl bg-brand px-3 py-2 text-xs font-semibold text-white transition hover:bg-brand-2"
            >
              <Icon.Sparkles width={13} height={13} /> Ask Jarvis
            </button>
            {profile.folderId && (
              <button
                onClick={() => onOpenFolder(profile.folderId as string)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-line px-3 py-2 text-xs font-medium text-ink-muted transition hover:text-ink"
              >
                <Icon.Folder width={13} height={13} /> Open folder
              </button>
            )}
          </div>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-[1.55fr_1fr]">
        <div className="space-y-4">
          {/* Identity */}
          <section className="rounded-2xl border border-line bg-panel/50">
            <div className="flex items-center gap-2 border-b border-line px-4 py-3">
              <Icon.User width={14} height={14} className="text-ink-faint" />
              <h2 className="text-[13px] font-semibold text-ink">
                {profile.kind === "business" ? "Business details" : "Identity"}
              </h2>
              <button
                onClick={addCustomField}
                className="ml-auto inline-flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-[10px] text-ink-muted transition hover:text-ink"
              >
                <Icon.Plus width={10} height={10} /> Field
              </button>
            </div>
            <dl className="divide-y divide-line/70">
              {profile.fields.map((field) => {
                const sensitive = isSensitiveField(field);
                const hasValue = Boolean(field.value.trim());
                const masked = sensitive && hasValue && !revealed.has(field.id);
                const editing = editingField === field.id;
                return (
                  <div key={field.id} className="group/field flex items-start gap-2 px-4 py-2.5">
                    <dt className="w-[132px] shrink-0 pt-1 text-[11px] text-ink-faint">{field.label}</dt>
                    <dd className="min-w-0 flex-1">
                      {editing ? (
                        <input
                          id={`pf-${field.id}`}
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onBlur={() => commitField(field.id, field.label, field.value)}
                          onKeyDown={(e) => {
                            // Blur commits once. Calling commit here too fired
                            // the save twice (and two toasts) on Enter.
                            if (e.key === "Enter") {
                              e.preventDefault();
                              e.currentTarget.blur();
                            }
                            if (e.key === "Escape") setEditingField(null);
                          }}
                          type={field.type === "date" ? "date" : field.type === "email" ? "email" : "text"}
                          className="w-full rounded-lg border border-brand bg-canvas px-2 py-1 text-xs text-ink outline-none"
                          autoFocus
                        />
                      ) : (
                        <button
                          onClick={() => beginEdit(field.id, field.value)}
                          className={
                            "block w-full truncate rounded-md px-1 py-0.5 text-left text-xs transition hover:bg-panel-2 " +
                            (field.value ? "text-ink" : "border border-dashed border-line/70 text-ink-faint")
                          }
                          title={field.hint || "Click to edit"}
                        >
                          {masked ? "••••••••" : field.value || "Not added yet — click to fill"}
                        </button>
                      )}
                      {field.hint && !editing && (
                        <p className="mt-0.5 px-1 text-[9px] text-ink-faint/70">{field.hint}</p>
                      )}
                    </dd>
                    <div className="flex shrink-0 items-center gap-0.5 pt-0.5">
                      {sensitive && hasValue && (
                        <button
                          onClick={() => reveal(field.id)}
                          aria-label={revealed.has(field.id) ? "Hide" : "Reveal"}
                          className="rounded p-1 text-ink-faint hover:text-ink"
                        >
                          {revealed.has(field.id) ? (
                            <Icon.EyeOff width={11} height={11} />
                          ) : (
                            <Icon.Eye width={11} height={11} />
                          )}
                        </button>
                      )}
                      {field.value && !masked && (
                        <button
                          onClick={() => void copy(field.value, field.label)}
                          aria-label={`Copy ${field.label}`}
                          className="rounded p-1 text-ink-faint opacity-0 transition hover:text-ink group-hover/field:opacity-100"
                        >
                          <Icon.Copy width={11} height={11} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </dl>
          </section>

          {/* Accounts */}
          <section className="rounded-2xl border border-line bg-panel/50">
            <div className="flex items-center gap-2 border-b border-line px-4 py-3">
              <Icon.Wallet width={14} height={14} className="text-ink-faint" />
              <h2 className="text-[13px] font-semibold text-ink">Accounts &amp; logins</h2>
              <span className="rounded bg-panel-2 px-1.5 py-0.5 text-[10px] tabular-nums text-ink-faint">
                {profile.accounts.length}
              </span>
              <button
                onClick={() => setAccountDialog({})}
                className="ml-auto inline-flex items-center gap-1 rounded-lg bg-brand/10 px-2 py-1 text-[10px] font-semibold text-brand transition hover:bg-brand/20"
              >
                <Icon.Plus width={10} height={10} /> Add account
              </button>
            </div>

            {profile.accounts.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <div className="mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-xl bg-panel-2 text-ink-faint">
                  <Icon.Wallet width={17} height={17} />
                </div>
                <p className="text-xs font-medium text-ink">No accounts yet</p>
                <p className="mx-auto mt-1 max-w-xs text-[11px] leading-relaxed text-ink-muted">
                  Add the first one — a bank, a brokerage, a domain. Date opened, login and renewal
                  date each get their own slot, and you can leave any of them blank.
                </p>
                <button
                  onClick={() => setAccountDialog({})}
                  className="mt-3 inline-flex items-center gap-1 rounded-lg border border-line px-2.5 py-1.5 text-[11px] text-ink-muted hover:text-ink"
                >
                  <Icon.Plus width={11} height={11} /> Add the first account
                </button>
              </div>
            ) : (
              <div className="space-y-2 p-3">
                {profile.accounts.map((account) => {
                  const showPw = revealed.has(`acct-pw-${account.id}`);
                  const busy = busyAccount === account.id;
                  return (
                    <div key={account.id} className="rounded-xl border border-line bg-canvas p-3">
                      <div className="flex items-start gap-2.5">
                        <span
                          className={
                            "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg " +
                            (account.kind === "domain" || account.kind === "hosting"
                              ? "bg-sky-400/10 text-sky-300"
                              : account.kind === "brokerage" || account.kind === "account"
                                ? "bg-emerald-400/10 text-emerald-300"
                                : "bg-panel-2 text-ink-muted")
                          }
                        >
                          {account.kind === "domain" ? (
                            <Icon.Globe width={15} height={15} />
                          ) : account.kind === "hosting" ? (
                            <Icon.Server width={15} height={15} />
                          ) : (
                            <Icon.Wallet width={15} height={15} />
                          )}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <p className="truncate text-[13px] font-semibold text-ink">{account.label}</p>
                            {account.live?.status === "connected" && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-400/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-emerald-300">
                                <span className="h-1 w-1 rounded-full bg-emerald-400" /> Live
                              </span>
                            )}
                            {account.live?.status === "error" && (
                              <span className="rounded-full bg-red-400/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-red-300">
                                Sync error
                              </span>
                            )}
                          </div>
                          <p className="truncate text-[10px] text-ink-faint">{accountSubtitle(account)}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-base font-semibold tabular-nums text-ink">{formatMoney(account)}</p>
                          {account.live?.syncedAt && (
                            <p className="text-[9px] text-ink-faint">Synced {relativeTime(account.live.syncedAt)}</p>
                          )}
                        </div>
                      </div>

                      <div className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1.5 rounded-lg bg-panel/60 px-2.5 py-2 text-[10px] sm:grid-cols-4">
                        <div>
                          <p className="text-ink-faint">Opened</p>
                          <p className="text-ink-muted">{account.openedDate || "—"}</p>
                        </div>
                        <div>
                          <p className="text-ink-faint">Renewal</p>
                          <p className="text-ink-muted">{account.renewalDate || "—"}</p>
                        </div>
                        <div>
                          <p className="text-ink-faint">Login</p>
                          <p className="truncate text-ink-muted" title={account.login}>
                            {account.login || "—"}
                          </p>
                        </div>
                        <div>
                          <p className="text-ink-faint">Account no.</p>
                          <p className="truncate text-ink-muted">{account.accountNumber || "—"}</p>
                        </div>
                      </div>

                      {account.password && (
                        <div className="mt-1.5 flex items-center gap-1.5 text-[10px]">
                          <span className="text-ink-faint">Password</span>
                          <span className="min-w-0 flex-1 truncate font-mono text-ink-muted">
                            {showPw ? account.password : "••••••••••"}
                          </span>
                          <button
                            onClick={() => reveal(`acct-pw-${account.id}`)}
                            className="rounded p-0.5 text-ink-faint hover:text-ink"
                            aria-label={showPw ? "Hide password" : "Show password"}
                          >
                            {showPw ? <Icon.EyeOff width={11} height={11} /> : <Icon.Eye width={11} height={11} />}
                          </button>
                          <button
                            onClick={() => void copy(account.password as string, "Password")}
                            className="rounded p-0.5 text-ink-faint hover:text-ink"
                            aria-label="Copy password"
                          >
                            <Icon.Copy width={11} height={11} />
                          </button>
                        </div>
                      )}

                      {account.live?.note && account.live.status === "error" && (
                        <p className="mt-1 text-[10px] text-red-300/80">{account.live.note}</p>
                      )}

                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <button
                          onClick={() => void syncAccount(account)}
                          disabled={busy}
                          className="inline-flex items-center gap-1 rounded-lg border border-line px-2 py-0.5 text-[10px] font-medium text-ink-muted transition hover:text-ink disabled:opacity-50"
                        >
                          <Icon.Refresh width={10} height={10} className={busy ? "animate-spin" : ""} />
                          {account.live?.provider === "json" ? "Sync" : "Update value"}
                        </button>
                        {account.url && (
                          <a
                            href={account.url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 rounded-lg border border-line px-2 py-0.5 text-[10px] text-ink-muted hover:text-ink"
                          >
                            <Icon.Launch width={10} height={10} /> Open
                          </a>
                        )}
                        <button
                          onClick={() => setAccountDialog({ account })}
                          className="rounded-lg border border-line px-2 py-0.5 text-[10px] text-ink-muted hover:text-ink"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => {
                            if (window.confirm(`Remove “${account.label}” from this profile?`)) {
                              onData(deleteProfileAccount(profile.id, account.id));
                              onToast("Account removed");
                            }
                          }}
                          className="ml-auto rounded-lg px-1.5 py-0.5 text-[10px] text-ink-faint hover:text-red-300"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          <section className="rounded-2xl border border-amber-400/20 bg-amber-400/[0.04] p-4">
            <div className="mb-2 flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-400/15 text-amber-300">
                <Icon.Target width={14} height={14} />
              </span>
              <h2 className="text-[13px] font-semibold text-ink">Still to add</h2>
              <span className="ml-auto text-[11px] font-semibold tabular-nums text-amber-200">
                {completeness.missing.length}
              </span>
            </div>
            {completeness.missing.length === 0 ? (
              <p className="text-[11px] leading-relaxed text-ink-muted">
                Every placeholder is filled. Nice — this profile can answer for itself.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {completeness.missing.slice(0, 10).map((field) => (
                  <button
                    key={field.id}
                    onClick={() => beginEdit(field.id, field.value)}
                    className="inline-flex items-center gap-1 rounded-full border border-amber-400/25 bg-panel/60 px-2 py-0.5 text-[10px] text-amber-100/90 transition hover:bg-amber-400/10"
                  >
                    <Icon.Plus width={9} height={9} /> {field.label}
                  </button>
                ))}
              </div>
            )}
            <button
              onClick={() =>
                onAsk(
                  `Ask me for the missing details on ${profile.displayName}'s profile, one at a time, and add each answer. Missing: ${completeness.missing
                    .map((f) => f.label)
                    .join(", ")}.`,
                )
              }
              className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-amber-400/25 bg-panel/50 px-2.5 py-1.5 text-[11px] font-medium text-amber-100 hover:bg-amber-400/10"
            >
              <Icon.Sparkles width={11} height={11} /> Ask Jarvis to fill these
            </button>
          </section>

          <section className="rounded-2xl border border-line bg-panel/50 p-4">
            <h2 className="mb-2.5 text-[13px] font-semibold text-ink">Connections</h2>
            <div className="space-y-1.5 text-[11px]">
              <button
                onClick={onOpenMemory}
                className="flex w-full items-center gap-2 rounded-lg border border-line bg-canvas px-2.5 py-2 text-left text-ink-muted transition hover:text-ink"
              >
                <Icon.Network width={13} height={13} className="text-brand" />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium text-ink">Memory map</span>
                  <span className="block text-[10px] text-ink-faint">
                    {profile.fields.length} fields · {profile.accounts.length} accounts · 1 node
                  </span>
                </span>
                <Icon.Chevron width={12} height={12} />
              </button>
              {folder && (
                <button
                  onClick={() => profile.folderId && onOpenFolder(profile.folderId)}
                  className="flex w-full items-center gap-2 rounded-lg border border-line bg-canvas px-2.5 py-2 text-left text-ink-muted transition hover:text-ink"
                >
                  <Icon.Folder width={13} height={13} className="text-ink-faint" />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-ink">Folder</span>
                    <span className="block truncate text-[10px] text-ink-faint">{folder}</span>
                  </span>
                  <Icon.Chevron width={12} height={12} />
                </button>
              )}
              {note && (
                <button
                  onClick={() => onOpenItem(note)}
                  className="flex w-full items-center gap-2 rounded-lg border border-line bg-canvas px-2.5 py-2 text-left text-ink-muted transition hover:text-ink"
                >
                  <Icon.Note width={13} height={13} className="text-ink-faint" />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-ink">Profile record</span>
                    <span className="block truncate text-[10px] text-ink-faint">{note.title}</span>
                  </span>
                  <Icon.Chevron width={12} height={12} />
                </button>
              )}
            </div>
            <p className="mt-2.5 text-[10px] leading-relaxed text-ink-faint">
              The folder is the source of truth. This card and the memory map read from the same
              records, so nothing can drift.
            </p>
          </section>

          <section className="rounded-2xl border border-line bg-panel/40 p-4">
            <h2 className="mb-1 text-[13px] font-semibold text-ink">Profile notes</h2>
            <p className="text-[10px] text-ink-faint">
              Created {new Date(profile.createdAt).toLocaleDateString()} · Updated{" "}
              {relativeTime(profile.updatedAt)}
            </p>
            <button
              onClick={() => {
                const next = window.prompt("Notes", profile.notes ?? "");
                if (next !== null) {
                  onData(updateProfile(profile.id, { notes: next }));
                  onToast("Notes saved");
                }
              }}
              className="mt-2 w-full rounded-lg border border-line bg-canvas px-2.5 py-2 text-left text-[11px] leading-relaxed text-ink-muted hover:text-ink"
            >
              {profile.notes || "Click to add free-form notes…"}
            </button>
            <button
              onClick={remove}
              className="mt-3 inline-flex items-center gap-1 rounded-lg px-1 py-0.5 text-[10px] text-ink-faint transition hover:text-red-300"
            >
              <Icon.Trash width={10} height={10} /> Delete profile
            </button>
          </section>
        </div>
      </div>

      <AccountDialog
        open={Boolean(accountDialog)}
        account={accountDialog?.account}
        onSave={saveAccount}
        onClose={() => setAccountDialog(null)}
      />
    </div>
  );
}
