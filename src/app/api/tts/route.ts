import { NextResponse } from "next/server";
import { encodeMsgpack } from "@/lib/voice-studio/msgpack";
import { capabilitiesFor, resolveTtsPlan, type TtsTarget } from "@/lib/voice-studio/backend";
import type { TtsFormat, TtsRequest } from "@/lib/voice-studio/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_TEXT = 5000;

// GET /api/tts — capabilities, so the UI shows the right mode and gates cloning.
export function GET() {
  return NextResponse.json(capabilitiesFor(resolveTtsPlan(process.env)));
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

  const { primary, fallback } = resolveTtsPlan(process.env);
  if (primary.mode === "browser") {
    // No server backend — tell the client to speak with browser voices.
    return NextResponse.json({ fallback: true });
  }

  const format: TtsFormat = body.format === "wav" ? "wav" : "mp3";
  const speed = clamp(typeof body.speed === "number" ? body.speed : 1, 0.5, 2);

  let res: Response;
  try {
    res = await send(primary, { text, format, speed, body });
  } catch (err) {
    // The primary is unreachable. Phonon lives on the owner's own machine, so
    // that is an everyday state (laptop asleep, server not started) rather
    // than an outage — take the net if one is rigged.
    if (!fallback) {
      return NextResponse.json(
        { error: `Voice backend unreachable: ${(err as Error).message}` },
        { status: 502 },
      );
    }
    try {
      res = await send(fallback, { text, format, speed, body });
    } catch (fallbackErr) {
      return NextResponse.json(
        { error: `Voice backends unreachable: ${(fallbackErr as Error).message}` },
        { status: 502 },
      );
    }
  }

  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    return NextResponse.json(
      { error: `Voice backend error (${res.status})${detail ? `: ${detail}` : ""}` },
      { status: res.status === 429 ? 429 : 502 },
    );
  }

  const audio = await res.arrayBuffer();
  // Phonon answers WAV unless ffmpeg re-encoded it, so trust what it served
  // over what was asked for — a wrong Content-Type is a silent <audio> element.
  const served = res.headers.get("content-type");
  const contentType =
    served && served.startsWith("audio/")
      ? served
      : format === "wav"
        ? "audio/wav"
        : "audio/mpeg";

  return new NextResponse(audio, {
    status: 200,
    headers: { "Content-Type": contentType, "Cache-Control": "no-store" },
  });
}

interface SendArgs {
  text: string;
  format: TtsFormat;
  speed: number;
  body: TtsRequest;
}

/** POST one request to a resolved backend, in whichever wire format it speaks. */
function send(target: TtsTarget, args: SendArgs): Promise<Response> {
  const headers: Record<string, string> = target.key
    ? { Authorization: `Bearer ${target.key}` }
    : {};

  let payloadBody: BodyInit;
  if (target.wire === "json") {
    headers["Content-Type"] = "application/json";
    payloadBody = JSON.stringify(phononPayload(args));
  } else {
    headers["Content-Type"] = "application/msgpack";
    headers.model = process.env.FISH_MODEL || "s2.1-pro-free";
    payloadBody = toArrayBuffer(encodeMsgpack(fishPayload(args)));
  }

  return fetch(target.url, {
    method: "POST",
    headers,
    body: payloadBody,
    signal: AbortSignal.timeout(55_000),
  });
}

/** Phonon's own JSON shape (tools/phonon-tts/server.py). */
function phononPayload({ text, format, speed, body }: SendArgs): Record<string, unknown> {
  const payload: Record<string, unknown> = { text, format, speed };
  // Phonon names voices ("Easton", "Hadley"), where fish uses reference ids.
  if (body.voiceId && body.voiceId !== "default") payload.voice = body.voiceId;
  else if (process.env.PHONON_VOICE) payload.voice = process.env.PHONON_VOICE;
  return payload;
}

/** The fish.audio-shaped payload. */
function fishPayload({ text, format, speed, body }: SendArgs): Record<string, unknown> {
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
  return payload;
}

/** A fresh ArrayBuffer is an unambiguous BodyInit across DOM/Node fetch typings. */
function toArrayBuffer(packed: Uint8Array): ArrayBuffer {
  return packed.buffer.slice(
    packed.byteOffset,
    packed.byteOffset + packed.byteLength,
  ) as ArrayBuffer;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
