import { redirect } from "next/navigation";

// New Jarvis is just Jarvis now, at /apps/jarvis. Old links, bookmarks and QR
// codes land there; the browser carries any #tab across the redirect itself.
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(await searchParams)) {
    if (typeof v === "string") q.set(k, v);
  }
  redirect(`/apps/jarvis${q.size ? `?${q}` : ""}`);
}
