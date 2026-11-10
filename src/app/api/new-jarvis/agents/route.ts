import { NextResponse } from "next/server";

import {
  MAX_GOAL,
  add,
  cleanNeeds,
  configure,
  newAgent,
  pause,
  remove,
  resume,
  runNow,
  type AgentRepeat,
  type AgentsDoc,
  type ShipMode,
} from "@/lib/new-jarvis/agents/agents";
import { readAgents, updateAgents } from "@/lib/new-jarvis/server/agentsStore";
import { browserUid } from "@/lib/new-jarvis/server/requestsAuth";

// ---------------------------------------------------------------------------
// 24/7 agents, for the browser.
//
//   GET                                           -> { doc }
//   POST { action: "add", goal, needs?, steps?, folder?, images? }  -> { doc, added }
//        (also pick?, edits?, sendsTo?, ship?, repeat? — see agents.ts)
//   POST { action: "configure", id, pick?, edits?, sendsTo?, ship?, repeat? } -> { doc }
//   POST { action: "pause" | "resume" | "remove" | "run-now", id }  -> { doc }
//
// The runners do NOT come through here. A machine picking up work uses the
// jarvis-memory connector (agent_next / agent_note / agent_handoff /
// agent_done), which resolves to the same document for the same account. This
// route is only the owner looking at, and steering, their own agents.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Big enough for four downscaled pictures; anything larger is refused before parsing. */
const MAX_BODY = 4_500_000;

function signIn() {
  return NextResponse.json({ error: "Sign in to use your agents." }, { status: 401 });
}

function failed(e: unknown, fallback: string) {
  // Plain English, never a stack or a code (R3).
  const message = e instanceof Error ? e.message : fallback;
  return NextResponse.json({ error: message.slice(0, 300) }, { status: 500 });
}

export async function GET() {
  const uid = await browserUid();
  if (!uid) return signIn();
  try {
    return NextResponse.json({ doc: await readAgents(uid) });
  } catch (e) {
    return failed(e, "Couldn't read your agents.");
  }
}

export async function POST(req: Request) {
  const uid = await browserUid();
  if (!uid) return signIn();

  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > MAX_BODY) {
    return NextResponse.json(
      { error: "Those pictures are too big together. Try fewer or smaller ones." },
      { status: 413 },
    );
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "That request was empty." }, { status: 400 });

  const action = String(body.action ?? "");
  const id = typeof body.id === "string" ? body.id : "";
  const at = new Date().toISOString();

  // Everything is checked here, on the server, whatever the browser sent (S4).
  if (action === "add") {
    const goal = String(body.goal ?? "").trim();
    if (!goal) return NextResponse.json({ error: "Say what the agent should get done." }, { status: 400 });
    if (goal.length > MAX_GOAL) {
      return NextResponse.json({ error: `Keep the goal under ${MAX_GOAL} characters.` }, { status: 400 });
    }
    const steps = Array.isArray(body.steps) ? body.steps.map((s) => String(s)).filter(Boolean) : [];
    const images = Array.isArray(body.images) ? body.images.filter((i) => typeof i === "string") : [];
    if (images.some((i) => !String(i).startsWith("data:image/"))) {
      return NextResponse.json({ error: "A picture couldn't be read — try re-adding it." }, { status: 400 });
    }

    const agent = newAgent({
      goal,
      needs: cleanNeeds(body.needs),
      steps,
      folder: typeof body.folder === "string" ? body.folder : undefined,
      images: images as string[],
      from: "you",
      at,
      // Each one is cleaned in newAgent; a bad value becomes the safe default.
      pick: typeof body.pick === "string" ? body.pick : undefined,
      edits: Array.isArray(body.edits) ? (body.edits as string[]) : undefined,
      sendsTo: Array.isArray(body.sendsTo) ? (body.sendsTo as string[]) : undefined,
      ship: body.ship as ShipMode | undefined,
      repeat: body.repeat as AgentRepeat | undefined,
    });
    try {
      const doc = await updateAgents(uid, (d): AgentsDoc => add(d, agent));
      return NextResponse.json({ doc, added: agent.id });
    } catch (e) {
      return failed(e, "Couldn't save that agent.");
    }
  }

  if (action === "configure") {
    if (!id) return NextResponse.json({ error: "Which agent?" }, { status: 400 });
    try {
      const doc = await updateAgents(uid, (d): AgentsDoc =>
        configure(
          d,
          id,
          {
            ...(typeof body.pick === "string" ? { pick: body.pick } : {}),
            ...(Array.isArray(body.edits) ? { edits: body.edits as string[] } : {}),
            ...(Array.isArray(body.sendsTo) ? { sendsTo: body.sendsTo as string[] } : {}),
            ...(body.ship !== undefined ? { ship: body.ship as ShipMode } : {}),
            ...(body.repeat !== undefined ? { repeat: body.repeat as AgentRepeat } : {}),
          },
          at,
        ),
      );
      return NextResponse.json({ doc });
    } catch (e) {
      return failed(e, "Couldn't change that agent.");
    }
  }

  if (action !== "pause" && action !== "resume" && action !== "remove" && action !== "run-now") {
    return NextResponse.json({ error: "That isn't something an agent can do." }, { status: 400 });
  }
  if (!id) return NextResponse.json({ error: "Which agent?" }, { status: 400 });

  try {
    const doc = await updateAgents(uid, (d): AgentsDoc => {
      if (action === "pause") return pause(d, id, at);
      if (action === "resume") return resume(d, id, at);
      if (action === "run-now") return runNow(d, id, at);
      return remove(d, id);
    });
    return NextResponse.json({ doc });
  } catch (e) {
    return failed(e, "Couldn't change that agent.");
  }
}
