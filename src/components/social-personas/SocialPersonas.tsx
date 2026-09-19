"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "../icons";
import { useRemotePull } from "@/lib/sync/useSync";
import { KEY, loadBoard, removePersona, saveBoard, upsertPersona } from "@/lib/social-personas/store";
import { mergePosts, uid } from "@/lib/social-personas/logic";
import { PLATFORM_NAME, type Board, type Persona, type SocialPlatform } from "@/lib/social-personas/types";
import { api, type Status } from "./api";
import { PersonaGrid } from "./PersonaGrid";
import { PersonaForm } from "./PersonaForm";
import { Workspace } from "./Workspace";

export type Mutate = (id: string, fn: (p: Persona) => Persona) => void;

export function SocialPersonas() {
  const [board, setBoard] = useState<Board>({ version: 1, personas: [] });
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [form, setForm] = useState<{ persona?: Persona } | null>(null);
  const [toast, setToast] = useState<{ text: string; bad?: boolean } | null>(null);
  const boardRef = useRef(board);
  boardRef.current = board;

  useEffect(() => {
    setBoard(loadBoard());
    setLoaded(true);
    void api.status().then((r) => r.ok && setStatus(r.data));
  }, []);
  useRemotePull(KEY, () => setBoard(loadBoard()));

  const commit = useCallback((next: Board) => {
    boardRef.current = next;
    setBoard(next);
    saveBoard(next);
  }, []);

  const mutate: Mutate = useCallback(
    (id, fn) => {
      const p = boardRef.current.personas.find((x) => x.id === id);
      if (p) commit(upsertPersona(boardRef.current, fn(p)));
    },
    [commit],
  );

  const flash = useCallback((text: string, bad = false) => {
    setToast({ text, bad });
    window.setTimeout(() => setToast(null), 5000);
  }, []);

  /** Pull an account's posts through its stored login, then refresh the brain. */
  const syncAccount = useCallback(
    async (personaId: string, accountId: string) => {
      const acc = boardRef.current.personas.find((p) => p.id === personaId)?.accounts.find((a) => a.id === accountId);
      if (!acc?.connectionId) return;
      const r = await api.sync(acc.connectionId);
      if (!r.ok) {
        flash(`${PLATFORM_NAME[acc.platform]}: ${r.error}`, true);
        if (r.extra?.reconnect) mutate(personaId, (p) => ({ ...p, accounts: p.accounts.map((a) => (a.id === accountId ? { ...a, connectionId: undefined } : a)) }));
        return;
      }
      const d = r.data;
      mutate(personaId, (p) => ({
        ...p,
        accounts: p.accounts.map((a) =>
          a.id === accountId
            ? { ...a, handle: d.handle || a.handle, url: d.url || a.url, displayName: d.displayName, followers: d.followers, lastSyncAt: new Date().toISOString() }
            : a,
        ),
        posts: mergePosts(p.posts, d.posts),
      }));
      flash(`${PLATFORM_NAME[acc.platform]} synced — ${d.posts.length} posts read.`);
      const fresh = boardRef.current.personas.find((p) => p.id === personaId);
      if (fresh) {
        const b = await api.brain(fresh);
        if (b.ok) mutate(personaId, (p) => ({ ...p, brain: b.data.brain }));
      }
    },
    [flash, mutate],
  );

  // Back from a platform login: attach the connection and run the first sync.
  useEffect(() => {
    if (!loaded) return;
    const q = new URLSearchParams(window.location.search);
    const personaId = q.get("persona");
    const connected = q.get("connected");
    const platform = q.get("platform") as SocialPlatform | null;
    const oauthError = q.get("oauthError");
    if (personaId && boardRef.current.personas.some((p) => p.id === personaId)) setOpenId(personaId);
    if (oauthError) {
      flash(oauthError.startsWith("not-configured:") ? "That platform's login isn't set up yet — see Accounts for the keys it needs." : `Connect failed: ${oauthError}`, true);
    }
    if (personaId && connected && platform) {
      const accId = uid("a_");
      mutate(personaId, (p) => {
        const existing = p.accounts.find((a) => a.platform === platform && !a.connectionId);
        const accounts = existing
          ? p.accounts.map((a) => (a === existing ? { ...a, id: accId, connectionId: connected } : a))
          : [...p.accounts, { id: accId, platform, handle: "", url: "", connectionId: connected }];
        return { ...p, accounts };
      });
      void syncAccount(personaId, accId);
    }
    if (personaId || oauthError || connected) window.history.replaceState(null, "", window.location.pathname);
  }, [loaded, flash, mutate, syncAccount]);

  const open = board.personas.find((p) => p.id === openId) ?? null;

  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <div className="flex items-center gap-2 border-b border-line bg-panel px-3 py-2.5 sm:px-4">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-ink-muted transition hover:bg-panel-2 hover:text-ink"
          aria-label="Back to hub"
        >
          <Icon.ArrowLeft width={14} height={14} />
          <span className="hidden sm:inline">Hub</span>
        </Link>
        <button onClick={() => setOpenId(null)} className="ml-1 text-sm font-semibold text-ink hover:text-brand">
          Social Personas
        </button>
        {open && (
          <>
            <span className="text-ink-faint">/</span>
            <span className="truncate text-sm text-ink-muted">{open.name}</span>
          </>
        )}
        <span className="ml-auto flex items-center gap-2 text-[11px] text-ink-faint">
          {status && (
            <span className={"rounded-full border px-2 py-0.5 " + (status.ai ? "border-emerald-500/40 text-emerald-400" : "border-amber-500/40 text-amber-400")}>
              {status.ai ? "AI on" : "AI off — offline ideas"}
            </span>
          )}
        </span>
      </div>

      {open ? (
        <Workspace
          key={open.id}
          persona={open}
          status={status}
          mutate={mutate}
          flash={flash}
          syncAccount={syncAccount}
          onEdit={() => setForm({ persona: open })}
          onDelete={() => {
            for (const a of open.accounts) if (a.connectionId) void api.disconnect(a.connectionId);
            commit(removePersona(boardRef.current, open.id));
            setOpenId(null);
          }}
        />
      ) : (
        <PersonaGrid personas={board.personas} loaded={loaded} onOpen={setOpenId} onNew={() => setForm({})} />
      )}

      {form && (
        <PersonaForm
          initial={form.persona}
          onClose={() => setForm(null)}
          onSave={(p) => {
            commit(upsertPersona(boardRef.current, p));
            setForm(null);
            setOpenId(p.id);
          }}
        />
      )}

      {toast && (
        <div
          role="status"
          className={
            "fixed bottom-4 left-1/2 z-[1000] max-w-[92vw] -translate-x-1/2 rounded-xl border px-4 py-2.5 text-sm shadow-2xl " +
            (toast.bad ? "border-rose-500/40 bg-panel text-rose-300" : "border-line bg-panel text-ink")
          }
        >
          {toast.text}
        </div>
      )}
    </div>
  );
}
