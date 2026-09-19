import { NextResponse } from "next/server";
import { builderInfo, createGame, listGames } from "@/lib/game-creator/store";
import { sessionUid, storageFailed } from "@/lib/game-creator/http";
import { BUILD_MODELS, isBuildModel, isSkillName, isTemplateId, MAX_PROMPT_CHARS } from "@/lib/game-creator/types";

// GET  /api/game-creator/games — this owner's games, newest first, plus whether
//      their PC builder is connected and when it last checked in.
// POST /api/game-creator/games { prompt, template, skill?, model? } — queue a new game.
//      `skill` must be one the PC reported; otherwise the PC's default is used.
//      `model` is a BUILD_MODELS id; OpenRouter ones need the PC to have a key.

export const runtime = "nodejs";

export async function GET() {
  const uid = await sessionUid();
  const [games, builder] = await Promise.all([listGames(uid), builderInfo(uid)]);
  return NextResponse.json({ games, builder });
}

export async function POST(req: Request) {
  const uid = await sessionUid();
  const body = (await req.json().catch(() => ({}))) as {
    prompt?: unknown;
    template?: unknown;
    skill?: unknown;
    model?: unknown;
  };
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (prompt.length < 8) {
    return NextResponse.json({ error: "Describe the game in a sentence or more." }, { status: 400 });
  }
  if (prompt.length > MAX_PROMPT_CHARS) {
    return NextResponse.json({ error: `Keep the prompt under ${MAX_PROMPT_CHARS} characters.` }, { status: 400 });
  }
  const template = isTemplateId(body.template) ? body.template : "Auto";
  const model = isBuildModel(body.model) ? body.model : undefined;
  if (model && BUILD_MODELS.find((m) => m.id === model)?.via === "openrouter" && !(await builderInfo(uid)).openrouter) {
    return NextResponse.json(
      { error: "That model runs through OpenRouter. Add OPENROUTER_API_KEY to tools/unreal-builder/.env and restart the builder." },
      { status: 400 },
    );
  }
  const game = await createGame(uid, prompt, template, isSkillName(body.skill) ? body.skill : undefined, model);
  if (!game) return storageFailed();
  return NextResponse.json({ game }, { status: 201 });
}
