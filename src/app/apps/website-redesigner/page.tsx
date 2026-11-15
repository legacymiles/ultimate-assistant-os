import { redirect } from "next/navigation";
import { studioRedirectFor } from "@/lib/website-studio/redirects";

// Website Redesigner lives inside Website Studio now (its "Redesign a website"
// start); the bake-off, Showcase and Flux edit board stay on App Builder's
// redesign section, which the Studio does not host.
// The route stays alive because links to it exist; `?v=2` (the bake-off),
// `?v=showcase` and `?v=edit` (with an edit's url / edit / name / lanes) are
// carried across so they still land on the same view.
const CARRY = ["url", "edit", "name", "l1", "l2", "l3", "n1", "n2", "n3", "go"];

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const first = (k: string) => {
    const v = params[k];
    return Array.isArray(v) ? v[0] : v;
  };
  const view = first("v");
  const q = new URLSearchParams({ section: "redesign" });
  if (view === "2" || view === "showcase" || view === "edit") q.set("v", view);
  for (const k of CARRY) {
    const v = first(k);
    if (v) q.set(k, v);
  }
  if (q.has("edit") && !q.has("v")) q.set("v", "edit");
  redirect(studioRedirectFor(Object.fromEntries(q), false) ?? `/apps/app-builder?${q.toString()}`);
}
