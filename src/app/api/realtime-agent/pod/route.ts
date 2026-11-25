import { NextResponse } from "next/server";
import {
  PodError,
  getPod,
  isBilling,
  isPending,
  missingSetup,
  podEndpoint,
  startPod,
  stopPod,
} from "@/lib/realtime-agent/pod";
import { DEFAULT_IDLE_STOP_MINUTES, shouldAutoStop } from "@/lib/realtime-agent/cost";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET  /api/realtime-agent/pod   — what the pod is doing, and what it costs
// POST /api/realtime-agent/pod   — { action: "start" | "stop" | "keepalive" }
//
// Access: none of its own, on purpose. `routeAccess` in lib/hubAccess.ts
// defaults every unlisted path to "owner", and the middleware runs on /api, so
// this answers 401 to a stranger and 403 to a signed-in non-owner before the
// handler is reached. This path is deliberately NOT in any PUBLIC list — it
// can spend the owner's money, so it must stay fail-closed.

/** LiveTalking's port inside the container (deploy/runpod/Dockerfile EXPOSEs it). */
const LIVETALKING_PORT = 8010;

// Last time the owner actually talked to the pod. Module scope, so it is
// per-instance and does not survive a cold start — which is exactly why the
// browser keeps its own timer too, and why the UI says plainly that closing
// the tab means stopping the pod yourself. This is the safety net, not the
// guarantee.
let lastActivityAt = 0;
let idleStopMinutes = DEFAULT_IDLE_STOP_MINUTES;

function fail(e: unknown) {
  if (e instanceof PodError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  return NextResponse.json({ error: "The pod could not be reached." }, { status: 502 });
}

const noStore = { headers: { "Cache-Control": "no-store" } };

export async function GET() {
  const missing = missingSetup();
  if (missing) {
    return NextResponse.json({ configured: false, missing }, noStore);
  }
  try {
    const pod = await getPod();
    if (!pod) {
      return NextResponse.json(
        { configured: true, missing: null, error: "RunPod did not describe that pod." },
        { status: 502, ...noStore },
      );
    }

    // The safety net: if the pod is burning money and nothing has talked to it
    // for the idle window, stop it here rather than waiting for a browser.
    let autoStopped = false;
    if (isBilling(pod.status) && lastActivityAt > 0 && shouldAutoStop(lastActivityAt, Date.now(), idleStopMinutes)) {
      try {
        await stopPod();
        autoStopped = true;
        lastActivityAt = 0;
      } catch {
        // Report the real state; the banner will still show it running.
      }
    }

    return NextResponse.json(
      {
        configured: true,
        missing: null,
        status: autoStopped ? "EXITED" : pod.status,
        billing: autoStopped ? false : isBilling(pod.status),
        pending: isPending(pod.status),
        ratePerHour: pod.cost,
        endpoint: podEndpoint(pod, LIVETALKING_PORT),
        lastActivityAt: lastActivityAt || null,
        idleStopMinutes,
        autoStopped,
      },
      noStore,
    );
  } catch (e) {
    return fail(e);
  }
}

export async function POST(request: Request) {
  const missing = missingSetup();
  if (missing) return NextResponse.json({ error: missing }, { status: 503 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Send an action." }, { status: 400 });
  }
  const action = (body as { action?: unknown })?.action;
  const minutes = (body as { idleStopMinutes?: unknown })?.idleStopMinutes;
  if (typeof minutes === "number" && minutes > 0 && minutes <= 240) {
    idleStopMinutes = Math.round(minutes);
  }

  if (action === "keepalive") {
    lastActivityAt = Date.now();
    return NextResponse.json({ ok: true, lastActivityAt, idleStopMinutes }, noStore);
  }

  if (action !== "start" && action !== "stop") {
    return NextResponse.json({ error: "Action must be start, stop or keepalive." }, { status: 400 });
  }

  try {
    if (action === "start") {
      await startPod();
      // Start the clock now: a pod that comes up while the owner walks away
      // must still auto-stop.
      lastActivityAt = Date.now();
    } else {
      await stopPod();
      lastActivityAt = 0;
    }
  } catch (e) {
    return fail(e);
  }

  // Answer with the state RunPod reports, not with what we asked for — a start
  // that was accepted still takes a minute to become RUNNING.
  try {
    const pod = await getPod();
    return NextResponse.json(
      {
        ok: true,
        status: pod?.status ?? null,
        billing: pod ? isBilling(pod.status) : null,
        pending: pod ? isPending(pod.status) : null,
        ratePerHour: pod?.cost ?? 0,
        endpoint: pod ? podEndpoint(pod, LIVETALKING_PORT) : null,
        idleStopMinutes,
      },
      noStore,
    );
  } catch {
    return NextResponse.json({ ok: true, status: null, idleStopMinutes }, noStore);
  }
}
