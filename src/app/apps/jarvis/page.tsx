import { redirect } from "next/navigation";

// The original Jarvis shell is retired: New Jarvis has every tab it had, the
// same stores behind them, and Chat with attachments in place of its chat.
//
// This route stays so nothing that points here breaks. A hash (`#skills`,
// `#memory`) survives the redirect on its own — browsers carry the fragment
// over — and New Jarvis maps the old names (memory, record, profile, routines,
// console) to where they live now. The old `?tab=` form is turned into a hash
// here, because a query string is not something New Jarvis reads.
export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = (await searchParams).tab;
  const tab = (Array.isArray(raw) ? raw[0] : raw ?? "").replace(/[^a-z-]/gi, "").toLowerCase();
  redirect(tab ? `/apps/new-jarvis#${tab}` : "/apps/new-jarvis");
}
