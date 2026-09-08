import { Icon } from "@/components/icons";
import { UnlockScreen } from "@/components/UnlockForm";

// The gated app's own title, so the lock screen does not inherit another
// app's name from the root layout.
export const metadata = {
  title: "Unlock Dashboard · Ultimate Assistant OS",
  description: "Private second brain.",
};

export default function RecallUnlockPage() {
  return (
    <UnlockScreen
      title="Dashboard"
      subtitle="This is a private second brain."
      endpoint="/api/recall-unlock"
      defaultNext="/apps/dashboard"
      icon={<Icon.Sparkles width={24} height={24} />}
      footnote="Saved passwords are separately encrypted behind your vault's master password."
    />
  );
}
