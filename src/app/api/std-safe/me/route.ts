import { readJson, withCaller } from "@/lib/stdsafe/api";
import { mePayload, rotateCode, setDisplayName } from "@/lib/stdsafe/store";

// The dashboard payload, and the two things you can change about yourself.
// The client polls GET here, which is also how a pending request appears while
// the other person is standing in front of you.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return withCaller(async (caller) => mePayload(caller));
}

export async function POST(req: Request) {
  return withCaller(async (caller) => {
    const body = await readJson<{ action?: "rotate" | "rename"; displayName?: string }>(req);
    if (body.action === "rotate") await rotateCode(caller);
    if (body.action === "rename") await setDisplayName(caller, body.displayName ?? "");
    return mePayload(caller);
  });
}
