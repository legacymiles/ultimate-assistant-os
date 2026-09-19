import { personaContext } from "@/lib/social-personas/logic";
import type { ChatMsg, Persona } from "@/lib/social-personas/types";
import { aiReady, askText } from "@/lib/social-personas/server/ai";
import { body, fail } from "@/lib/social-personas/server/http";

export const runtime = "nodejs";
export const maxDuration = 120;

// POST { persona, messages: ChatMsg[] } → { reply }
export async function POST(req: Request) {
  const b = await body(req);
  const persona = b?.persona as Persona | undefined;
  const messages = (Array.isArray(b?.messages) ? b.messages : []) as ChatMsg[];
  if (!persona?.name || !messages.length) return fail(400, "Missing persona or message.");
  if (!aiReady()) {
    return Response.json({
      reply:
        "Brainstorming needs an AI key (OPENROUTER_API_KEY in .env.local). Meanwhile, today's ideas and the content table still work offline.",
      offline: true,
    });
  }
  const system =
    `You are the brainstorming partner and creative producer for this creator. You know their account:\n\n${personaContext(persona)}\n\n` +
    "Stay inside their niche and voice. Be specific: hooks word for word, shot lists, captions, hashtags, posting times, series ideas. " +
    "Reference their real posts and what performed when it helps. Keep answers tight and skimmable (short lists, no fluff). " +
    (persona.avoid ? `Never suggest: ${persona.avoid}.` : "");
  try {
    const reply = await askText(
      system,
      messages.slice(-20).map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content).slice(0, 4000) })),
    );
    return Response.json({ reply });
  } catch (err) {
    console.error("[social-personas/chat] AI failed:", err);
    return fail(502, `The AI didn't answer: ${(err as Error).message.slice(0, 200)}`);
  }
}
