import { redirect } from "next/navigation";

// Skills Library is a tab inside (New) Jarvis now. The page is the only thing that
// moved: the store, /api/skills/* and the Supabase table are unchanged.
export default function Page() {
  redirect("/apps/new-jarvis#skills");
}
