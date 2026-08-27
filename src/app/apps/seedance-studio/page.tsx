import { SeedanceStudio } from "@/components/seedance/SeedanceStudio";

export const metadata = {
  title: "Seedance Studio · Ultimate Assistant OS",
  description:
    "A CapCut-style prompt builder for Seedance 2. Lay a song and prompt segments on a timeline and generate a custom video.",
};

export default function Page() {
  return <SeedanceStudio />;
}
