import { DanceVault } from "@/components/dances/DanceVault";

export const metadata = {
  title: "Dance Vault · Ultimate Assistant OS",
  description:
    "A living wall of TikTok dances that play on hover, each with the song, the choreographer and your own score out of 100 — plus one new viral dance added automatically every day.",
};

export default function Page() {
  return <DanceVault />;
}
