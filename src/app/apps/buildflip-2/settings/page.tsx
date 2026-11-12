import type { Metadata } from "next";
import { redirect } from "next/navigation";
import AppShell from "@/components/buildflip-2/AppShell";
import Settings from "@/components/buildflip-2/Settings";
import { currentUser } from "@/lib/buildflip-2/supabase/server";
import { capabilities } from "@/lib/buildflip-2/flags";

export const metadata: Metadata = {
  title: "Settings",
  robots: { index: false, follow: false },
};

export default async function SettingsPage() {
  if (!capabilities().auth) redirect("/apps/buildflip-2/board");
  const user = await currentUser();
  if (!user) redirect("/login");

  return (
    <AppShell>
      <Settings email={user.email} />
    </AppShell>
  );
}
