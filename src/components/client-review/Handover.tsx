"use client";

// ---------------------------------------------------------------------------
// Ship › Handover — the only part of this console that hands a site to anyone.
//
// Two presses, and they are the two the owner actually has: give it to the
// client (its own GitHub repository, made now, and the private link starts
// opening), or move it into the hub beside their other apps. Everything else
// that used to crowd this screen — a model menu, a timeline dropdown, a
// version adder, a release link — did not hand anything over, so it is not
// here.
//
// The repository is shown as what it is: folders. A line of grey monospace
// saying "owner/name" is not a site anyone can believe in, and the owner
// should be able to see the files they are about to give away without leaving
// the page.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from "react";
import { admin } from "@/lib/client-review/client";
import { MOVE_PHASE_LABEL, moveDied } from "@/lib/app-builder/absorb";
import { checkedAndPassed, endedUnchecked, latestWord } from "@/lib/app-builder/build";
import { useBuild } from "@/lib/app-builder/useBuild";
import { askedBefore } from "@/lib/new-jarvis/harness/families";
import { harnessHref } from "@/lib/new-jarvis/harness/link";
import { buildLinks } from "@/lib/client-review/autoBuild";
import { HUB_ORIGIN, HUB_REPO } from "@/lib/client-review/apps";
import {
  countFiles,
  folderTree,
  handover,
  hubSlugFor,
  OPEN_BY_DEFAULT,
  readableSize,
  moveStep,
  repoUrl,
  type TreeNode,
} from "@/lib/client-review/handover";
import { pushSiteToRepo, startPluginsBuild } from "@/lib/client-review/handoverPc";
import { shipThread } from "@/lib/client-review/pushMain";
import type { ClientProject } from "@/lib/client-review/types";

interface RepoTree {
  repo: string;
  branch: string;
  url: string;
  entries: { path: string; type: "blob" | "tree"; size?: number }[];
  truncated: boolean;
}

type Run = <T extends { project?: ClientProject }>(label: string, action: Record<string, unknown>) => Promise<T | null>;

/** Whether a hub move should go live by itself, remembered on this device. */
const LAND_KEY = "client-review:move-land";

// ----- the folder view ---------------------------------------------------------

function FolderIcon({ open }: { open: boolean }) {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round" aria-hidden className="shrink-0 text-amber-300/80">
      {open ? (
        <path d="M3 8.5h5.2l1.8 2h8.5a1.5 1.5 0 0 1 1.5 1.5v6A1.5 1.5 0 0 1 18.5 19h-13A1.5 1.5 0 0 1 4 17.5V8.5Z" />
      ) : (
        <path d="M3 7a1.5 1.5 0 0 1 1.5-1.5h4.1l1.8 2h9.1A1.5 1.5 0 0 1 21 9v8.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5V7Z" />
      )}
    </svg>
  );
}

function FileIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden className="shrink-0 text-ink-faint">
      <path d="M13 3H7a1.6 1.6 0 0 0-1.6 1.6v14.8A1.6 1.6 0 0 0 7 21h10a1.6 1.6 0 0 0 1.6-1.6V8.6L13 3Z" />
      <path d="M13 3v5.6h5.6" />
    </svg>
  );
}

