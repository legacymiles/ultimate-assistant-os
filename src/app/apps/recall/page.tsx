import { redirect } from "next/navigation";

// Recall was renamed to Dashboard. This redirect stays because the old path is
// in bookmarks and in older Projects Timeline entries. Storage keys, module
// paths and /api/recall/* deliberately keep the `recall` name — renaming those
// would orphan every saved note and break the invite links family already hold.
export default function Page() {
  redirect("/apps/dashboard");
}
