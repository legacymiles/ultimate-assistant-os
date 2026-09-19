import { NextResponse } from "next/server";
import { connector, findTool, normaliseEvents } from "@/lib/jarvis/server/connectors";

// Read-only: the calendar is shown from the connected account, and every change
// goes through the confirm card and /api/jarvis/action instead.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CALENDAR_APPS = ["googlecalendar", "outlook"];

export async function GET(req: Request) {
  const url = new URL(req.url);
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";

  const c = connector();
  if (!c.available) {
    return NextResponse.json({ available: false, reason: c.reason, events: [], apps: [] });
  }

  try {
    const apps = (await c.listApps()).filter((a) => a.connected && CALENDAR_APPS.includes(a.slug));
    if (!apps.length) {
      return NextResponse.json({
        available: true,
        events: [],
        apps: [],
        note: "No calendar is connected yet.",
      });
    }

    const tools = await c.listTools(apps.map((a) => a.slug));
    const events = [];
    const failures: string[] = [];

    for (const app of apps) {
      const tool = findTool(tools, app.slug, /event/);
      if (!tool) {
        failures.push(`${app.name}: no tool for reading events.`);
        continue;
      }
      try {
        // Different calendars name the window differently; sending several
        // spellings is cheaper than maintaining a table per toolkit.
        const result = await c.call(tool, {
          timeMin: from ? `${from}T00:00:00Z` : undefined,
          timeMax: to ? `${to}T23:59:59Z` : undefined,
          time_min: from || undefined,
          time_max: to || undefined,
          max_results: 250,
          single_events: true,
        });
        events.push(...normaliseEvents(app.slug, result));
      } catch (e) {
        failures.push(`${app.name}: ${e instanceof Error ? e.message : "failed"}`);
      }
    }

    events.sort((a, b) => `${a.date} ${a.start}`.localeCompare(`${b.date} ${b.start}`));
    return NextResponse.json({
      available: true,
      events,
      apps: apps.map((a) => ({ slug: a.slug, name: a.name })),
      failures,
    });
  } catch (e) {
    return NextResponse.json({
      available: false,
      reason: e instanceof Error ? e.message : "Couldn't reach your calendar.",
      events: [],
      apps: [],
    });
  }
}