function Row({ node, depth, repo, branch }: { node: TreeNode; depth: number; repo: string; branch: string }) {
  const [open, setOpen] = useState(depth === 0 && OPEN_BY_DEFAULT.has(node.name));
  const pad = { paddingLeft: `${8 + depth * 14}px` };

  if (node.kind === "file") {
    return (
      <a
        href={`${repoUrl(repo)}/blob/${encodeURIComponent(branch)}/${node.path}`}
        target="_blank"
        rel="noreferrer"
        style={pad}
        className="flex items-center gap-1.5 py-[3px] pr-2 text-[12px] text-ink-muted hover:bg-panel-2 focus-visible:bg-panel-2 focus-visible:outline-none"
      >
        <FileIcon />
        <span className="truncate">{node.name}</span>
        <span className="ml-auto shrink-0 pl-3 text-[10.5px] tabular-nums text-ink-faint">{readableSize(node.size)}</span>
      </a>
    );
  }

  const files = countFiles(node.children);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        style={pad}
        className="flex w-full items-center gap-1.5 py-[3px] pr-2 text-left text-[12px] text-ink hover:bg-panel-2 focus-visible:bg-panel-2 focus-visible:outline-none"
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          aria-hidden
          className={`shrink-0 text-ink-faint transition-transform duration-150 ${open ? "rotate-90" : ""}`}
        >
          <path d="m9 6 6 6-6 6" />
        </svg>
        <FolderIcon open={open} />
        <span className="truncate font-medium">{node.name}</span>
        {!open && files > 0 && (
          <span className="ml-auto shrink-0 pl-3 text-[10.5px] tabular-nums text-ink-faint">{files}</span>
        )}
      </button>
      {open &&
        (node.children.length ? (
          node.children.map((c) => <Row key={c.path} node={c} depth={depth + 1} repo={repo} branch={branch} />)
        ) : (
          <p style={{ paddingLeft: `${8 + (depth + 1) * 14}px` }} className="py-[3px] text-[11.5px] text-ink-faint">
            Empty
          </p>
        ))}
    </>
  );
}

function TreeSkeleton() {
  const widths = ["55%", "38%", "72%", "46%", "61%", "33%"];
  return (
    <div className="space-y-2 p-3" aria-hidden>
      {widths.map((w, i) => (
        <div key={i} className="h-2.5 animate-pulse rounded bg-white/[0.07]" style={{ width: w, marginLeft: `${(i % 3) * 14}px` }} />
      ))}
    </div>
  );
}

/** The site's repository, as folders. Reads from the server, so the PC can be off. */
function RepoFolder({ project: p, reloadKey }: { project: ClientProject; reloadKey: number }) {
  const [tree, setTree] = useState<RepoTree | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "none" | "error">("loading");
  const [error, setError] = useState("");

  const load = useCallback(() => {
    setState("loading");
    admin
      .act<{ tree: RepoTree | null; ready: boolean }>({ action: "repoTree", id: p.id })
      .then((out) => {
        setTree(out.tree);
        setState(out.tree ? "ok" : "none");
        setError("");
      })
      .catch((e: Error) => {
        setError(e.message);
        setState("error");
      });
  }, [p.id]);
  useEffect(load, [load, reloadKey]);

  if (state === "none") {
    return (
      <p className="px-3 py-4 text-[12px] leading-relaxed text-ink-faint">
        No repository yet — this site gets its own the moment you send it to the client, and the files appear here.
      </p>
    );
  }
  if (state === "error") {
    return (
      <div className="px-3 py-4 text-[12px] leading-relaxed text-amber-200">
        <p>{error}</p>
        <button className="mt-2 rounded-md border border-line px-2.5 py-1 text-[11.5px] text-ink-muted hover:text-ink" onClick={load}>
          Try again
        </button>
      </div>
    );
  }
  if (state === "loading" || !tree) return <TreeSkeleton />;

  const nodes = folderTree(tree.entries);
  const files = countFiles(nodes);
  return (
    <>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-line-soft px-3 py-1.5 text-[11px] text-ink-faint">
        <code className="font-mono text-[11.5px] text-ink-muted">{tree.branch}</code>
        <span>·</span>
        <span className="tabular-nums">{files === 1 ? "1 file" : `${files} files`}</span>
        {tree.truncated && <span className="text-amber-200">· too big to list in full</span>}
        <a className="ml-auto text-accent underline underline-offset-2" href={tree.url} target="_blank" rel="noreferrer">
          Open on GitHub ↗
        </a>
      </div>
      {files === 0 ? (
        <p className="px-3 py-4 text-[12px] leading-relaxed text-ink-faint">
          The repository is made, but the site&rsquo;s own files aren&rsquo;t in it yet — press <b className="text-ink-muted">Put the site in it</b> with
          your PC on, or they go up with the next build.
        </p>
      ) : (
        <div className="max-h-72 overflow-auto overscroll-contain py-1" role="group" aria-label={`Files in ${tree.repo}`}>
          {nodes.map((n) => (
            <Row key={n.path} node={n} depth={0} repo={tree.repo} branch={tree.branch} />
          ))}
        </div>
      )}
    </>
  );
}

