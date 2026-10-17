// ---------------------------------------------------------------------------
// "Is memory + skill sync set up, and what do I do next on THIS device?"
//
// Pure: takes what /api/jarvis/sync-status reports plus which device the page
// is open on, returns the overall state, the checklist, and the one next step
// for this device. The Skills everywhere card, the New Jarvis Skills tab and
// the Finish setup checklist all read the same answer from here.
// ---------------------------------------------------------------------------

export type DeviceKind = "phone" | "windows" | "mac" | "linux" | "other";

export interface DeviceSeen {
  host: string;
  os: string;
  lastSeen: string;
  lastAction: string;
  skillCount: number | null;
}

export interface SyncStatusReport {
  server: { ready: boolean; missing: { env: string; how: string }[] };
  account: { signedIn: boolean; userId: string | null; matchesConnector: boolean | null };
  skills: { count: number } | null;
  connector: { lastSeen: string; clients: Record<string, string> } | null;
  devices: DeviceSeen[];
}

export type SyncState = "not-set-up" | "partial" | "ready";

export interface SyncStep {
  id: "server" | "account" | "connector" | "computers";
  title: string;
  detail: string;
  done: boolean;
}

export interface NextStep {
  title: string;
  detail: string;
  /** A command or URL to copy, when the step has one. */
  copy?: string;
  copyLabel?: string;
  done: boolean;
}

export interface SyncPlan {
  state: SyncState;
  headline: string;
  steps: SyncStep[];
  here: NextStep;
}

const DAY = 86_400_000;

export function detectDevice(userAgent: string, maxTouchPoints = 0): DeviceKind {
  const ua = userAgent || "";
  // iPadOS reports itself as a Mac; touch points give it away.
  if (/iPhone|iPod|Android.+Mobile|Windows Phone|Mobile Safari/i.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1) || /iPad|Android/i.test(ua)) {
    return "phone";
  }
  if (/Windows/i.test(ua)) return "windows";
  if (/Macintosh|Mac OS X/i.test(ua)) return "mac";
  if (/Linux|X11|CrOS/i.test(ua)) return "linux";
  return "other";
}

export function ago(iso: string, now: number): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "never";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 90) return "just now";
  const m = Math.round(s / 60);
  if (m < 90) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 36) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

const recent = (iso: string | undefined, now: number, days: number) => {
  const t = Date.parse(iso ?? "");
  return Number.isFinite(t) && now - t < days * DAY;
};

