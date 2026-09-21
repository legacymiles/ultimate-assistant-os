import { redirect } from "next/navigation";
import { callerIsMember } from "@/lib/recall/lists/session";

// Dashboard moved into Jarvis (Folders, Photos, Calendar and Lists are tabs
// there now). Its storage keys, module paths and /api/recall/* routes did NOT
// move — see the dashboard-app memory — only the page did. Old bookmarks and
// the iPhone Shortcut's links land on the Folders tab.
export const dynamic = "force-dynamic";

export default async function Page() {
  if (await callerIsMember()) redirect("/apps/dashboard/lists");
  redirect("/apps/jarvis#folders");
}