// ----- the two presses ---------------------------------------------------------

/** A press that can't be taken back asks once, in place (S7). */
function Confirm({
  label,
  question,
  yes,
  busy,
  tone = "brand",
  onGo,
  disabled,
  hint,
}: {
  label: string;
  question: string;
  yes: string;
  busy: string;
  tone?: "brand" | "core";
  onGo: () => void;
  disabled?: boolean;
  hint: string;
}) {
  const [sure, setSure] = useState(false);
  const look =
    tone === "brand"
      ? "border-brand/50 bg-brand/20 hover:bg-brand/30"
      : "border-core/50 bg-core/15 hover:bg-core/25";
  if (busy) {
    return <span className="inline-flex items-center rounded-md border border-line px-3 py-2 text-xs text-ink-muted">{busy}</span>;
  }
  if (!sure) {
    return (
      <div className="min-w-0">
        <button
          type="button"
          className={`w-full rounded-md border px-3 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto ${look}`}
          disabled={disabled}
          onClick={() => setSure(true)}
        >
          {label}
        </button>
        <p className="mt-1 text-[11px] leading-snug text-ink-faint">{hint}</p>
      </div>
    );
  }
  return (
    <div className="min-w-0 rounded-md border border-line bg-panel-2 p-2">
      <p className="text-[11.5px] leading-snug text-ink">{question}</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <button
          type="button"
          className={`rounded-md border px-2.5 py-1 text-[11.5px] font-semibold ${look}`}
          onClick={() => {
            setSure(false);
            onGo();
          }}
        >
          {yes}
        </button>
        <button type="button" className="rounded-md border border-line px-2.5 py-1 text-[11.5px] text-ink-muted" onClick={() => setSure(false)}>
          Not yet
        </button>
      </div>
    </div>
  );
}

/**
 * The move into the hub, followed live.
 *
 * The press used to end at `setMoved({ threadId })` and a sentence saying a
 * pull request would turn up. Nothing watched the thread, so three things were
 * invisible: a permission gate (the move waits forever and looks like it is
 * working), a thread that died (the owner finds out when the pull request never
 * arrives), and the pull request itself when it DID arrive. All three happened.
 *
 * So this is the same follower the client-edit builds get, in the language of a
 * move: the real phase, the agent's own last words, gates answerable here, and
 * the pull request as a link the moment Claude says `PR:`.
 */
