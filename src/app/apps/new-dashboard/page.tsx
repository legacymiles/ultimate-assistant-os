import { redirect } from "next/navigation";

// New Dashboard became Jarvis (2026-09-19). The old route stays so saved
// links, the AI-OS skill's export notes and the decisions log keep working.
export default function Page() {
  redirect("/apps/new-jarvis#dashboard");
}
