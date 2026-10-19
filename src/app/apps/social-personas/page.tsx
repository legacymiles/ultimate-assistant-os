import { redirect } from "next/navigation";

// Social Personas grew into Personas Studio. Old links (and bookmarks) land
// in the new app with their query intact.
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(await searchParams)) if (typeof v === "string") q.set(k, v);
  redirect(`/apps/personas-studio${q.size ? `?${q}` : ""}`);
}