function MoveThread({
  record,
  slug,
  onRecord,
  onStartOver,
}: {
  record: NonNullable<ClientProject["pluginsMove"]>;
  slug: string;
  onRecord: (patch: { prUrl?: string; landed?: boolean }) => Promise<void>;
  onStartOver: () => void;
}) {
  const threadId = record.threadId;
  const move = useBuild(threadId, true);
  const links = buildLinks(move.view.turns.map((turn) => turn.text).join("\n"));

  const [shipping, setShipping] = useState(false);
  const [landError, setLandError] = useState("");
  const step = moveStep({
    move: record,
    prUrl: links.pr ?? "",
    phase: move.phase,
    passed: checkedAndPassed(move.summary),
    unchecked: endedUnchecked(move.summary),
    shipping,
  });

  // The whole of "one press" lives here: everything after the press, and it
  // happens once. `moveStep` stops saying "land" the moment `landedAt` is
  // written, and `acting` keeps the next poll out while one is in flight.
  const acting = useRef("");
  const act = step.act;
  const prUrl = step.prUrl;
  useEffect(() => {
    if (act === "none") return;
    const key = act + ":" + prUrl;
    if (acting.current === key) return;
    acting.current = key;
    void (async () => {
      try {
        if (act === "record-pr") {
          await onRecord({ prUrl });
          return;
        }
        setShipping(true);
        setLandError("");
        const out = await shipThread(threadId, prUrl);
        if (!out.ok) {
          // Usually a conflict the build agent has just been told to fix, so
          // this is left open for the next poll to try again.
          setLandError(out.message);
          acting.current = "";
          return;
        }
        await onRecord({ landed: true });
      } catch (e) {
        setLandError(e instanceof Error ? e.message : "Taking it live failed.");
        acting.current = "";
      } finally {
        setShipping(false);
      }
    })();
  }, [act, prUrl, threadId, onRecord]);
  const word = move.phase === "working" ? latestWord(move.view) : "";
  const died = moveDied(move.phase);
  const done = move.phase === "done";
  const gate = move.gate;
  const repeat = gate ? askedBefore(move.view, gate) : false;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px]">
        <span className={done ? "text-emerald-200" : died ? "text-rose-200" : "text-sky-200"}>
          ● Moving in as <code className="font-mono">/apps/{slug}</code> — {MOVE_PHASE_LABEL[move.phase]}
        </span>
        <a className="text-brand hover:underline" href={harnessHref(threadId)} target="_blank" rel="noreferrer">
          Open in Jarvis →
        </a>
      </div>

      {word && <p className="truncate text-[11px] text-ink-faint">{word}</p>}

      {/*
        Answered here. A gate that can only be answered on another screen is a
        move that stalls until the owner happens to look somewhere else, which
        from the Ship panel is indistinguishable from one that failed.
      */}
      {gate && (
        <div className="flex flex-wrap items-center gap-1.5 rounded border border-amber-400/40 bg-amber-400/10 px-1.5 py-1 text-[11px] text-amber-100">
          <span className="min-w-0 truncate" title={gate.why || gate.command || gate.path}>
            Needs you: {gate.title || gate.name}
          </span>
          <button
            className={
              repeat
                ? "rounded border border-amber-300/40 px-1.5 py-0.5"
                : "rounded border border-amber-300/60 bg-amber-300/20 px-1.5 py-0.5 font-semibold"
            }
            onClick={() => void move.decide(gate.gateId, true)}
          >
            Allow{repeat ? " once" : ""}
          </button>
          {gate.risk !== "grave" && (
            <button
              className="rounded border border-amber-300/50 px-1.5 py-0.5"
              title={`Stop asking about ${gate.name} for the rest of this move`}
              onClick={() => void move.decide(gate.gateId, true, true)}
            >
              Always
            </button>
          )}
          <button className="rounded border border-amber-300/30 px-1.5 py-0.5" onClick={() => void move.decide(gate.gateId, false)}>
            Not now
          </button>
        </div>
      )}

      {step.show === "live" && (
        <p className="text-[11.5px] leading-snug text-emerald-200">
          Live.{" "}
          <a className="font-semibold underline underline-offset-2" href={`/apps/${slug}`}>
            Open /apps/{slug}
          </a>{" "}
          — merged to main; its card is on Jarvis &rsaquo; App plugins once the deploy finishes.
        </p>
      )}

      {step.show === "landing" && (
        <p className="text-[11.5px] leading-snug text-sky-200">
          The checks passed, so it is going live by itself — bringing main in, pushing, merging the pull request.
        </p>
      )}

      {/*
        The two states where the hub deliberately stops short of main. Not a
        refusal — the owner gets the reason and the press. What it will not do
        is decide for them, because "nothing checked it" and "the checks
        passed" are the same `phase` and only one is safe to push.
      */}
      {(step.show === "unchecked" || step.show === "failed") && (
        <div className="space-y-1.5 rounded border border-amber-400/40 bg-amber-400/10 px-2 py-1.5">
          <p className="text-[11.5px] leading-snug text-amber-100">
            It opened a pull request but did not go live, because {step.why}.
          </p>
          {move.summary?.verify?.failures?.length ? (
            <ul className="space-y-0.5 text-[11px] text-amber-200/90">
              {move.summary.verify.failures.slice(0, 4).map((f) => (
                <li key={`${f.step}-${f.page}-${f.title}`}>
                  &bull; {f.step}
                  {f.title ? `: ${f.title}` : ""}
                  {f.page ? ` (${f.page})` : ""}
                </li>
              ))}
            </ul>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <a className="font-semibold text-accent underline underline-offset-2" href={step.prUrl} target="_blank" rel="noreferrer">
              Read the pull request ↗
            </a>
            <button
              type="button"
              className="rounded-md border border-amber-300/50 px-2 py-0.5 text-[11px] text-amber-100"
              title="Count it as checked although the report is failing, and let it go live"
              onClick={() => void move.useAnyway()}
            >
              Take it live anyway
            </button>
          </div>
        </div>
      )}

      {step.show === "pr-only" && (
        <p className="text-[11.5px] leading-snug text-ink-muted">
          <a className="font-semibold text-accent underline underline-offset-2" href={step.prUrl} target="_blank" rel="noreferrer">
            Review and merge it ↗
          </a>{" "}
          — nothing is in the hub until you do.
        </p>
      )}

      {landError && <p className="text-[11px] text-rose-200">{landError}</p>}
      {move.error && <p className="text-[11px] text-amber-200">{move.error}</p>}

      {/*
        A dead thread with no pull request is the one state that needs a press,
        and the press it needs is "go again" — the move only ever adds, so
        restarting it costs a branch. Without this the panel showed a finished
        move that had produced nothing and offered no way out.
      */}
      {step.show === "restart" && (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[11px] text-rose-200">
            It stopped without opening a pull request, so nothing was moved. Starting again only adds a branch.
          </p>
          <button
            type="button"
            className="rounded-md border border-line px-2 py-0.5 text-[11px] text-ink-muted hover:text-ink"
            onClick={onStartOver}
          >
            Start it again
          </button>
        </div>
      )}
      {(step.show === "live" || step.show === "pr-only") && (
        <button
          type="button"
          className="self-start rounded-md border border-line px-2 py-0.5 text-[11px] text-ink-faint hover:text-ink"
          title="Stop following this move"
          onClick={onStartOver}
        >
          Clear
        </button>
      )}
    </div>
  );
}

