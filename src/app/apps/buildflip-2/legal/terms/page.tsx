import type { Metadata } from "next";
import { LegalDoc } from "@/components/buildflip-2/Legal";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "The terms you agree to when you use BuildFlip.",
};

export default function TermsPage() {
  return (
    <LegalDoc
      title="Terms of Service"
      updated="10 November 2026"
      intro="Plain English, because you are about to spend real money on the back of what this app tells you. If anything here is unclear, email us and we will explain it."
      sections={[
        {
          heading: "What BuildFlip is",
          body: [
            "BuildFlip turns a build idea into a step-by-step plan, a materials list priced from current retail listings, an estimate of what finished versions have sold for, and a profit calculation based on those two figures.",
            "It is a research and estimating tool. It is not a contractor, an engineer, an appraiser, or a guarantee of profit.",
          ],
        },
        {
          heading: "The estimates are estimates",
          body: [
            "Prices come from listings that were live at the moment we checked them. Lumber, metal and sheet goods move constantly, retailers price regionally, and shipping and tax are not included. Every price on the site shows the exact date it was checked so you can judge how stale it is.",
            "Resale figures come from completed sales we were able to find for comparable finished pieces. Where we cannot find enough completed sales, the app says so plainly rather than producing a number. We never present an asking price as evidence of value.",
            "We do not warrant that any build will sell, or sell at any particular price. The decision to buy materials and start building is yours.",
          ],
        },
        {
          heading: "Build safely and legally",
          body: [
            "Build plans are generated for a competent amateur and include the safety notes we judge to matter for that specific build. They are not a substitute for a qualified professional, a building inspector, or the instructions that came with your tools.",
            "Anything structural, electrical, gas, plumbing, or that floats on water, carries people, or holds heat or pressure, may require a licensed professional, a permit, an inspection, or registration where you live. That is your responsibility to check. Where we spot such a requirement we flag it, but we cannot know your local rules.",
            "You are responsible for your own safety and for the safety of anyone who uses what you build.",
          ],
        },
        {
          heading: "Your account",
          body: [
            "You need an account to save plans. You are responsible for the email address you sign in with. One person, one account.",
            "Do not use BuildFlip to generate plans for anything illegal, or to scrape, resell or redistribute our generated plans at scale. We can suspend an account doing that.",
          ],
        },
        {
          heading: "Free and paid",
          body: [
            "Your first complete plan is free and does not require a card. After that, generating further plans, re-pricing existing ones, and tracking real costs require a Pro subscription.",
            "Pro includes a 7-day free trial. You see the exact date of the first charge on Stripe's checkout page before you confirm anything. You can cancel in one click from Settings; you keep access until the end of the period you have already paid for, and we do not ask you to email or call anyone to cancel.",
            "If you stop paying, every plan you have already made stays readable, exportable and shareable. We do not hold your work hostage.",
            "Prices may change for new subscriptions. If we change the price of a plan you are already on, we will email you first and it will not take effect before your next renewal.",
          ],
        },
        {
          heading: "What you own, what we own",
          body: [
            "Your ideas, your prompts, your photos and your logged receipts are yours. The plan generated for you is yours to use, build from, print, share and sell the resulting work from.",
            "We use anonymised estimate-versus-actual figures, pooled by build type, to improve the accuracy of future estimates. That pooling never includes your titles, your photos, your prompts or anything identifying you or your plans.",
            "The BuildFlip software, design and name are ours.",
          ],
        },
        {
          heading: "Availability and liability",
          body: [
            "We work hard to keep BuildFlip up, but we do not promise uninterrupted service, and the live-pricing search depends on third-party retailers and search providers that can be slow or unavailable.",
            "To the extent the law allows, our total liability to you is limited to the amount you have paid us in the twelve months before the claim. We are not liable for materials you bought, work you did, or a piece that did not sell.",
            "Nothing here limits liability that cannot legally be limited.",
          ],
        },
        {
          heading: "Ending it",
          body: [
            "You can delete your account at any time from Settings. That genuinely deletes your plans, receipts and uploaded photos, and cancels any subscription.",
            "We can close an account that is abusing the service, and will tell you why.",
          ],
        },
      ]}
    />
  );
}
