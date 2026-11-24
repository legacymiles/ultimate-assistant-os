import { NextResponse } from "next/server";
import { aiConfigured, aiFetch } from "@/lib/ai/provider";
import { parseDirectAnswer } from "@/lib/ai-live-studio/command";
import { EMOTIONS, sanitizePerformance } from "@/lib/ai-live-studio/performance";
import { sanitizeSettings } from "@/lib/ai-live-studio/personality";
import { speakable } from "@/lib/ai-live-studio/reply";

// The director's earpiece. What the owner says privately — anything the
// instant parser couldn't place, and every line while Talkback is on — comes
// here and goes back as checked directions plus, when asked for, Alex's
// private answer.
//
// PRIVATE by design: nothing this route returns is ever spoken on the stream.
// The browser plays `reply` only on the director's own output device, and
// only when Talkback is on and that device isn't the stream's.
//
// Owner-only: the hub's middleware gives every route not on its public list
// to the owner (src/lib/hubAccess.ts routeAccess → "owner").

const MODEL = process.env.LIVE_STUDIO_MODEL || "anthropic/claude-haiku-4.5";
const TIMEOUT_MS = 8_000;

// ---- S5: its own cap, so a chatty director can't run up the bill -----------
const WINDOW_MS = 60_000;
const MAX_CALLS = 30;
const calls: number[] = [];
function rateLimited(now: number): boolean {
  while (calls.length && now - calls[0] > WINDOW_MS) calls.shift();
  if (calls.length >= MAX_CALLS) return true;
  calls.push(now);
  return false;
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

interface Context {
  comments: { id: string; handle: string; user: string; text: string; waiting: boolean }[];
  focus: string;
  speaking: string;
  recent: string[];
  waiting: number;
  viewers: number | null;
  live: boolean;
}

function readContext(raw: unknown): Context {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const comments = Array.isArray(r.comments)
    ? r.comments.slice(-30).flatMap((c) => {
        if (!c || typeof c !== "object") return [];
        const x = c as Record<string, unknown>;
        const handle = str(x.handle, 32);
        return handle ? [{ id: str(x.id, 120), handle, user: str(x.user, 40), text: str(x.text, 140), waiting: x.waiting === true }] : [];
      })
    : [];
  return {
    comments,
    focus: str(r.focus, 200),
    speaking: str(r.speaking, 300),
    recent: Array.isArray(r.recent) ? r.recent.slice(-5).map((x) => str(x, 200)).filter(Boolean) : [],
    waiting: typeof r.waiting === "number" ? Math.max(0, Math.min(999, Math.round(r.waiting))) : 0,
    viewers: typeof r.viewers === "number" ? Math.round(r.viewers) : null,
    live: r.live === true,
  };
}

function instructions(name: string, talkback: boolean): string {
  return [
    `You are the private earpiece between a livestream director and ${name}, an AI actor performing live on TikTok. The director speaks privately; the audience never hears them, and ${name} never mentions them on air.`,
    `Turn what the director says into actions. Answer with JSON only: {"actions": [...], "reply": "...", "ack": "..."}`,
    `Actions — use only these shapes:`,
    `- {"type":"tune","humor":n,"energy":n,"expressiveness":n,"interaction":n,"speed":n,"preset":"funny|friendly|charismatic|chill|host","style":"punchy|conversational|storyteller"} — personality changes. Numbers are CHANGES on 0–10 scales (+2 = more, -1 = a little less); speed is a change of about ±0.05–0.15. Include only what changes.`,
    `- {"type":"act","emotion":"${EMOTIONS.join("|")}","eyeContact":n,"headMotion":n,"reactions":true|false,"scope":"standing|next"} — how he acts and looks. "next" = the next reply only.`,
    `- {"type":"note","text":"<imperative direction>","scope":"standing|next"} — any direction about the performance the other actions can't express.`,
    `- {"type":"reply","target":"<viewer name, @handle, or 'that' for the comment in focus>","instruction":"<how to answer them, from ${name}'s point of view>","promote":true|false} — promote=false only when it's about HOW to answer, not WHEN.`,
    `- {"type":"skip","target":"..."} — don't answer that comment.  {"type":"mute","target":"..."} — ignore that viewer for the rest of the stream.`,
    `- {"type":"avoid","topic":"..."} — a topic to stay away from.`,
    `- {"type":"cue","kind":"subject|audience|shoutout|react|bit|line","intent":"<what to do on air, imperative>","target":"<optional name>"} — something to do live that isn't an answer to a comment.`,
    `- {"type":"say","text":"<exact words>"} — ONLY when the director dictates exact words to say.`,
    `- {"type":"wait","seconds":n}, {"type":"pause"}, {"type":"resume"}, {"type":"reset"} (back to his normal self).`,
    talkback
      ? `"reply": TALKBACK IS ON — what ${name} says back to the director, privately, in their headphones: one to three short spoken sentences, candid and collaborative, like an actor talking to his director between takes. Acknowledge instructions in a few words ("Got it — I'll pull more people in."). Answer questions about the stream from the context below; never invent viewers or numbers.`
      : `"reply": TALKBACK IS OFF — leave it empty unless the director asked a direct question; then one or two short sentences they will read silently.`,
    `"ack": two to six words for the director's screen, saying what changed ("Mike prioritized", "Changing conversation topic"). Empty when nothing changed.`,
    `A QUESTION to ${name} ("what do you think of the audience?", "how's it going?") is not an instruction: answer it in "reply" and return NO actions. Only return actions when the director clearly asks for a change ("could you…", "why don't you…" count as asking).`,
    `If the words are clearly not meant for ${name} — the director talking to someone else in the room — return no actions and an empty reply.`,

  ].join("\n");
}

function contextBlock(c: Context, settingsLine: string, direction: string, history: string[]): string {
  const lines = [
    c.live ? `The stream is live${c.viewers !== null ? ` with about ${c.viewers} viewers` : ""}; ${c.waiting} comment${c.waiting === 1 ? "" : "s"} waiting.` : "The stream is not live yet.",
    `Personality now: ${settingsLine}`,
    direction ? `Direction in effect: ${direction}` : "",
    c.speaking ? `On air right now he's saying: "${c.speaking}"` : "",
    c.recent.length ? `His last lines on air: ${c.recent.map((r) => `"${r}"`).join(" · ")}` : "",
    c.focus ? `Comment in focus ("that"): ${c.focus}` : "",
    c.comments.length ? `Recent chat, oldest first:\n${c.comments.map((x) => `- @${x.handle} (${x.user})${x.waiting ? " [waiting]" : ""}: ${x.text}`).join("\n")}` : "Chat is empty so far.",
    history.length ? `Earlier between you and the director:\n${history.join("\n")}` : "",
  ];
  return lines.filter(Boolean).join("\n");
}

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "That request couldn't be read. Try again." }, { status: 400 });
  }

  // ---- S4: check every field on the server ---------------------------------
  const text = typeof body.text === "string" ? body.text.replace(/\s+/g, " ").trim() : "";
  if (!text || text.length > 600) {
    return NextResponse.json({ error: "Say a direction of up to a few sentences." }, { status: 400 });
  }
  const talkback = body.talkback === true;
  // The instant parser already applied these: the brain only talks back about them.
  const applied = Array.isArray(body.applied) ? body.applied.slice(0, 8).map((a) => str(a, 80)).filter(Boolean) : [];
  const settings = sanitizeSettings(body.settings);
  const perf = sanitizePerformance(body.performance);
  const context = readContext(body.context);
  const history = Array.isArray(body.history)
    ? body.history.slice(-10).flatMap((h) => {
        if (!h || typeof h !== "object") return [];
        const x = h as Record<string, unknown>;
        const t = str(x.text, 240);
        return t ? [`${x.role === "alex" ? settings.name : "Director"}: ${t}`] : [];
      })
    : [];

  if (rateLimited(Date.now())) {
    return NextResponse.json({ directives: [], reply: "", ack: "", note: "Too many directions in the last minute — give it a moment." });
  }
  if (!aiConfigured()) {
    return NextResponse.json({
      directives: [],
      reply: talkback ? "Got it." : "",
      ack: "",
      canned: true,
      note: "Add an AI key in Connections so Alex understands free-form directions and can talk back.",
    });
  }

  const settingsLine = `${settings.persona} Humour ${settings.humor}/10, energy ${settings.energy}/10, expression ${settings.expressiveness}/10, ${settings.style}, speed ${settings.speed}.`;
  const direction = [
    perf.emotion !== "neutral" ? `playing it ${perf.emotion}` : "",
    perf.notes.length ? `notes: ${perf.notes.join("; ")}` : "",
    perf.avoid.length ? `avoiding: ${perf.avoid.join(", ")}` : "",
  ].filter(Boolean).join(" · ");

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  req.signal.addEventListener("abort", () => ctrl.abort());
  try {
    const res = await aiFetch({

      method: "POST",
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        temperature: talkback ? 0.6 : 0.2,
        max_tokens: 420,
        messages: [
          { role: "system", content: instructions(settings.name, talkback) },
          { role: "system", content: contextBlock(context, settingsLine, direction, history) },
          ...(applied.length
            ? [{ role: "system", content: `Already done by the studio — return NO actions for it, only your reply: ${applied.join("; ")}.` }]
            : []),
          { role: "user", content: `Director: ${text}` },
        ],
      }),
    });
    if (!res.ok) {
      return NextResponse.json({ directives: [], reply: "", ack: "", note: "The AI didn't answer — try saying it again, or type it." });
    }
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const answer = parseDirectAnswer(json.choices?.[0]?.message?.content ?? "");
    return NextResponse.json({ ...answer, directives: applied.length ? [] : answer.directives, reply: speakable(answer.reply) });

  } catch {
    return NextResponse.json({ directives: [], reply: "", ack: "", note: "The AI didn't answer in time — try again, or type it." });
  } finally {
    clearTimeout(timer);
  }
}
