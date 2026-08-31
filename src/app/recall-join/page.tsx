import { JoinForm } from "@/components/recall/lists/JoinForm";

// The family door. Signup with ?t=<invite token>, sign-in without one.
// Its own title so the lock screen does not inherit another app's name.
export const metadata = {
  title: "Family lists · Ultimate Assistant OS",
  description: "Join the shared board.",
};

export default function Page() {
  return <JoinForm />;
}
