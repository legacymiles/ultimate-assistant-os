// ---------------------------------------------------------------------------
// A stable address for a harness thread.
//
// The thread lives in the bridge, not in the tab that started it. Any surface
// that starts one - Chat, Client Review, App Builder, a notification - needs a
// way to hand the owner the same thread in one link, rather than a threadId
// they would have to paste somewhere.
//
// `#harness` is the thread viewer; the id after it opens that thread. Kept as
// one function so every caller spells it the same way.
// ---------------------------------------------------------------------------

/** `/apps/jarvis#harness/<threadId>` (or the harness start panel). */
export function harnessHref(threadId?: string): string {
  const id = (threadId ?? "").trim();
  return `/apps/jarvis#harness${id ? `/${encodeURIComponent(id)}` : ""}`;
}

/** Read `#harness/<id>` (and the older `#console/harness/<id>`). */
export function harnessFromHash(hash: string): { harness: boolean; threadId: string } {
  const at = hash.indexOf("#");
  const raw = at >= 0 ? hash.slice(at + 1) : hash;
  const [head, second, third] = raw.split("/");
  if (head === "harness") return { harness: true, threadId: second ? decodeURIComponent(second) : "" };
  // Links written while Chat hosted the harness keep working.
  if ((head === "console" || head === "chat") && second === "harness")
    return { harness: true, threadId: third ? decodeURIComponent(third) : "" };
  return { harness: false, threadId: "" };
}
