import { NextResponse } from "next/server";
import type { AnalyzeRequest, AnalyzeResponse } from "@/lib/h3-lab/api";
import type { Blueprint, BlueprintShot } from "@/lib/h3-lab/model";
import { guessGenre, GENRES } from "@/lib/h3-lab/genres";
import { blueprintMeta, log, newId, aiCallsLeft } from "@/lib/h3-lab/state";
import { analyzeAsk, askHub, offlineAnalysis, parseAnalysis } from "@/lib/h3-lab/server/brain";
import { loadLab, mutateLab, saveBlueprint } from "@/lib/h3-lab/server/store";
import { bad, readJson, sessionUid } from "@/lib/h3-lab/server/http";
import { aiConfigured } from "@/lib/ai/provider";

// POST /api/h3-lab/analyze — reverse-engineer a reference video.
//
// The browser already found the shots (colour-histogram cuts, measured) and
// grabbed keyframes; this route asks a vision model to describe each shot's
// people, blocking, action, camera, light and set in the blueprint's shape,
// and stores the blueprint. With no AI available it stores the measured
// structure only and says so. Owner-only.

export const runtime = "nodejs";
export const maxDuration = 120;

const FRAME = /^data:image\/(jpeg|webp|png);base64,[A-Za-z0-9+/=]+$/;
const MAX_SHOTS = 40;
const MAX_TOTAL = 4_000_000;

export async function POST(req: Request) {
  const uid = await sessionUid();
  const body = await readJson<AnalyzeRequest>(req);
  if (!body || !Array.isArray(body.shots) || !body.shots.length) return bad("Send the detected shots.");
  const shots = body.shots.slice(0, MAX_SHOTS).map((s) => ({
    start: Math.max(0, Number(s.start) || 0),
    end: Math.max(0, Number(s.end) || 0),
    cutStrength: Math.max(0, Math.min(1, Number(s.cutStrength) || 0)),
    frames: (s.frames ?? []).filter((f) => typeof f === "string" && FRAME.test(f)).slice(0, 3),
  }));
  const total = shots.reduce((n, s) => n + s.frames.reduce((m, f) => m + f.length, 0), 0);
  if (total > MAX_TOTAL) return bad("Too many frame bytes — send fewer or smaller keyframes.", 413);
  const req2: AnalyzeRequest = {
    name: String(body.name ?? "reference.mp4").slice(0, 200),
    durationSec: Number(body.durationSec) || shots[shots.length - 1].end,
    width: Number(body.width) || 1920,
    height: Number(body.height) || 1080,
    note: String(body.note ?? "").slice(0, 1000),
    audio: body.audio ? String(body.audio).slice(0, 1000) : undefined,
    genre: body.genre,
    shots,
  };

  const snapshot = await loadLab(uid);
  const fallbackGenre = body.genre && GENRES.some((g) => g.id === body.genre) ? body.genre : guessGenre(`${req2.name} ${req2.note}`);
  let engine: "ai" | "offline" = "offline";
  let notice: string | undefined;
  let draft = offlineAnalysis(req2, fallbackGenre);

  if (aiConfigured() && aiCallsLeft(snapshot, new Date().toISOString()) > 0) {
    try {
      const parsed = parseAnalysis(await askHub(analyzeAsk(req2), snapshot.agent.model), shots.length);
      if (parsed) {
        draft = { ...parsed, genre: body.genre && GENRES.some((g) => g.id === body.genre) ? body.genre : parsed.genre };
        engine = "ai";
      } else notice = "The vision model's answer could not be read — kept the measured shot structure only.";
    } catch (e) {
      notice = `The vision model failed (${e instanceof Error ? e.message : e}) — kept the measured shot structure only.`;
    }
  } else {
    notice = aiConfigured() ? "Today's AI budget is spent — stored the measured shot structure only." : "No AI key is configured — stored the measured shot structure (cuts, timings, keyframes) only. Add OPENROUTER_API_KEY to have each shot described.";
  }

  const bpShots: BlueprintShot[] = shots.map((s, i) => ({
    index: i,
    start: s.start,
    end: s.end,
    keyframes: s.frames,
    cutStrength: s.cutStrength,
    ...draft.shots[i],
  }));
  const blueprint: Blueprint = {
    id: newId("bp"),
    sourceName: req2.name,
    durationSec: req2.durationSec,
    width: req2.width,
    height: req2.height,
    createdAt: new Date().toISOString(),
    detection: "browser-histogram",
    engine,
    genre: draft.genre,
    style: draft.style,
    editingRhythm: draft.editingRhythm || `${shots.length} shots, average ${(req2.durationSec / shots.length).toFixed(1)}s`,
    sound: draft.sound,
    characters: draft.characters,
    environments: draft.environments,
    shots: bpShots,
    ...(notice ? { notice } : {}),
  };
  if (!(await saveBlueprint(uid, blueprint))) return bad("Could not save the blueprint.", 500);
  const now = new Date().toISOString();
  const { state } = await mutateLab(uid, (s) => {
    if (engine === "ai") s.counters.aiCalls++;
    s.blueprints.unshift(blueprintMeta(blueprint));
    if (s.blueprints.length > 50) s.blueprints.length = 50;
    log(s, "owner", "analyze-reference", `Reverse-engineered "${blueprint.sourceName}": ${blueprint.shots.length} shots over ${blueprint.durationSec.toFixed(1)}s, ${blueprint.characters.length} people, ${blueprint.environments.length} place(s)${engine === "offline" ? " (measured structure only)" : ""}.`, { type: "blueprint", id: blueprint.id }, now);
  });
  return NextResponse.json({ blueprintId: blueprint.id, engine, notice, state } satisfies AnalyzeResponse);
}
