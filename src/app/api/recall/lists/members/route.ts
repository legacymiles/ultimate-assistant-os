import { readJson, withCaller } from "@/lib/recall/lists/api";
import {
  createInvite,
  removeMember,
  revokeInvite,
  updateMember,
} from "@/lib/recall/lists/store";
import { gateIsOn } from "@/lib/recall/lists/session";

// Members and invites.
// Inviting and removing are admin-only; editing a profile is self-or-admin.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST → mint a single-use invite link. */
export async function POST() {
  return withCaller(async (caller) => {
    const { board, token } = await createInvite(caller);
    return {
      board,
      token,
      // Roles are only meaningful once the app password is set — otherwise
      // anyone who reaches Recall is already the admin. The UI says so.
      gated: await gateIsOn(),
    };
  });
}

/** PATCH { id, name?, colour? } → rename or recolour a profile. */
export async function PATCH(req: Request) {
  return withCaller(async (caller) => {
    const body = await readJson<{ id?: string; name?: string; colour?: string }>(req);
    return {
      board: await updateMember(caller, body.id ?? caller.member.id, {
        name: body.name,
        colour: body.colour,
      }),
    };
  });
}

/**
 * DELETE ?member=<id>&purge=1  → remove a member, optionally deleting what
 *                                they added (otherwise it stays, attributed to
 *                                a removed-member placeholder).
 * DELETE ?invite=<token>       → revoke a pending invite.
 */
export async function DELETE(req: Request) {
  const params = new URL(req.url).searchParams;
  return withCaller(async (caller) => {
    const invite = params.get("invite");
    if (invite) return { board: await revokeInvite(caller, invite) };
    return {
      board: await removeMember(caller, params.get("member") ?? "", params.get("purge") === "1"),
    };
  });
}
