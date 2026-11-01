"use client";

// ---------------------------------------------------------------------------
// The Studio tab: the wall of studios, or the workflow wall.
//
// This is all it does, and the asymmetry is deliberate. Every studio on the
// wall is a full app with its own route and its own `?section=` switcher, so
// the wall sends you there rather than re-hosting it — a second mount for each
// one is a second thing to keep working. The workflow wall is the exception:
// it has no route of its own, it only ever existed as this tab, so it opens
// here with a way back.
//
// The view is in the hash (`#studio/workflows`) so a reload, a bookmark and
// the browser's own back button all land where the owner was, the same way
// the tab itself does.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useState } from "react";
import type { JarvisStore } from "@/lib/jarvis/types";
import type { Profile } from "@/lib/new-dashboard/types";
import { Icon } from "../icons";
import { StudioTab } from "./StudioTab";
import { StudioWall } from "./StudioWall";
import "./studio-hub.css";

export function StudioRoot({
  store,
  commit,
  profile,
  onDashboardChanged,
}: {
  store: JarvisStore;
  commit: (s: JarvisStore) => void;
  profile: Profile | null;
  onDashboardChanged?: () => void;
}) {
  const [onWorkflows, setOnWorkflows] = useState(false);

  useEffect(() => {
    const read = () => setOnWorkflows(/^#?studio\/workflows$/.test(window.location.hash));
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);

  const open = useCallback(() => {
    window.location.hash = "studio/workflows";
  }, []);

  const back = useCallback(() => {
    // Replacing rather than pushing: the wall is where you came from, so
    // going back to it should not need two presses of the browser's own back.
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#studio`);
    setOnWorkflows(false);
  }, []);

  // Escape returns to the wall, the way it closes everything else in Jarvis —
  // but not while something inside the wall has the keyboard.
  useEffect(() => {
    if (!onWorkflows) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const el = document.activeElement;
      if (el instanceof HTMLElement && el.closest("input, textarea, [contenteditable='true']")) return;
      back();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onWorkflows, back]);

  if (!onWorkflows) return <StudioWall onOpenWorkflows={open} />;

  return (
    <div className="sshell">
      <div className="sshell-bar" style={{ ["--h"]: 258 } as React.CSSProperties}>
        <button type="button" className="sshell-back" onClick={back} title="Back to the studios (Esc)">
          <Icon.ArrowLeft />
          Studios
        </button>
        <div className="sshell-name">
          Video Studio
          <span>The video agent</span>
        </div>
        <div className="sshell-blurb">The wall, the composer and the camera deck</div>
      </div>
      <div className="sshell-stage">
        <StudioTab
          store={store}
          commit={commit}
          profile={profile}
          onDashboardChanged={onDashboardChanged}
        />
      </div>
    </div>
  );
}
