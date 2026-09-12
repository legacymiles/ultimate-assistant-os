// ---------------------------------------------------------------------------
// Which stored blobs are still owned by something.
//
// The Dashboard sweeps IndexedDB on load, deleting every blob nothing refers
// to. It used to count only ITEMS as owners — but a photo waiting in the review
// queue is not an item yet, and its full-size blob lives in the same store. So
// every load deleted the image of every photo still awaiting review: import
// fifty photos, refresh the page, and approving them afterwards filed fifty
// broken images, with "Re-read" failing as "no longer stored locally".
//
// Kept pure, with no browser imports, so the rule that decides what gets
// deleted can be tested directly. A sweep is the one operation here that
// destroys data, and it should not be verified only by clicking around.
// ---------------------------------------------------------------------------

/** Anything that may hold a stored file, shaped like a Dashboard item. */
export interface ItemFileHolder {
  attachment?: { fileId?: string | null } | null;
}

/** Anything that may hold a stored file, shaped like a queued photo. */
export interface QueuedFileHolder {
  fileId?: string | null;
}

/**
 * Every fileId that must survive a sweep.
 *
 * Add a source here whenever something new starts storing blobs; a blob whose
 * owner is missing from this set will be deleted on the next page load.
 */
export function referencedFileIds(
  items: readonly ItemFileHolder[],
  queued: readonly QueuedFileHolder[],
): Set<string> {
  const ids = new Set<string>();
  for (const it of items) if (it.attachment?.fileId) ids.add(it.attachment.fileId);
  for (const p of queued) if (p.fileId) ids.add(p.fileId);
  return ids;
}
