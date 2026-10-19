"use client";

// Mounted once in the root layout: every uncaught browser error and unhandled
// promise rejection on the hub goes to the site-error log (checklist R2).

import { useEffect } from "react";
import { reportError } from "@/lib/site-errors/client";

export function ErrorReporter() {
  useEffect(() => {
    const onError = (e: ErrorEvent) => reportError(e.error ?? e.message, "error");
    const onRejection = (e: PromiseRejectionEvent) => reportError(e.reason, "rejection");
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  return null;
}
