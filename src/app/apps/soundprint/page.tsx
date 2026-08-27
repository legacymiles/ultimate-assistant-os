import { Soundprint } from "@/components/soundprint/Soundprint";

export const metadata = {
  title: "Soundprint · Ultimate Assistant OS",
  description:
    "Turn a reference song into the two prompts Suno needs — style and lyrics — by measuring the audio and breaking the style down like a producer.",
};

export default function Page() {
  return <Soundprint />;
}
