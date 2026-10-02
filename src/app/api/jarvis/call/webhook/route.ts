import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { readWebhook } from "@/lib/telephony/script";
import { readDoc, writeDoc } from "@/lib/server/docStore";
import { dataDir } from "@/lib/recall/dataDir";

// ---------------------------------------------------------------------------
// What the phone provider tells us afterwards.
//
// This is a PUBLIC route — the provider calls it from their own servers, so it
// carries no session and cannot. Two things follow, and both matter:
//
//   It is authenticated by a shared secret, not by a session. Without
//   JARVIS_CALL_WEBHOOK_SECRET set, the route refuses everything rather than
//   accepting anything: an open endpoint that writes into the owner's call log
//   is a way to put words in Jarvis's mouth.
//
//   Nothing it says is ACTED ON. Anything the owner asked for during the call
//   is recorded as a request and waits for a yes given on a screen. A webhook
//   body is the least verified input in the system and it arrives claiming the
//   owner agreed to something.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DOC = "jarvis-calls";
const KEEP = 100;

interface CallRecord {
  reference: string;
  status: string;
  summary: string;
  requests: string[];
  seconds?: number;
  at: string;
}

/**
 * Compare the provider's signature against ours.
 *
 * Constant-time, and the body is read as TEXT before being parsed — a signature
 * over a re-serialised object is a signature over different bytes, which is the
 * usual way webhook verification is accidentally disabled.
 */
function signed(raw: string, header: string, secret: string): boolean {
  if (!header) return false;
  const expected = createHmac("sha256", secret).update(raw, "utf8").digest("hex");
  // Providers send it variously as a bare hex digest or as `v1=<digest>`.
  const given = header.includes("=") ? header.split("=").pop()!.trim() : header.trim();
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(given.toLowerCase(), "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  const secret = process.env.JARVIS_CALL_WEBHOOK_SECRET ?? "";
  if (!secret) {
    // Refusing is the safe default. An open endpoint here writes into the
    // owner's call log, which is a way to put words in Jarvis's mouth.
    return NextResponse.json({ ok: false, reason: "No webhook secret configured." }, { status: 503 });
  }

  const raw = await req.text();
  const header =
    req.headers.get("x-retell-signature") ??
    req.headers.get("x-vapi-signature") ??
    req.headers.get("x-twilio-signature") ??
    req.headers.get("x-signature") ??
    "";

  if (!signed(raw, header, secret)) {
    return NextResponse.json({ ok: false, reason: "Bad signature." }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, reason: "Not JSON." }, { status: 400 });
  }

  const outcome = readWebhook(body);
  // A webhook that cannot be tied back to a call we placed is noise. 200 so the
  // provider stops retrying something that will never match.
  if (!outcome) return NextResponse.json({ ok: true, matched: false });

  const existing = ((await readDoc<{ calls?: CallRecord[] }>(DOC, dataDir())) ?? {}).calls ?? [];
  const record: CallRecord = {
    reference: outcome.reference,
    status: outcome.status,
    summary: outcome.summary,
    requests: outcome.requests,
    seconds: outcome.seconds,
    at: new Date().toISOString(),
  };

  await writeDoc(DOC, dataDir(), {
    calls: [record, ...existing.filter((c) => c.reference !== outcome.reference)].slice(0, KEEP),
  });

  return NextResponse.json({ ok: true, matched: true });
}

/** The call log, for the panel. Session-authenticated by the hub's own gate. */
export async function GET() {
  const doc = (await readDoc<{ calls?: CallRecord[] }>(DOC, dataDir())) ?? {};
  return NextResponse.json({ calls: doc.calls ?? [] });
}
