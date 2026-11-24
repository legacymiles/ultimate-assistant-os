import type { Metadata } from "next";
import { LabShell } from "@/components/h3-lab/lab/LabShell";

export const metadata: Metadata = {
  title: "H3 Prompt Lab",
  description: "The self-improving MiniMax H3 prompting lab: one Master Prompt Guide, experiments that test techniques against it on the local H3, and the evidence for every change.",
};

export default function H3PromptLabPage() {
  return <LabShell />;
}