export function syncPlan(r: SyncStatusReport, device: DeviceKind, origin: string, now = Date.now()): SyncPlan {
  const devices = [...r.devices].sort((a, b) => Date.parse(b.lastSeen) - Date.parse(a.lastSeen));
  const activeDevices = devices.filter((d) => recent(d.lastSeen, now, 14));
  const connectorLive = recent(r.connector?.lastSeen, now, 30);
  const clientList = Object.entries(r.connector?.clients ?? {})
    .sort((a, b) => Date.parse(b[1]) - Date.parse(a[1]))
    .map(([name, at]) => `${name} ${ago(at, now)}`)
    .join(", ");

  const steps: SyncStep[] = [
    {
      id: "server",
      title: "Turn on sync in Vercel",
      detail: r.server.ready
        ? "Done — the memory and skill keys are set on this site."
        : `Set ${r.server.missing.map((m) => m.env).join(", ")} in Vercel › Settings › Environment Variables, then redeploy.`,
      done: r.server.ready,
    },
    {
      id: "account",
      title: "Point sync at your account",
      detail:
        r.account.matchesConnector === false
          ? `JARVIS_MCP_USER_ID in Vercel is a different account from the one you're signed in as, so skills and memories saved from Claude land somewhere you can't see. Set it to ${r.account.userId ?? "your user id"} and redeploy.`
          : r.account.matchesConnector === true
            ? "Done — Claude saves into the account you're signed in as."
            : "Sign in to check this.",
      done: r.account.matchesConnector !== false,
    },
    {
      id: "connector",
      title: "Add Jarvis to Claude (phone, claude.ai)",
      detail: connectorLive
        ? `Done — in use: ${clientList}.`
        : r.connector
          ? `Last used ${ago(r.connector.lastSeen, now)} — re-add the connector if it stopped working.`
          : "Not used yet. Add the connector once in claude.ai and it works in Claude Code on your phone too.",
      done: connectorLive,
    },
    {
      id: "computers",
      title: "Set up skill sync on your computers",
      detail: activeDevices.length
        ? `Syncing: ${activeDevices.map((d) => `${d.host} (${d.os}, ${ago(d.lastSeen, now)})`).join(" · ")}.`
        : devices.length
          ? `No computer has synced in two weeks (last: ${devices[0].host}, ${ago(devices[0].lastSeen, now)}). Open Claude Code on it, or re-run setup.`
          : "No computer has synced yet. Run the setup command once on your PC and once on your VPS.",
      done: activeDevices.length > 0,
    },
  ];

  const left = steps.filter((s) => !s.done).length;
  const state: SyncState = !r.server.ready ? "not-set-up" : left ? "partial" : "ready";
  const headline =
    state === "ready"
      ? "Fully set up — memory and skills sync across your devices."
      : state === "not-set-up"
        ? "Not set up — sync is off on this site."
        : `Almost — ${left} step${left === 1 ? "" : "s"} left.`;

  return { state, headline, steps, here: nextHere(r, device, origin, connectorLive, devices, now) };
}

function nextHere(
  r: SyncStatusReport,
  device: DeviceKind,
  origin: string,
  connectorLive: boolean,
  devices: DeviceSeen[],
  now: number,
): NextStep {
  if (!r.server.ready) {
    return {
      title: device === "phone" ? "Finish this on a computer" : "First: turn sync on in Vercel",
      detail:
        `This site is missing ${r.server.missing.map((m) => m.env).join(", ")}. ` +
        "Add them in Vercel › your project › Settings › Environment Variables, then redeploy. Nothing on any device can sync until then.",
      done: false,
    };
  }
  if (r.account.matchesConnector === false) {
    return {
      title: "Fix the account in Vercel",
      detail: `Set JARVIS_MCP_USER_ID to your user id and redeploy, so what Claude saves shows up here.`,
      copy: r.account.userId ?? undefined,
      copyLabel: "your user id",
      done: false,
    };
  }

  if (device === "phone") {
    return connectorLive
      ? {
          title: "Ready on your phone",
          detail:
            "Nothing to install. In Claude Code (or claude.ai) on your phone, ask for a skill — \"make me a skill that…\" — and it's saved to Jarvis, then lands on your computers at their next session.",
          done: true,
        }
      : {
          title: "Add Jarvis to Claude — one time",
          detail:
            "In claude.ai: Settings › Connectors › Add custom connector, and paste this URL with your token in place of YOUR_TOKEN. Claude Code on your phone uses the same connectors, so this one step covers both.",
          copy: `${origin}/api/jarvis/memory/mcp?k=YOUR_TOKEN`,
          copyLabel: "connector URL",
          done: false,
        };
  }

  const shell = device === "windows" ? "PowerShell" : "Terminal";
  const seen = devices.length
    ? ` Computers already syncing: ${devices.map((d) => `${d.host} (${d.os}, ${ago(d.lastSeen, now)})`).join(", ")} — if this is one of them, you're done.`
    : "";
  return {
    title: "Set up this computer (if you use Claude Code on it)",
    detail:
      `Open ${shell} in your hub folder and run this once. It finds your token in the jarvis-memory connector you already added to Claude Code` +
      ` — if this computer doesn't have the connector, add --token and your token at the end.${seen}`,
    copy: "npm run skills:setup",
    copyLabel: "setup command",
    done: false,
  };
}
