// ---------------------------------------------------------------------------
// Client Review — the shapes.
//
// A client gets a private link to the website the owner is building for them.
// On that link they see the current version of their site with a Chat Intake
// floating over it, type as many edit requests as they like, and press "Send
// to Jarvis". The batch lands with the owner (the admin), who approves, edits
// or improves it; approving opens the next version (v2, v3 …). When the owner
// posts that version's URL the client is told it is ready.
//
// One document per client project, owned by the server (see store.ts), so a
// client can only ever reach their own project, and only through their link.
// ---------------------------------------------------------------------------

import type { LookChoice } from "@/lib/mockup/types";

/** Which model lane writes the build brief. */
export type ContentLane = "auto" | "standard" | "uncensored";

/**
 *  review     — live, the client can add requests to it
 *  building   — approved changes are being made; this is the version being built
 *  superseded — an older version, kept for the timeline
 */
export type VersionStatus = "review" | "building" | "superseded";

export interface ReviewVersion {
  id: string;
  /** "v1", "v2" … */
  number: string;
  /** The URL the client's screen frames. Empty while a version is still being built. */
  siteUrl: string;
  /** What changed in this version, in the owner's words (or the approved brief). */
  summary: string;
  status: VersionStatus;
  createdAt: string;
  /** When the owner marked it ready for the client. */
  readyAt?: string;
  /**
   * Built by App Builder from a client edit batch: the branch it lives on in
   * the client's repo and the pull request that puts it live once the owner
   * merges it. Owner-only — never sent to the client.
   */
  branch?: string;
  prUrl?: string;
  /** Who posted the URL: the owner by hand, or Claude Code through the connector. */
  shippedBy?: "owner" | "claude-code";
  /** A small screenshot of this version's page, as it looked when it landed. */
  image?: string;
  /** The screenshot taken just before this version's edit was built. */
  beforeImage?: string;
}

/**
 *  draft    — the client has written it, not sent yet; they can still change it
 *  sent     — sent to Jarvis, waiting on the owner
 *  approved — the owner accepted it (possibly reworded)
 *  rejected — the owner turned it down
 *  done     — shipped in a later version
 */
export type RequestStatus = "draft" | "sent" | "approved" | "rejected" | "done";

/** Where on the screen the client pointed, as fractions of the frame. */
export interface RequestPin {
  x: number;
  y: number;
  /** The frame's width when they pointed, so "top-right on a phone" survives. */
  viewport: number;
}

export interface EditRequest {
  id: string;
  versionId: string;
  text: string;
  pin?: RequestPin;
  status: RequestStatus;
  createdAt: string;
  sentAt?: string;
  /** The owner's rewording. When set, this is what gets built. */
  adminText?: string;
  /** A note the client sees on a rejected or reworded request. */
  adminNote?: string;
  /** Which batch carried it to the owner. */
  batchId?: string;
}

export type BatchStatus = "pending" | "approved" | "rejected";

/** One press of "Send to Jarvis". */
export interface RequestBatch {
  id: string;
  versionId: string;
  requestIds: string[];
  sentAt: string;
  status: BatchStatus;
  /** The build brief — AI-written, then the owner's to edit. */
  brief?: string;
  /** The model that wrote the brief, and whether the uncensored lane took it. */
  briefModel?: string;
  briefLane?: "standard" | "uncensored";
  decidedAt?: string;
  /** The version this batch opened when it was approved. */
  nextVersionId?: string;
  /** Handed to App Builder and queued for Claude Code. */
  build?: BatchBuild;
  /**
   * The last time pressing build did not start one, and what it said.
   *
   * Kept on the batch rather than shown once and forgotten. A build that
   * fails to start leaves no thread, no queue entry and no trace — the reason
   * lived in a toast that was gone on the next render, which is how a version
   * sat on "building" with nobody able to say why. Cleared the moment a build
   * does start.
   */
  buildError?: { at: string; message: string };
}

/** Where an approved batch went to be built. */
export interface BatchBuild {
  /** The App Builder project made from it. */
  builderId: string;
  /** The In Queue request, when the build was filed rather than started. */
  queueId?: string;
  /**
   * The bridge's harness thread, when the build is running on the owner's PC.
   * That is the difference between "being built" and "filed and waiting", and
   * the console reads it to show which one this is.
   */
  threadId?: string;
  at: string;
}

export interface ClientSettings {
  /** The client said yes to being notified. */
  notify: boolean;
}

/** A browser push subscription, as PushSubscription.toJSON() gives it. */
export interface PushSub {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  addedAt: string;
}

/** Something the client should hear about the next time they look. */
export interface ClientNotice {
  id: string;
  at: string;
  title: string;
  body: string;
  read: boolean;
}

