import Link from "next/link";

export default function LegalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-dvh">
      <header className="border-b border-[var(--line-soft)]">
        <div className="mx-auto flex h-14 w-full max-w-3xl items-center justify-between px-4 sm:px-6">
          <Link
            href="/apps/buildflip-2"
            className="flex items-center gap-2 text-[15px] font-bold tracking-[-0.03em]"
          >
            <span className="relative grid h-6 w-6 place-items-center">
              <span className="absolute h-[5px] w-6 rounded-full bg-[var(--surface-3)]" />
              <span className="absolute left-0 h-[5px] w-[15px] rounded-full bg-[var(--profit)]" />
              <span className="absolute left-[13px] h-[15px] w-[5px] rounded-full bg-[var(--accent)]" />
            </span>
            BuildFlip
          </Link>
          <nav aria-label="Legal" className="flex gap-3 text-[12.5px] text-[var(--ink-3)]">
            <Link href="/apps/buildflip-2/legal/terms" className="hover:text-[var(--ink)]">Terms</Link>
            <Link href="/apps/buildflip-2/legal/privacy" className="hover:text-[var(--ink)]">Privacy</Link>
            <Link href="/apps/buildflip-2/legal/refunds" className="hover:text-[var(--ink)]">Refunds</Link>
          </nav>
        </div>
      </header>
      <main
        id="main"
        className="prose-bf mx-auto w-full max-w-3xl px-4 pb-20 pt-9 sm:px-6"
      >
        {children}
      </main>
    </div>
  );
}
