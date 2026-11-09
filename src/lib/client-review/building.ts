// ---------------------------------------------------------------------------
// What is being built right now, across everything this person can see.
//
// There is no Building screen any more: a build plays out in the Chat Intake
// on the page being edited, and these rows are what that chat reads. One row
// per project with a version in flight, so a page can find its own.
//
// A finished build keeps its row for a short while AFTER the version ships,
// marked `ready` and carrying the address. That window is what lets a page
// tell "it is done" from "it was stopped" — opposite things to say to someone
// who has been watching — instead of the row simply vanishing on a poll.
// ---------------------------------------------------------------------------

import { currentVersion, buildingVersion } from "./logic";
import type { ClientProject } from "./types";

/** How long a finished build stays on the screen, so the flip can be seen. */
export const READY_WINDOW_MS = 3 * 60_000;

export interface BuildRow {
  /** The project's review link — how the screen opens it. */
  token: string;
  /**
   * The project id, which the admin API works in. Owner-only, like
   * `threadId`: a client has nothing to call that takes one.
   */
  projectId?: string;
  name: string;
  /** Set for the owner's own hub apps: the route the built version lives at. */
  appSlug?: string;
  appPath?: string;
  versionId: string;
  /** "v2" */
  version: string;
  /** What is being built, in the owner's words. */
  summary: string;
  /** When this version was opened, so the screen can say how long it has been. */
  since: string;
  /**
   * `building` while it is being made, `ready` for a short while after it
   * ships. A row never goes straight from `building` to gone.
   */
  state: "building" | "ready";
  /** The address to open. Only on a `ready` row. */
  siteUrl?: string;
  /**
   * Why the last press of build did not start one. Present exactly when the
   * row is stuck: a version marked building with nothing behind it.
   */
  error?: { at: string; message: string };
  /**
   * The harness thread building it, so the owner can watch and answer it from
   * this screen. Owner-only: the endpoint strips it for a client, who has no
   * PC to talk to and no business knowing one exists.
   */
  threadId?: string;
}

function rowFor(p: ClientProject, now: number): BuildRow | null {
  const app = p.appSlug ? { appSlug: p.appSlug, ...(p.appPath ? { appPath: p.appPath } : {}) } : {};
  const making = buildingVersion(p);
  if (making) {
    const opener = p.batches.find((b) => b.nextVersionId === making.id);
    const thread = opener?.build?.threadId;
    return {
      ...(thread ? { threadId: thread } : {}),
      ...(!thread && opener?.buildError ? { error: opener.buildError } : {}),
      projectId: p.id,
      token: p.token,
      name: p.name,
      ...app,
      versionId: making.id,
      version: making.number,
      summary: making.summary,
      since: making.createdAt,
      state: "building",
    };
  }

  // Just finished. `readyAt` rather than `updatedAt`: editing the project's
  // name should not put a finished build back on everyone's screen.
  const live = currentVersion(p);
  const at = live?.readyAt ? Date.parse(live.readyAt) : NaN;
  if (!live || Number.isNaN(at) || now - at > READY_WINDOW_MS || at > now + 60_000) return null;
  return {
    projectId: p.id,
    token: p.token,
    name: p.name,
    ...app,
    versionId: live.id,
    version: live.number,
    summary: live.summary,
    since: live.createdAt,
    state: "ready",
    siteUrl: live.siteUrl,
  };
}

/**
 * Every build worth showing, newest first.
 *
 * Archived projects are left out; a project nobody is looking at any more is
 * not something to wait on. Everything else is the caller's to filter — this
 * function does not know whether it is being asked by the owner or a client.
 */
export function buildingRows(projects: ClientProject[], now = Date.now()): BuildRow[] {
  const rows: BuildRow[] = [];
  for (const p of projects) {
    if (p.archived) continue;
    const row = rowFor(p, now);
    if (row) rows.push(row);
  }
  return rows.sort(
    (a, b) =>
      // Finished rows sit at the top: they are the ones about to take someone
      // somewhere, and a row that is leaving should not be scrolled to.
      Number(b.state === "ready") - Number(a.state === "ready") ||
      Date.parse(b.since) - Date.parse(a.since),
  );
}

/** How long it has been building, in the words a person would use. */
export function waitedFor(since: string, now = Date.now()): string {
  const ms = now - Date.parse(since);
  if (!Number.isFinite(ms) || ms < 0) return "just now";
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "just started";
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  const rest = mins % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}
