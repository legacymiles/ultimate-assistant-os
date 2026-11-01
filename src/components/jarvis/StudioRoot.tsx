"use client";

// ---------------------------------------------------------------------------
// The Studio tab: the wall of studios, or one studio.
//
// This is all this component does. The wall is StudioWall, a studio is
// StudioShell, and the only state here is which of the two you are looking at —
// because that is the only thing neither of them can know.
//
// The studio is in the URL hash (`#studio/video/arena`), so a studio and the
// section inside it can be linked to, the back button works, and the old app
// routes that moved in have somewhere to forward to.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useState } from "react";
import type { Profile } from "@/lib/new-dashboard/types";
import type { JarvisStore } from "@/lib/jarvis/types";
import {
  getStudio,
  parseStudioHash,
  studioHash,
  type StudioId,
} from "@/lib/studio/studios";
import { StudioShell } from "./StudioShell";
import { StudioWall } from "./StudioWall";

interface At {
  studio: StudioId;
  section: string | null;
}

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
  /** null = the wall. */
  const [at, setAt] = useState<At | null>(null);

  // The hash is the source of truth, so the browser's own back button walks
  // out of a studio instead of leaving Jarvis.
  useEffect(() => {
    const read = () => setAt(parseStudioHash(window.location.hash));
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);

  const open = useCallback((id: StudioId, section?: string) => {
    window.location.hash = studioHash(id, section);
  }, []);

  const back = useCallback(() => {
    // Replacing rather than pushing: the wall is where you came from, so going
    // back to it should not need two presses of the browser's back button.
    const url = `${window.location.pathname}${window.location.search}#studio`;
    window.history.replaceState(null, "", url);
    setAt(null);
  }, []);

  const studio = at ? getStudio(at.studio) : null;

  if (!studio || !at) return <StudioWall onOpen={open} />;

  return (
    <StudioShell
      studio={studio}
      initialSection={at.section}
      onBack={back}
      store={store}
      commit={commit}
      profile={profile}
      onDashboardChanged={onDashboardChanged}
    />
  );
}
