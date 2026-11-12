import type { Metadata } from "next";
import Providers from "@/components/buildflip-2/Providers";
import { bfMono, bfSans } from "@/lib/fonts";
import { currentUser } from "@/lib/buildflip-2/supabase/server";

/**
 * BuildFlip 2's root inside the hub.
 *
 * On the stand-alone site this was `src/app/layout.tsx`: it owned <html>, the
 * fonts, the pre-paint theme script and the providers. Here the hub owns the
 * document, so what is left is the app's own region — the two font variables,
 * and the client providers every page below needs (theme, toasts, the plans
 * cache). The `.bf2` root element and the app's light/dark attribute live in
 * `Providers`, so the theme is a class on this app rather than on <html>, which
 * the hub keeps dark.
 */

export const metadata: Metadata = {
  title: {
    default: "BuildFlip — know if a build makes money before you buy a board",
    template: "%s · BuildFlip",
  },
  description:
    "Paste a link to any build idea and get a step-by-step plan, materials priced at real current listings, what finished ones actually sold for, and a profit number you can check.",
  applicationName: "BuildFlip",
};

export default async function BuildFlipLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const user = await currentUser();
  return (
    <div className={`${bfSans.variable} ${bfMono.variable}`}>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-[10px] focus:bg-[var(--accent)] focus:px-4 focus:py-2.5 focus:text-[14px] focus:font-semibold focus:text-[var(--accent-ink)]"
      >
        Skip to content
      </a>
      <Providers signedIn={Boolean(user)}>{children}</Providers>
    </div>
  );
}
