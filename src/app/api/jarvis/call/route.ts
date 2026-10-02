import { NextResponse } from "next/server";
import { ownerNumber, telephony, telephonyStatus } from "@/lib/telephony/provider";
import { buildBrief } from "@/lib/telephony/script";
import type { JarvisUpdate } from "@/lib/jarvis/updates";

// ---------------------------------------------------------------------------
// Place one call.
//
//   GET   whether a call could be placed at all, and why not
//   POST  place it
//
// The DECISION of whether to ring lives in `decide.ts`, on the client, next to
// the feed it reasons over — this route only carries one out. That split is
// deliberate: the rules about quiet hours and cooldowns are the owner's and
// want to be testable without a phone bill, and a route that both decided and
// dialled would be one nobody dared run.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(telephonyStatus());
}

export async function POST(req: Request) {
  const status = telephonyStatus();
  if (!status.ready) {
    // 200, not an error: "no phone service configured" is an ordinary state of
    // this feature, and the panel shows the reason rather than a failure.
    return NextResponse.json({ ...status, placed: false, reason: status.reason });
  }

  const body = (await req.json().catch(() => ({}))) as {
    update?: Partial<JarvisUpdate>;
    ownerName?: unknown;
    timezone?: unknown;
    context?: unknown;
    test?: unknown;
  };

  const update = cleanUpdate(body.update, body.test === true);
  if (!update) return NextResponse.json({ placed: false, reason: "Nothing to call about." }, { status: 400 });

  const reference = `${update.id}:${Date.now().toString(36)}`;
  const brief = buildBrief({
    update,
    ownerName: typeof body.ownerName === "string" ? body.ownerName.slice(0, 80) : "",
    timezone: typeof body.timezone === "string" ? body.timezone.slice(0, 64) : "UTC",
    now: Date.now(),
    context: typeof body.context === "string" ? body.context.slice(0, 2000) : undefined,
  });

  try {
    const call = await telephony().place({ to: ownerNumber(), subject: update.title, brief, reference });
    return NextResponse.json({ placed: true, reference, call, provider: status.provider });
  } catch (e) {
    return NextResponse.json({
      placed: false,
      reason: e instanceof Error ? e.message : "The call could not be placed.",
      provider: status.provider,
    });
  }
}

/** Only the fields a brief is built from, each bounded. */
function cleanUpdate(raw: Partial<JarvisUpdate> | undefined, isTest: boolean): JarvisUpdate | null {
  if (isTest) {
    return {
      id: "test",
      source: "actions",
      title: "This is a test call from Jarvis",
      detail: "Nothing is wrong — you asked it to check the phone line works.",
      at: new Date().toISOString(),
      when: "just now",
    };
  }
  if (!raw?.id || !raw.title) return null;
  return {
    id: String(raw.id).slice(0, 200),
    source: (raw.source ?? "actions") as JarvisUpdate["source"],
    title: String(raw.title).slice(0, 200),
    detail: String(raw.detail ?? "").slice(0, 500),
    at: String(raw.at ?? new Date().toISOString()),
    when: String(raw.when ?? "").slice(0, 60),
    startsAt: raw.startsAt ? String(raw.startsAt) : undefined,
  };
}
