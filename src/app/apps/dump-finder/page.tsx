import { DumpFinder } from "@/components/dump-finder/DumpFinder";

export const metadata = {
  title: "Dump Finder · Ultimate Assistant OS",
  description:
    "Every asphalt plant, landfill, transfer station, recycling center, scrap yard and concrete yard "
    + "within your radius, on a map, nearest first — filtered to the load on the truck.",
};

export default function Page() {
  return <DumpFinder />;
}
