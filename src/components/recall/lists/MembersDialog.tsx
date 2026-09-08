"use client";

import { useEffect, useState } from "react";
import { Icon } from "../../icons";
import { Avatar } from "./bits";
import { inviteUrl, listsApi } from "@/lib/recall/lists/client";
import {
  MEMBER_COLOURS,
  type BoardPayload,
  type PublicMember,
} from "@/lib/recall/lists/types";

// ---------------------------------------------------------------------------
// Who is on the board.
//
// Everyone can edit their own name and colour here. Only the admin sees the
// invite link, the pending invites, and the remove buttons — and the server
// checks again, so this is presentation, not enforcement.
// ---------------------------------------------------------------------------

interface Props {
  board: BoardPayload;
  onBoard: (board: BoardPayload) => void;
  onToast: (message: string) => void;
  onClose: () => void;
}

export function MembersDialog({ board, onBoard, onToast, onClose }: Props) {
  const { me, isAdmin, members, invites } = board;
  const [name, setName] = useState(me.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [gated, setGated] = useState<boolean | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (!isAdmin) return;
    fetch("/api/recall-unlock")
      .then((r) => r.json())
      .then((d: { gated?: boolean }) => setGated(Boolean(d.gated)))
      .catch(() => setGated(null));
  }, [isAdmin]);

  const taken = new Set(members.filter((m) => m.id !== me.id).map((m) => m.colour));

  async function run(fn: () => Promise<BoardPayload>, message?: string) {
    setBusy(true);
    setError(null);
    try {
      onBoard(await fn());
      if (message) onToast(message);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  async function createInvite() {
    setBusy(true);
    setError(null);
    try {
      const res = await listsApi.invite();
      onBoard(res.board);
      setLink(inviteUrl(res.token));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create a link.");
    } finally {
      setBusy(false);
    }
  }

  /**
   * Two questions, not one: removing someone and deleting what they wrote are
   * different decisions, and defaulting the second to "keep" means a mis-click
   * cannot wipe a shopping list.
   */
  function removeMember(m: PublicMember) {
    if (!window.confirm(`Remove ${m.name}? They will be signed out everywhere.`)) return;
    const mine = board.items.filter((i) => i.authorId === m.id).length;
    const purge =
      mine > 0 &&
      window.confirm(
        `Also delete the ${mine} ${mine === 1 ? "item" : "items"} ${m.name} added?\n\n` +
          `OK — delete them.\nCancel — keep them on the board.`,
      );
    void run(() => listsApi.removeMember(m.id, purge), `${m.name} removed`);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-t-2xl border border-line bg-panel p-4 shadow-2xl sm:rounded-2xl"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">Family</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-ink-faint hover:bg-panel-2 hover:text-ink"
          >
            <Icon.Close width={14} height={14} />
          </button>
        </div>

        {/* Your own profile — everyone gets this much */}
        <section className="mb-4 rounded-xl border border-line bg-canvas p-3">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
            You
          </p>
          <div className="mb-2.5 flex items-center gap-2">
            <Avatar member={{ ...me, name }} size={30} />
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => {
                if (name.trim() && name.trim() !== me.name) {
                  void run(() => listsApi.updateMember(me.id, { name: name.trim() }));
                }
              }}
              aria-label="Your name"
              className="min-w-0 flex-1 rounded-lg border border-line bg-panel px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/25"
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {MEMBER_COLOURS.map((c) => {
              const used = taken.has(c.id);
              return (
                <button
                  key={c.id}
                  disabled={used || busy}
                  onClick={() => void run(() => listsApi.updateMember(me.id, { colour: c.id }))}
                  title={used ? `${c.label} — taken` : c.label}
                  aria-label={`Use ${c.label}`}
                  className={
                    "h-6 w-6 rounded-full transition " + c.dot +
                    (me.colour === c.id ? " ring-2 ring-ink ring-offset-2 ring-offset-canvas" : "") +
                    (used ? " cursor-not-allowed opacity-25" : " hover:brightness-125")
                  }
                />
              );
            })}
          </div>
        </section>

        {isAdmin && (
          <>
            {gated === false && (
              <p className="mb-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-2.5 text-[11px] leading-relaxed text-amber-200">
                Dashboard has no app password set, so anyone who opens it is treated as the admin.
                Set one in Security (the shield icon) before inviting anyone — until then, the
                member rules below do not hold.
              </p>
            )}

            <section className="mb-4">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
                Members
              </p>
              {members.filter((m) => m.id !== me.id).length === 0 ? (
                <p className="rounded-xl border border-dashed border-line px-3 py-3 text-[11.5px] leading-relaxed text-ink-faint">
                  Nobody else yet. Send someone an invite link and they pick a name, a colour and
                  their own password — once, then they are in for good.
                </p>
              ) : (
                <ul className="space-y-1">
                  {members
                    .filter((m) => m.id !== me.id)
                    .map((m) => (
                      <li
                        key={m.id}
                        className="flex items-center gap-2 rounded-lg border border-line bg-canvas px-2.5 py-1.5"
                      >
                        <Avatar member={m} size={22} />
                        <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{m.name}</span>
                        <span className="text-[10px] tabular-nums text-ink-faint">
                          {board.items.filter((i) => i.authorId === m.id).length} items
                        </span>
                        <button
                          onClick={() => removeMember(m)}
                          disabled={busy}
                          title={`Remove ${m.name}`}
                          aria-label={`Remove ${m.name}`}
                          className="rounded p-1 text-ink-faint transition hover:text-red-400"
                        >
                          <Icon.Trash width={13} height={13} />
                        </button>
                      </li>
                    ))}
                </ul>
              )}
            </section>

            <section className="mb-1">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
                Invite
              </p>

              {link && (
                <div className="mb-2 rounded-xl border border-brand/40 bg-brand/10 p-2.5">
                  <p className="mb-1.5 text-[11px] text-ink-muted">
                    Send this to one person. It works once and expires in 7 days.
                  </p>
                  <div className="flex gap-1.5">
                    <input
                      readOnly
                      value={link}
                      onFocus={(e) => e.currentTarget.select()}
                      aria-label="Invite link"
                      className="min-w-0 flex-1 rounded-lg border border-line bg-canvas px-2 py-1.5 text-[11px] text-ink outline-none"
                    />
                    <button
                      onClick={() => {
                        void navigator.clipboard
                          .writeText(link)
                          .then(() => onToast("Link copied"))
                          .catch(() => onToast("Copy failed — select it instead"));
                      }}
                      className="shrink-0 rounded-lg bg-brand px-2.5 text-[11px] font-semibold text-white hover:bg-brand-2"
                    >
                      Copy
                    </button>
                  </div>
                </div>
              )}

              {invites.length > 0 && (
                <ul className="mb-2 space-y-1">
                  {invites.map((v) => (
                    <li
                      key={v.token}
                      className="flex items-center gap-2 rounded-lg border border-line bg-canvas px-2.5 py-1.5"
                    >
                      <Icon.Clock width={12} height={12} className="shrink-0 text-ink-faint" />
                      <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink-muted">
                        Unused link · expires {new Date(v.expiresAt).toLocaleDateString()}
                      </span>
                      <button
                        onClick={() => void run(() => listsApi.revokeInvite(v.token), "Link revoked")}
                        disabled={busy}
                        title="Revoke this link"
                        aria-label="Revoke this link"
                        className="rounded p-1 text-ink-faint transition hover:text-red-400"
                      >
                        <Icon.Close width={12} height={12} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <button
                onClick={() => void createInvite()}
                disabled={busy}
                className="w-full rounded-xl border border-line px-4 py-2.5 text-[13px] font-semibold text-ink transition hover:border-brand/50 hover:text-brand disabled:opacity-50"
              >
                {busy ? "Working…" : "Create an invite link"}
              </button>
            </section>
          </>
        )}

        {error && <p className="mt-3 text-xs text-red-400">{error}</p>}
      </div>
    </div>
  );
}
