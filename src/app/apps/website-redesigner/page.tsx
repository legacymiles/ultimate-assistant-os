import { Redesigner } from "@/components/redesigner/Redesigner";

export const metadata = {
  title: "Website Redesigner · Ultimate Assistant OS",
  description:
    "Paste a URL and get three redesign directions plus a functionality-preserving build prompt for Claude Code.",
};

export default function Page() {
  return <Redesigner />;
}
