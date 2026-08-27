import { NextResponse } from "next/server";
import { encodeMsgpack } from "@/lib/voice-studio/msgpack";
import type { TtsCapabilities, TtsRequest } from "@/lib/voice-studio/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const FISH_URL = "https://api.fish.audio/v1/tts";
const MAX_TEXT = 5000;

// Resolve which backend is active from env.
function resolveBackend(): { mode: TtsCapabilities["mode"]; url: string; key?: string } {
  const selfHost = process.env.TTS_SELF_HOST_URL;
  if (process.env.TTS_BACKEND === "self-hosted" && selfHost) {
    const url = /\/tts\/?$/.test(selfHost) ? selfHost : `${selfHost.replace(/\/$/, "")}/v1/tts`;
    return { mode: "self-hosted", url, key: process.env.TTS_SELF_HOST_KEY };
  }
  if (process.env.FISH_API_KEY) {
    return { mode: "fish-audio", url: FISH_URL, key: process.env.FISH_API_KEY };
  }
  return { mode: "browser", url: "" };
}

// GET /api/tts — capabilities, so the UI shows the right mode and gates cloning.
export function GET() {
  const { mode } = resolveBackend();
  const caps: TtsCapabilities = { mode, cloning: mode !== "browser" };
  return NextResponse.json(caps);
}

// POST /api/tts — generate speech. Returns audio bytes, or { fallback: true }
// when no server backend is configured (the client uses browser voices).
export async function POST(req: Request) {
  let body: TtsRequest;
  try {
    body = (await req.json()) as TtsRequest;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) return NextResponse.json({ error: "Text is required" }, { status: 400 });
  if (text.length > MAX_TEXT) {
    return NextResponse.json({ error: `Text too long (max ${MAX_TEXT} characters)` }, { status: 400 });
  }

  const { mode, url, key } = resolveBackend();
  if (mode === "browser") {
    // No server backend — tell the client to speak with browser voices.
    return NextResponse.json({ fallback: true });
  }

  const format = body.format === "wav" ? "wav" : "mp3";
  const speed = clamp(typeof body.speed === "number" ? body.speed : 1, 0.5, 2);

  // Build the fish.audio-shaped payload.
  const payload: Record<string, unknown> = {
    text,
    format,
    chunk_length: 200,
    prosody: { speed },
  };
  if (format === "mp3") payload.mp3_bitrate = 128;

  if (body.reference?.audioBase64) {
    // Instant voice cloning: inline reference clip + its transcript.
    const audio = Buffer.from(body.reference.audioBase64, "base64");
    payload.references = [{ audio: new Uint8Array(audio), text: body.reference.transcript ?? "" }];
  } else if (body.voiceId && body.voiceId !== "default") {
    payload.reference_id = body.voiceId;
  }

  const packed = encodeMsgpack(payload);
  // A fresh ArrayBuffer is an unambiguous BodyInit across DOM/Node fetch typings.
  const reqBuf = packed.buffer.slice(
    packed.byteOffset,
    packed.byteOffset + packed.byteLength,
  ) as ArrayBuffer;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/msgpack",
        ...(key ? { Authorization: `Bearer ${key}` } : {}),
        model: process.env.FISH_MODEL || "s2.1-pro-free",
      },
      body: reqBuf,
      signal: AbortSignal.timeout(55_000),
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Voice backend unreachable: ${(err as Error).message}` },
      { status: 502 },
    );
  }

  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    return NextResponse.json(
      { error: `Voice backend error (${res.status})${detail ? `: ${detail}` : ""}` },
      { status: res.status === 429 ? 429 : 502 },
    );
  }

  const audio = await res.arrayBuffer();
  return new NextResponse(audio, {
    status: 200,
    headers: {
      "Content-Type": format === "wav" ? "audio/wav" : "audio/mpeg",
      "Cache-Control": "no-store",
    },
  });
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
