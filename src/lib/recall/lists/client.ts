// ---------------------------------------------------------------------------
// Recall Lists — browser side of the API.
//
// Every mutation returns the whole board, so the client never has to reconcile
// a patch against optimistic state. The board is small (a family's worth of
// short-lived rows), and a shared list where two people are editing at once is
// exactly where clever local merging goes wrong.
// ---------------------------------------------------------------------------

import type { BoardPayload, ListDef, ListItem, Priority } from "./types";

/** A failed call carries the server's own wording — those messages are written to be read. */
export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    });
  } catch {
    throw new ApiError("No connection.", 0);
  }
  const body = (await res.json().catch(() => ({}))) as { error?: string } & T;
  if (!res.ok) throw new ApiError(body.error ?? "Something went wrong.", res.status);
  return body;
}

async function board(url: string, init?: RequestInit): Promise<BoardPayload> {
  return (await call<{ board: BoardPayload }>(url, init)).board;
}

const BASE = "/api/recall/lists";

export const listsApi = {
  load: () => board(BASE),

  addItem: (input: {
    listId: string;
    text: string;
    priority?: Priority;
    note?: string;
    dueDate?: string;
    url?: string;
  }) => board(`${BASE}/items`, { method: "POST", body: JSON.stringify(input) }),

  updateItem: (id: string, patch: Partial<ListItem>) =>
    board(`${BASE}/items`, { method: "PATCH", body: JSON.stringify({ id, patch }) }),

  deleteItem: (id: string) =>
    board(`${BASE}/items?id=${encodeURIComponent(id)}`, { method: "DELETE" }),

  clearDone: (listId: string) =>
    board(`${BASE}/items?clearDone=${encodeURIComponent(listId)}`, { method: "DELETE" }),

  createList: (input: { name: string; icon: string }) =>
    board(`${BASE}/defs`, { method: "POST", body: JSON.stringify(input) }),

  updateList: (id: string, patch: Partial<Pick<ListDef, "name" | "icon" | "hidden">>) =>
    board(`${BASE}/defs`, { method: "PATCH", body: JSON.stringify({ id, patch }) }),

  deleteList: (id: string) =>
    board(`${BASE}/defs?id=${encodeURIComponent(id)}`, { method: "DELETE" }),

  invite: () =>
    call<{ board: BoardPayload; token: string; gated: boolean }>(`${BASE}/members`, {
      method: "POST",
    }),

  revokeInvite: (token: string) =>
    board(`${BASE}/members?invite=${encodeURIComponent(token)}`, { method: "DELETE" }),

  updateMember: (id: string, patch: { name?: string; colour?: string }) =>
    board(`${BASE}/members`, { method: "PATCH", body: JSON.stringify({ id, ...patch }) }),

  removeMember: (id: string, purge: boolean) =>
    board(`${BASE}/members?member=${encodeURIComponent(id)}&purge=${purge ? "1" : "0"}`, {
      method: "DELETE",
    }),

  signOut: () => call<{ ok: boolean }>(`${BASE}/session`, { method: "DELETE" }),
};

/** The invite link to hand to a family member. */
export function inviteUrl(token: string): string {
  if (typeof window === "undefined") return `/recall-join?t=${token}`;
  return `${window.location.origin}/recall-join?t=${token}`;
}