export interface ClientProject {
  id: string;
  /** The private link's secret. Owner-only; the client knows it as their URL. */
  token: string;
  name: string;
  clientName: string;
  /** Projects Timeline project this mirrors into, when linked. */
  timelineProjectId?: string;
  /**
   * Where the client's site lives, so approved edits can be built without the
   * owner: the GitHub repo ("owner/name") and the Vercel project that deploys
   * it (a preview per branch). Set once per client.
   */
  repo?: string;
  vercelProject?: string;
  /**
   * One of the owner's own hub apps (catalog slug), opened from the Client
   * view's site picker so the owner can edit it on the page like a client.
   * `appPath` is its route ("/apps/cook-connect"): v1 frames it same-origin,
   * and builds post the branch preview at that path.
   */
  appSlug?: string;
  appPath?: string;
  /**
   * Who may open the link. The client signs in with their Jarvis account
   * (Google); the first account to open it claims it, and after that only that
   * account (and the owner) can. `inviteEmail`, when the owner set one, is the
   * only email allowed to claim.
   */
  inviteEmail?: string;
  clientUserId?: string;
  clientUserEmail?: string;
  claimedAt?: string;
  /**
   * When the owner sent this to the client.
   *
   * Until it is set the project is OWNER-ONLY: it is not in the client's list,
   * and its link does not open even for someone holding the token. This
   * matters now that App Builder opens a review project for every build — most
   * of those are the owner's own apps and were never meant for a client to
   * see, so visibility is something the owner grants rather than something a
   * project has merely by existing. `isSentToClient` is the one place that
   * decides, and it grandfathers projects a client had already claimed before
   * this field existed.
   */
  sentAt?: string;
  /**
   * The design direction the spec recommended, when App Builder opened this
   * link. It is lane 1 of the mockup bake-off and it never changes, which is
   * what keeps the three directions on offer STABLE: compute them from the
   * pick instead and re-picking one of the original three would be rejected
   * the moment the first choice moved the set.
   */
  designSkill?: string;
  /**
   * The direction settled on for this site — by the owner in App Builder, or
   * by the client approving one of the mockups on their own link.
   */
  look?: LookChoice;
  lane: ContentLane;
  /**
   * The one model that writes this project's build briefs, when the owner
   * picked one from the menu (src/lib/client-review/models.ts). "" or missing
   * means "use the lane" — Claude first, the uncensored chain if it refuses —
   * which is what every project made before the menu existed has.
   */
  briefModel?: string;
  versions: ReviewVersion[];
  requests: EditRequest[];
  batches: RequestBatch[];
  /**
   * The harness thread building a version App Builder opened (a NEW app, not a
   * client edit — those already carry `batch.build.threadId`). It is how the
   * client's own page can narrate a first build: without it the page knows a
   * version is "building" but has no thread to watch.
   *
   * Owner-only. `buildingRows` hands it to the owner and the portal endpoint
   * strips it for a client.
   */
  buildWatch?: { threadId: string; builderId?: string; versionId?: string; at: string };
  settings: ClientSettings;
  pushSubs: PushSub[];
  notices: ClientNotice[];
  createdAt: string;
  updatedAt: string;
  archived?: boolean;
}

/** What the owner's dashboard is told about. */
export type AdminEventKind = "batch_sent" | "request_added" | "notify_on" | "claimed" | "preview_sent" | "look_picked";

export interface AdminEvent {
  id: string;
  kind: AdminEventKind;
  projectId: string;
  projectName: string;
  clientName: string;
  at: string;
  /** "3 edit requests for v2". */
  detail: string;
}

/** The index: who exists, and which link opens which project. */
export interface ReviewIndex {
  projects: {
    id: string;
    token: string;
    name: string;
    clientName: string;
    updatedAt: string;
    archived?: boolean;
    /** The client account that claimed the link, so /review can list their sites. */
    clientUserId?: string;
    /** Set when the project is one of the owner's own hub apps. */
    appSlug?: string;
  }[];
  events: AdminEvent[];
}

// ----- what the client's browser is allowed to see -------------------------

export interface PortalRequest {
  id: string;
  versionId: string;
  text: string;
  pin?: RequestPin;
  status: RequestStatus;
  createdAt: string;
  /** The reworded version, shown so the client knows what is being built. */
  adminText?: string;
  adminNote?: string;
}

/** A version as the client sees it: no branch, no pull request. */
export type PortalVersion = Pick<
  ReviewVersion,
  "id" | "number" | "siteUrl" | "summary" | "status" | "createdAt" | "readyAt" | "image" | "beforeImage"
>;

export interface PortalView {
  /** The project id, so the owner's version history can call the admin API. */
  projectId: string;
  name: string;
  clientName: string;
  versions: PortalVersion[];
  /** The version the client is looking at: the newest one with a URL. */
  currentVersionId: string | null;
  /** A version being built right now, if any. */
  buildingVersionId: string | null;
  requests: PortalRequest[];
  /** Batches still sitting with the owner. */
  pending: number;
  settings: ClientSettings;
  notices: ClientNotice[];
  /** Web Push public key, when push is configured on this deploy. */
  vapidPublicKey: string | null;
  /** The signed-in account looking at it (added by the route). */
  viewerEmail?: string | null;
  /** The owner is looking (added by the route): Send goes straight to the build. */
  viewerOwner?: boolean;
  /** One of the owner's own hub apps. */
  isApp?: boolean;
  /**
   * The look: what the mockups are drawn in, and which one has been settled
   * on. A design-skill name is not owner-only data — it is the name of a style
   * — and the portal needs both to draw the bake-off and to show which lane is
   * already chosen. The branch and the pull request stay off this view, as
   * they always have.
   */
  designSkill?: string | null;
  look?: LookChoice | null;
}
