"use client";

import { CrashScreen } from "@/components/CrashScreen";

export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <CrashScreen error={error} reset={reset} />;
}
