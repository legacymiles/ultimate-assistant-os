import { redirect } from "next/navigation";

// The EA Feature List is now the Feature List section of Trading Studio. The
// route stays alive because links to it exist (bookmarks, notes, Jarvis), and a
// merge should not turn those into 404s.
export default function Page() {
  redirect("/apps/trading-studio?section=features");
}
