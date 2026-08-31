import { readJson, withCaller } from "@/lib/recall/lists/api";
import { createList, deleteList, updateList } from "@/lib/recall/lists/store";
import type { ListDef } from "@/lib/recall/lists/types";

// List definitions — admin only, enforced in the store.
// Built-ins can be hidden but never deleted, and a custom list must be empty
// before it can go, so tidying the board can never destroy items.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return withCaller(async (caller) => ({
    board: await createList(caller, await readJson<{ name: string; icon: string }>(req)),
  }));
}

export async function PATCH(req: Request) {
  return withCaller(async (caller) => {
    const body = await readJson<{
      id?: string;
      patch?: Partial<Pick<ListDef, "name" | "icon" | "hidden">>;
    }>(req);
    return { board: await updateList(caller, body.id ?? "", body.patch ?? {}) };
  });
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  return withCaller(async (caller) => ({ board: await deleteList(caller, id) }));
}
