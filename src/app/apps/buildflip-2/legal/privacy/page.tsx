import type { Metadata } from "next";
import { LegalDoc } from "@/components/buildflip-2/Legal";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "What BuildFlip stores, why, and how to get rid of it.",
};

export default function PrivacyPage() {
  return (
    <LegalDoc
      title="Privacy Policy"
      updated="10 November 2026"
      intro="Your plans contain real spending decisions and sometimes photos of your home. Here is exactly what we keep, why, and how to delete it."
      sections={[
        {
          heading: "What we store",
          body: [
            "Your email address, so you can sign in and we can send account emails.",
            "Your plans: what you typed, any link you pasted, the generated steps and materials, the prices and comps we found, and anything you changed.",
            "Reference photos you upload. These go into a private storage bucket under your user id and are only ever read through a short-lived signed link. They are never public and never indexed.",
            "Receipts you log: the amount, the label, the date and optionally the store.",
            "Your settings: your target hourly rate, your theme, whether you want updates by email.",
            "If you subscribe, a Stripe customer id and your subscription status. We never see or store your card number — that stays with Stripe.",
            "Error reports when something breaks: the message, the stack trace, and the page it happened on. API keys and tokens are stripped before anything is written down.",
          ],
        },
        {
          heading: "What we don't do",
          body: [
            "We do not sell your data. Not to advertisers, not to retailers, not to anyone.",
            "We do not share your plans with other users. Row-level security in the database means a query for your rows can only return your rows, and a shared plan only opens for someone holding that plan's specific link.",
            "We do not use third-party advertising or tracking pixels.",
          ],
        },
        {
          heading: "The one thing that is pooled",
          body: [
            "When you log real receipts, we add the pair of numbers — what we estimated, what it actually cost — to an anonymous pool for that build type, so the next person pricing the same kind of build gets a sharper estimate.",
            "That pool contains two numbers and a build-type label. It does not contain your email, your user id, your plan title, your photos, your prompt, or the store you shopped at.",
          ],
        },
        {
          heading: "Who else sees it, and why",
          body: [
            "Supabase hosts the database, authentication and photo storage.",
            "Vercel hosts and serves the app, and records standard server logs.",
            "OpenRouter runs the model that reads your idea and searches the web. Your prompt, your pasted link's public metadata, and your reference photos are sent to it for that purpose. They are not used to train anybody's model on our account.",
            "Stripe handles payments if you subscribe.",
            "Resend sends account emails, if email is configured on this deployment.",
            "That is the complete list. Each of them only gets what it needs to do its job.",
          ],
        },
        {
          heading: "How long we keep it",
          body: [
            "Your plans stay until you delete them or delete your account.",
            "Error logs are kept short — the most recent few hundred entries, then they roll off.",
            "If you delete your account, everything goes at once (see below).",
          ],
        },
        {
          heading: "Deleting your data",
          body: [
            "Settings → Delete my account. You type DELETE to confirm, because it cannot be undone.",
            "That removes, in order: every reference photo from storage, every plan and receipt row, your Stripe customer record (which cancels any subscription), and finally your sign-in itself. It is a real deletion, not a hidden flag.",
            "You can download everything as a JSON file first, from the same page.",
          ],
        },
        {
          heading: "Cookies",
          body: [
            "We set a session cookie so you stay signed in, and we store your theme choice in your browser. That is all. There are no advertising or analytics cookies.",
          ],
        },
        {
          heading: "Your rights",
          body: [
            "You can see, export and delete your data from Settings, immediately, without emailing anyone. If you are in the UK, EU or California and want anything else — a correction, a restriction, a copy in another format — email hello@buildflip.app and we will do it.",
            "BuildFlip is not for children. You must be 18 or older, or have a parent's permission, to use it.",
          ],
        },
      ]}
    />
  );
}
