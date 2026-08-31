import { readJson, withCaller } from "@/lib/recall/lists/api";
import {
  addItem,
  clearDone,
  deleteItem,
  updateItem,
  type ItemInput,
  type ItemPatch,
} from "@/lib/recall/lists/store";

// Items on the shared board.
// Permission lives in the store, not here, so it cannot be sidestepped by
// calling a different route: adding is open to everyone, editing and deleting
// are owner-scoped, and ticking `done` is deliberately open to everyone.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return withCaller(async (caller) => ({
    board: await addItem(caller, await readJson<ItemInput>(req)),
  }));
}

export async function PATCH(req: Request) {
  return withCaller(async (caller) => {
    const body = await readJson<{ id?: string; patch?: ItemPatch }>(req);
    return { board: await updateItem(caller, body.id ?? "", body.patch ?? {}) };
  });
}

/** ?id=… removes one item; ?clearDone=<listId> sweeps everything ticked on a list. */
export async function DELETE(req: Request) {
  const params = new URL(req.url).searchParams;
  return withCaller(async (caller) => {
    const listId = params.get("clearDone");
    return {
      board: listId
        ? await clearDone(caller, listId)
        : await deleteItem(caller, params.get("id") ?? ""),
    };
  });
}
