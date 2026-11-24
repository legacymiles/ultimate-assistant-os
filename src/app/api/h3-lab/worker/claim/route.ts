import { NextResponse } from "next/server";
import type { ClaimRequest, ClaimResponse } from "@/lib/h3-lab/api";
import type { Generation, LabState } from "@/lib/h3-lab/model";
import { log, rendersLeft } from "@/lib/h3-lab/state";
import { mutateLab, saveWorker } from "@/lib/h3-lab/server/store";
import { readJson, unauthorized, workerUid } from "@/lib/h3-lab/server/http";

// POST /api/h3-lab/worker/claim — the PC worker's heartbeat and work request.
// Token-authenticated; session-exempt in middleware by exact path.
//
// Hands out, in order: a think job (when the brain is Claude Code on the PC
// and the worker can think), then the next render. Experiment renders count
// against the daily budget and only run while the agent is running; the
// owner's own test and production renders never wait on either. Recovery: if
// the worker says it is idle while the lab thinks a render is on its GPU,
// that render was lost (a restart, a crash) and goes back in the queue.

export const runtime = "nodejs";

const isAgentRender = (g: Generation) => g.pairKey.includes(":v");

function pick(s: LabState, now: string): Generation | null {
  const queued = s.generations.filter((g) => g.status === "queued").sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
  const budget = rendersLeft(s, now);
  const allowed = queued
    .filter((g) => !isAgentRender(g) || (budget > 0 && s.agent.mode === "running"))
    // A re-used master render is cloned into each pair, so the same prompt and
    // seed can sit in the queue twice. Rendering it twice would cost a second
    // six minutes of GPU for an identical clip; applyResult copies the finished
    // result onto every twin, so skip one whose twin is already under way.
    .filter((g) => !s.generations.some((o) => o.id !== g.id && o.prompt === g.prompt && o.seed === g.seed && (o.status === "claimed" || o.status === "rendering" || o.status === "done")));
  // Finish a half-done pair first: one render of a pair is worthless alone.
  const half = allowed.find((g) => s.generations.some((o) => o.pairKey === g.pairKey && o.id !== g.id && o.status === "done"));
  return half ?? allowed[0] ?? null;
}

export async function POST(req: Request) {
  const uid = await workerUid(req);
  if (!uid) return unauthorized();
  const body = (await readJson<ClaimRequest>(req)) ?? { status: {}, canRender: false, canThink: false };
  const worker = await saveWorker(uid, body.status ?? {});
  const now = new Date().toISOString();

  const { value } = await mutateLab(uid, (s): ClaimResponse | null => {
    if (!worker.current) {
      for (const g of s.generations) {
        if (g.status === "claimed" || g.status === "rendering") {
          g.status = "queued";
          g.startedAt = undefined;
          log(s, "system", "worker", "Re-queued a render the PC worker no longer holds (it restarted or lost it).", { type: "generation", id: g.id }, now);
        }
      }
    }
    for (const j of s.think) {
      if (j.state === "claimed" && j.claimedAt && Date.now() - Date.parse(j.claimedAt) > 20 * 60_000) j.state = "queued";
    }

    if (body.canThink && s.agent.brain === "claude-code") {
      const job = s.think.find((j) => j.state === "queued");
      if (job) {
        job.state = "claimed";
        job.claimedAt = now;
        return { kind: "think", job };
      }
    }
    if (body.canRender && worker.wangp !== "busy") {
      const g = pick(s, now);
      if (g) {
        g.status = "claimed";
        g.startedAt = now;
        if (isAgentRender(g)) s.counters.renders++;
        const seconds = Number((g.settings as { video_length?: number }).video_length ?? 124) / 24;
        log(s, "worker", "render", `The PC worker took a render: ${g.genre} (${g.arm}).`, { type: "generation", id: g.id }, now);
        return { kind: "render", generation: { id: g.id, prompt: g.prompt, settings: g.settings, seconds } };
      }
    }
    return null;
  });
  if (!value) return new NextResponse(null, { status: 204 });
  return NextResponse.json(value);
}
