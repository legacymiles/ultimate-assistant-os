import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Recall } from "@/components/recall/Recall";
import { sessionToken, status, tokenMatches } from "@/lib/recall/gateStore";
import { callerIsMember } from "@/lib/recall/lists/session";

export const metadata = {
  title: "Recall · Ultimate Assistant OS",
  description:
    "Your private second brain. Folders you open like pages, one search box that reads inside your files, an encrypted vault for logins, and an agent that reorganises only with your confirmation.",
};

// The gate is checked here rather than in middleware: the password lives in a
// writable store so it can be changed from inside the app, and reading that
// store needs the Node runtime, which edge middleware does not give us.
export const dynamic = "force-dynamic";

export default async function Page() {
  // Family members get the Lists board and nothing else. Checked before the
  // app password, so a member's own session sends them to their own page
  // instead of the unlock screen.
  if (await callerIsMember()) redirect("/apps/recall/lists");

  const gate = await status();
  if (gate.gated) {
    const cookie = (await cookies()).get("recall_auth")?.value ?? "";
    if (!tokenMatches(cookie, await sessionToken())) {
      redirect("/recall-unlock?next=%2Fapps%2Frecall");
    }
  }
  return <Recall />;
}
