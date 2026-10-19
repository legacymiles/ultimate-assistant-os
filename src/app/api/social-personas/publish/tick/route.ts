import { runAllDue } from "@/lib/social-personas/server/queue";

export const runtime = "nodejs";
export const maxDuration = 60;

// GET|POST — the scheduler's heartbeat (GitHub Actions every 15 minutes, see
// .github/workflows/personas-tick.yml). Sends every post that is due, for
// every account. Safe to call any number of times: it only sends what owners
// already scheduled for now or earlier, behind a per-job lock. If
// PERSONAS_TICK_TOKEN is set, callers must present it as a bearer token.
async function tick(req: Request) {
  const token = process.env.PERSONAS_TICK_TOKEN;
  if (token && req.headers.get("authorization") !== `Bearer ${token}`) {
    return Response.json({ error: "Not allowed." }, { status: 401 });
  }
  try {
    const sent = await runAllDue(50_000);
    return Response.json({ ok: true, sent: sent.reduce((s, x) => s + x.sent, 0) });
  } catch (err) {
    console.error("[personas-studio] tick failed:", err);
    return Response.json({ ok: false, error: "The scheduler hit a problem; it'll run again on the next tick." }, { status: 500 });
  }
}

export const GET = tick;
export const POST = tick;
