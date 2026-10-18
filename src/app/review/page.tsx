import type { Metadata } from "next";
import { MyWebsites } from "@/components/client-review/MyWebsites";

export const metadata: Metadata = {
  title: "My websites · Jarvis",
  robots: { index: false, follow: false },
};

export default function Page() {
  return <MyWebsites />;
}
