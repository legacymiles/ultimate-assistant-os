import { redirect } from "next/navigation";

// Terminals is now a section of Trading Studio. Old links land in it.
export default function Page() {
  redirect("/apps/trading-studio?section=terminals");
}
