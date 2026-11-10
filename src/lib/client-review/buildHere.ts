"use client";

// ---------------------------------------------------------------------------
// Build it from the page you are editing.
//
// The owner never leaves the app they are looking at: Send & build approves
// the edits and starts Claude Code on the PC, the Chat Intake narrates it, and
// the finished preview is put on the version from the same page. Admin is for
// shipping to clients — their own repo and Vercel — not for babysitting a
// build.
//
// Approving and starting are one action. If the start fails, the approval is
// undone (the version is removed, the edits go back to waiting), because half
// of that action is what used to leave a version saying "building" with
// nothing behind it.
// ---------------------------------------------------------------------------

import { call, connectPc, probe, START_LINK } from "@/lib/new-jarvis/bridge";
import { admin } from "./client";
import { CannotBuildHere, startClientEditBuild } from "./autoBuild";
import { blockerAdvice, type Blocker } from "./liveBuild";
import type { ClientProject, ReviewVersion } from "./types";

export interface BuildStarted {
  state: "working" | "failed";
  /** "v3" once a version was opened. */
  version?: string;
  message: string;
  /** Set when a press could fix it, so the chat can offer that press. */
  blocker?: Blocker;
}

/**
 * Can this browser build, right now?
 *
 * Asked BEFORE approving. Approving and then discovering the PC is unreachable
 * meant opening a version, failing, and unpicking it again — three writes to
 * say "your browser hasn't been allowed to talk to your PC". Null means go.
 */
export async function pcReadiness(): Promise<Blocker | null> {
  const health = await probe();
  if (!health.up) return health.needsLocalNetwork ? "blocked-by-browser" : "pc-off";
  if (!health.paired) return "not-paired";
  return null;
}

/**
 * Connect this browser to the PC, from a press.
 *
 * The press matters: Chrome will only ask "let this site reach your local
 * network?" off the back of a real click, which is why this cannot be done
 * quietly on the page's behalf. A helper that is not running is started
 * through the link it registers, and then waited for.
 */
export async function connectToPc(): Promise<Blocker | null> {
  // This runs on a click, which is the one moment a browser allows a popup.
  // The relay window is the route that still works when Chrome has refused
  // (or stopped asking about) the direct localhost permission.
  if (await connectPc()) return null;
  const first = await pcReadiness();
  if (first !== "pc-off") return first;
  // Not running: ask Windows to start it, then give it a few seconds.
  startHelper();
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    const again = await pcReadiness();
    if (!again) return null;
  }
  return "pc-off";
}

/**
 * Open the `jarvis-agent://` link the helper registers, without betting the
 * page on it.
 *
 * Through `location.href` this is a navigation: where the handler is missing,
 * or the browser is strict about custom protocols, the page it was pressed on
 * goes away — taking the chat, the build about to start and the edits on
 * screen with it. In a frame nothing can leave, and a protocol that does not
 * exist is simply a frame that does nothing.
 */
function startHelper(): void {
  try {
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.style.display = "none";
    frame.src = START_LINK;
    document.body.appendChild(frame);
    window.setTimeout(() => frame.remove(), 10_000);
  } catch {
    // Nothing to do: the wait below simply finds the helper still absent.
  }
}

/** Edits waiting on the owner, on any version: what Build would build. */
export function waitingBatch(project: ClientProject) {
  return project.batches.find((b) => b.status === "pending") ?? null;
}

/**
 * Approve whatever is waiting and start building it on this PC.
 *
 * `versionId` narrows it to edits on that version (Send & build passes the one
 * it just sent); without it, the first waiting batch is built — a client's
 * requests, or edits a failed start handed back.
 */
export async function approveAndStart(token: string, versionId?: string, beforeImage?: string): Promise<BuildStarted> {
  // FIRST, before any other round trip: a browser only offers "let this site
  // reach your PC?" while the press that started this is still warm, and it
  // expires in seconds. Asking the server about the project first is what
  // spent that press and left the owner reading about a button on another
  // screen. Nothing is approved until this answers yes, either.
  const blocked = await pcReadiness();
  if (blocked) return { state: "failed", blocker: blocked, message: blockerAdvice(blocked).text };

  const { project } = await admin.byToken(token);
  const batch = versionId
    ? project.batches.filter((b) => b.versionId === versionId && b.status === "pending").at(-1)
    : waitingBatch(project);
  if (!batch) return { state: "failed", message: "There are no edits waiting to be built." };
  if (!project.repo) return { state: "failed", blocker: "no-repo", message: blockerAdvice("no-repo").text };

  const out = await admin.act<{ project: ClientProject; version: ReviewVersion }>({
    action: "approve",
    id: project.id,
    batchId: batch.id,
  });

  // Keep the picture of the page as it was before this edit. It is what the
  // version chip and the history strip show for this version.
  if (beforeImage) {
    await admin
      .act({ action: "screenshot", id: out.project.id, versionId: out.version.id, image: beforeImage })
      .catch(() => null);
  }
  try {
    const started = await startClientEditBuild(out.project, batch.id);
    await admin.act({
      action: "buildQueued",
      id: out.project.id,
      batchId: batch.id,
      builderId: started.builderId,
      threadId: started.threadId,
    });
    return { state: "working", version: out.version.number, message: `Claude Code is building ${out.version.number} with ${started.model}.` };
  } catch (e) {
    const blocker = e instanceof CannotBuildHere && e.reason !== "repo-not-here" ? e.reason : undefined;
    // When a press can fix it, say the words that match the press. The
    // library's own sentences send people to Jarvis on that PC to pair it,
    // and that is a screen away from the one they are standing on.
    const why = blocker
      ? blockerAdvice(blocker).text
      : e instanceof CannotBuildHere || e instanceof Error
        ? e.message
        : "The build didn't start.";
    await admin.act({ action: "buildFailed", id: out.project.id, batchId: batch.id, message: why }).catch(() => null);
    const undone = await admin
      .act({ action: "cancelBuild", id: out.project.id, versionId: out.version.id })
      .then(() => true)
      .catch(() => false);
    return {
      state: "failed",
      ...(blocker ? { blocker } : {}),
      message: undone
        ? `${why}${blocker ? "" : " Your edits are still waiting — press Build when that's sorted."}`
        : `${why} ${out.version.number} is stuck on building; stop it from the chat and try again.`,
    };
  }
}

/** The finished build's preview becomes what this page shows. */
export async function publishBuilt(projectId: string, versionId: string, url: string, threadId?: string) {
  const out = await admin.act({ action: "ready", id: projectId, versionId, siteUrl: url });
  // The strongest "this job is finished" signal the bridge can get. Without
  // it a job whose last words did not include `Preview:` would be resumed on
  // the next boot, doing work that is already on the page.
  if (threadId) await call("harness/job/done", { id: threadId }).catch(() => {});
  return out;
}

/** Stop a build and hand its edits back. The thread is killed by the caller first. */
export function removeBuild(projectId: string, versionId: string) {
  return admin.act({ action: "cancelBuild", id: projectId, versionId });
}
