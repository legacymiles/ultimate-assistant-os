import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { appBuilderDisplay as syne, appBuilderMono as mono } from "@/lib/fonts";
import { AppBuilderHome } from "@/components/app-builder/AppBuilderHome";
import { BUILDER_SECTIONS } from "@/lib/studio-home/builder";
import { pickSection } from "@/lib/studio-home/sections";
import { studioRedirectFor } from "@/lib/website-studio/redirects";

// App Builder — a Jarvis App plugin, and the one home for building. Build:
// type an idea or drop a recording of an app or workflow; the super agent
// takes it apart, asks what it's for, designs the features, and hands the
// build to Claude Code with the owner's skills. Website Redesigner: a new look
// for an existing site, plus a Showcase of app ideas. Owner-only (middleware),
// so it is never indexed or previewed.

export const metadata: Metadata = {
  title: "App Builder · Jarvis",
  description: "Describe an app or show a recording of one — the super agent designs it and hands the build to your pro team.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#07080c",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  // Website Studio took App Builder's place (Nov 2026). Where the owner
  // navigates here, they land there; inside Jarvis's sheet, and on the boards
  // the Studio does not host, App Builder stays (src/lib/website-studio/redirects.ts).
  const framed = (await headers()).get("sec-fetch-dest") === "iframe";
  const to = studioRedirectFor(params, framed);
  if (to) redirect(to);
  const section = params.section;
  return (
    <div className={`${syne.variable} ${mono.variable}`}>
      <AppBuilderHome initialSection={pickSection(BUILDER_SECTIONS, section)} />
    </div>
  );
}
