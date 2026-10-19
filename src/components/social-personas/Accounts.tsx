"use client";

// ---------------------------------------------------------------------------
// A persona's accounts: one row per account, across TikTok, Instagram,
// YouTube, Facebook and X, each with its username, its sign-in, and — for the
// platforms whose official login is wired up — Connect (sync posts + stats)
// and Turn on auto-post.
//
// Sign-ins are Recall logins (kind "credential", folder Personas Studio ›
// <persona>), so they also appear in Jarvis › Passwords. The password goes
// into the encrypted vault when it's unlocked; until the vault is set up it is
// stored on the login like every other saved password and the row says so —
// it never goes into the persona blob.
// ---------------------------------------------------------------------------

import { useState } from "react";
import { Icon } from "../icons";
import { handleFrom, profileUrl, uid } from "@/lib/social-personas/logic";
import { compact } from "@/lib/social-personas/studio";
import { PLATFORM_NAME, SOCIAL_PLATFORMS, isConnectable, type Account, type Persona, type SocialPlatform } from "@/lib/social-personas/types";
import { createItem, ensureFolderPath, getData, setItemFields, setItemPassword, updateItem } from "@/lib/recall/store";
import { copyEphemeral } from "@/lib/recall/clipboard";
import type { UsePasswordVault } from "@/lib/passwords/usePasswordVault";
import { api, type Status } from "./api";
import { Btn, PlatformDot, inputCls } from "./bits";
import type { Mutate } from "./SocialPersonas";

const NOTE: Record<SocialPlatform, string> = {
  tiktok: "One sign-in: your videos and views sync in, and each scheduled video goes to your TikTok inbox to post with one tap.",
  instagram: "One sign-in (Business or Creator account): posts and reels sync in, and scheduled reels and photos publish on time.",
  facebook: "One sign-in to a Page you manage: posts sync in and scheduled videos publish on time (apps can't post to personal profiles).",
  youtube: "Save the channel and its sign-in. Scheduled posts remind you and open YouTube Studio with the caption copied.",
  x: "Save the account and its sign-in. Scheduled posts remind you and open X with the text copied.",
};

