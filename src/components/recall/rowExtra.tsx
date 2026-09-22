"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { Item } from "@/lib/recall/types";

// ---------------------------------------------------------------------------
// Something extra a folder wants on every one of its rows, whatever section
// the row is in — today, the AI Rankings folder's per-entry Sync button.
//
// A context rather than a prop so the section bodies don't each grow a prop
// that only one folder uses; a folder that provides nothing renders exactly as
// before.
// ---------------------------------------------------------------------------

export const RowExtraContext = createContext<((item: Item) => ReactNode) | null>(null);

export function useRowExtra(): (item: Item) => ReactNode {
  const fn = useContext(RowExtraContext);
  return fn ?? (() => null);
}
