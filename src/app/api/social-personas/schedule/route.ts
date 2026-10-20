import { loadConnection } from "@/lib/social-personas/server/connectors";
import { body, fail, viewerUid } from "@/lib/social-personas/server/http";
import { runDue, schedule } from "@/lib/social-personas/server/queue";
import { jobId, type Job } from "@/lib/social-personas/queue";
import { canAutoPost } from "@/lib/social-personas/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

// POST { jobs: [{ personaId, draftId, accountId, connectionId, platform, title,
//   caption, media, runAt }], now?: boolean }
// Puts a draft on the posting queue for each account. Re-scheduling the same
// draft+account replaces its job. `now: true` also sends it straight away.
export async function POST(req: Request) {
  const b = await body(req);
  const raw = Array.isArray(b?.jobs) ? b!.jobs.slice(0, 20) : null;
  if (!raw?.length) return fail(400, "Nothing to schedule.");
  const uid = await viewerUid();
  const now = new Date().toISOString();
  const jobs: Job[] = [];
  for (const r of raw) {
    const draftId = str(r?.draftId, 64);
    const accountId = str(r?.accountId, 64);
    const connectionId = str(r?.connectionId, 64);
    const platform = str(r?.platform, 16);
    const runAt = Date.parse(str(r?.runAt, 40));
    if (!draftId || !accountId || !connectionId || !canAutoPost(platform) || !Number.isFinite(runAt)) {
      return fail(400, "That post is missing its account or time. Pick an account and a time, then try again.");
    }
    const conn = await loadConnection(connectionId);
    if (!conn || conn.ownerUid !== uid) return fail(403, "One of those accounts isn't connected to your login any more. Connect it again.");
    const m = r?.media;
    const media =
      m && typeof m.key === "string"
        ? { key: m.key.slice(0, 300), type: str(m.type, 80) || "video/mp4", size: Number(m.size) || 0 }
        : null;
    // A media key is always under the uploader's own folder; refuse anyone else's.
    if (media && !media.key.startsWith(`${uid.replace(/[^a-z0-9_-]/gi, "") || "local"}/`)) return fail(403, "That video belongs to another account.");
    jobs.push({
      id: jobId(draftId, accountId),
      uid,
      personaId: str(r?.personaId, 64),
      draftId,
      accountId,
      connectionId,
      platform,
      title: str(r?.title, 300),
      caption: str(r?.caption, 63_206),
      media,
      runAt: b?.now ? now : new Date(runAt).toISOString(),
      status: "queued",
      attempts: 0,
      updatedAt: now,
    });
  }
  const res = await schedule(uid, jobs);
  if (!res.ok) return fail(503, "The server couldn't save the schedule. Set SUPABASE_SERVICE_ROLE_KEY on the live site, then try again.");
  const sent = b?.now ? await runDue(uid, { limit: jobs.length }) : [];
  const ids = new Set(jobs.map((j) => j.id));
  const latest = sent.length ? sent : res.jobs.filter((j) => ids.has(j.id));
  return Response.json({ jobs: res.jobs.filter((j) => ids.has(j.id)).map((j) => latest.find((x) => x.id === j.id) ?? j) });
}
