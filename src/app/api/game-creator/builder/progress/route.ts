import { NextResponse } from "next/server";
import { progress } from "@/lib/game-creator/store";
import { builderUid, notFound, unauthorized } from "@/lib/game-creator/http";
import type { GameCut, GameStatus, ProgressUpdate } from "@/lib/game-creator/types";

// POST /api/game-creator/builder/progress
//   { gameId, status?, note?, lines?, design?, manifest?, paths?, sessionId?, skillUsed? }
//
// The builder streams what Claude is doing: log lines, the design document,
// stage changes, and finally the game.json manifest. Every field is validated
// here because the body comes from a program, not from our own UI.

export const runtime = "nodejs";

const STATUSES: GameStatus[] = ["designing", "building", "testing", "packaging", "ready", "failed"];

const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : undefined);
const strList = (v: unknown, maxItems: number, maxLen: number) =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, maxItems).map((s) => s.slice(0, maxLen)) : undefined;

function cuts(v: unknown): GameCut[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v
    .map((c) =>
      typeof c === "string"
        ? { feature: c.slice(0, 200), reason: "" }
        : c && typeof c === "object"
          ? { feature: String((c as GameCut).feature ?? "").slice(0, 200), reason: String((c as GameCut).reason ?? "").slice(0, 400) }
          : null,
    )
    .filter((c): c is GameCut => Boolean(c?.feature))
    .slice(0, 20);
}

export async function POST(req: Request) {
  const uid = await builderUid(req);
  if (!uid) return unauthorized();

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const gameId = str(body?.gameId, 100);
  if (!body || !gameId) return NextResponse.json({ error: "gameId is required" }, { status: 400 });

  const m = (body.manifest ?? null) as Record<string, unknown> | null;
  const p = (body.paths ?? null) as Record<string, unknown> | null;
  const update: ProgressUpdate = {
    status: STATUSES.includes(body.status as GameStatus) ? (body.status as GameStatus) : undefined,
    note: str(body.note, 300),
    lines: strList(body.lines, 200, 2000),
    design: str(body.design, 40_000),
    manifest: m
      ? {
          title: str(m.title, 120),
          summary: str(m.summary, 1000),
          genre: str(m.genre, 80),
          template: str(m.template, 40),
          controls: strList(m.controls, 30, 200),
          features: strList(m.features, 30, 300),
          cut: cuts(m.cut),
          uproject: str(m.uproject, 500),
          packagedExe: str(m.packagedExe, 500),
        }
      : undefined,
    paths: p
      ? { uproject: str(p.uproject, 500), projectDir: str(p.projectDir, 500), packagedExe: str(p.packagedExe, 500) }
      : undefined,
    sessionId: typeof body.sessionId === "string" && /^[\w-]{8,80}$/.test(body.sessionId) ? body.sessionId : undefined,
    skillUsed: typeof body.skillUsed === "boolean" ? body.skillUsed : undefined,
  };
  if (update.paths) {
    update.paths = Object.fromEntries(Object.entries(update.paths).filter(([, v]) => v)) as ProgressUpdate["paths"];
  }

  const game = await progress(uid, gameId, update);
  if (!game) return notFound();
  return NextResponse.json({ ok: true, status: game.status });
}
