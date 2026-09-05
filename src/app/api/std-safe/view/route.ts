import { withCaller } from "@/lib/stdsafe/api";
import { sharedView } from "@/lib/stdsafe/store";

// The other person's status, for someone who asked and was approved.
//
// Every condition — you made this request, it was approved, it has not expired
// — is checked inside sharedView, together, and answered with one message. A
// distinct "expired" versus "denied" would tell the asker which one happened,
// and a denial that announces itself is a disclosure in its own right.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return withCaller(async (caller) => ({
    view: await sharedView(caller, new URL(req.url).searchParams.get("id") ?? ""),
  }));
}
