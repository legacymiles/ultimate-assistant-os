// POST /api/new-jarvis/attachments  { name, mime, size } → { key, url }
//   Where the browser PUTs a Chat attachment too big to ride in the agent
//   request: a signed Storage link on a deployed hub (any size up to 50 MB,
//   skipping the 4.5 MB function body cap), or this route on local disk.
// PUT  /api/new-jarvis/attachments?key=…   raw body — the local-disk path.

import { NextResponse } from "next/server";
import { chatUid, ownsKey, putLocal, uploadTarget } from "@/lib/new-jarvis/server/attachments";
import { kindOf } from "@/lib/new-jarvis/attachments";
import { isRemoteConfigured } from "@/lib/server/blobStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const fail = (error: string, status = 400) => NextResponse.json({ error }, { status });

export async function POST(req: Request) {
  const uid = await chatUid();
  if (!uid) return fail("Sign in to attach files.", 401);
  const body = (await req.json().catch(() => ({}))) as { name?: string; mime?: string; size?: number };
  const name = String(body.name ?? "file").slice(0, 200);
  if (!kindOf(String(body.mime ?? ""), name)) return fail(`${name} isn't a file type the model can read.`);
  try {
    return NextResponse.json(await uploadTarget(uid, name, Number(body.size)));
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Could not prepare the upload.", 502);
  }
}

export async function PUT(req: Request) {
  const uid = await chatUid();
  if (!uid) return fail("Sign in to attach files.", 401);
  if (isRemoteConfigured()) return fail("Upload to the signed storage link instead.", 409);
  const key = new URL(req.url).searchParams.get("key");
  if (!ownsKey(uid, key)) return fail("Not your upload key.", 403);
  const bytes = Buffer.from(await req.arrayBuffer());
  if (!bytes.length) return fail("Empty upload.");
  const ok = await putLocal(key, bytes, req.headers.get("content-type") ?? "application/octet-stream");
  return ok ? NextResponse.json({ ok: true, key }) : fail("Could not save the file.", 500);
}
