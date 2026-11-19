import { NextResponse } from "next/server";
import { readBoard, saveBoard, viewerCanEdit } from "@/lib/ai-rankings/boardServer";
import { mergeInbox, runSweep } from "@/lib/ai-rankings/sweep";
import { AA_BOARDS, applyScoreRefresh, countApplied, refreshScores, scoreNote } from "@/lib/ai-rankings/scores";
import {
  applyMetricRefresh,
  countApplied as countMetricsApplied,
  metricNote,
  refreshMetrics,
} from "@/lib/ai-rankings/metrics";
import {
  AA_MODEL_PAGE,
  ARENA_DISCOVER_TOP,
  discoveriesFrom,
  fromAaEntries,
  fromAaLlmEntries,
  nameKey,
} from "@/lib/ai-rankings/sources";
import type { InboxItem } from "@/lib/ai-rankings/leaderboard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/ai-rankings/sweep
//
// The daily check, in two halves: Hugging Face for new releases, which land in
// the owner's inbox, and Artificial Analysis for the scores already on the
// board, which are refreshed in place — a score nobody re-reads is what makes
// a leaderboard quietly wrong. With no ARTIFICIAL_ANALYSIS_API_KEY the score
// half is skipped, the note says so, and the release half still runs.
//
// Called once a day by .github/workflows/ai-rankings-sweep.yml (bearer token,
// no session) and by the owner's "Check now" button (session).
//
// It is a token path in middleware, so the check here is the only guard:
// a matching AI_RANKINGS_SWEEP_TOKEN, or the owner's own session. The worst an
// unauthorised call could do is fill the inbox early, but it still has to be
// one of those two.

function bearerOk(req: Request): boolean {
  const token = process.env.AI_RANKINGS_SWEEP_TOKEN;
  if (!token) return false;
  const got = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (got.length !== token.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ token.charCodeAt(i);
  return diff === 0;
}

export async function POST(req: Request) {
  if (!bearerOk(req) && !(await viewerCanEdit())) {
    return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  }

  let board;
  try {
    board = await readBoard();
  } catch (err) {
    console.error("ai-rankings sweep: read failed", err);
    return NextResponse.json({ error: "Couldn't reach storage. The next run will try again." }, { status: 503 });
  }

  // All three halves read the web, so they run together; none of them writes.
  const key = process.env.ARTIFICIAL_ANALYSIS_API_KEY;
  const [result, scores, measures] = await Promise.all([
    runSweep(board),
    refreshScores(board, { apiKey: key }),
    refreshMetrics(board, { apiKey: key }),
  ]);
  const at = new Date().toISOString();
  const nowMs = Date.parse(at);

  // Discovery from the arenas, out of entries the two refreshes already
  // fetched — so it costs no extra call against the free tier's 100 a day.
  // Seeded with what the trending feed just found and what is already
  // waiting, so one model found twice is suggested once.
  const seen = new Set<string>([...result.added, ...board.inbox].map((i) => nameKey(i.name)));
  const arena: InboxItem[] = [];
  for (const b of AA_BOARDS) {
    const entries = scores.entries?.[b.category];
    if (!entries?.length) continue;
    arena.push(
      ...discoveriesFrom(
        fromAaEntries(entries).slice(0, ARENA_DISCOVER_TOP),
        b.category,
        b.url,
        board,
        nowMs,
        seen,
      ),
    );
  }
  if (measures.entries?.length) {
    arena.push(
      ...discoveriesFrom(
        fromAaLlmEntries(measures.entries).slice(0, ARENA_DISCOVER_TOP),
        "llm",
        AA_MODEL_PAGE,
        board,
        nowMs,
        seen,
      ),
    );
  }

  const found = [...result.added, ...arena];
  const n = found.length;

  // Re-read just before saving: the owner may have approved something, or
  // typed a score, while the feeds were loading, and saving the stale copy
  // would undo it.
  let latest;
  try {
    latest = await readBoard();
  } catch {
    return NextResponse.json({ error: "Couldn't reach storage. The next run will try again." }, { status: 503 });
  }
  const scored = applyScoreRefresh(latest, scores, at);
  const measured = applyMetricRefresh(scored, measures, at);
  const applied = countApplied(latest, scored, scores);
  const metricsApplied = countMetricsApplied(scored, measured, measures);
  const note = [
    (n
      ? `${n} new release${n === 1 ? "" : "s"} found` +
        (arena.length ? ` (${arena.length} from the arenas)` : "")
      : "No new releases") + (result.failed.length ? ` · couldn't read ${result.failed.join(", ")}` : ""),
    scoreNote(scores, applied),
    metricNote(measures, metricsApplied),
  ]
    .filter(Boolean)
    .join(" · ");

  const next = { ...measured, inbox: mergeInbox(latest, found), lastSweepAt: at, lastSweepNote: note };
  if (!(await saveBoard(next))) {
    return NextResponse.json({ error: "Checked, but couldn't save the result. The next run will try again." }, { status: 503 });
  }
  return NextResponse.json({
    added: n,
    fromArenas: arena.length,
    failed: result.failed,
    measurements: {
      updated: metricsApplied,
      skippedForKey: Boolean(measures.noKey),
      failed: Boolean(measures.failed),
      // Every measurement that moved, so a wrong match is visible here too.
      changes: measures.changes.map((c) => ({
        name: c.name,
        dim: c.dim,
        from: c.from,
        to: c.to,
        aaName: c.aaName,
      })),
    },
    note,
    inbox: next.inbox,
    lastSweepAt: at,
    models: next.models,
    scores: {
      refreshed: applied,
      skippedForKey: Boolean(scores.noKey),
      boardsRead: Object.keys(scores.refreshedAt),
      boardsFresh: scores.fresh,
      failed: scores.failed,
      // Every match that moved, so a wrong one is visible in the response.
      changes: scores.changes.map((c) => ({
        name: c.name,
        maker: c.maker,
        category: c.category,
        from: c.from,
        to: c.to,
        aaName: c.aaName,
      })),
    },
  });
}
