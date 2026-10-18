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
  lane: ContentLane;
  versions: ReviewVersion[];
  requests: EditRequest[];
  batches: RequestBatch[];
  settings: ClientSettings;
  pushSubs: PushSub[];
  notices: ClientNotice[];
  createdAt: string;
  updatedAt: string;
  archived?: boolean;
}

/** What the owner's dashboard is told about. */
export type AdminEventKind = "batch_sent" | "request_added" | "notify_on";

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
  projects: { id: string; token: string; name: string; clientName: string; updatedAt: string; archived?: boolean }[];
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

export interface PortalView {
  name: string;
  clientName: string;
  versions: ReviewVersion[];
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
}