export function Accounts({
  persona,
  status,
  vault,
  mutate,
  flash,
  syncAccount,
  openSetup,
}: {
  persona: Persona;
  status: Status | null;
  vault: UsePasswordVault;
  mutate: Mutate;
  flash: (t: string, bad?: boolean) => void;
  syncAccount: (personaId: string, accountId: string) => Promise<void>;
  /** Open Connect setup for a platform whose developer app isn't set up yet. */
  openSetup: (p: "tiktok" | "instagram" | "facebook") => void;
}) {
  const [adding, setAdding] = useState<SocialPlatform | null>(null);
  const [handle, setHandle] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [signIn, setSignIn] = useState<string | null>(null);

  const addHandle = (platform: SocialPlatform) => {
    const h = handleFrom(handle);
    if (!h) return;
    // No duplicates (D5): the same handle on the same platform is one account.
    if (persona.accounts.some((a) => a.platform === platform && a.handle.toLowerCase() === h.toLowerCase())) {
      flash(`@${h} is already on ${persona.name}.`, true);
      return;
    }
    const id = uid("a_");
    mutate(persona.id, (p) => ({ ...p, accounts: [...p.accounts, { id, platform, handle: h, url: profileUrl(platform, h) }] }));
    setHandle("");
    setAdding(null);
    setSignIn(id);
  };

  /**
   * One login: syncing and auto-post together. If the platform's developer
   * app isn't set up yet, the setup guide opens instead of a dead end.
   */
  const connect = (platform: SocialPlatform, opts: { replace?: string } = {}) => {
    if (!isConnectable(platform)) return;
    if (!status?.platforms[platform].configured) return openSetup(platform);
    const q = new URLSearchParams({ persona: persona.id, ...(opts.replace ? { replace: opts.replace } : {}) });
    window.location.href = `/api/social-personas/oauth/${platform}/start?${q}`;
  };

  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-[11px] font-medium uppercase tracking-wider text-ink-faint">Accounts</h3>
        <div className="ml-auto flex flex-wrap gap-1">
          {SOCIAL_PLATFORMS.map((p) => (
            <button
              key={p}
              onClick={() => {
                setAdding(adding === p ? null : p);
                setHandle("");
              }}
              aria-pressed={adding === p}
              className={"inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] transition " + (adding === p ? "border-brand text-ink" : "border-line text-ink-muted hover:bg-panel-2 hover:text-ink")}
            >
              <Icon.Plus width={10} height={10} />
              <PlatformDot platform={p} /> {PLATFORM_NAME[p]}
            </button>
          ))}
        </div>
      </div>

      {adding && (
        <div className="mb-2 rounded-lg border border-brand/40 bg-panel p-2">
          <div className="flex gap-1.5">
            <input
              autoFocus
              className={inputCls + " py-1 text-xs"}
              placeholder={`${PLATFORM_NAME[adding]} @username or profile link`}
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addHandle(adding)}
            />
            <Btn onClick={() => addHandle(adding)} disabled={!handleFrom(handle)}>
              Add
            </Btn>
            {isConnectable(adding) && (
              <Btn primary onClick={() => connect(adding)} title="Sign in with the platform: videos and stats sync in, and scheduled posts go out by themselves">
                {status?.platforms[adding as "tiktok"]?.configured ? `Sign in with ${PLATFORM_NAME[adding]}` : "Set up & connect"}
              </Btn>
            )}
          </div>
          <p className="mt-1.5 text-[11px] text-ink-faint">{NOTE[adding]}</p>
        </div>
      )}

      {persona.accounts.length === 0 && !adding ? (
        <p className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-xs text-ink-muted">No accounts yet. Add one above — its username and sign-in live here.</p>
      ) : (
        <div className="divide-y divide-line overflow-hidden rounded-lg border border-line">
          {persona.accounts.map((a) => (
            <div key={a.id} className="bg-canvas/30">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-2.5 py-2 text-xs">
                <PlatformDot platform={a.platform} />
                <span className="w-16 shrink-0 text-ink-faint">{PLATFORM_NAME[a.platform]}</span>
                <a href={a.url || undefined} target="_blank" rel="noreferrer" className="min-w-0 truncate font-medium text-ink hover:text-brand">
                  @{a.handle || "syncing…"}
                </a>
                {a.followers != null && <span className="text-ink-faint">{compact(a.followers)} followers</span>}
                <span className="ml-auto flex flex-wrap items-center gap-1">
                  <button
                    onClick={() => setSignIn(signIn === a.id ? null : a.id)}
                    className={"inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] " + (a.loginItemId ? "text-ink-muted hover:bg-panel-2 hover:text-ink" : "text-amber-300 hover:bg-amber-500/10")}
                    title="Username, email and password for this account"
                  >
                    <Icon.Key width={11} height={11} /> {a.loginItemId ? "Sign-in" : "Add sign-in"}
                  </button>
                  {a.connectionId ? (
                    <>
                      <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-400" title={a.lastSyncAt ? `Last sync ${new Date(a.lastSyncAt).toLocaleString()}` : ""}>
                        connected
                      </span>
                      {a.canPost ? (
                        <span className="rounded bg-brand/15 px-1.5 py-0.5 text-[10px] font-semibold text-brand" title="Scheduled posts go out on their own">
                          auto-post on
                        </span>
                      ) : (
                        <button
                          onClick={() => connect(a.platform, { replace: a.connectionId })}
                          className="rounded px-1.5 py-0.5 text-[11px] font-medium text-brand hover:bg-brand/10"
                          title={status && isConnectable(a.platform) ? `Auto-post is off. ${status.platforms[a.platform].postSetup} Then reconnect.` : "Reconnect to allow posting"}
                        >
                          Reconnect for auto-post
                        </button>
                      )}
                      <button
                        title="Sync posts now"
                        aria-label="Sync posts now"
                        disabled={busy === a.id}
                        onClick={async () => {
                          setBusy(a.id);
                          await syncAccount(persona.id, a.id);
                          setBusy(null);
                        }}
                        className="rounded p-1 text-ink-muted hover:bg-panel-2 hover:text-ink disabled:animate-spin"
                      >
                        <Icon.Refresh width={12} height={12} />
                      </button>
                    </>
                  ) : isConnectable(a.platform) ? (
                    <button onClick={() => connect(a.platform)} className="rounded-md bg-brand/15 px-2 py-0.5 text-[11px] font-semibold text-brand hover:bg-brand/25" title={NOTE[a.platform]}>
                      Connect
                    </button>
                  ) : (
                    <span className="rounded bg-panel-2 px-1.5 py-0.5 text-[10px] text-ink-faint" title={NOTE[a.platform]}>
                      reminders
                    </span>
                  )}
                  <RemoveAccount
                    onRemove={() => {
                      if (a.connectionId) void api.disconnect(a.connectionId);
                      mutate(persona.id, (p) => ({ ...p, accounts: p.accounts.filter((x) => x.id !== a.id), drafts: p.drafts.map((d) => ({ ...d, accountIds: d.accountIds.filter((id) => id !== a.id) })) }));
                    }}
                  />
                </span>
              </div>
              {signIn === a.id && <SignIn persona={persona} account={a} vault={vault} mutate={mutate} flash={flash} onClose={() => setSignIn(null)} />}
            </div>
          ))}
        </div>
      )}

      {persona.accounts.some((a) => a.connectionId) && (
        <Btn
          className="mt-2"
          disabled={busy === "all"}
          onClick={async () => {
            setBusy("all");
            for (const a of persona.accounts) if (a.connectionId) await syncAccount(persona.id, a.id);
            setBusy(null);
          }}
        >
          <Icon.Refresh width={12} height={12} /> {busy === "all" ? "Syncing…" : "Sync all now"}
        </Btn>
      )}
    </section>
  );
}

