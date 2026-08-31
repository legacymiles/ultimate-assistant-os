import { AiRankings } from "@/components/ai-rankings/AiRankings";

export const metadata = {
  title: "AI Rankings · Ultimate Assistant OS",
  description:
    "A personal database of every tool worth remembering — free vs paid vs open source, API-key status, date added, your own notes and features, and a leaderboard per section.",
};

export default function Page() {
  return <AiRankings />;
}
