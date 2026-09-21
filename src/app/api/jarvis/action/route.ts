import { NextResponse } from "next/server";
import { connector } from "@/lib/jarvis/server/connectors";
import { DASHBOARD_TOOLS, isReadOnly } from "@/lib/jarvis/tools";

const DASHBOARD_TOOL_NAMES = DASHBOARD_TOOLS.map((t) => t.name);

// The ONLY place an action with outside effects is executed. It runs on an
// explicit request from the confirm card — never from the agent loop.
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    tool?: string;
    args?: Record<string, unknown>;
    confirmed?: boolean;
  };
  const tool = body.tool ?? "";
  if (!tool) return NextResponse.json({ error: "Which action?" }, { status: 400 });

  // Belt and braces: a write can only arrive here with confirmed: true, which
  // only the confirm card sends.
  if (!isReadOnly({ name: tool }) && body.confirmed !== true) {
    return NextResponse.json({ error: "That action needs to be confirmed first." }, { status: 403 });
  }

  // Dashboard actions run in the browser, where folders and the owner's own
  // calendar live. One arriving here means a client skipped that path.
  if (DASHBOARD_TOOL_NAMES.includes(tool)) {
    return NextResponse.json({ error: "That action runs in the app, not on the server." }, { status: 400 });
  }

  const c = connector();
  if (!c.available) return NextResponse.json({ error: c.reason }, { status: 400 });

  try {
    const result = await c.call(tool, body.args ?? {});
    return NextResponse.json({ ok: true, result });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "The action failed." },
      { status: 502 },
    );
  }
}
