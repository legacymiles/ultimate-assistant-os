import { InspireApp } from "@/components/image-studio/inspire/InspireApp";

export const metadata = {
  title: "Inspire · Image Studio",
  description:
    "Discover AI images and the prompts behind them. Every prompt is broken into glowing, categorised ingredients you can save, remix and rebuild in the Prompt Builder — or upload any image to reverse-engineer its prompt.",
};

export default function Page() {
  return <InspireApp />;
}
