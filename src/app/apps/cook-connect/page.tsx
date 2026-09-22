import { CookConnect } from "@/components/cook-connect/CookConnect";
import "./cook-connect.css";

export const metadata = {
  title: "Cook Connect · Ultimate Assistant OS",
  description:
    "A cooking social network with a card table in it: publish cookbooks, save the ones worth keeping, "
    + "find and follow other cooks, and play them at spades or chess with chat and video at the table.",
};

export default function Page() {
  return <CookConnect />;
}
