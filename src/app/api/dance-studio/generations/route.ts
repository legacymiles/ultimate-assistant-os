// POST /api/dance-studio/generations
//   { danceId, characterId, userPrompt?, settings?: { resolution?, useExtraImages? } }
//
// Starts one render of dance × character and files it immediately, so the
// library shows it as generating even if the browser closes. Regenerate is
// the same call again — every take is kept.

import { NextResponse } from "next/server";

import { composeMotionPrompt } from "@/lib/dance-studio/h3prompt";
import { REF_MAX_SEC, REF_MIN_SEC, aspectFor, estimateCostUsd, outputSeconds } from "@/lib/dance-studio/limits";
import { errorMessage, fail, newId, nowIso, readJson, requireUid } from "@/lib/dance-studio/server/http";
import { loadLibrary, mutateLibrary } from "@/lib/dance-studio/server/library";
import { activeProvider } from "@/lib/dance-studio/server/providers";
import { remoteStorage, signedReadUrl } from "@/lib/dance-studio/server/storage";
import type { Generation, GenerationSettings } from "@/lib/dance-studio/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface Body {
  danceId?: string;
  characterId?: string;
  userPrompt?: string;
  settings?: Partial<GenerationSettings>;
}

export async function POST(req: Request) {
  const uid = await requireUid();
  if (uid instanceof NextResponse) return uid;
  const b = await readJson<Body>(req);
  if (!b) return fail("Bad request body.");

  const provider = activeProvider();
  if (!provider) return fail("No video provider is configured. Set AI_GATEWAY_API_KEY or MINIMAX_API_KEY.", 503);
  if (!remoteStorage()) {
    return fail("MiniMax has to download the dance clip and character image from a link, but this server keeps media on local disk. Set SUPABASE_SERVICE_ROLE_KEY.", 409);
  }

  const lib = await loadLibrary(uid);
  const dance = lib.dances.find((d) => d.id === b.danceId);
  const character = lib.characters.find((c) => c.id === b.characterId);
  if (!dance) return fail("Pick a reference dance.", 404);
  if (!character) return fail("Pick a character.", 404);
  if (!character.active) return fail(`${character.name} is inactive. Turn them back on in Characters first.`, 409);
  if (dance.durationSec < REF_MIN_SEC || dance.durationSec > REF_MAX_SEC + 0.6) return fail("That dance clip is outside the model's 2–15 s range.", 422);

  const settings: GenerationSettings = {
    resolution: b.settings?.resolution === "2k" && provider.info.resolutions.includes("2k") ? "2k" : "768p",
    aspectRatio: aspectFor(dance.width, dance.height),
    durationSec: outputSeconds(dance.durationSec),
    useExtraImages: !!b.settings?.useExtraImages,
  };
  const imageKeys = [character.imageKey, ...(settings.useExtraImages ? character.extraImageKeys : [])].slice(0, provider.info.maxCharacterImages);
  const userPrompt = String(b.userPrompt ?? "").trim().slice(0, 1500);
  const prompt = composeMotionPrompt({
    characterName: character.name,
    description: character.description,
    imageCount: imageKeys.length,
    userPrompt,
  });

  const at = nowIso();
  const gen: Generation = {
    id: newId("gen"),
    danceId: dance.id,
    characterId: character.id,
    characterName: character.name,
    status: "queued",
    providerId: provider.info.id,
    model: provider.info.model,
    userPrompt,
    prompt,
    settings,
    warnings: [],
    estimatedCostUsd: estimateCostUsd(provider.info.pricing, settings, dance.durationSec, imageKeys.length),
    createdAt: at,
    updatedAt: at,
  };

  try {
    const [referenceVideoUrl, ...characterImageUrls] = await Promise.all([dance.videoKey, ...imageKeys].map((k) => signedReadUrl(k)));
    if (!referenceVideoUrl || characterImageUrls.some((u) => !u)) throw new Error("Couldn't create download links for the clip or character images.");
    const started = await provider.start({
      referenceVideoUrl,
      referenceDurationSec: dance.durationSec,
      characterImageUrls: characterImageUrls as string[],
      prompt,
      settings,
    });
    gen.operation = started.operation;
    gen.warnings = started.warnings;
    gen.status = "generating";
    gen.startedAt = nowIso();
  } catch (err) {
    gen.status = "error";
    gen.error = errorMessage(err);
  }
  gen.updatedAt = nowIso();

  const { saved } = await mutateLibrary(uid, (l) => l.generations.unshift(gen));
  if (!saved) return fail("The render may have started, but the library couldn't be saved.", 500);
  return NextResponse.json({ generation: gen }, { status: gen.status === "error" ? 502 : 200 });
}
