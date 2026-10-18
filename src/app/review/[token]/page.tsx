import { redirect } from "next/navigation";

// Old-style client links (/review/<code>) still work: Client Review lives on
// one page now, and the code rides along so the client lands on their site.
export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  redirect(`/apps/client-review?site=${encodeURIComponent(token)}`);
}
