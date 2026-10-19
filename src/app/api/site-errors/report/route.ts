import { NextResponse } from "next/server";
import { agentLabel, coerceReport, isNoise } from "@/lib/site-errors/log";
import { saveReport } from "@/lib/site-errors/store";

// ---------------------------------------------------------------------------
// Where crashes are reported — from the hub (ErrorReporter, the error
// boundaries) and from client sites (/jarvis-errors.js).
//
// Session-exempt by exact path in middleware, because a client site's visitor
// is never signed in to the hub. That makes it public, so it only ever
// APPENDS a bounded, cleaned report to the log: no read, no response body
// worth anything, sizes capped in coerceReport, noise dropped, and the log
// folds repeats so a flood is one row with a big count.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function POST(req: Request) {
  let raw: unknown;
  try {
    const text = await req.text();
    if (text.length > 12_000) return new NextResponse(null, { status: 413, headers: CORS });
    raw = JSON.parse(text);
  } catch {
    return new NextResponse(null, { status: 400, headers: CORS });
  }
  const report = coerceReport(raw);
  if (!report || isNoise(report)) return new NextResponse(null, { status: 204, headers: CORS });
  if (!report.agent) report.agent = agentLabel(req.headers.get("user-agent") ?? "");
  try {
    const { entry } = await saveReport(report);
    return NextResponse.json({ id: entry.id }, { status: 202, headers: CORS });
  } catch (err) {
    // The reporter must never become a second crash.
    console.error("[site-errors] could not save a report:", err);
    return new NextResponse(null, { status: 204, headers: CORS });
  }
}
