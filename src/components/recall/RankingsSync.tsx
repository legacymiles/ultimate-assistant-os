"use client";

import { useState } from "react";
import { Icon } from "../icons";
import { findOnBoard, syncToRankings } from "@/lib/ai-rankings/fromDashboard";
import { getData } from "@/lib/ai-rankings/store";
import type { Item } from "@/lib/recall/types";

// ---------------------------------------------------------------------------
// The Sync button on an entry in the AI Rankings folder.
//
// Two states, told apart by colour so a glance down the folder says which
// entries are already on the board: an outlined "Sync" (not sent) and a filled
// green chip naming the section it was filed under (on the board). The green
// chip opens the AI Rankings tab.
// ---------------------------------------------------------------------------

export function RankingsSyncButton({
  item,
  onToast,
}: {
  item: Item;
  onToast: (m: string) => void;
}) {
  // Read the board on render: it lives in localStorage and is small, and a
  // record deleted in the app should turn this button back to "Sync".
  const onBoard = findOnBoard(item, getData().tools);
  const [busy, setBusy] = useState(false);
  const [, bump] = useState(0);

  if (onBoard) {
    return (
      <button
        type="button"
        onClick={() => window.open("/apps/ai-rankings", "_blank", "noreferrer")}
        title={`On the board as “${onBoard.name}” — open AI Rankings`}
        className="inline-flex max-w-[45%] shrink-0 items-center gap-1 rounded-md border border-emerald-400/30 bg-emerald-500/15 px-1.5 py-0.5 text-[10.5px] font-medium text-emerald-200 transition hover:bg-emerald-500/25"
      >
        <Icon.Check width={10} height={10} className="shrink-0" />
        <span className="truncate">
          {onBoard.group} › {onBoard.category}
        </span>
      </button>
    );
  }

  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const { tool } = await syncToRankings(item);
          onToast(`Filed under ${tool.group} › ${tool.category}`);
        } catch (e) {
          onToast(e instanceof Error ? e.message : "Couldn't sync that one.");
        } finally {
          setBusy(false);
          bump((n) => n + 1);
        }
      }}
      title="Add this to the AI Rankings app — it picks the section from the name"
      className="inline-flex shrink-0 items-center gap-1 rounded-md border border-brand/40 px-1.5 py-0.5 text-[10.5px] font-medium text-brand transition hover:bg-brand/10 disabled:opacity-60"
    >
      <Icon.Refresh width={10} height={10} className={busy ? "animate-spin" : ""} />
      {busy ? "Filing…" : "Sync"}
    </button>
  );
}
