import { NextResponse } from "next/server";
import { aiEndpoint } from "@/lib/ai/provider";
import { aiReady, chatJson } from "@/lib/music-classified/ai";
import {
  LISTEN_SYSTEM,
  coerceDraft,
  heuristicDraft,
  listenPrompt,
  type ArtistSongSummary,
} from "@/lib/music-classified/classify";
import { clampLevel, isLens } from "@/lib/music-classified/levels";
import type { ClassifyResult, Measured, SongDraft, Tree } from "@/lib/music-classified/types";

export const runtime = "nodejs";
export const maxDuration = 120;

// Gemini models on OpenRouter accept audio input (verified 2026-09-13: a
// synthetic 128 BPM clip came back as 125 BPM electronic/techno in 6.5s).
// Claude does not hear audio, so this route uses a separate model.
const LISTEN_MODEL = process.env.MUSIC_LISTEN_MODEL || "google/gemini-3.8-flash";

/** ~2.9 MB of WAV once decoded — well past a 40s 16 kHz mono clip, under Vercel's 4.5 MB body cap. */
const MAX_CLIP_CHARS = 3_900_000;

// POST /api/music-classified/listen
// Body: { title, artist, measured?, clip? (base64 WAV), tree, lenses, artistSongs }
// Files one of the user's own songs. Always answers with a draft.
export async function POST(req: Request) {
  let body: {
    title?: string;
    artist?: string;
    measured?: Measured | null;
    clip?: string | null;
    tree?: Tree;
    lenses?: unknown[];
    artistSongs?: ArtistSongSummary[];
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body (is the audio clip too large?)" }, { status: 400 });
  }
  const title = String(body.title ?? "").trim().slice(0, 200);
  const artist = String(body.artist ?? "").trim().slice(0, 120);
  if (!title || !artist) return NextResponse.json({ error: "A song needs a title and an artist." }, { status: 400 });

  const lenses = (body.lenses ?? []).filter(isLens);
  const tree = body.tree && typeof body.tree === "object" ? body.tree : {};
  const measured = body.measured ?? undefined;
  const artistSongs = (Array.isArray(body.artistSongs) ? body.artistSongs : [])
    .filter((s) => s && typeof s.title === "string")
    .slice(0, 40)
    .map((s) => ({ title: s.title.slice(0, 120), level: clampLevel(s.level), genre: String(s.genre ?? ""), subgenre: String(s.subgenre ?? "") }));

  const ctx = { identity: { title, artist, matched: false }, measured, tree, lenses };
  // Own music has no catalogue record: no links, no store genre.
  const own = (d: SongDraft): SongDraft => ({ ...d, title, artist, links: [], sourceGenre: undefined, artwork: undefined, kind: "own" });

  if (!aiReady()) {
    return NextResponse.json({
      draft: own(heuristicDraft(ctx)),
      aiAvailable: false,
      warning: "No AI key is set, so songs were filed from their measured tempo only.",
    } satisfies ClassifyResult);
  }

  const clip = typeof body.clip === "string" && body.clip.length <= MAX_CLIP_CHARS ? body.clip : null;
  const canHear = Boolean(clip) && aiEndpoint()?.provider === "openrouter";

  try {
    const prompt = listenPrompt({ title, artist, measured, tree, lenses, artistSongs, heard: canHear });
    const raw = canHear
      ? await chatJson(
          LISTEN_SYSTEM,
          [
            { type: "text", text: prompt },
            { type: "input_audio", input_audio: { data: clip!, format: "wav" } },
          ],
          { model: LISTEN_MODEL, maxTokens: 8000 + 1500 * lenses.length, timeoutMs: 110_000 },
        )
      : await chatJson(LISTEN_SYSTEM, prompt, { maxTokens: 5000 + 1500 * lenses.length, timeoutMs: 110_000 });
    const filed = own(coerceDraft(raw, ctx));
    // For a released song the model may correct a half/double-time detector
    // error because it KNOWS the record. It can't know your own song, so the
    // measurement stands (it called a 140 BPM half-time beat "70").
    const draft =
      measured && measured.bpmConfidence >= 0.3
        ? { ...filed, profile: { ...filed.profile, bpm: Math.round(measured.bpm) } }
        : filed;
    return NextResponse.json({
      draft: { ...draft, confidence: canHear ? "heard" : "guess" },
      aiAvailable: true,
      warning: canHear
        ? undefined
        : clip
          ? "The AI couldn't listen (hearing audio needs OPENROUTER_API_KEY), so songs were filed from their measurements."
          : "The audio couldn't be prepared, so this was filed from its measurements.",
    } satisfies ClassifyResult);
  } catch (err) {
    console.error("music-classified listen failed, using offline filer:", err);
    return NextResponse.json({
      draft: own(heuristicDraft(ctx)),
      aiAvailable: true,
      warning: "The AI didn't answer, so this was filed from measured tempo. Open it and hit Listen again to retry.",
    } satisfies ClassifyResult);
  }
}
