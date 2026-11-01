import { EaLab } from "@/components/ea-lab/EaLab";

export const metadata = {
  title: "EA Lab · Ultimate Assistant OS",
  description:
    "A testing bench for MetaTrader Expert Advisors: drop one in, it is backtested headless, "
    + "filed by how it fails, and rated on out-of-sample results — with peak unhedged exposure, "
    + "the number no MetaTrader report prints.",
};

export default function Page() {
  return <EaLab />;
}
