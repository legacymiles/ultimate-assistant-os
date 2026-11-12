import type { Metadata } from "next";
import { LegalDoc } from "@/components/buildflip-2/Legal";

export const metadata: Metadata = {
  title: "Refund Policy",
  description: "When BuildFlip refunds you, and how to ask.",
};

export default function RefundsPage() {
  return (
    <LegalDoc
      title="Refund Policy"
      updated="10 November 2026"
      intro="Short version: if BuildFlip did not do its job, we give your money back. You do not have to argue with anyone."
      sections={[
        {
          heading: "The trial means you shouldn't need this",
          body: [
            "Pro starts with 7 free days. Stripe shows you the exact date of the first charge before you confirm, and cancelling before then costs you nothing.",
          ],
        },
        {
          heading: "First 30 days",
          body: [
            "If, within 30 days of your first charge, BuildFlip's estimate sent you badly wrong on a real build — the materials cost far more than we said, or a resale figure was not supported by the sales behind it — email hello@buildflip.app and we refund that month in full. Tell us which plan, so we can fix the estimate too.",
            "We do not ask for proof or make you justify it. We do ask which plan, because that is how the app gets better.",
          ],
        },
        {
          heading: "After that",
          body: [
            "Cancel any time and you keep Pro until the end of the period you have already paid for. We do not refund part-months as a rule, but if something clearly went wrong on our side — an outage, a broken generation that used your allowance, a double charge — tell us and we will sort it out.",
          ],
        },
        {
          heading: "Annual plans",
          body: [
            "Within the first 30 days of an annual plan, we refund the full year. After that we refund the unused whole months on request.",
          ],
        },
        {
          heading: "How to ask",
          body: [
            "Email hello@buildflip.app from the address on your account. One line is enough. A person reads it and refunds go back to the original card through Stripe, usually within a few business days.",
          ],
        },
      ]}
    />
  );
}
