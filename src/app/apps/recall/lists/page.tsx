import { redirect } from "next/navigation";
import { ListsBoard } from "@/components/recall/lists/ListsBoard";
import { resolveCaller } from "@/lib/recall/lists/session";

// The family board on its own page. This is the ONLY Recall route a member can
// reach — the rest of the app checks for the admin cookie and bounces them.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Family lists · Recall",
  description:
    "The shared board — to-do, to-buy, things to remember — colour-coded by urgency and by who added them.",
};

export default async function Page() {
  if (!(await resolveCaller())) redirect("/recall-join");
  return <ListsBoard standalone />;
}
