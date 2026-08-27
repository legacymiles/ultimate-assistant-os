import { VoiceStudio } from "@/components/voice-studio/VoiceStudio";

export const metadata = {
  title: "Voice Studio · Ultimate Assistant OS",
  description:
    "Text-to-speech and instant voice cloning powered by fish-speech, with browser voices as a free fallback.",
};

export default function Page() {
  return <VoiceStudio />;
}
