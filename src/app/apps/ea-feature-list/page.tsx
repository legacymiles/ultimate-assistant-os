import { EaFeatureList } from "@/components/ea/EaFeatureList";

export const metadata = {
  title: "Expert Advisor Feature List · Ultimate Assistant OS",
  description:
    "A tagged, searchable list of every Expert Advisor feature spec — click any feature to read the full spec and copy it in one click.",
};

export default function Page() {
  return <EaFeatureList />;
}
