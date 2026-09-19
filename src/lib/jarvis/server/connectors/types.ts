import "server-only";

// ---------------------------------------------------------------------------
// The seam between Jarvis and the outside world.
//
// Everything Jarvis can do to a real account — read a mailbox, add a calendar
// event, send a message — goes through a Connector. There is one today
// (Composio, which brings a thousand apps behind a single key) and a second
// planned (Google direct, for when the free tool-call allowance runs out).
// Neither the agent nor the UI knows which is in use.
// ---------------------------------------------------------------------------

import type { ToolSpec } from "../../tools";

export interface ConnectedApp {
  /** Toolkit slug, lowercase: "gmail", "googlecalendar", "slack". */
  slug: string;
  name: string;
  connected: boolean;
  /** The connector's id for this connection, when it has one. */
  accountId?: string;
  /** "active", "failed", … as the connector reports it. */
  status?: string;
}

export interface NormalisedMessage {
  id: string;
  app: string;
  from: string;
  subject: string;
  body: string;
  at: string;
  link?: string;
}

export interface NormalisedEvent {
  id: string;
  app: string;
  title: string;
  /** Local date YYYY-MM-DD. */
  date: string;
  start: string;
  end: string;
  timezone: string;
  where?: string;
  notes?: string;
}

export interface Connector {
  id: "composio" | "google";
  /** False when this connector has no key configured. */
  available: boolean;
  /** Why it is unavailable, in words the owner can act on. */
  reason: string;
  listApps(): Promise<ConnectedApp[]>;
  /** The tools to offer the model, already classified read vs write. */
  listTools(apps: string[]): Promise<ToolSpec[]>;
  call(tool: string, args: Record<string, unknown>): Promise<unknown>;
  /** Where the owner goes to connect an app. */
  connectUrl(slug?: string): string;
}

/** A connector that exists only to explain why nothing is connected. */
export function missingConnector(reason: string): Connector {
  return {
    id: "composio",
    available: false,
    reason,
    listApps: async () => [],
    listTools: async () => [],
    call: async () => {
      throw new Error(reason);
    },
    connectUrl: () => "https://app.composio.dev",
  };
}
