// Jarvis's command bar for the 24/7 Queue: { text, taskId?, tz?, model?, images? }
// → { reply, created, acted, model }. `model` is the chat's model pick (an
// OpenRouter id; absent = Auto), `images` up to six reference pictures as
// { dataUrl, name } (the browser shrinks them first; see lib/queue247/refs.ts). Also what the Jarvis chat's queue_command tool
// and the connector's task_command call.
//
// GET ?taskId= → the conversation so far (general, or about one task).

import { NextResponse } from "next/server";
import { errorJson, signedIn } from "@/lib/queue247/server/auth";
import { queueDb } from "@/lib/queue247/server/db";
import { runCommand } from "@/lib/queue247/server/command";
import { listMessages } from "@/lib/queue247/server/store";
import { saveRefs, signAttachments } from "@/lib/queue247/server/refs";
import { cleanRefs } from "@/lib/queue247/refs";
import { isModelId } from "@/lib/new-jarvis/chatModels";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: Request) {
  const who = await signedIn();
  if ("error" in who) return who.error;
  const taskId = new URL(req.url).searchParams.get("taskId");
  try {
    return NextResponse.json({ messages: await signAttachments(await listMessages(queueDb(), who.uid, taskId || null, 60)) });
  } catch (e) {
    return errorJson(e);
  }
}

export async function POST(req: Request) {
  const who = await signedIn();
  if ("error" in who) return who.error;
  let body: { text?: string; taskId?: string; tz?: string; from?: string; model?: unknown; images?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Send JSON." }, { status: 400 });
  }
  const { refs, problem } = cleanRefs(body.images);
  const text = String(body.text ?? "").trim() || (refs.length ? "Here is a reference picture — what can you do with it?" : "");
  if (!text) return NextResponse.json({ error: "Tell Jarvis what you want done." }, { status: 400 });
  try {
    const { saved, failed } = await saveRefs(who.uid, refs);
    const result = await runCommand(queueDb(), who.uid, text, {
      taskId: body.taskId || null,
      tz: typeof body.tz === "string" ? body.tz.slice(0, 60) : undefined,
      from: body.from === "jarvis-chat" ? "jarvis-chat" : "jarvis",
      // Only a real OpenRouter id is honoured; a subscription pick (the PC's
      // Claude) or anything else plans with Auto.
      model: isModelId(body.model) ? body.model : undefined,
      refs: saved,
    });
    const notes = [problem, failed ? `${failed} picture${failed === 1 ? "" : "s"} could not be stored.` : null].filter(Boolean);
    return NextResponse.json(notes.length ? { ...result, notice: notes.join(" ") } : result);
  } catch (e) {
    return errorJson(e);
  }
}
