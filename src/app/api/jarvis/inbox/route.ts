import { NextResponse } from "next/server";
import { connector, findTool, normaliseMessages } from "@/lib/jarvis/server/connectors";
import { memoryContext, saveMemories } from "@/lib/jarvis/server/memory";

// Pulls recent messages from every connected messaging app and normalises them
// into one list. Read-only: nothing here sends anything.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MESSAGING_APPS = ["gmail", "outlook", "slack"];

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit")) || 15));
  const remember = url.searchParams.get("remember") !== "0";

  const c = connector();
  if (!c.available) {
    return NextResponse.json({ available: false, reason: c.reason, messages: [], apps: [] });
  }

  try {
    const apps = (await c.listApps()).filter((a) => a.connected && MESSAGING_APPS.includes(a.slug));
    if (!apps.length) {
      return NextResponse.json({
        available: true,
        messages: [],
        apps: [],
        note: "No mailbox or chat app is connected yet.",
      });
    }

    const tools = await c.listTools(apps.map((a) => a.slug));
    const messages = [];
    const failures: string[] = [];

    for (const app of apps) {
      const tool = findTool(tools, app.slug, /fetch|list|search|find/);
      if (!tool) {
        failures.push(`${app.name}: no tool for reading messages.`);
        continue;
      }
      try {
        const result = await c.call(tool, { max_results: limit, maxResults: limit, limit });
        messages.push(...normaliseMessages(app.slug, result).slice(0, limit));
      } catch (e) {
        failures.push(`${app.name}: ${e instanceof Error ? e.message : "failed"}`);
      }
    }

    messages.sort((a, b) => b.at.localeCompare(a.at));

    // Messages become memories too, so Jarvis can answer "what did Sam say
    // about the invoice?" later without the mailbox being open.
    if (remember && messages.length) {
      const ctx = await memoryContext();
      if (ctx.available) {
        try {
          await saveMemories(
            ctx,
            messages.slice(0, 40).map((m) => ({
              source: "email" as const,
              title: `${m.subject} — ${m.from}`,
              content: m.body.slice(0, 4000),
              origin: `${m.app}: ${m.from}`,
              externalId: `${m.app}:${m.id}`,
              capturedAt: m.at,
            })),
          );
        } catch {
          // Remembering is a bonus; the inbox still works without it.
        }
      }
    }

    return NextResponse.json({
      available: true,
      messages,
      apps: apps.map((a) => ({ slug: a.slug, name: a.name })),
      failures,
    });
  } catch (e) {
    return NextResponse.json({
      available: false,
      reason: e instanceof Error ? e.message : "Couldn't reach your apps.",
      messages: [],
      apps: [],
    });
  }
}
