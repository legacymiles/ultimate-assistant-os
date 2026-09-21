import { redirect } from "next/navigation";

// Skills Library is a tab inside Jarvis now. The page is the only thing that
// moved: the store, /api/skills/* and the Supabase table are unchanged.
export default function Page() {
  redirect("/apps/jarvis#skills");
}
