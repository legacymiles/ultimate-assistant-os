import { LegalPage } from "../LegalPage";

export const metadata = {
  title: "Terms of Sale & Artwork Rights · DTF Studio",
  description: "How custom DTF orders work: artwork rights, made-to-order printing, payment, shipping, returns and your data.",
};

export default function Page() {
  return (
    <LegalPage title="DTF Studio — Terms of Sale & Artwork Rights" updated="November 23, 2026">
      <p>These terms cover designing in DTF Studio and ordering custom-printed garments. Placing an order means you agree to them.</p>

      <h2>Your artwork</h2>
      <ul>
        <li>You confirm you own, or have permission to use, everything you upload: images, logos, photos, text and reference pictures.</li>
        <li>We don&apos;t print trademarks, characters, team or brand logos, or other people&apos;s artwork without permission. We may refuse or cancel an order that appears to infringe someone&apos;s rights, and refund what you paid.</li>
        <li>You keep the rights to your designs. You let us store, process and print them only to make your order and show you previews.</li>
        <li>The AI designer creates original suggestions. It won&apos;t copy protected designs, and you&apos;re responsible for what you choose to print.</li>
      </ul>

      <h2>Made to order — and checked first</h2>
      <ul>
        <li>Every item is printed for you with direct-to-film (DTF) transfers and heat-pressed by hand. A person reviews every print file before it prints.</li>
        <li>The 3D mockup is a close preview, not a photograph. Fabric colours vary slightly between dye lots and screens, and printed colours can differ a little from what you see on your display.</li>
        <li>If your artwork may not print well — low resolution, very fine lines, a background box — the studio tells you before you order. If we find a problem after you order, we contact you before printing.</li>
      </ul>

      <h2>Payment</h2>
      <ul>
        <li>Prices are shown before you order and confirmed at checkout. Card payments are processed by Stripe; we never see or store your card number.</li>
        <li>If card payment isn&apos;t available, placing an order charges nothing. We contact you to arrange payment, and nothing prints until it&apos;s paid.</li>
      </ul>

      <h2>Shipping and pickup</h2>
      <p>We ship to the address you give, or hold your order for local pickup. You&apos;ll see each step on your order page and get an email when it&apos;s approved for print, ready, and shipped.</p>

      <h2>Returns</h2>
      <ul>
        <li>Because each item is made for you, we can&apos;t accept returns for a change of mind or a wrong size you chose.</li>
        <li>If an item arrives misprinted, damaged or different from your approved design, tell us within 14 days with a photo and we&apos;ll reprint it or refund you.</li>
      </ul>

      <h2>Your data</h2>
      <p>
        We store your designs, uploads and orders to make and track your order. You can delete your saved designs and uploads at any time from
        Your designs in the studio; files belonging to an order we still have to make or account for are kept with that order. See the{" "}
        <a href="/legal/privacy">privacy policy</a> and <a href="/legal/data-deletion">data deletion</a> pages for more.
      </p>
    </LegalPage>
  );
}
