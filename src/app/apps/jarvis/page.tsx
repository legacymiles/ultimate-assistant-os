import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { JetBrains_Mono, Oxanium } from "next/font/google";
import { NewJarvis } from "@/components/new-jarvis/NewJarvis";
import { sessionToken, status, tokenMatches } from "@/lib/recall/gateStore";
import { callerIsMember } from "@/lib/recall/lists/session";

// The surface's design names JetBrains Mono as the voice of every command,
// path, ref, count and elapsed time. The hub's --font-mono token asks for it
// first, but asking is not loading: nothing on this machine or on the deployed
// site has that face, so every one of those strings was falling through to
// Consolas. Loading it here is what makes the token true.
const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-nj-mono",
  display: "swap",
});

// The Deck's display face: angular and technical, used only for the greeting
// and section names so the HUD reads as one instrument.
const display = Oxanium({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-nj-display",
  display: "swap",
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
    <div className={`${mono.variable} ${display.variable}`}>
      <NewJarvis />
    </div>
  );
}
