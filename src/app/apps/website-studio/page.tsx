import type { Metadata, Viewport } from "next";
import { WebsiteStudio } from "@/components/website-studio/WebsiteStudio";

// Website Studio — one place to build a website, redesign one from its
// address, and edit one that is already live with the client who owns it.
// It is the consolidation of App Builder, Website Redesigner and Client
// Review; the three of them kept their routes while the migration is checked
// (docs/superpowers/specs/website-studio.md).
//
// Owner-only in middleware, like the three it replaces, so it is never
// indexed. A client never comes here: their own link is unchanged and mounts
// the same workspace at /apps/client-review?site=<token>.

export const metadata: Metadata = {
  title: "Website Studio · Jarvis",
  description: "Build a website from a prompt, redesign one from its address, or open one you have already shipped — one workspace for all three.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#06070b",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function Page() {
  return <WebsiteStudio />;
}
