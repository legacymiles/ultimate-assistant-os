"use client";

// ---------------------------------------------------------------------------
// The two halves of a handover that need the owner's PC.
//
// The website makes the repository (src/lib/client-review/github.ts) because
// that must work with the laptop shut. The SITE'S CODE is a different matter:
// it only exists in the folder Claude Code built it in, so putting it into
// that repository, and moving it into the hub, both happen here, through the
// bridge, exactly like a build does.
//
// Neither is ever silent about being unable to run. A PC that is off gets one
// sentence saying so and a button that is pressed again later — never a
// pretend success, and never a queue nobody works.
// ---------------------------------------------------------------------------

import { BridgeError, call, knownFolder, probe } from "@/lib/new-jarvis/bridge";
import { connectToPc } from "./buildHere";
import { buildHarness } from "@/lib/new-jarvis/harness/choice";
import { readTrust } from "@/lib/new-jarvis/trust";
import { readChatModel } from "@/lib/new-jarvis/useChatModel";
import { buildModelFor, buildsWithPick, pickValue } from "./models";
import { admin } from "./client";
import { hubSlugFor, pluginsBrief, repoHasNoSite, repoUrl, type RepoEntry } from "./handover";
import type { ClientProject } from "./types";

export interface PcResult {
  ok: boolean;
  message: string;
}

interface ThreadSummary {
  id: string;
  status?: string;
  worktree?: { path?: string; branch?: string };
}

/** One shell call, as either "it worked" or the first useful line it said. */
async function shell(command: string): Promise<{ ok: boolean; said: string }> {
  const out = await call<{ ok?: boolean; exitCode?: number | null; stdout?: string; stderr?: string }>("shell", {
    command,
    timeoutMs: 300_000,
  });
  const said = `${out.stdout ?? ""}\n${out.stderr ?? ""}`.trim();
  return { ok: out.ok === true && (out.exitCode ?? 0) === 0, said };
}

function firstLine(text: string): string {
  return text.split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? "";
}

/** Every thread id this project has ever built in, newest first. */
function threadIds(p: ClientProject): string[] {
  const fromBatches = [...p.batches]
    .sort((a, b) => b.sentAt.localeCompare(a.sentAt))
    .map((b) => b.build?.threadId)
    .filter((t): t is string => Boolean(t));
  return [...(p.buildWatch?.threadId ? [p.buildWatch.threadId] : []), ...fromBatches];
}

/**
 * The folder this site was built in, on this PC.
 *
 * Found through the threads the bridge still knows about rather than guessed
 * from the project's name: a worktree that has been discarded is gone, and
 * saying so is the honest answer. Returns "" when there is nothing to find.
 */
export async function siteFolder(p: ClientProject): Promise<string> {
  const wanted = new Set(threadIds(p));
  if (!wanted.size) return "";
  const data = await call<{ threads: ThreadSummary[] }>("harness/threads").catch(() => ({ threads: [] as ThreadSummary[] }));
  for (const id of wanted) {
    const path = (data.threads ?? []).find((t) => t.id === id)?.worktree?.path;
    if (path) return path;
  }
  return "";
}

/**
 * The PC, or the one sentence saying why it can't be used right now.
 *
 * Both presses that land here are presses — the owner's own click is still
 * live — so when the direct route to 127.0.0.1 is shut this does the thing
 * that opens it instead of describing it. `connectToPc` opens the local relay
 * window (the route Chrome does not gate), starts a helper that isn't running,
 * and pairs. Telling the owner to "press Connect to my PC on a build" was
 * sending them to another screen to press a button this one could press
 * itself, which is why the move never started from here.
 */
async function pcOrWhy(): Promise<string> {
  const health = await probe().catch(() => null);
  if (health?.up && health.paired) return "";

  // Still inside the click. This is the one moment the relay window can open.
  const blocker = await connectToPc().catch(() => "pc-off" as const);
  if (!blocker) return "";

  if (blocker === "blocked-by-browser") {
    return "Your browser is blocking this site from reaching your PC, and the small Jarvis window didn't open. Allow pop-ups for this site and press this again.";
  }
  if (blocker === "not-paired") {
    return "This browser isn't paired with the PC helper yet. Open Jarvis on that PC once and press this again.";
  }
  return "Jarvis's PC helper isn't running, so the code can't be moved from here. Start it on that PC and press this again.";
}

/**
 * Put the built site into the repository Jarvis just made for it.
 *
 * `fresh` means Jarvis created that repository seconds ago and the only thing
 * in it is the README Jarvis itself wrote — which is why the push may replace
 * it. A repository the owner added by hand is never force-pushed: that one
 * has a history that is not ours to rewrite.
 */
export async function pushSiteToRepo(p: ClientProject, opts: { repo: string; fresh: boolean }): Promise<PcResult> {
  const why = await pcOrWhy();
  if (why) return { ok: false, message: why };

  let where = "";
  try {
    where = await siteFolder(p);
  } catch (e) {
    return { ok: false, message: e instanceof BridgeError ? e.message : "Couldn't ask your PC where this site was built." };
  }
  if (!where) {
    return {
      ok: false,
      message: `The folder this site was built in isn't on this PC any more, so there is nothing to copy up. ${repoUrl(opts.repo)} is made and empty — push the site into it yourself, or build a version and it will go up with that.`,
    };
  }

  const git = (args: string) => shell(`git -C "${where}" ${args}`);
  const head = await git("rev-parse HEAD");
  if (!head.ok) {
    return { ok: false, message: `That folder isn't a git repository any more: ${firstLine(head.said) || "git gave no answer"}` };
  }
  // Everything the build left uncommitted goes up too; a half-committed
  // worktree is the normal state at the end of a build, and shipping the
  // client a repository missing the last file is worse than one extra commit.
  await git("add -A");
  await git(`commit -m "The site as it was handed over" --allow-empty`);

  const push = await git(`push "${repoUrl(opts.repo)}.git" HEAD:refs/heads/main${opts.fresh ? " --force" : ""}`);
  if (!push.ok) {
    const said = firstLine(push.said) || "git gave no answer";
    return {
      ok: false,
      message: /authentication|could not read|403|denied/i.test(push.said)
        ? `Your PC's git isn't signed in to GitHub for ${opts.repo}. Run \`gh auth login\` on that PC and press this again.`
        : `The site didn't make it into ${opts.repo}: ${said}`,
    };
  }
  return { ok: true, message: `The site is in ${opts.repo} now.` };
}

