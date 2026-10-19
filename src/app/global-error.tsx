"use client";

// The last line: a crash in the root layout itself. It replaces the whole
// document, so it brings its own <html> and <body>.

import { CrashScreen } from "@/components/CrashScreen";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0 }}>
        <CrashScreen error={error} reset={reset} />
      </body>
    </html>
  );
}
