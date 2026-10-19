// The public pages TikTok and Meta ask for when a developer app is created:
// a privacy policy, terms of service and data-deletion instructions. Plain,
// readable, and true to what Personas Studio actually does.

import Link from "next/link";

const NAME = "Ultimate Assistant OS";

export function LegalPage({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  const contact = process.env.LEGAL_CONTACT_EMAIL;
  return (
    <main className="min-h-dvh bg-canvas px-4 py-10 text-ink">
      <article className="mx-auto max-w-2xl space-y-4 text-[15px] leading-relaxed text-ink-muted [&_h2]:mt-6 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-ink [&_li]:ml-5 [&_li]:list-disc">
        <p className="text-xs uppercase tracking-wider text-ink-faint">{NAME} · Personas Studio</p>
        <h1 className="text-2xl font-bold text-ink">{title}</h1>
        <p className="text-xs text-ink-faint">Last updated {updated}</p>
        {children}
        <h2>Contact</h2>
        <p>{contact ? <>Questions or requests: <a className="text-brand underline" href={`mailto:${contact}`}>{contact}</a>.</> : "Questions or requests: use the contact address listed on this app's TikTok or Meta developer page."}</p>
        <nav className="flex gap-4 border-t border-line pt-4 text-xs">
          <Link href="/legal/privacy" className="hover:text-ink">Privacy</Link>
          <Link href="/legal/terms" className="hover:text-ink">Terms</Link>
          <Link href="/legal/data-deletion" className="hover:text-ink">Delete your data</Link>
        </nav>
      </article>
    </main>
  );
}
