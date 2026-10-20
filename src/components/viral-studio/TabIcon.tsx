import type { TabId } from "@/lib/viral-studio/types";

/** One small line icon per board. Drawn here so nothing external is loaded. */
export function TabIcon({ tab }: { tab: TabId }) {
  return (
    <svg className="vsc-tab-icon" viewBox="0 0 24 24" aria-hidden="true">
      {tab === "audio" && (
        <>
          <path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2" />
        </>
      )}
      {tab === "fights" && <path d="M13 2 5 13h6l-1 9 8-11h-6l1-9z" />}
      {tab === "dances" && (
        <>
          <circle cx="13" cy="4.5" r="1.8" />
          <path d="M13 7.5 11 13l3 3 1 6M11 13l-4 2-1 5M12 9l4 2 3-2M12 9 8 7.5 5 9" />
        </>
      )}
      {tab === "motion" && <path d="M2 15c2.5 0 2.5-3 5-3s2.5 3 5 3 2.5-3 5-3 2.5 3 5 3M2 20c2.5 0 2.5-3 5-3s2.5 3 5 3 2.5-3 5-3 2.5 3 5 3M14 4l4 4-4 4" />}
    </svg>
  );
}
