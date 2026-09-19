import { Jarvis } from "@/components/jarvis/Jarvis";

export const metadata = {
  title: "Jarvis · Ultimate Assistant OS",
  description:
    "A voice-first personal assistant with a real memory: ask him anything, he answers from what he actually knows and names his sources, and he asks before he acts.",
};

export default function Page() {
  return <Jarvis />;
}
