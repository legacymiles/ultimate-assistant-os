import type { Metadata } from "next";
import { Leaderboard } from "@/components/ai-rankings/Leaderboard";

const description =
  "The best AI models ranked by category — text-to-speech, realtime voice, video, image, LLMs and more — with what just dropped, open-source filters and a score you can trace to its source.";

export const metadata: Metadata = {
  title: "AI Rankings — the best AI models by category",
  description,
  openGraph: {
    title: "AI Rankings",
    description,
    type: "website",
  },
  twitter: { card: "summary", title: "AI Rankings", description },
};

export default function Page() {
  return <Leaderboard />;
}
