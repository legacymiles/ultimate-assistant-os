import { NextResponse } from "next/server";
import {
  admit,
  addPushSub,
  addRequest,
  batchDetail,
  deleteDraft,
  editDraft,
  isToken,
  markNoticesRead,
  portalView,
  pushEvent,
  upsertIndex,
  ReviewError,
  sendToJarvis,
  setNotify,
} from "@/lib/client-review/logic";
import { vapidPublicKey } from "@/lib/client-review/push";
import { checkBatch } from "@/lib/client-review/contentCheckServer";
import { projectForToken, updateIndex, updateProject } from "@/lib/client-review/store";
import type { ClientProject } from "@/lib/client-review/types";
import { currentViewer } from "@/lib/client-review/viewer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// /api/client-review/portal/<token> — the client's side.
//
// Open to any signed-in Jarvis account in middleware (src/lib/hubAccess.ts),
// and checked here: the client must be signed in (401 → the page shows the
// Google button), and the first account to open a link claims it — after
// that only that account and the owner get in (403). A wrong or archived
// token is a plain 404, the same answer a link that never existed gets.
//
//   GET                       → what the client sees (portalView)
//   POST { action: "add",    versionId, text, pin? }
//        { action: "edit",   id, text, pin? }       — drafts only
//        { action: "delete", id }                   — drafts only
//        { action: "send",   versionId }            — "Send to Jarvis"
//        { action: "notify", on }                   — the Settings toggle
//        { action: "subscribe", subscription }      — a browser push subscription
//        { action: "seen" }                         — notices read
// ---------------------------------------------------------------------------

type Outcome =
  | { kind: "add"; id: string }
  | { kind: "edit" | "delete" | "subscribe" | "seen" }
  | { kind: "send"; detail: string }
  | { kind: "notify"; on: boolean; was: boolean };

const NOT_FOUND = { error: "This review link isn't active. Ask for a new one." };
const MAX_BODY = 16_000;

async function load(token: string): Promise<ClientProject | null> {
  if (!isToken(token)) return null;
  return projectForToken(token);
}

async function view(p: ClientProject, viewerEmail: string | null, viewerOwner: boolean) {
  return NextResponse.json(
    { ...portalView(p, await vapidPublicKey()), viewerEmail, viewerOwner },
    { headers: { "Cache-Control": "no-store" } },
  );
}

const SIGN_IN = { error: "Sign in with your Jarvis account to see your website.", signIn: true };

/**
 * The project this signed-in person may open, claimed for them on first open.
 * Returns a Response for every way in that fails.
 */
async function gate(token: string): Promise<{ project: ClientProject; email: string | null; owner: boolean } | Response> {
  const found = await load(token);
  if (!found) return NextResponse.json(NOT_FOUND, { status: 404 });
  const viewer = await currentViewer();
  // Accounts off (local demo mode): the link alone opens it.
  if (viewer === "none") return { project: found, email: null, owner: true };
  if (!viewer) return NextResponse.json(SIGN_IN, { status: 401 });
  try {
    if (viewer.owner || found.clientUserId === viewer.id) return { project: found, email: viewer.email, owner: viewer.owner };
    const { project, result } = await updateProject(found.id, (p) => {
      const out = admit(p, viewer);
      return { project: out.project, result: out.claimed };
    });
    if (result) {
      await updateIndex((i) => upsertIndex(pushEvent(i, project, "claimed", `opened their link as ${viewer.email}`), project)).catch(() => {});
    }
    return { project, email: viewer.email, owner: false };
  } catch (err) {
    if (err instanceof ReviewError) return NextResponse.json({ error: err.message, wrongAccount: true, viewerEmail: viewer.email }, { status: err.status });
    throw err;
  }
}

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const g = await gate(token);
  if (g instanceof Response) return g;
  return view(g.project, g.email, g.owner);
}

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const g = await gate(token);
  if (g instanceof Response) return g;
  const found = g.project;

  const raw = await req.text();
  if (raw.length > MAX_BODY) return NextResponse.json({ error: "That's too much in one go." }, { status: 413 });
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "That request couldn't be read." }, { status: 400 });
  }

  // A request no model may build (see contentCheck.ts) stops the send here,
  // before it reaches the owner or any model. Checked outside the write lock
  // because it may ask Span / Jev, which takes a second or two.
  if (body.action === "send") {
    const drafts = found.requests.filter((r) => r.versionId === body.versionId && r.status === "draft");
    const verdict = await checkBatch(drafts.map((r) => r.text), found.name);
    if (verdict.route === "blocked") {
      return NextResponse.json({ error: "One of these requests can't be sent. Please remove it and try again." }, { status: 422 });
    }
  }

  try {
    const { project, result } = await updateProject<Outcome>(found.id, (p) => {
      // The link could have been rotated between the lookup and now.
      if (p.token !== token || p.archived) throw new ReviewError(NOT_FOUND.error, 404);
      switch (body.action) {
        case "add": {
          const out = addRequest(p, { versionId: body.versionId, text: body.text, pin: body.pin });
          return { project: out.project, result: { kind: "add" as const, id: out.request.id } };
        }
        case "edit":
          return { project: editDraft(p, { id: body.id, text: body.text, pin: body.pin }), result: { kind: "edit" as const } };
        case "delete":
          return { project: deleteDraft(p, body.id), result: { kind: "delete" as const } };
        case "send": {
          const out = sendToJarvis(p, body.versionId);
          return { project: out.project, result: { kind: "send" as const, detail: batchDetail(out.project, out.batch) } };
        }
        case "notify": {
          const next = setNotify(p, body.on === true);
          return { project: next, result: { kind: "notify" as const, on: body.on === true, was: p.settings.notify } };
        }
        case "subscribe":
          return { project: addPushSub(p, body.subscription), result: { kind: "subscribe" as const } };
        case "seen":
          return { project: markNoticesRead(p), result: { kind: "seen" as const } };
        default:
          throw new ReviewError("Unknown action.");
      }
    });

    // The owner hears about a send right away; a turned-on notification
    // setting is worth a line too, so they know the client will be told.
    if (result.kind === "send") {
      await updateIndex((i) => pushEvent(i, project, "batch_sent", result.detail)).catch(() => {});
    } else if (result.kind === "notify" && result.on && !result.was) {
      await updateIndex((i) => pushEvent(i, project, "notify_on", "turned on notifications")).catch(() => {});
    }
    return view(project, g.email, g.owner);
  } catch (err) {
    if (err instanceof ReviewError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: "Something went wrong saving that. Try again in a moment." }, { status: 500 });
  }
}
