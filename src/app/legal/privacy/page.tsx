import { LegalPage } from "../LegalPage";

export const metadata = { title: "Privacy Policy · Ultimate Assistant OS", description: "What Personas Studio reads from connected social accounts and how it is kept." };

export default function Page() {
  return (
    <LegalPage title="Privacy Policy" updated="October 19, 2026">
      <p>
        Personas Studio is a tool inside Ultimate Assistant OS that helps a creator plan, post and measure content for the social accounts they
        connect. This page explains what it reads, why, and how it is kept.
      </p>
      <h2>What we read</h2>
      <ul>
        <li>Your public profile basics: username, display name and follower count.</li>
        <li>Your posts and videos: captions, links, cover images, post dates, and their view, like, comment and share counts.</li>
        <li>The access tokens the platform gives us when you connect, so the app can keep reading those numbers and post for you.</li>
      </ul>
      <h2>What we do with it</h2>
      <ul>
        <li>Show your analytics: how each video grows over time and when your posts do best.</li>
        <li>Suggest content ideas based on what has worked on your account.</li>
        <li>Publish the posts you schedule, at the time you choose. Nothing is posted that you did not schedule or press Post now on.</li>
      </ul>
      <h2>What we never do</h2>
      <ul>
        <li>We don&apos;t sell or rent your data, show you ads, or share it with advertisers.</li>
        <li>We don&apos;t read direct messages.</li>
        <li>We don&apos;t post anything you didn&apos;t ask for.</li>
      </ul>
      <h2>How it&apos;s kept</h2>
      <p>
        Access tokens are stored only on our server, never in your browser, and only your own account can use them. Content and stats are
        stored with your account so they appear on your devices. AI features send post text (never tokens or passwords) to the AI provider to
        write ideas and summaries.
      </p>
      <h2>Your choices</h2>
      <p>
        Disconnect any account at any time from the persona&apos;s Overview — its token is deleted from our server straight away. You can also
        revoke access from the platform&apos;s own settings. See <a className="text-brand underline" href="/legal/data-deletion">Delete your data</a>.
      </p>
    </LegalPage>
  );
}
