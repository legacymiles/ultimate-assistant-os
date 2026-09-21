import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Jarvis } from "@/components/jarvis/Jarvis";
import { sessionToken, status, tokenMatches } from "@/lib/recall/gateStore";
import { callerIsMember } from "@/lib/recall/lists/session";

export const metadata = {
  title: "Jarvis · Ultimate Assistant OS",
  description:
    "A voice-first personal assistant with a real memory: ask him anything, he answers from what he actually knows and names his sources, and he asks before he acts.",
};

// Jarvis now holds what Dashboard held — folders, saved logins, photos, the
// family lists — so it sits behind the same door Dashboard did. The password
// lives in a writable store (changeable in-app), which needs the Node runtime,
// so the check runs here rather than in edge middleware.
export const dynamic = "force-dynamic";

export default async function Page() {
  // Family members get the Lists board and nothing else, same as before.
  if (await callerIsMember()) redirect("/apps/dashboard/lists");

  const gate = await status();
  if (gate.gated) {
    const cookie = (await cookies()).get("recall_auth")?.value ?? "";
    if (!tokenMatches(cookie, await sessionToken())) {
      redirect("/recall-unlock?next=%2Fapps%2Fjarvis");
    }
  }
  return <Jarvis />;
}