export function Handover({
  project: p,
  busy,
  run,
  say,
}: {
  project: ClientProject;
  busy: string;
  run: Run;
  say: (m: string) => void;
}) {
  const state = handover(p, HUB_REPO);
  const [reloadKey, setReloadKey] = useState(0);
  const [working, setWorking] = useState("");
  const [note, setNote] = useState<{ tone: "ok" | "warn"; text: string } | null>(null);

  const live = [...p.versions].reverse().find((v) => v.status === "review" && v.siteUrl)?.siteUrl ?? "";
  const liveUrl = live.startsWith("/") ? `${HUB_ORIGIN}${live}` : live;
  const slug = hubSlugFor(p.name);

  /** Send it: the repository is made server-side, the code follows from the PC. */
  const send = async () => {
    setNote(null);
    const out = await run<{ project: ClientProject; madeRepo?: { repo: string; url: string; fresh: boolean } }>("send", {
      action: "send",
      id: p.id,
    });
    if (!out) return;
    const made = out.madeRepo;
    if (!made) {
      say(`Sent — ${p.clientName || "the client"}'s link opens now.`);
      return;
    }
    say(`Sent, and ${made.repo} is theirs.`);
    setReloadKey((k) => k + 1);
    setWorking("Putting the site into it…");
    const push = await pushSiteToRepo(p, { repo: made.repo, fresh: made.fresh }).catch((e: Error) => ({
      ok: false,
      message: e.message,
    }));
    setWorking("");
    setNote({ tone: push.ok ? "ok" : "warn", text: push.message });
    setReloadKey((k) => k + 1);
  };

  /** The code only, for a repository that was made while the PC was off. */
  const putCodeIn = async () => {
    setNote(null);
    setWorking("Putting the site into it…");
    const push = await pushSiteToRepo(p, { repo: state.repo, fresh: false }).catch((e: Error) => ({ ok: false, message: e.message }));
    setWorking("");
    setNote({ tone: push.ok ? "ok" : "warn", text: push.message });
    setReloadKey((k) => k + 1);
  };

  const toPlugins = async () => {
    setNote(null);
    setWorking("Starting the move…");
    try {
      const out = await startPluginsBuild(p, { repo: state.repo, liveUrl });
      // On the project, not in this component. `run` puts the new project back
      // into the page, which is what swaps the button for the live follower —
      // and what makes a reload, or the same project opened on the phone, come
      // back to the move that is actually running instead of losing it.
      await run("move", { action: "moveStarted", id: p.id, threadId: out.threadId, land });
      setNote({ tone: "ok", text: `Claude Code is moving it in as /apps/${slug}. It opens a pull request when it's done — you merge it.` });
    } catch (e) {
      setNote({ tone: "warn", text: e instanceof Error ? e.message : "The move didn't start." });
    } finally {
      setWorking("");
    }
  };

  /**
   * One press, or a pull request to read — remembered per device.
   *
   * On by default because that is what "one press" means: the owner presses
   * once and the app turns up. Off is the honest alternative for a move they
   * want to read first, and it has to be visible rather than buried, since the
   * difference between the two is whether code reaches main unread.
   */
  const [land, setLand] = useState(true);
  useEffect(() => {
    try {
      setLand(window.localStorage.getItem(LAND_KEY) !== "0");
    } catch {
      /* a private window has no storage; the default stands */
    }
  }, []);
  const chooseLand = (next: boolean) => {
    setLand(next);
    try {
      window.localStorage.setItem(LAND_KEY, next ? "1" : "0");
    } catch {
      /* nothing to do: the choice still holds for this visit */
    }
  };

  /** Write the pull request, or the landing, onto the project. */
  const recordMove = useCallback(
    async (patch: { prUrl?: string; landed?: boolean }) => {
      await run("move", { action: "moveLanded", id: p.id, ...patch });
    },
    [p.id, run],
  );

  /** Stop following a move: a dead one so it can be pressed again, or a finished one. */
  const forgetMove = () => {
    setNote(null);
    void run("move", { action: "moveStarted", id: p.id, threadId: "" });
  };

  return (
    <section className="space-y-3">
      <h2 className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-ink-faint">
        Handover
        {state.sent ? (
          <span className="rounded bg-core/15 px-1.5 py-0.5 text-[10.5px] normal-case tracking-normal text-core">
            {p.claimedAt ? `Open on ${p.clientUserEmail || "their account"}` : "Sent — the link opens"}
          </span>
        ) : state.kind === "site" ? (
          <span className="rounded bg-line px-1.5 py-0.5 text-[10.5px] normal-case tracking-normal text-ink-faint">Yours only</span>
        ) : null}
      </h2>

      {/* ---------- the repository, as folders ---------- */}
      <div className="overflow-hidden rounded-lg border border-line bg-panel">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
          <h3 className="text-[12px] font-semibold">
            {state.kind === "hub-app" ? "This one lives in the hub" : "The site's own repository"}
          </h3>
          {state.repo ? (
            <a
              className="truncate rounded border border-line-soft bg-panel-2 px-1.5 py-0.5 font-mono text-[11.5px] text-ink-muted hover:text-ink"
              href={repoUrl(state.repo)}
              target="_blank"
              rel="noreferrer"
            >
              {state.repo}
            </a>
          ) : (
            <span className="rounded border border-dashed border-line px-1.5 py-0.5 text-[11px] text-ink-faint">made when you send it</span>
          )}
          {state.repo && state.kind === "site" && (
            <button
              type="button"
              className="ml-auto rounded-md border border-line px-2 py-0.5 text-[11px] text-ink-muted hover:text-ink disabled:opacity-40"
              disabled={Boolean(working)}
              title="Push the folder this site was built in on your PC up to its repository"
              onClick={putCodeIn}
            >
              Put the site in it
            </button>
          )}
        </div>
        {state.kind === "hub-app" ? (
          <p className="px-3 py-4 text-[12px] leading-relaxed text-ink-faint">
            This is one of your own hub apps, so its code is the hub&rsquo;s — it is already in Jarvis Plugins at{" "}
            <a className="text-accent underline underline-offset-2" href={state.hubPath || "/"}>
              {state.hubPath}
            </a>
            , and there is nothing of its own to hand to a client.
          </p>
        ) : (
          <RepoFolder project={p} reloadKey={reloadKey} />
        )}
      </div>

      {/* ---------- what happens on a press ---------- */}
      {(working || note) && (
        <p
          role="status"
          className={`rounded-md px-3 py-2 text-[11.5px] leading-snug ${
            working ? "bg-sky-500/10 text-sky-200" : note?.tone === "ok" ? "bg-emerald-500/10 text-emerald-200" : "bg-amber-500/10 text-amber-100"
          }`}
        >
          {working || note?.text}
        </p>
      )}

      {/* ---------- the two presses ---------- */}
      {state.kind === "site" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-line bg-panel p-3">
            <h3 className="text-[12px] font-semibold">Send it to {p.clientName || "the client"}</h3>
            <p className="mb-2.5 mt-1 text-[11.5px] leading-snug text-ink-muted">
              {state.sent
                ? "Their link is open. Edits they send land in Waiting on you."
                : state.makesRepo
                  ? "Makes this site its own private GitHub repository, puts the build into it, and opens their link."
                  : "Opens their private link. The repository it already has stays as it is."}
            </p>
            {state.sent ? (
              !p.claimedAt ? (
                <button
                  type="button"
                  className="rounded-md border border-line px-3 py-2 text-xs text-ink-muted disabled:opacity-40"
                  disabled={busy === "send"}
                  onClick={() => run("send", { action: "unsend", id: p.id })}
                >
                  {busy === "send" ? "Taking it back…" : "Take it back"}
                </button>
              ) : (
                <p className="text-[11px] text-ink-faint">They have opened it, so it can&rsquo;t be taken back — archive it instead.</p>
              )
            ) : (
              <Confirm
                label="Send to the client"
                question={
                  state.makesRepo
                    ? `Make ${p.name} its own GitHub repository and open ${p.clientName || "the client"}'s link? Both are theirs from then on.`
                    : `Open ${p.clientName || "the client"}'s link now?`
                }
                yes={state.makesRepo ? "Yes, hand it over" : "Yes, send it"}
                busy={busy === "send" ? "Sending…" : ""}
                onGo={send}
                hint={state.makesRepo ? "Nothing is created until you say yes here." : "They are notified when a version is marked ready."}
              />
            )}
          </div>

          <div className="rounded-lg border border-line bg-panel p-3">
            <h3 className="text-[12px] font-semibold">Send to Jarvis Plugins</h3>
            <p className="mb-2.5 mt-1 text-[11.5px] leading-snug text-ink-muted">
              {state.pluginsBlocked === "nothing-built"
                ? "Nothing has been built yet, so there is no site to move in. Build a version first."
                : (
                    <>
                      Moves it into the hub as <code className="font-mono text-ink">/apps/{slug}</code> — its own route, its own card on
                      Jarvis &rsaquo; App plugins, on the hub&rsquo;s provider and sync. Claude Code does it on your PC and opens a pull
                      request for you to merge.
                    </>
                  )}
            </p>
            {p.pluginsMove ? (
              <MoveThread record={p.pluginsMove} slug={slug} onRecord={recordMove} onStartOver={forgetMove} />
            ) : (
              <>
                <label className="mb-2 flex items-start gap-2 text-[11.5px] leading-snug text-ink-muted">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={land}
                    onChange={(e) => chooseLand(e.target.checked)}
                  />
                  <span>
                    Take it live when the checks pass — one press and it is at <code className="font-mono text-ink">/apps/{slug}</code>.
                    Untick to stop at a pull request you read first.
                  </span>
                </label>
                <Confirm
                  label="Move it into the hub"
                  question={
                    land
                      ? `Move ${p.name} into the hub as /apps/${slug} and take it live? Claude Code does it on your PC, and it merges to main only if your PC's checks pass.`
                      : `Start Claude Code moving ${p.name} into the hub as /apps/${slug}? It opens a pull request and never merges it itself.`
                  }
                  yes={land ? "Yes, move it in and ship it" : "Yes, move it in"}
                  busy={working.startsWith("Starting") ? "Starting…" : ""}
                  tone="core"
                  disabled={Boolean(state.pluginsBlocked) || Boolean(working)}
                  onGo={toPlugins}
                  hint={
                    land
                      ? "Runs on your PC. It goes live only if the checks pass — otherwise it stops and tells you why."
                      : "Runs on your PC. Nothing goes live until you merge it."
                  }
                />
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
