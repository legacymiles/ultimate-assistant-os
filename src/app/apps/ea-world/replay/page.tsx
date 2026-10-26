import { redirect } from "next/navigation";

// Replay is now a section of Trading Studio. Old links land in it.
export default function Page() {
  redirect("/apps/trading-studio?section=replay");
}
