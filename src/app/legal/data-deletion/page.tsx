import { LegalPage } from "../LegalPage";

export const metadata = { title: "Delete your data · Ultimate Assistant OS", description: "How to remove what Personas Studio holds about your social accounts." };

export default function Page() {
  return (
    <LegalPage title="Delete your data" updated="October 19, 2026">
      <h2>From inside the app (immediate)</h2>
      <ul>
        <li>Open Personas Studio, open the persona, go to Overview, and press the bin next to the account — its access token is deleted from our server at once.</li>
        <li>To remove everything for a persona (posts, stats, plans and scheduled posts), press Delete persona at the bottom of its Overview.</li>
      </ul>
      <h2>From the platform</h2>
      <ul>
        <li>TikTok: Settings and privacy › Security › Manage app permissions › remove Ultimate Assistant OS.</li>
        <li>Instagram / Facebook: Settings › Apps and websites › remove Ultimate Assistant OS.</li>
      </ul>
      <p>Once access is removed on the platform, the app can no longer read or post for that account. Ask us using the contact below and we&apos;ll delete anything left within 30 days.</p>
    </LegalPage>
  );
}
