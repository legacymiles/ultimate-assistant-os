import { StdSafe } from "@/components/stdsafe/StdSafe";

export const metadata = {
  title: "STD Safe · Ultimate Assistant OS",
  description:
    "A tracker for the STD lab reports you already receive, and a way to show someone what you were tested for, what came back, and how long ago the sample was taken — without ever claiming more than the results support.",
};

export default function Page() {
  return <StdSafe />;
}
