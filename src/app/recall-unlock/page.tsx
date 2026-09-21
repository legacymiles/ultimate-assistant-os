import { Icon } from "@/components/icons";
import { UnlockScreen } from "@/components/UnlockForm";

// The gated app's own title, so the lock screen does not inherit another
// app's name from the root layout.
export const metadata = {
  title: "Unlock Jarvis · Ultimate Assistant OS",
  description: "Private second brain.",
};

export default function RecallUnlockPage() {
  return (
    <UnlockScreen
      title="Jarvis"
      subtitle="Your folders, photos, lists and assistant."
      endpoint="/api/recall-unlock"
      defaultNext="/apps/jarvis"
      icon={<Icon.Sparkles width={24} height={24} />}
      footnote="One password for everything Jarvis keeps. Family members sign in to the Lists board separately."
    />
  );
}
