import { LegalPage } from "../LegalPage";

export const metadata = { title: "Terms of Service · Ultimate Assistant OS", description: "The terms for using Personas Studio with your social accounts." };

export default function Page() {
  return (
    <LegalPage title="Terms of Service" updated="October 19, 2026">
      <p>By connecting a social account to Personas Studio you agree to these terms.</p>
      <h2>Your accounts, your content</h2>
      <ul>
        <li>You connect only accounts you own or are allowed to manage.</li>
        <li>You own what you post. You&apos;re responsible for it following each platform&apos;s rules and the law.</li>
        <li>Personas Studio posts only what you schedule or tell it to post now.</li>
      </ul>
      <h2>The platforms&apos; rules</h2>
      <p>
        Your use of TikTok, Instagram, Facebook, YouTube and X through this app is also covered by their own terms. If a platform limits or
        changes what its API allows, the matching feature here may stop working or change.
      </p>
      <h2>No guarantees</h2>
      <p>
        The app is provided as is. We work to keep it reliable, but we can&apos;t promise that every scheduled post goes out on time or that
        stats match the platform exactly. Failed posts are shown to you with the reason.
      </p>
      <h2>Stopping</h2>
      <p>You can disconnect accounts and delete your personas at any time. We may stop offering the service, and will try to tell you first.</p>
    </LegalPage>
  );
}
