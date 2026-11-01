import { MoneyAgentStudio } from "@/components/money-agent/MoneyAgentStudio";

export const metadata = {
  title: "Money Agent Studio · Ultimate Assistant OS",
  description:
    "An agent that reads a trade setup and argues with the reasoning, the EA Lab bench that "
    + "backtests MetaTrader bots on this PC, and the calculator that sizes the orders. The "
    + "arithmetic is computed locally. There is no broker connection and no order path.",
};

export default function Page() {
  return <MoneyAgentStudio />;
}
