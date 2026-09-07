import type { Metadata, Viewport } from "next";
import "./globals.css";
import { IdentityBoundary } from "@/components/IdentityBoundary";

export const metadata: Metadata = {
  title: "Projects Timeline · Ultimate Assistant OS",
  description:
    "A project intelligence system to organize, store, understand and continuously refine your projects over time.",
};

export const viewport: Viewport = {
  themeColor: "#0a0b0f",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <IdentityBoundary />
        {children}
      </body>
    </html>
  );
}
