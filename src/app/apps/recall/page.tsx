import { Recall } from "@/components/recall/Recall";

export const metadata = {
  title: "Recall · Ultimate Assistant OS",
  description:
    "Your personal RAG second brain. Capture notes, links and images — Recall auto-files and tags them, so you find anything by searching or by asking the built-in agent, which can also organize things for you.",
};

export default function Page() {
  return <Recall />;
}
