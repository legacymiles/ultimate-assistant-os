"use client";

// ---------------------------------------------------------------------------
// The hub's front door — decides whether you get v1 (the gallery) or v2 (the
// rotating stand), and carries the switch between them.
//
// Three rules this had to satisfy, and they pull against each other:
//
//   1. v1 must be untouched. It is the design across the rest of the site, so
//      the carousel is a SECOND view of the same catalog, never a rewrite of
//      the first one. Nothing in v2 reaches into v1's markup or stylesheet.
//   2. The choice has to stick. Someone who prefers the carousel should not
//      have to re-pick it every visit, so it is remembered per browser.
//   3. A link has to be able to name a version. ?v=2 wins over the remembered
//      preference so the carousel can be shown to someone directly.
//
// The version is resolved on the client, after mount. Rendering v2 on the
// server would mean guessing at a localStorage value the server cannot read,
// and being wrong shows the whole wrong hub for a frame.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CarouselHub } from "./v2/CarouselHub";
import { HubHome } from "./HubHome";

export type HubVersion = "v1" | "v2";

const STORAGE_KEY = "hub:version";

function readStored(): HubVersion | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw === "v1" || raw === "v2" ? raw : null;
  } catch {
    // Private mode or blocked storage. Not an error — just no preference.
    return null;
  }
}

export function HubShell() {
  const params = useSearchParams();
  const urlVersion = params.get("v") === "2" ? "v2" : params.get("v") === "1" ? "v1" : null;

  // Starts null rather than "v1" so the first paint renders nothing instead of
  // flashing the gallery at someone whose saved preference is the carousel.
  const [version, setVersion] = useState<HubVersion | null>(null);

  useEffect(() => {
    setVersion(urlVersion ?? readStored() ?? "v1");
  }, [urlVersion]);

  const choose = useCallback((next: HubVersion) => {
    setVersion(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // The choice still applies for this session; it just will not persist.
    }
    // Keep the URL honest about what is on screen, without a navigation —
    // a router push would remount the whole hub just to change a label.
    const url = new URL(window.location.href);
    url.searchParams.set("v", next === "v2" ? "2" : "1");
    window.history.replaceState(null, "", url);
  }, []);

  if (version === null) return null;

  return (
    <>
      <VersionToggle version={version} onChange={choose} />
      {version === "v2" ? <CarouselHub /> : <HubHome />}
    </>
  );
}

export function VersionToggle({
  version,
  onChange,
}: {
  version: HubVersion;
  onChange: (v: HubVersion) => void;
}) {
  return (
    <div className="hubv2-toggle" role="group" aria-label="Hub layout">
      {(["v1", "v2"] as const).map((v) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          aria-pressed={version === v}
          title={v === "v1" ? "Gallery view" : "Rotating stand"}
          className={"hubv2-toggle__btn" + (version === v ? " is-active" : "")}
        >
          {v.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
