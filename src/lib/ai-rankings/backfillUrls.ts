// ---------------------------------------------------------------------------
// The entries that were already in the AI Rankings folder before links were
// filled in automatically.
//
// `siteUrl.ts` only runs when an entry is SAVED, so a folder collected over
// months keeps every one of its old, linkless rows — which is most of them, and
// exactly the rows the owner wanted to be able to click. This is the catch-up
// pass: one press fills in every entry in the folder (and its sub-folders) that
// has no URL yet.
//
// It writes, so it is a button and never a side effect of opening the folder.
// Entries that already have a link are not touched, not re-checked and not
// overwritten — a link the owner typed outranks anything found here.
// ---------------------------------------------------------------------------

import { setItemFields, updateItem } from "@/lib/recall/store";
import type { Item, RecallData } from "@/lib/recall/types";
import { itemUrl } from "./fromDashboard";
import { resolveSiteUrl } from "./siteUrl";

/** How many lookups are in flight at once — enough to be quick, few enough to be polite. */
const LANES = 3;

export interface BackfillResult {
  /** Entries that now have a link they did not have before. */
  filled: number;
  /** Entries left alone because a name gave nothing to go on. */
  skipped: number;
}

/**
 * The entries this pass would touch: everything in the folder subtree with a
 * name but no URL. Notes and to-dos are included — a to-do called "try Kling"
 * is still a tool worth linking — but anything nameless is not.
 */
export function itemsNeedingUrl(items: Item[], folderIds: Set<string>): Item[] {
  return items.filter(
    (i) => i.folderId !== null && folderIds.has(i.folderId) && !itemUrl(i) && i.title.trim(),
  );
}

/** Write one resolved URL onto an entry, in both places a row reads it from. */
export function applyUrl(item: Item, url: string): RecallData {
  const data = updateItem(item.id, { url });
  // A website/credential row shows `fields.url`; everything else reads `url`.
  return item.fields || item.kind === "website" ? setItemFields(item.id, { url }) : data;
}

/**
 * Fill in the missing links, a few at a time. `onProgress` is called after each
 * entry so the button can count up; the data is saved entry by entry, so
 * closing the tab half way through keeps what was already found.
 */
export async function backfillUrls(
  targets: Item[],
  onProgress?: (done: number, total: number, data: RecallData) => void,
): Promise<BackfillResult> {
  const result: BackfillResult = { filled: 0, skipped: 0 };
  let done = 0;
  let next = 0;

  async function lane(): Promise<void> {
    for (let i = next++; i < targets.length; i = next++) {
      const item = targets[i];
      let data: RecallData | undefined;
      try {
        const { url } = await resolveSiteUrl(item.title);
        if (url) {
          data = applyUrl(item, url);
          result.filled += 1;
        } else {
          result.skipped += 1;
        }
      } catch {
        // One dead lookup must not strand the other twenty.
        result.skipped += 1;
      }
      done += 1;
      onProgress?.(done, targets.length, data ?? ({} as RecallData));
    }
  }

  await Promise.all(Array.from({ length: Math.min(LANES, targets.length) }, lane));
  return result;
}

/** What the toast says once it has run. */
export function backfillNote(r: BackfillResult): string {
  if (!r.filled && !r.skipped) return "Every entry already has a link.";
  const filled = `${r.filled} link${r.filled === 1 ? "" : "s"} added`;
  const rest = r.skipped ? `, ${r.skipped} left blank — no site found` : "";
  return `${filled}${rest}. Check any that look wrong.`;
}
