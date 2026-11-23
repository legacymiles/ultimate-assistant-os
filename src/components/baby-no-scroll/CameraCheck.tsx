"use client";

// ---------------------------------------------------------------------------
// Ask for the camera on the console, before the hand-over.
//
// Silly faces needs the front camera, and the browser asks before it lets a
// page have it. That question is a dialog with an "Allow" and a "Block" button
// — two more things for a baby to press on a locked screen. So the parent
// answers it here, once, and the locked screen never shows it.
//
// The camera is opened for a moment and closed again: this proves access and
// leaves the light off. The picture never goes anywhere.
// ---------------------------------------------------------------------------

import { useEffect, useState } from "react";

type Access = "checking" | "ask" | "asking" | "granted" | "denied" | "none";

export function CameraCheck() {
  const [access, setAccess] = useState<Access>("checking");

  useEffect(() => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setAccess("none");
      return;
    }
    let status: PermissionStatus | null = null;
    const read = (s: PermissionState) => setAccess(s === "granted" ? "granted" : s === "denied" ? "denied" : "ask");
    navigator.permissions
      ?.query({ name: "camera" as PermissionName })
      .then((s) => {
        status = s;
        read(s.state);
        s.onchange = () => read(s.state);
      })
      // Safari before 16 cannot query the camera; asking is the only way to know.
      .catch(() => setAccess("ask")) ?? setAccess("ask");
    return () => {
      if (status) status.onchange = null;
    };
  }, []);

  const ask = async () => {
    setAccess("asking");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
      stream.getTracks().forEach((t) => t.stop());
      setAccess("granted");
    } catch (err) {
      const name = (err as DOMException)?.name;
      setAccess(name === "NotFoundError" || name === "OverconstrainedError" ? "none" : "denied");
    }
  };

  const tone =
    access === "granted"
      ? "border-emerald-400/25 bg-emerald-400/[0.06]"
      : access === "denied" || access === "none"
        ? "border-amber-400/25 bg-amber-400/[0.05]"
        : "border-sky-400/25 bg-sky-400/[0.05]";

  return (
    <div className={`mt-3 rounded-lg border px-3 py-3 ${tone}`}>
      <div className="flex items-center gap-3">
        <span className="min-w-0 flex-1">
          <span className="block text-[12px] font-medium text-ink">
            {access === "granted"
              ? "Camera allowed"
              : access === "denied"
                ? "The camera is blocked for this site"
                : access === "none"
                  ? "No front camera here"
                  : "Silly faces uses the front camera"}
          </span>
          <span className="mt-0.5 block text-[11px] leading-snug text-ink-faint">
            {access === "granted"
              ? "Nothing is recorded or sent — the picture stays on this device."
              : access === "denied"
                ? "Allow it in the browser’s site settings (the icon left of the address), or hand over anyway — a cartoon face wears the filters instead."
                : access === "none"
                  ? "A cartoon face wears the filters instead, and every swipe still works."
                  : "Allow it now, so the baby never sees the browser’s question. Nothing is recorded or sent."}
          </span>
        </span>
        {(access === "ask" || access === "asking") && (
          <button
            type="button"
            onClick={ask}
            disabled={access === "asking"}
            className="shrink-0 rounded-lg bg-sky-500/90 px-3 py-2 text-[12px] font-semibold text-white transition hover:bg-sky-400 disabled:opacity-60"
          >
            {access === "asking" ? "Asking…" : "Allow the camera"}
          </button>
        )}
      </div>
    </div>
  );
}
