import { redirect } from "next/navigation";

// Website Redesigner lives inside App Builder now — the one home for building.
// The route stays alive because links to it exist; `?v=2` (the bake-off) and
// `?v=showcase` are carried across so they still land on the same view.
export default async function Page({ searchParams }: { searchParams: Promise<{ v?: string | string[] }> }) {
  const { v } = await searchParams;
  const view = Array.isArray(v) ? v[0] : v;
  const keep = view === "2" || view === "showcase" ? `&v=${view}` : "";
  redirect(`/apps/app-builder?section=redesign${keep}`);
}
