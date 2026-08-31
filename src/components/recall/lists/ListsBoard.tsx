"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "../../icons";
import { Avatar } from "./bits";
import { ListCard } from "./ListCard";
import { ItemDialog, type ItemDraft } from "./ItemDialog";
import { ListDialog } from "./ListDialog";
import { MemberFilter } from "./MemberFilter";
import { MembersDialog } from "./MembersDialog";
import { SUB_ACCENTS, accentsFor } from "@/lib/recall/accents";
import { ApiError, listsApi } from "@/lib/recall/lists/client";
import type { BoardPayload, ListDef, ListItem } from "@/lib/recall/lists/types";

// ---------------------------------------------------------------------------
// The Lists board.
//
// Every mutation round-trips and returns the whole board, so what you see is
// what the server actually holds. On a list two people are editing at once,
// that honesty is worth more than the few milliseconds an optimistic update
// would save.
//
// Rendered two ways:
//   · inside Recall, as the second home tab (admin) — `standalone` false
//   · on its own page (family members, who get nothing else) — `standalone` true
// ---------------------------------------------------------------------------

const FILTER_KEY = "recall:lists:filter";

interface Props {
  /** True when this is the whole page rather than a tab inside Recall. */
  standalone?: boolean;
}

export function ListsBoard({ standalone = false }: Props) {
  const [board, setBoard] = useState<BoardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const [filter, setFilter] = useState<string[]>([]);
  const [showHidden, setShowHidden] = useState(false);
  const [quickText, setQuickText] = useState("");
  const [quickList, setQuickList] = useState("todo");

  const [itemDialog, setItemDialog] = useState<{ item: ListItem | null; listId: string } | null>(null);
  const [listDialog, setListDialog] = useState<{ list: ListDef | null } | null>(null);
  const [membersOpen, setMembersOpen] = useState(false);

  // ----- loading ----------------------------------------------------------

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(FILTER_KEY);
      if (raw) setFilter(JSON.parse(raw) as string[]);
    } catch {
      /* a corrupt filter is not worth failing over — show everyone */
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(FILTER_KEY, JSON.stringify(filter));
    } catch {
      /* private mode — the filter just will not survive a reload */
    }
  }, [filter]);

  useEffect(() => {
    listsApi
      .load()
      .then(setBoard)
      .catch((err: unknown) => {
        // Signed out entirely: send them to the door rather than an empty board.
        if (err instanceof ApiError && err.status === 401) {
          window.location.href = "/recall-join";
          return;
        }
        setError(err instanceof Error ? err.message : "Could not load the board.");
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2400);
    return () => clearTimeout(t);
  }, [toast]);

  /** Run a mutation, swap in the returned board, and surface any refusal. */
  const run = useCallback(
    async (fn: () => Promise<BoardPayload>, message?: string) => {
      setBusy(true);
      setError(null);
      try {
        setBoard(await fn());
        if (message) setToast(message);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          window.location.href = "/recall-join";
          return;
        }
        // A 403 means the UI and the server disagree about what is allowed;
        // the server is right, so re-read rather than leaving a stale board.
        if (err instanceof ApiError && err.status === 403) {
          void listsApi.load().then(setBoard).catch(() => undefined);
        }
        setToast(err instanceof Error ? err.message : "Something went wrong.");
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  // ----- derived ----------------------------------------------------------

  const visibleLists = useMemo(
    () => (board?.lists ?? []).filter((l) => showHidden || !l.hidden),
    [board, showHidden],
  );

  const accents = useMemo(
    () => accentsFor(visibleLists.map((l) => l.id), SUB_ACCENTS),
    [visibleLists],
  );

  const filtered = useMemo(() => {
    if (!board) return [];
    return filter.length === 0
      ? board.items
      : board.items.filter((i) => filter.includes(i.authorId));
  }, [board, filter]);

  /** Open items per member, for the count on each filter chip. */
  const counts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const i of board?.items ?? []) {
      if (!i.done) out[i.authorId] = (out[i.authorId] ?? 0) + 1;
    }
    return out;
  }, [board]);

  useEffect(() => {
    if (visibleLists.length && !visibleLists.some((l) => l.id === quickList)) {
      setQuickList(visibleLists[0].id);
    }
  }, [visibleLists, quickList]);

  // ----- actions ----------------------------------------------------------

  const submitItem = (draft: ItemDraft) => {
    const payload = {
      listId: draft.listId,
      text: draft.text,
      priority: draft.priority,
      note: draft.note,
      dueDate: draft.dueDate,
      url: draft.url,
    };
    const existing = itemDialog?.item;
    setItemDialog(null);
    void run(
      () => (existing ? listsApi.updateItem(existing.id, payload) : listsApi.addItem(payload)),
      existing ? "Saved" : "Added",
    );
  };

  const submitList = (draft: { name: string; icon: string }) => {
    const existing = listDialog?.list;
    setListDialog(null);
    void run(
      () => (existing ? listsApi.updateList(existing.id, draft) : listsApi.createList(draft)),
      existing ? "List updated" : "List created",
    );
  };

  const deleteItem = (item: ListItem) => {
    if (!window.confirm(`Remove “${item.text}”?`)) return;
    void run(() => listsApi.deleteItem(item.id), "Removed");
  };

  async function signOut() {
    await listsApi.signOut().catch(() => undefined);
    window.location.href = "/recall-join";
  }

  // ----- render -----------------------------------------------------------

  if (loading) {
    return <p className="py-16 text-center text-sm text-ink-muted">Loading the board…</p>;
  }

  if (!board) {
    return (
      <div className="rounded-2xl border border-dashed border-line bg-panel/40 px-6 py-16 text-center">
        <p className="text-sm text-ink">{error ?? "The board is unavailable."}</p>
        <button
          onClick={() => window.location.reload()}
          className="mt-4 rounded-xl border border-line px-4 py-2 text-xs font-medium text-ink-muted hover:text-ink"
        >
          Try again
        </button>
      </div>
    );
  }

  const hiddenCount = board.lists.filter((l) => l.hidden).length;

  const body = (
    <>
      {!board.persistent && (
        <p className="mb-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-200">
          This host does not keep files between requests, so the board will reset. It works
          properly when Recall runs somewhere long-lived — your own machine or a VPS.
        </p>
      )}

      {/* Who is on the board */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <MemberFilter
          members={board.members}
          active={filter}
          onChange={setFilter}
          counts={counts}
          isAdmin={board.isAdmin}
          onManage={() => setMembersOpen(true)}
        />
        {/* Inside Recall the header carries no identity, so the chip does. On the
            standalone page the header already names you — a second chip beside
            your own filter chip just reads as two of you. */}
        {!standalone && (
          <button
            onClick={() => setMembersOpen(true)}
            title={`You are ${board.me.name}`}
            className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-line py-1 pl-1 pr-2.5 text-[11.5px] font-medium text-ink-muted transition hover:text-ink"
          >
            <Avatar member={board.me} size={18} />
            {board.me.name}
          </button>
        )}
      </div>

      {/* Quick add — anything into any list without navigating */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const text = quickText.trim();
          if (!text) return;
          setQuickText("");
          void run(() => listsApi.addItem({ listId: quickList, text }));
        }}
        className="mb-4 flex gap-1.5"
      >
        <div className="relative min-w-0 flex-1">
          <Icon.Plus
            width={14}
            height={14}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint"
          />
          <input
            value={quickText}
            onChange={(e) => setQuickText(e.target.value)}
            placeholder="Add something…"
            aria-label="Add something to a list"
            className="w-full rounded-xl border border-line bg-canvas py-2 pl-9 pr-3 text-[13px] text-ink outline-none placeholder:text-ink-faint focus:border-brand focus:ring-2 focus:ring-brand/25"
          />
        </div>
        <select
          value={quickList}
          onChange={(e) => setQuickList(e.target.value)}
          aria-label="Which list"
          className="shrink-0 rounded-xl border border-line bg-canvas px-2 py-2 text-[12px] text-ink-muted outline-none focus:border-brand"
        >
          {visibleLists.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={!quickText.trim()}
          title="Add it"
          className="shrink-0 rounded-xl bg-brand px-3 text-[12.5px] font-semibold text-white transition hover:bg-brand-2 disabled:opacity-40"
        >
          Add
        </button>
        <button
          type="button"
          onClick={() => setItemDialog({ item: null, listId: quickList })}
          title="Add with a priority, note, date or link"
          aria-label="Add with details"
          className="shrink-0 rounded-xl border border-line px-2.5 text-ink-muted transition hover:border-brand/50 hover:text-brand"
        >
          <Icon.Settings width={14} height={14} />
        </button>
      </form>

      {/* The card wall */}
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
        {visibleLists.map((list, i) => {
          const mine = filtered.filter((it) => it.listId === list.id);
          const total = board.items.filter((it) => it.listId === list.id).length;
          return (
            <ListCard
              key={list.id}
              list={list}
              items={mine}
              members={board.members}
              me={board.me}
              isAdmin={board.isAdmin}
              accent={accents[i]}
              hiddenByFilter={total - mine.length}
              onQuickAdd={(text) => void run(() => listsApi.addItem({ listId: list.id, text }))}
              onOpenAdd={() => setItemDialog({ item: null, listId: list.id })}
              onToggle={(item) =>
                void run(() => listsApi.updateItem(item.id, { done: !item.done }))
              }
              onEdit={(item) => setItemDialog({ item, listId: list.id })}
              onDelete={deleteItem}
              onClearDone={() => void run(() => listsApi.clearDone(list.id), "Cleared")}
              onEditList={() => setListDialog({ list })}
            />
          );
        })}

        {board.isAdmin && (
          <button
            onClick={() => setListDialog({ list: null })}
            className="flex min-h-[72px] flex-col items-center justify-center gap-1.5 rounded-2xl border border-dashed border-line text-ink-faint transition hover:border-brand/50 hover:text-brand"
          >
            <Icon.Plus width={18} height={18} />
            <span className="text-[11px] font-medium">New list</span>
          </button>
        )}
      </div>

      {board.isAdmin && hiddenCount > 0 && (
        <button
          onClick={() => setShowHidden((v) => !v)}
          className="mt-3 text-[11px] text-ink-faint transition hover:text-ink"
        >
          {showHidden ? "Hide" : "Show"} {hiddenCount} hidden{" "}
          {hiddenCount === 1 ? "list" : "lists"}
        </button>
      )}
    </>
  );

  return (
    <>
      {standalone ? (
        <div className="flex min-h-dvh flex-col">
          <header className="sticky top-0 z-30 border-b border-line bg-panel/95 backdrop-blur">
            <div className="mx-auto flex w-full max-w-5xl items-center gap-2 px-3 py-2.5 sm:px-5">
              <span className="flex items-center gap-1.5 text-sm font-semibold text-ink">
                <Icon.ListChecks width={16} height={16} className="text-brand" />
                Family lists
              </span>
              <button
                onClick={() => setMembersOpen(true)}
                title="Your name and colour"
                className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-line py-1 pl-1 pr-2.5 text-[11.5px] font-medium text-ink-muted transition hover:text-ink"
              >
                <Avatar member={board.me} size={18} />
                {board.me.name}
              </button>
              <button
                onClick={() => void signOut()}
                title="Sign out"
                aria-label="Sign out"
                className="rounded-lg border border-line p-1.5 text-ink-muted transition hover:border-red-500/40 hover:text-red-400"
              >
                <Icon.ArrowRight width={15} height={15} />
              </button>
            </div>
          </header>
          <main className="mx-auto w-full max-w-5xl flex-1 px-3 py-4 sm:px-5">{body}</main>
        </div>
      ) : (
        body
      )}

      {itemDialog && (
        <ItemDialog
          lists={visibleLists}
          item={itemDialog.item}
          defaultListId={itemDialog.listId}
          busy={busy}
          onSubmit={submitItem}
          onClose={() => setItemDialog(null)}
        />
      )}

      {listDialog && (
        <ListDialog
          list={listDialog.list}
          itemCount={
            listDialog.list
              ? board.items.filter((i) => i.listId === listDialog.list!.id).length
              : 0
          }
          busy={busy}
          onSubmit={submitList}
          onHide={(hidden) => {
            const target = listDialog.list;
            setListDialog(null);
            if (target) {
              void run(() => listsApi.updateList(target.id, { hidden }), hidden ? "Hidden" : "Shown");
            }
          }}
          onDelete={() => {
            const target = listDialog.list;
            setListDialog(null);
            if (target) void run(() => listsApi.deleteList(target.id), "List deleted");
          }}
          onClose={() => setListDialog(null)}
        />
      )}

      {membersOpen && (
        <MembersDialog
          board={board}
          onBoard={setBoard}
          onToast={setToast}
          onClose={() => setMembersOpen(false)}
        />
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-full bg-elevated px-4 py-2 text-xs font-medium text-ink shadow-lg">
          {toast}
        </div>
      )}
    </>
  );
}
