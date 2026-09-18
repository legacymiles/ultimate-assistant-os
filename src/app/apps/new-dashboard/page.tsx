import { NewDashboard } from "@/components/new-dashboard/NewDashboard";

export const metadata = {
  title: "New Dashboard · Ultimate Assistant OS",
  description:
    "Your personal AI Operating System: a 7-question onboarding becomes a Four-Cs dashboard (Context, Connections, Capabilities, Cadence) and the Claude Code files that make every session know you.",
};

export default function Page() {
  return <NewDashboard />;
}
