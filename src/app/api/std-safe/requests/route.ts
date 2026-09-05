import { readJson, withCaller } from "@/lib/stdsafe/api";
import { mePayload, requestByCode, respondToRequest, revokeGrant } from "@/lib/stdsafe/store";

// Ask someone, answer someone, or pull a grant back.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST { code } — ask the person holding that code. */
export async function POST(req: Request) {
  return withCaller(async (caller) => {
    const { code } = await readJson<{ code?: string }>(req);
    const request = await requestByCode(caller, code ?? "");
    return { request, ...(await mePayload(caller)) };
  });
}

/** PATCH { id, approve } — answer a request that was made of you. */
export async function PATCH(req: Request) {
  return withCaller(async (caller) => {
    const { id, approve } = await readJson<{ id?: string; approve?: boolean }>(req);
    await respondToRequest(caller, id ?? "", Boolean(approve));
    return mePayload(caller);
  });
}

/** DELETE ?id= — end a grant you already gave, before it expires on its own. */
export async function DELETE(req: Request) {
  return withCaller(async (caller) => {
    await revokeGrant(caller, new URL(req.url).searchParams.get("id") ?? "");
    return mePayload(caller);
  });
}
