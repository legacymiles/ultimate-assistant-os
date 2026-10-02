"use client";

// ---------------------------------------------------------------------------
// One password manager, for every login in every folder.
//
// This surface leads with what is TRUE rather than with a lock icon. Before it
// is set up the headline says the saved passwords are readable, because they
// are — reassuring chrome in front of something that protects nothing is a lie,
// and this is the one screen where that matters.
//
// The recovery key is a PRECONDITION, not a dialog. "Encrypt my passwords" is
// visibly disabled with its reason attached until the key has been exported,
// and the count still in the clear stays on screen. This repo already retired
// an encrypted vault because forgetting the master password lost every login;
// a dismissible modal would repeat it.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useState } from "react";
import { Icon } from "../icons";
import { copyEphemeral } from "@/lib/recall/clipboard";
import { usePasswordVault } from "@/lib/passwords/usePasswordVault";
import { recoverySheet } from "@/lib/passwords/vault";

/** A revealed password hides itself again, rather than sitting on screen all afternoon. */
const REVEAL_MS = 20_000;

export function PasswordVault() {
  const vault = usePasswordVault();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [recoveryInput, setRecoveryInput] = useState("");
  const [mode, setMode] = useState<"password" | "recovery">("password");
  const [shown, setShown] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState("");
  const [moved, setMoved] = useState<number | null>(null);

  // Nothing stays revealed. A secret on screen is a secret in a screenshot, a
  // screen share and whatever is behind you.
  useEffect(() => {
    if (!Object.keys(shown).length) return;
    const t = setTimeout(() => setShown({}), REVEAL_MS);
    return () => clearTimeout(t);
  }, [shown]);

  useEffect(() => {
    if (!vault.unlocked) setShown({});
  }, [vault.unlocked]);

  const reveal = useCallback(
    async (id: string) => {
      if (shown[id]) {
        setShown((s) => {
          const { [id]: _gone, ...rest } = s;
          return rest;
        });
        return;
      }
      const secret = await vault.reveal(id);
      if (secret !== null) setShown((s) => ({ ...s, [id]: secret }));
    },
    [shown, vault],
  );

  const copy = useCallback(
    async (id: string) => {
      const secret = shown[id] ?? (await vault.reveal(id));
      if (secret === null) return;
      await copyEphemeral(secret);
      setCopied(id);
      setTimeout(() => setCopied(""), 2500);
    },
    [shown, vault],
  );

  const saveSheet = useCallback(() => {
    if (!vault.freshRecoveryKey) return;
    const blob = new Blob([recoverySheet(vault.freshRecoveryKey)], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "jarvis-vault-recovery-key.txt";
    a.click();
    URL.revokeObjectURL(url);
  }, [vault.freshRecoveryKey]);

  const head = (
    <header className="border-b border-line-soft px-3 py-2.5">
      <div className="flex items-center gap-2">
        <Icon.Key width={13} height={13} className="text-ink-muted" aria-hidden />
        <h2 className="text-[11px] uppercase tracking-[0.14em] text-ink-faint">Passwords</h2>
        {vault.unlocked && (
          <button
            type="button"
            onClick={vault.lock}
            className="ml-auto rounded border border-line px-1.5 py-0.5 text-[10px] text-ink-muted transition hover:bg-panel-2 hover:text-ink"
          >
            Lock
          </button>
        )}
      </div>
      <p className="mt-1 text-[11.5px] leading-relaxed text-ink-muted">{vault.summary}</p>
      {vault.error && <p className="mt-1.5 text-[11px] leading-relaxed text-amber-300">{vault.error}</p>}
      {vault.busy && <p className="mt-1.5 text-[11px] text-ink-faint">{vault.busy}</p>}
    </header>
  );

  // --- the recovery key, shown exactly once -------------------------------

  if (vault.freshRecoveryKey) {
    return (
      <section className="rounded-md border border-line bg-panel">
        {head}
        <div className="space-y-3 p-3">
          <div>
            <h3 className="text-[12.5px] font-semibold text-ink">Write this down before anything goes in.</h3>
            <p className="mt-1 text-[11.5px] leading-relaxed text-ink-muted">
              It opens the vault on its own if you forget the master password. Nobody holds a copy — not this app, not
              Supabase, not me. That is the point of it being encrypted, and it is why this screen will not let you past
              until you have it.
            </p>
          </div>

          {/* Tracked and large, because it gets read off a screen onto paper. */}
          <p className="select-all break-all rounded-md border border-line bg-canvas px-3 py-2.5 text-center font-mono text-[15px] leading-relaxed tracking-[0.12em] text-ink">
            {vault.freshRecoveryKey}
          </p>

          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={saveSheet}
              className="inline-flex items-center gap-1.5 rounded border border-line bg-panel-2 px-2 py-1 text-[11px] text-ink transition hover:border-ink-faint hover:bg-elevated"
            >
              <Icon.Download width={10} height={10} aria-hidden />
              Save it as a file
            </button>
            <button
              type="button"
              onClick={() => void copyEphemeral(vault.freshRecoveryKey ?? "")}
              className="rounded border border-line px-2 py-1 text-[11px] text-ink-muted transition hover:bg-panel-2 hover:text-ink"
            >
              Copy
            </button>
          </div>

          <p className="text-[10.5px] leading-relaxed text-ink-faint">
            Put it somewhere that is not this computer. Printed, in a drawer, is a perfectly good answer — a photo in
            your camera roll is not, because that syncs to the same places everything else does.
          </p>

          <button
            type="button"
            onClick={vault.confirmExported}
            className="w-full rounded-md border border-line bg-brand px-2.5 py-2 text-[11.5px] font-medium text-white transition hover:bg-[var(--nj-brand-press)]"
          >
            I have written it down
          </button>
        </div>
      </section>
    );
  }

  // --- not set up ----------------------------------------------------------

  if (vault.state === "empty") {
    const tooShort = password.length > 0 && password.length < 10;
    const mismatch = confirm.length > 0 && password !== confirm;
    return (
      <section className="rounded-md border border-line bg-panel">
        {head}
        <div className="space-y-2.5 p-3">
          <p className="text-[11.5px] leading-relaxed text-ink-muted">
            Encrypting them in this browser means your Supabase row — and any backup of it — holds ciphertext instead of
            passwords. It does not stop anything running on this page while the vault is open; nothing can.
          </p>

          <label className="block">
            <span className="text-[10px] uppercase tracking-[0.12em] text-ink-faint">Master password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              className="mt-1 w-full rounded border border-line bg-panel-2 px-2 py-1.5 font-mono text-[12px] text-ink focus:border-ink-faint focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="text-[10px] uppercase tracking-[0.12em] text-ink-faint">Again</span>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              className="mt-1 w-full rounded border border-line bg-panel-2 px-2 py-1.5 font-mono text-[12px] text-ink focus:border-ink-faint focus:outline-none"
            />
          </label>

          {tooShort && <p className="text-[10.5px] text-amber-300">Ten characters at least. A short one is the weak link in all of this.</p>}
          {mismatch && <p className="text-[10.5px] text-amber-300">Those two do not match.</p>}

          <button
            type="button"
            disabled={password.length < 10 || password !== confirm || Boolean(vault.busy)}
            onClick={() => void vault.create(password)}
            className="w-full rounded-md border border-line bg-brand px-2.5 py-2 text-[11.5px] font-medium text-white transition hover:bg-[var(--nj-brand-press)] disabled:opacity-50"
          >
            Make the vault
          </button>
          <p className="text-[10.5px] leading-relaxed text-ink-faint">
            You will be given a recovery key next, and nothing can go in until you have written it down.
          </p>
        </div>
      </section>
    );
  }

  // --- locked --------------------------------------------------------------

  if (!vault.unlocked) {
    return (
      <section className="rounded-md border border-line bg-panel">
        {head}
        <div className="space-y-2.5 p-3">
          <div className="flex gap-0.5">
            {(["password", "recovery"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                aria-pressed={mode === m}
                className={`rounded px-2 py-1 text-[11px] transition ${
                  mode === m ? "bg-elevated text-ink" : "text-ink-muted hover:bg-panel-2 hover:text-ink"
                }`}
              >
                {m === "password" ? "Master password" : "Recovery key"}
              </button>
            ))}
          </div>

          {mode === "password" ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void vault.unlock(password).then((ok) => ok && setPassword(""));
              }}
            >
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                placeholder="Master password"
                className="w-full rounded border border-line bg-panel-2 px-2 py-1.5 font-mono text-[12px] text-ink placeholder:text-ink-faint focus:border-ink-faint focus:outline-none"
              />
              <button
                type="submit"
                disabled={!password || Boolean(vault.busy)}
                className="mt-2 w-full rounded-md border border-line bg-brand px-2.5 py-2 text-[11.5px] font-medium text-white transition hover:bg-[var(--nj-brand-press)] disabled:opacity-50"
              >
                Unlock
              </button>
            </form>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void vault.recover(recoveryInput).then((ok) => ok && setRecoveryInput(""));
              }}
            >
              <input
                value={recoveryInput}
                onChange={(e) => setRecoveryInput(e.target.value)}
                placeholder="ABCDE-FGHJK-…"
                className="w-full rounded border border-line bg-panel-2 px-2 py-1.5 font-mono text-[12px] tracking-wider text-ink placeholder:text-ink-faint focus:border-ink-faint focus:outline-none"
              />
              <button
                type="submit"
                disabled={!recoveryInput.trim() || Boolean(vault.busy)}
                className="mt-2 w-full rounded-md border border-line bg-panel-2 px-2.5 py-2 text-[11.5px] text-ink transition hover:border-ink-faint hover:bg-elevated disabled:opacity-50"
              >
                Open with the recovery key
              </button>
              <p className="mt-1.5 text-[10.5px] leading-relaxed text-ink-faint">
                Case, spaces and dashes do not matter. Set a new master password once you are in.
              </p>
            </form>
          )}
        </div>
      </section>
    );
  }

  // --- open ---------------------------------------------------------------

  const gateShut = vault.state !== "ready";

  return (
    <section className="rounded-md border border-line bg-panel">
      {head}

      {/* The gate, visible rather than modal. */}
      {(vault.plan.toSeal.length > 0 || gateShut) && (
        <div className="border-b border-line-soft px-3 py-2.5">
          <p className="text-[11.5px] leading-relaxed text-ink">
            {gateShut
              ? "Nothing can be encrypted until the recovery key is written down."
              : `${vault.plan.toSeal.length} ${vault.plan.toSeal.length === 1 ? "password is" : "passwords are"} still stored in the clear.`}
          </p>
          <button
            type="button"
            disabled={gateShut || vault.plan.toSeal.length === 0 || Boolean(vault.busy)}
            onClick={() => void vault.migrate().then(setMoved)}
            title={gateShut ? "Write down the recovery key first" : undefined}
            className="mt-2 rounded-md border border-line bg-brand px-2.5 py-1.5 text-[11.5px] font-medium text-white transition hover:bg-[var(--nj-brand-press)] disabled:opacity-50"
          >
            Encrypt {vault.plan.toSeal.length || ""} and clear the readable copies
          </button>
          {moved !== null && (
            <p className="mt-1.5 text-[10.5px] text-core">
              {moved} encrypted. The readable copies are gone from your synced data.
            </p>
          )}
          {vault.plan.stranded.length > 0 && (
            <p className="mt-1.5 text-[10.5px] leading-relaxed text-ink-faint">
              {vault.plan.stranded.length} {vault.plan.stranded.length === 1 ? "login is" : "logins are"} still sealed
              under the retired master password from the old vault. This one cannot open those — import them from
              Settings first.
            </p>
          )}
        </div>
      )}

      {vault.logins.length === 0 ? (
        <p className="px-3 py-3 text-[11.5px] leading-relaxed text-ink-muted">
          No saved logins yet. Add them in Folders — a credential in any folder shows up here.
        </p>
      ) : (
        <ul className="divide-y divide-line-soft">
          {vault.logins.map((login) => (
            <li key={login.id} className="flex items-center gap-2 px-3 py-2">
              <span
                className={`size-1.5 shrink-0 rounded-full ${login.sealed ? "bg-core" : "bg-amber-400"}`}
                title={login.sealed ? "Encrypted" : "Stored in the clear"}
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[11.5px] text-ink">{login.title}</p>
                {shown[login.id] && (
                  <p className="mt-0.5 break-all font-mono text-[11.5px] text-core">{shown[login.id]}</p>
                )}
              </div>

              {login.sealed && (
                <>
                  <button
                    type="button"
                    onClick={() => void reveal(login.id)}
                    aria-label={shown[login.id] ? `Hide ${login.title}` : `Show ${login.title}`}
                    className="shrink-0 rounded p-1 text-ink-faint transition hover:text-ink"
                  >
                    {shown[login.id] ? <Icon.EyeOff width={11} height={11} /> : <Icon.Eye width={11} height={11} />}
                  </button>
                  <button
                    type="button"
                    onClick={() => void copy(login.id)}
                    aria-label={`Copy ${login.title}`}
                    className="shrink-0 rounded p-1 text-ink-faint transition hover:text-ink"
                  >
                    {copied === login.id ? <Icon.Check width={11} height={11} /> : <Icon.Copy width={11} height={11} />}
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      <footer className="space-y-1.5 border-t border-line-soft px-3 py-2.5">
        <p className="text-[10px] leading-relaxed text-ink-faint">
          A copied password clears from the clipboard after 30 seconds, and a revealed one hides itself after 20. The
          vault locks itself after 15 minutes without a click, and closing this tab locks it immediately — the key is
          only ever in memory.
        </p>
        <button
          type="button"
          onClick={() => void vault.newRecoveryKey()}
          className="text-[10.5px] text-ink-muted underline-offset-2 transition hover:text-ink hover:underline"
        >
          Issue a new recovery key
        </button>
      </footer>
    </section>
  );
}
