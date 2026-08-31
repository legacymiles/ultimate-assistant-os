import { Icon } from "@/components/icons";
import { UnlockScreen } from "@/components/UnlockForm";

// The gated app's own title, so the lock screen does not inherit another
// app's name from the root layout.
export const metadata = {
  title: "Unlock Projects Timeline · Ultimate Assistant OS",
  description: "Private workspace.",
};

export default function TimelineUnlockPage() {
  return (
    <UnlockScreen
      title="Projects Timeline"
      subtitle="This is a private workspace."
      endpoint="/api/timeline-unlock"
      defaultNext="/apps/projects-timeline"
      icon={<Icon.Layers width={24} height={24} />}
    />
  );
}