function RemoveAccount({ onRemove }: { onRemove: () => void }) {
  const [sure, setSure] = useState(false);
  if (sure) {
    return (
      <span className="inline-flex items-center gap-1">
        <button onClick={onRemove} className="rounded px-1.5 py-0.5 text-[11px] font-semibold text-rose-400 hover:bg-rose-500/10">
          Remove
        </button>
        <button onClick={() => setSure(false)} className="rounded px-1.5 py-0.5 text-[11px] text-ink-faint hover:text-ink">
          Keep
        </button>
      </span>
    );
  }
  return (
    <button title="Remove account" aria-label="Remove account" onClick={() => setSure(true)} className="rounded p-1 text-ink-faint hover:bg-panel-2 hover:text-rose-400">
      <Icon.Trash width={12} height={12} />
    </button>
  );
}

// --- sign-in ---------------------------------------------------------------------

function SignIn({
  persona,
  account,
  vault,
  mutate,
  flash,
  onClose,
}: {
  persona: Persona;
  account: Account;
  vault: UsePasswordVault;
  mutate: Mutate;
  flash: (t: string, bad?: boolean) => void;
  onClose: () => void;
}) {
  const item = account.loginItemId ? getData().items.find((i) => i.id === account.loginItemId) : undefined;
  const [username, setUsername] = useState(item?.fields?.username ?? account.handle);
  const [email, setEmail] = useState(item?.fields?.email ?? "");
  const [password, setPassword] = useState("");
  const [twofa, setTwofa] = useState(item?.fields?.twofa ?? "");
  const [notes, setNotes] = useState(item?.fields?.notes ?? "");
  const [show, setShow] = useState(false);
  const [unlockPw, setUnlockPw] = useState("");
  const sealed = Boolean(item && vault.blob.secrets[item.id]);
  const plain = Boolean(item?.password);

  const save = async () => {
    const fields: Record<string, string> = { username: username.trim(), email: email.trim(), url: account.url, twofa: twofa.trim(), notes: notes.trim() };
    let id = item?.id;
    if (item) {
      updateItem(item.id, { title: `${PLATFORM_NAME[account.platform]} · @${account.handle}` });
      setItemFields(item.id, fields);
    } else {
      const { folderId } = ensureFolderPath(["Personas Studio", persona.name]);
      id = createItem({
        title: `${PLATFORM_NAME[account.platform]} · @${account.handle}`,
        body: "",
        summary: fields.username || fields.email || "Saved login",
        kind: "credential",
        source: "manual",
        folderId,
        tags: ["personas-studio", account.platform],
        fields,
        url: account.url || null,
      }).item.id;
      mutate(persona.id, (p) => ({ ...p, accounts: p.accounts.map((a) => (a.id === account.id ? { ...a, loginItemId: id } : a)) }));
    }
    if (password && id) {
      // Seal it when the vault is open; otherwise keep it on the login, as
      // every saved password is until the vault is set up.
      if (vault.unlocked && vault.state === "ready" && (await vault.put(id, password))) setItemPassword(id, null);
      else setItemPassword(id, password);
    }
    setPassword("");
    flash("Sign-in saved.");
    onClose();
  };

  const copyPassword = async () => {
    if (!item) return;
    const secret = sealed ? await vault.reveal(item.id) : item.password;
    if (!secret) return flash("Unlock your vault first.", true);
    await copyEphemeral(secret);
    flash("Password copied — it clears from the clipboard in 30 seconds.");
  };

  return (
    <div className="border-t border-line bg-panel/60 px-2.5 py-2.5">
      <div className="grid gap-1.5 sm:grid-cols-2">
        <Labelled label="Username">
          <input className={inputCls + " py-1 font-mono text-xs"} value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" />
        </Labelled>
        <Labelled label="Login email / phone">
          <input className={inputCls + " py-1 font-mono text-xs"} value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
        </Labelled>
        <Labelled label={item && (sealed || plain) ? "New password (leave blank to keep)" : "Password"}>
          <div className="flex gap-1">
            <input className={inputCls + " py-1 font-mono text-xs"} type={show ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
            <button type="button" onClick={() => setShow(!show)} className="rounded-md border border-line px-1.5 text-ink-muted hover:text-ink" aria-label={show ? "Hide password" : "Show password"}>
              {show ? <Icon.EyeOff width={12} height={12} /> : <Icon.Eye width={12} height={12} />}
            </button>
          </div>
        </Labelled>
        <Labelled label="2FA">
          <input className={inputCls + " py-1 text-xs"} value={twofa} onChange={(e) => setTwofa(e.target.value)} placeholder="Authenticator / SMS / none" />
        </Labelled>
        <Labelled label="Notes" wide>
          <input className={inputCls + " py-1 text-xs"} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Recovery email, birthday used, who has access…" />
        </Labelled>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
        <Btn primary onClick={() => void save()}>
          <Icon.Check width={12} height={12} /> Save sign-in
        </Btn>
        {item && (sealed || plain) && (
          <Btn onClick={() => void copyPassword()} disabled={sealed && !vault.unlocked}>
            <Icon.Copy width={12} height={12} /> Copy password
          </Btn>
        )}
        <Btn onClick={onClose}>Close</Btn>
        <span className="ml-auto inline-flex items-center gap-1 text-ink-faint">
          <Icon.Lock width={11} height={11} />
          {sealed
            ? "Encrypted in your vault"
            : vault.state === "ready"
              ? vault.unlocked
                ? "Will be encrypted in your vault"
                : "Vault locked — unlock to encrypt"
              : "Saved in Passwords. Turn on the vault in Jarvis › Passwords to encrypt it."}
        </span>
      </div>
      {vault.state === "ready" && !vault.unlocked && (password || sealed) && (
        <div className="mt-2 flex gap-1.5">
          <input className={inputCls + " py-1 text-xs"} type="password" placeholder="Vault master password" value={unlockPw} onChange={(e) => setUnlockPw(e.target.value)} />
          <Btn
            onClick={async () => {
              if (await vault.unlock(unlockPw)) setUnlockPw("");
              else flash("That isn't the vault password.", true);
            }}
          >
            <Icon.Unlock width={12} height={12} /> Unlock
          </Btn>
        </div>
      )}
    </div>
  );
}

function Labelled({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <label className={"block " + (wide ? "sm:col-span-2" : "")}>
      <span className="mb-0.5 block text-[10px] uppercase tracking-wider text-ink-faint">{label}</span>
      {children}
    </label>
  );
}
