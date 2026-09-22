"use client";

import { createContext, useContext } from "react";

// ---------------------------------------------------------------------------
// "The folder on screen is AI Rankings (or lives inside it)".
//
// Two features hang off this one fact: the per-entry Sync button (see
// rowExtra.tsx) and the auto-filled URL on a new website. A context rather than
// a prop because the forms are three levels down inside sections that no other
// folder treats specially — and a folder that does not provide it behaves
// exactly as it always has.
// ---------------------------------------------------------------------------

export const RankingsFolderContext = createContext(false);

export function useInRankingsFolder(): boolean {
  return useContext(RankingsFolderContext);
}
