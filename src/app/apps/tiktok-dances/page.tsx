import { redirect } from "next/navigation";

// Dance Vault became Viral Studio Content (Oct 2026). Old links and bookmarks land on the new app.
export default function Page() {
  redirect("/apps/viral-studio-content?tab=dances");
}
