import "server-only";

// ---------------------------------------------------------------------------
// Composio: one key, one user id, and every app the owner has connected in
// Composio's own dashboard becomes something Jarvis can use.
//
// Two decisions worth knowing:
//
// 1. Tools are DISCOVERED, not hardcoded. Composio renames slugs, and a
//    hardcoded "GMAIL_SEND_EMAIL" silently stops existing. Instead the
//    toolkit's tools are fetched and the few that matter are picked by what
//    they do, with their real argument schemas attached.
// 2. Only a handful per app reach the model. A toolkit can expose a hundred
//    tools; sending them all would bury the prompt and cost a fortune.
// ---------------------------------------------------------------------------

import { isReadOnly, type ToolSpec } from "../../tools";
import { missingConnector, type ConnectedApp, type Connector } from "./types";

const BASE = "https://backend.composio.dev/api/v3";

/** Apps Jarvis knows what to do with, in the order they matter to the owner. */
export const KNOWN_APPS: { slug: string; name: string }[] = [
  { slug: "gmail", name: "Gmail" },
  { slug: "googlecalendar", name: "Google Calendar" },
  { slug: "outlook", name: "Outlook" },
  { slug: "slack", name: "Slack" },
  { slug: "instagram", name: "Instagram" },
  { slug: "linkedin", name: "LinkedIn" },
  { slug: "x", name: "X" },
  { slug: "notion", name: "Notion" },
];

/**
 * What a tool has to be about to be worth offering. A tool matching none of
 * these is left out — the model cannot call what it never sees, which is the
 * cheapest way to keep it away from "delete all mail".
 */
const WANTED = [
  /fetch.*(email|message)/i,
  /list.*(email|message|thread|event)/i,
  /search.*(email|message|people)/i,
  /get.*(message|event|profile)/i,
  /send.*(email|message|dm)/i,
  /reply/i,
  /create.*(draft|event|message)/i,
  /update.*event/i,
  /delete.*event/i,
  /find.*(event|email|message)/i,
  /post.*message/i,
];

/** Never offered, whatever the toolkit calls them. */
const FORBIDDEN = [/delete.*(email|message|thread|contact)/i, /trash/i, /archive.*all/i, /batch.*delete/i];

interface ComposioTool {
  slug: string;
  name: string;
  description?: string;
  input_parameters?: Record<string, unknown>;
  toolkit?: { slug?: string; name?: string };
  is_deprecated?: boolean;
}

function key(): string {
  return process.env.COMPOSIO_API_KEY ?? "";
}

/** Composio's per-user namespace. One owner here, so a constant is enough. */
function userId(): string {
  return process.env.COMPOSIO_USER_ID || "owner";
}

async function api(path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "x-api-key": key(),
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Composio ${res.status}: ${text.slice(0, 300)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

/** "gmail.send_email" ⇄ "GMAIL_SEND_EMAIL". The model sees the readable form. */
export function toModelName(slug: string): string {
  const [toolkit, ...rest] = slug.split("_");
  return `${toolkit.toLowerCase()}.${rest.join("_").toLowerCase()}`;
}

export function toComposioSlug(modelName: string): string {
  return modelName.replace(".", "_").toUpperCase();
}

export function composioConnector(): Connector {
  if (!key()) {
    return missingConnector(
      "No COMPOSIO_API_KEY is set, so no accounts are connected. Add the key and connect your apps at app.composio.dev.",
    );
  }

  return {
    id: "composio",
    available: true,
    reason: "",

    async listApps(): Promise<ConnectedApp[]> {
      const data = (await api(
        `/connected_accounts?user_ids=${encodeURIComponent(userId())}&limit=50`,
      )) as { items?: { id?: string; status?: string; toolkit?: { slug?: string; name?: string } }[] };
      const connected = new Map<string, { id?: string; status?: string; name?: string }>();
      for (const item of data.items ?? []) {
        const slug = item.toolkit?.slug?.toLowerCase();
        if (slug) connected.set(slug, { id: item.id, status: item.status, name: item.toolkit?.name });
      }
      // Known apps first, in a fixed order, then anything else the owner has
      // connected that this app has no special handling for.
      const known = KNOWN_APPS.map((a) => ({
        slug: a.slug,
        name: a.name,
        connected: connected.has(a.slug),
        accountId: connected.get(a.slug)?.id,
        status: connected.get(a.slug)?.status,
      }));
      const extra = [...connected.entries()]
        .filter(([slug]) => !KNOWN_APPS.some((a) => a.slug === slug))
        .map(([slug, v]) => ({ slug, name: v.name ?? slug, connected: true, accountId: v.id, status: v.status }));
      return [...known, ...extra];
    },

    async listTools(apps: string[]): Promise<ToolSpec[]> {
      const out: ToolSpec[] = [];
      for (const app of apps) {
        let tools: ComposioTool[] = [];
        try {
          const data = (await api(`/tools?toolkit_slug=${encodeURIComponent(app)}&limit=200`)) as {
            items?: ComposioTool[];
          };
          tools = data.items ?? [];
        } catch {
          continue; // One unreachable toolkit must not cost the others.
        }
        const picked = tools
          .filter((t) => !t.is_deprecated)
          .filter((t) => WANTED.some((re) => re.test(t.slug) || re.test(t.name ?? "")))
          .filter((t) => !FORBIDDEN.some((re) => re.test(t.slug)))
          .slice(0, 8);

        for (const t of picked) {
          const name = toModelName(t.slug);
          out.push({
            name,
            description: `${t.description ?? t.name} (via ${t.toolkit?.name ?? app})`,
            parameters:
              (t.input_parameters as Record<string, unknown>) ?? { type: "object", properties: {} },
            app,
            // Composio does not publish a read-only flag, so the name decides —
            // and an unrecognised name counts as a write, needing confirmation.
            readOnlyHint: isReadOnly({ name }),
          });
        }
      }
      return out;
    },

    async call(tool: string, args: Record<string, unknown>): Promise<unknown> {
      const slug = toComposioSlug(tool);
      const data = (await api(`/tools/execute/${encodeURIComponent(slug)}`, {
        method: "POST",
        body: JSON.stringify({ user_id: userId(), arguments: args }),
      })) as { successful?: boolean; error?: string; data?: unknown };
      if (data.successful === false) throw new Error(data.error || `${slug} failed.`);
      return data.data ?? data;
    },

    connectUrl(slug?: string): string {
      return slug ? `https://app.composio.dev/apps/${slug}` : "https://app.composio.dev/apps";
    },
  };
}
