// ---------------------------------------------------------------------------
// When an edit gets painted before it gets built.
//
// The owner's standing rule (10 Nov 2026): every change to a website asked for
// in words is shown as three pictures of that change, on a screenshot of the
// real page, before any code is touched. The Studio's Send honours it — but
// only where it CAN: a request needs a page with an address to be painted onto,
// and a build already running is past the point where a picture helps.
//
// It lives here, away from the component, because it is the rule rather than a
// detail of one screen: the same question is asked by the tab list, by the
// canvas and by Send, and three copies of it would drift.
// ---------------------------------------------------------------------------

/** The slice of a portal view this question actually needs. */
export interface PaintableSite {
  /** The address of the version the edit was asked against, if it has one. */
  liveUrl?: string | null;
  /** A build already in flight. */
  building?: boolean;
  requests: { status: string }[];
}

/** The request states that are waiting for a build — the ones worth painting. */
const WAITING = new Set(["sent", "approved"]);

export function hasWaitingEdit(site: PaintableSite): boolean {
  return site.requests.some((r) => WAITING.has(r.status));
}

/**
 * Should this edit be painted three ways before it is built?
 *
 * A client never sees the look pass as a gate — they ask, the owner decides —
 * so `owner` is part of the question rather than checked around it.
 */
export function needsLookPass(site: PaintableSite, owner: boolean): boolean {
  if (!owner) return false;
  if (!site.liveUrl) return false;
  if (site.building) return false;
  return hasWaitingEdit(site);
}

/**
 * Can a brand-new edit be painted at all, before it has been filed?
 *
 * Send asks this the moment before it files the request, when nothing is
 * waiting yet — so it must not ask for a waiting edit.
 */
export function canPaintEdit(site: Pick<PaintableSite, "liveUrl" | "building">, owner: boolean): boolean {
  return owner && Boolean(site.liveUrl) && !site.building;
}
