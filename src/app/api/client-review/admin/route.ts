import { NextResponse } from "next/server";
import { aiConfigured } from "@/lib/ai/provider";
import { writeBrief } from "@/lib/client-review/brief";
import {
  addVersion,
  approveBatch,
  createProject,
  markVersionReady,
  noteBuild,
  rejectBatch,
  releaseClaim,
  removeFromIndex,
  reviewRequest,
  ReviewError,
  rotateToken,
  setBrief,
  updateProjectMeta,
  upsertIndex,
} from "@/lib/client-review/logic";
import { appEntry, appProject } from "@/lib/client-review/apps";
import { vapidPublicKey } from "@/lib/client-review/push";
import { tell } from "@/lib/client-review/ship";
import { lanePlan } from "@/lib/client-review/routing";
import {
  deleteProjectDoc,
  readIndex,
  readProject,
  storage,
  updateIndex,
  updateProject,
  writeProject,
} from "@/lib/client-review/store";
import type { ClientProject } from "@/lib/client-review/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// An AI-written brief can take a while on a long batch.
export const maxDuration = 120;

// ---------------------------------------------------------------------------
// /api/client-review/admin — the owner's console. Owner-only via middleware.
//
//   GET                → every project, the event feed, and what is configured
//   GET ?feed=1        → just the events and pending counts (Jarvis polls this)
//   GET ?token=<link>  → one project, by its link (the owner's Send & build)
//   POST { action, … } → see the switch below
// ---------------------------------------------------------------------------

function fail(err: unknown) {
  if (err instanceof ReviewError) return NextResponse.json({ error: err.message }, { status: err.status });
  const message = err instanceof Error ? err.message : "";
  return NextResponse.json(
    { error: `Something went wrong${message ? `: ${message}` : "."}` },
    { status: 500 },
  );
}