export interface PluginsBuild {
  threadId: string;
  model: string;
}

/**
 * Move this site into the hub, as `/apps/<slug>`.
 *
 * A worktree of the hub, the same way a client edit is built — the move is a
 * real piece of work (imports onto the hub's provider and sync layer, one new
 * row in the catalog, dependencies merged), not a file copy, so it is Claude
 * Code that does it and a pull request the owner reviews that lands it.
 */
export async function startPluginsBuild(p: ClientProject, opts: { repo: string; liveUrl: string }): Promise<PluginsBuild> {
  // One move at a time. Nothing used to stop a second press (or a second tab,
  // or the phone) cutting another worktree of the hub against the same site,
  // and two agents moving one app in produce two branches that both half-do it.
  // The panel shows the live one instead of the button; this is the door a
  // stale tab comes through.
  if (p.pluginsMove) {
    throw new Error(
      "A move is already running for this site. Reload this page to follow it — and if it has stopped, the panel there has a \"Start it again\".",
    );
  }

  const why = await pcOrWhy();
  if (why) throw new Error(why);

  const hub = knownFolder();
  if (!hub) throw new Error("This browser hasn't heard from your PC yet, so it doesn't know where the hub is checked out.");

  // Asked AFTER the connection exists, not before it. Looking the folder up
  // first meant the one call that finds it was made down a route the browser
  // had shut — it came back empty every time, and a site with no repository
  // yet was then refused for having "nothing to move in" on a PC that had the
  // folder sitting right there.
  const folder = opts.repo ? "" : await siteFolder(p).catch(() => "");
  if (!opts.repo && !folder) {
    throw new Error("This site has no repository and the folder it was built in is gone, so there is nothing to move in. Send it to the client first — that gives it a repository.");
  }
  // A repository is not a source until the site is IN it. Jarvis makes one on
  // Send and writes a README into it; when the build folder has already been
  // discarded nothing else ever follows, and starting a move against that
  // spends a thread to discover one file. Having a repo row on screen is not
  // the same as having a site, so this asks what is actually in it.
  if (opts.repo) {
    const out = await admin
      .act<{ tree: { entries: RepoEntry[] } | null }>({ action: "repoTree", id: p.id })
      .catch(() => null);
    const entries = out?.tree?.entries;
    if (entries && repoHasNoSite(entries)) {
      throw new Error(
        `${opts.repo} holds nothing but its README, so there is no site in it to move. Press "Put the site in it" with the folder this site was built in on this PC, or build a version — the code goes up with that.`,
      );
    }
  }

  const chosen = readChatModel();
  const pick = chosen && (buildsWithPick(chosen) || chosen === "claude-subscription") ? chosen : pickValue(p);
  const brief = pluginsBrief(p, { repo: opts.repo, folder, liveUrl: opts.liveUrl });

  let threadId = "";
  try {
    const { session } = await call<{ session: { id: string; worktree?: { path?: string } } }>("harness/start", {
      harness: buildHarness(),
      title: `${p.name} → Jarvis Plugins`.slice(0, 60),
      repo: hub,
      laneWrites: true,
      trust: readTrust(),
      model: buildModelFor(pick),
      durable: true,
      // The page the gate should open once the agent says it is finished. The
      // whole point of the move is that `/apps/<slug>` exists and works, and a
      // gate that only compiles and runs the tests cannot tell that the route
      // 404s — which is the one failure a move is most likely to leave.
      verifyPaths: [`/apps/${hubSlugFor(p.name)}`],
      brief,
    });
    threadId = session.id;
    const where = session.worktree?.path ?? "";
    if (!where) throw new Error("The PC helper started a thread without a worktree, so there is nowhere to build.");
    // Same reason as a client edit: a worktree is cut from whatever branch the
    // bridge's checkout is standing on, and a move landed on top of that
    // cannot be merged into main.
    const fetched = await shell(`git -C "${where}" fetch origin main`);
    if (!fetched.ok) throw new Error(`Couldn't fetch main, so the move wasn't started: ${firstLine(fetched.said) || "git gave no answer"}`);
    const reset = await shell(`git -C "${where}" reset --hard FETCH_HEAD`);
    if (!reset.ok) throw new Error(`Couldn't stand on main, so the move wasn't started: ${firstLine(reset.said) || "git gave no answer"}`);
    await call("harness/say", { id: threadId, text: brief });
  } catch (e) {
    if (threadId) await call("harness/stop", { id: threadId }).catch(() => {});
    if (e instanceof BridgeError && e.status === 0) throw new Error("The PC helper stopped answering while the move was starting.");
    throw new Error(e instanceof Error ? e.message : "The move didn't start.");
  }
  return { threadId, model: buildModelFor(pick) };
}
