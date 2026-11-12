import type { Metadata } from "next";
import { notFound } from "next/navigation";
import AppShell from "@/components/buildflip-2/AppShell";
import AdminDashboard from "@/components/buildflip-2/AdminDashboard";
import { isOwnerEmail } from "@/lib/buildflip-2/db/owner";
import { currentUser } from "@/lib/buildflip-2/supabase/server";

export const metadata: Metadata = {
  title: "Owner dashboard",
  robots: { index: false, follow: false },
};

/**
 * Owner-only. Checked on the server here AND again in /api/admin/stats, so
 * hiding the nav link is not what protects it (S3). A non-owner gets a 404.
 */
export default async function AdminPage() {
  const user = await currentUser();
  if (!user || !isOwnerEmail(user.email)) notFound();

  return (
    <AppShell>
      <AdminDashboard />
    </AppShell>
  );
}
