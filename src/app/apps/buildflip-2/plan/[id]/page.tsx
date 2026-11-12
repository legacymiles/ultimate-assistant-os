import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import AppShell from "@/components/buildflip-2/AppShell";
import PlanView from "@/components/buildflip-2/plan/PlanView";
import { getProject } from "@/lib/buildflip-2/db/projects";
import { currentUser } from "@/lib/buildflip-2/supabase/server";
import { capabilities } from "@/lib/buildflip-2/flags";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const user = await currentUser();
  if (!user) return { title: "Plan", robots: { index: false } };
  const project = await getProject(user.id, id);
  return {
    title: project?.title ?? "Plan",
    description: project?.summary ?? undefined,
    // A user's own plan is private — never indexed.
    robots: { index: false, follow: false },
  };
}

export default async function PlanPage({ params }: Props) {
  const { id } = await params;

  if (!capabilities().auth) {
    redirect("/apps/buildflip-2/board");
  }

  const user = await currentUser();
  if (!user) redirect("/login");

  const project = await getProject(user.id, id);
  if (!project) notFound();

  return (
    <AppShell>
      <PlanView initial={project} />
    </AppShell>
  );
}
