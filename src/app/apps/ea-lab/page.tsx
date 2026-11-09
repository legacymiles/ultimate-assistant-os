import { redirect } from "next/navigation";

// EA Lab is now the Lab section of Trading Studio. The route stays alive so
// old links land in the right place — the same bargain every merged app here
// makes (see MERGED_INTO in src/lib/studio/plugins.ts).
export default function Page() {
  redirect("/apps/trading-studio?section=lab");
}
