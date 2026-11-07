import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import localFont from "next/font/local";
import { NewJarvis } from "@/components/new-jarvis/NewJarvis";
import { sessionToken, status, tokenMatches } from "@/lib/recall/gateStore";
import { callerIsMember } from "@/lib/recall/lists/session";

// The surface's design names JetBrains Mono as the voice of every command,
// path, ref, count and elapsed time. It used to be asked for from Google at
// build time, which made a build fail wherever fonts.googleapis.com was
// unreachable; the same faces are self-hosted in public/fonts so the build
// never needs that network.
const mono = localFont({
  src: [{ path: "../../../../public/fonts/jetbrains-mono-latin.woff2", weight: "400 700", style: "normal" }],
  variable: "--font-nj-mono",
  display: "swap",
  fallback: ["Consolas", "monospace"],
});

// The Deck's display face: angular and technical, used only for the greeting
// and section names so the HUD reads as one instrument.
const display = localFont({
  src: [{ path: "../../../../public/fonts/oxanium-latin.woff2", weight: "500 700", style: "normal" }],
  variable: "--font-nj-display",
  display: "swap",
  fallback: ["Arial Narrow", "Arial", "sans-serif"],
});

export const metadata: Metadata = {
  title: "Jarvis",
  description:
    "The assistant console: every request becomes a block with its steps and its results, voice waiting on its name, and a local agent that can drive a real browser and this PC.",
};

/**
 * Behind the app password.
 *
 * This page had none, and that is the kind of gap you can never find by using
 * the app: it looked protected because its neighbour was. It mounts the
 * owner's folders, saved logins, photos, calendar, life record and family
 * lists — and it is not in `APP_GATES` either, so setting the app password did
 * not lock it. The hub-wide owner check was the only thing in front of it.
 *
 * The password lives in a writable store so it can be changed in-app, which
 * needs the Node runtime — hence a page check rather than edge middleware,
 * which is why it is a page check.
 */
export const dynamic = "force-dynamic";

export default async function Page() {
  // A family member gets the Lists board and nothing else. Without this they
  // reached the full console, with a shell on the owner's PC behind it.
  if (await callerIsMember()) redirect("/apps/dashboard/lists");

  const gate = await status();
  if (gate.gated) {
    const cookie = (await cookies()).get("recall_auth")?.value ?? "";
    if (!tokenMatches(cookie, await sessionToken())) {
      redirect("/recall-unlock?next=%2Fapps%2Fjarvis");
    }
  }

  return (
    // data-nj-fonts: sheets render at the top of the page (SheetPortal) and borrow these faces.
    <div className={`${mono.variable} ${display.variable}`} data-nj-fonts>
      <NewJarvis />
    </div>
  );
}