async function allProjects(): Promise<ClientProject[]> {
  const index = await readIndex();
  const loaded = await Promise.all(index.projects.map((p) => readProject(p.id)));
  return loaded
    .filter((p): p is ClientProject => !!p && !p.token.startsWith("deleted"))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const index = await readIndex();
    if (url.searchParams.get("feed")) {
      return NextResponse.json({ events: index.events.slice(-60) }, { headers: { "Cache-Control": "no-store" } });
    }
    const token = url.searchParams.get("token");
    if (token) {
      const entry = index.projects.find((p) => p.token === token);
      const project = entry ? await readProject(entry.id) : null;
      if (!project) throw new ReviewError("That project no longer exists.", 404);
      return NextResponse.json({ project }, { headers: { "Cache-Control": "no-store" } });
    }
    const [projects, store] = await Promise.all([allProjects(), storage()]);
    const lanes = lanePlan("auto", {
      standard: process.env.CLIENT_REVIEW_STANDARD_MODELS,
      uncensored: process.env.CLIENT_REVIEW_UNCENSORED_MODELS,
    });
    return NextResponse.json(
      {
        projects,
        events: index.events.slice(-100),
        storage: store,
        push: Boolean(await vapidPublicKey()),
        ai: aiConfigured(),
        lanes: { standard: lanes[0].models, uncensored: lanes[1].models },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return fail(err);
  }
}

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "That request couldn't be read." }, { status: 400 });
  }
  const origin = new URL(req.url).origin;
  const id = typeof body.id === "string" ? body.id : "";

  try {
    switch (body.action) {
      case "create": {
        const p = createProject({
          name: body.name,
          clientName: body.clientName,
          siteUrl: body.siteUrl,
          summary: body.summary,
          lane: body.lane,
          timelineProjectId: body.timelineProjectId,
          inviteEmail: body.inviteEmail,
          repo: body.repo,
          vercelProject: body.vercelProject,
        });
        await writeProject(p);
        await updateIndex((i) => upsertIndex(i, p));
        return NextResponse.json({ project: p });
      }

      // One of the owner's own apps, opened from the Client view's picker:
      // its project, made the first time it is opened.
      case "ensureApp": {
        const slug = typeof body.slug === "string" ? body.slug : "";
        const entry = appEntry(await readIndex(), slug);
        const existing = entry ? await readProject(entry.id) : null;
        if (existing) {
          if (!existing.archived) return NextResponse.json({ project: existing });
          const { project } = await updateProject(existing.id, (p) => ({ project: { ...p, archived: false }, result: null }));
          await updateIndex((i) => upsertIndex(i, project));
          return NextResponse.json({ project });
        }
        const p = appProject(slug);
        await writeProject(p);
        await updateIndex((i) => upsertIndex(i, p));
        return NextResponse.json({ project: p });
      }

      case "meta":
      case "rotate":
      case "release": {
        const { project } = await updateProject(id, (p) => ({
          project:
            body.action === "rotate" ? rotateToken(p) : body.action === "release" ? releaseClaim(p) : updateProjectMeta(p, body),
          result: null,
        }));
        await updateIndex((i) => upsertIndex(i, project));
        return NextResponse.json({ project });
      }

      case "delete": {
        await deleteProjectDoc(id);
        await updateIndex((i) => removeFromIndex(i, id));
        return NextResponse.json({ ok: true });
      }

      case "review": {
        const { project } = await updateProject(id, (p) => ({
          project: reviewRequest(p, {
            id: body.requestId,
            status: body.status,
            adminText: body.adminText,
            adminNote: body.adminNote,
          }),
          result: null,
        }));
        return NextResponse.json({ project });
      }

      case "brief": {
        // Written outside the project lock: the model can take a minute, and
        // the client must still be able to add drafts meanwhile.
        const p = await readProject(id);
        if (!p) throw new ReviewError("That project no longer exists.", 404);
        const batch = p.batches.find((b) => b.id === body.batchId);
        if (!batch) throw new ReviewError("That batch no longer exists.", 404);
        const out = await writeBrief(p, batch);
        const { project } = await updateProject(id, (cur) => ({
          project: setBrief(cur, { batchId: batch.id, brief: out.brief, model: out.model, lane: out.lane }),
          result: null,
        }));
        return NextResponse.json({ project, brief: out });
      }

      case "saveBrief": {
        const { project } = await updateProject(id, (p) => ({
          project: setBrief(p, { batchId: body.batchId, brief: body.brief }),
          result: null,
        }));
        return NextResponse.json({ project });
      }

      case "approve": {
        const { project, result } = await updateProject(id, (p) => {
          const out = approveBatch(p, { batchId: body.batchId, brief: body.brief, summary: body.summary });
          return { project: out.project, result: { version: out.version, approved: out.approved } };
        });
        const told = await tell(project, project.notices.at(-1), origin);
        await updateIndex((i) => upsertIndex(i, told));
        return NextResponse.json({ project: told, version: result.version, approved: result.approved });
      }

      case "reject": {
        const { project } = await updateProject(id, (p) => ({
          project: rejectBatch(p, { batchId: body.batchId, note: body.note }),
          result: null,
        }));
        const told = await tell(project, project.notices.at(-1), origin);
        return NextResponse.json({ project: told });
      }

      case "ready":
      case "addVersion": {
        const { project, result } = await updateProject(id, (p) => {
          const out =
            body.action === "ready"
              ? markVersionReady(p, { versionId: body.versionId, siteUrl: body.siteUrl, summary: body.summary })
              : addVersion(p, { siteUrl: body.siteUrl, summary: body.summary });
          return { project: out.project, result: out.version };
        });
        const live = result.status === "review";
        const told = live ? await tell(project, project.notices.at(-1), origin) : project;
        await updateIndex((i) => upsertIndex(i, told));
        return NextResponse.json({ project: told, version: result });
      }

      // App Builder made a project from an approved batch and queued it.
      case "buildQueued": {
        const { project } = await updateProject(id, (p) => ({
          project: noteBuild(p, { batchId: body.batchId, builderId: body.builderId, queueId: body.queueId }),
          result: null,
        }));
        return NextResponse.json({ project });
      }

      case "dismissEvents": {
        const ids = new Set(Array.isArray(body.eventIds) ? (body.eventIds as string[]) : []);
        const index = await updateIndex((i) => ({
          ...i,
          events: ids.size ? i.events.filter((e) => !ids.has(e.id)) : [],
        }));
        return NextResponse.json({ events: index.events });
      }

      default:
        throw new ReviewError("Unknown action.");
    }
  } catch (err) {
    return fail(err);
  }
}
