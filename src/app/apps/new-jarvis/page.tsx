import type { Metadata } from "next";
import { NewJarvis } from "@/components/new-jarvis/NewJarvis";

export const metadata: Metadata = {
  title: "New Jarvis",
  description:
    "The assistant console: every request becomes a block with its steps and its results, voice waiting on its name, and a local agent that can drive a real browser and this PC.",
};

export default function Page() {
  return <NewJarvis />;
}
