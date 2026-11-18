import type { Metadata, Viewport } from "next";
import { vsMono, vsSans } from "@/lib/fonts";
import { ProfilesApp } from "@/components/profiles/ProfilesApp";

// Profiles — a web of the owner's people, businesses and jobs, each with its
// own world of information, searched and filled by talking to Jarvis (their
// harness on the PC when it is on). Session-gated by middleware like the rest
// of the hub; never indexed — it is personal information.

export const metadata: Metadata = {
  title: "Profiles · Jarvis",
  description: "Every person, business and job in your life, each with its own world of information. Tell Jarvis new things and it files them; ask and it finds them.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#05060a",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function Page() {
  return (
    <div className={`${vsSans.variable} ${vsMono.variable}`}>
      <ProfilesApp />
    </div>
  );
}
