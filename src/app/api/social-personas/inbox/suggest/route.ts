import { personaContext } from "@/lib/social-personas/logic";
import type { InboxThread } from "@/lib/social-personas/inbox";
import type { Persona } from "@/lib/social-personas/types";
import { aiReady, askText } from "@/lib/social-personas/server/ai";
import { body, fail } from "@/lib/social-personas/server/http";

export const runtime = "nodejs";
export const maxDuration = 60;

// POST { persona, thread } → { reply }
// Drafts one reply in the persona's own voice. It only ever fills the reply
// box — a person reads it and presses Send.
export async function POST(req: Request) {
  const b = await body(req);
  const persona = b?.persona as Persona | undefined;
  const t = b?.thread as InboxThread | undefined;
  if (!persona?.name || !t || !Array.isArray(t.messages) || !t.messages.length) return fail(400, "Missing persona or conversation.");
  if (!aiReady()) return fail(503, "Reply ideas need AI turned on (an OpenRouter key in Jarvis › Profile › Connections). You can still type and send replies.");

  const where = t.kind === "dm" ? `a direct message on ${t.platform}` : `a comment on ${t.platform}${t.post?.title ? ` under "${String(t.post.title).slice(0, 100)}"` : ""}`;
  const convo = t.messages
    .slice(-12)
    .map((m) => `${m.mine ? persona.name : String(m.author || t.who?.name || "Them")}: ${String(m.text).slice(0, 1500)}`)
    .join("\n");
  const system =
    `You write replies for this creator persona, in their voice:\n\n${personaContext(persona, { maxPosts: 12 })}\n\n` +
    "Write ONE reply to the latest message. Sound like a real person, match the persona's tone, keep it short " +
    (t.kind === "dm" ? "(1–3 sentences)" : "(one or two sentences — it's a public comment)") +
    ". Be warm and specific to what they said. No hashtags, no quotes around it, no sign-off, nothing but the reply text. " +
    "Never promise money, deals, meetups, or anything the persona hasn't said they offer; for business or brand-deal questions, invite them to share details. " +
    (persona.avoid ? `Never mention: ${persona.avoid}.` : "");
  try {
    const reply = (await askText(system, [{ role: "user", content: `This is ${where}. Conversation so far:\n${convo}\n\nWrite ${persona.name}'s reply.` }], 0.7))
      .trim()
      .replace(/^["“]|["”]$/g, "");
    return Response.json({ reply: reply.slice(0, t.kind === "dm" ? 1000 : 2200) });
  } catch (err) {
    console.error("[social-personas/inbox] suggest failed:", err);
    return fail(502, `The AI didn't answer: ${(err as Error).message.slice(0, 200)}`);
  }
}
