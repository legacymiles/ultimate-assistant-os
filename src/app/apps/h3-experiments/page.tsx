import type { Metadata } from "next";
import { H3Lab } from "@/components/h3-lab/H3Lab";

export const metadata: Metadata = {
  title: "H3 Experiments",
  description: "Which skill actually makes a good film — the same brief, every skill, measured.",
};

export default function H3ExperimentsPage() {
  return <H3Lab />;
}
