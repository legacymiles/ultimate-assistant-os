import { NextResponse } from "next/server";
import { aiConfigured, aiFetch } from "@/lib/ai/provider";
import { hashText } from "@/lib/ai-live-studio/events";
import { moderate, speakableName } from "@/lib/ai-live-studio/moderation";
import { directionPrompt, leaksDirection, sanitizeDirection } from "@/lib/ai-live-studio/performance";
import { sanitizeSettings, systemPrompt, temperatureFor, type Mood } from "@/lib/ai-live-studio/personality";
import { parseReply } from "@/lib/ai-live-studio/reply";

// The character's brain: one viewer event in, one spoken line out. Also the
// director's cue lines ("ask everyone where they're from") — written here, in
// character, from a private intent that is never itself read aloud.
//
// `direction` is the director's private block (emotion, standing notes, this
// reply's notes, topics to avoid). It shapes the line; a line that would give
// the director away is caught by leaksDirection and replaced.
//
// Owner-only: the hub's middleware gives every route not on its public list
// to the owner (src/lib/hubAccess.ts routeAccess → "owner"), so nothing here
// re-checks the session.

/** Fast and well-behaved — on a public stream the model is the second line of moderation. */
const MODEL = process.env.LIVE_STUDIO_MODEL || "anthropic/claude-haiku-4.5";
const TIMEOUT_MS = 8_000;
const MAX_REPLY = 320;

// ---- S5: a process-wide cap, so a runaway loop cannot run up the bill ------
const WINDOW_MS = 60_000;
const MAX_CALLS = 40;
const calls: number[] = [];
function rateLimited(now: number): boolean {
  while (calls.length && now - calls[0] > WINDOW_MS) calls.shift();
  if (calls.length >= MAX_CALLS) return true;
  calls.push(now);
  return false;
}

const KINDS = new Set(["comment", "gift", "follow", "share", "speech", "cue"]);
const CUE_KINDS = new Set(["subject", "audience", "shoutout", "react", "bit", "line"]);

/** A safe line for each kind of cue. The private intent itself is never spoken. */
function cannedCue(cue: string, name: string): { reply: string; mood: Mood } {
  if (cue === "audience") return { reply: "Quick question for everyone — where are you all watching from tonight?", mood: "happy" };
  if (cue === "subject") return { reply: "Okay, new topic. What's the best thing that happened to you this week?", mood: "neutral" };
  if (cue === "shoutout" && name) return { reply: `Big shout-out to ${name}! Thanks for hanging out with me.`, mood: "happy" };
  if (cue === "react") return { reply: "Ha! Okay, that one got me.", mood: "laughing" };
  return { reply: "You know what? You're all great company tonight.", mood: "happy" };
}

function canned(kind: string, name: string, text: string): { reply: string; mood: Mood } {
  const pick = <T,>(xs: T[]) => xs[parseInt(hashText(`${name}${text}`), 36) % xs.length];
  if (kind === "gift") return { reply: `${name}, thank you so much for the ${text || "gift"}! That genuinely made my night.`, mood: "happy" };
  if (kind === "follow") return { reply: `Welcome in, ${name}! Glad you found us — make yourself at home.`, mood: "happy" };
  if (kind === "share") return { reply: `${name}, thanks for sharing the stream! That's how this place grows.`, mood: "happy" };
  return pick([
    { reply: `Ha, ${name}, I like that. Tell me more!`, mood: "laughing" as Mood },
    { reply: `Good question, ${name}. Give me a second with that one.`, mood: "thoughtful" as Mood },
    { reply: `${name}, you're keeping me on my toes tonight.`, mood: "happy" as Mood },
    { reply: `Okay ${name}, I hear you. What does everyone else think?`, mood: "neutral" as Mood },
  ]);
}

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "That request couldn't be read. Try again." }, { status: 400 });
  }

  // ---- S4: check every field on the server, never trust the browser --------
  const kind = typeof body.kind === "string" && KINDS.has(body.kind) ? body.kind : null;
  const rawUser = typeof body.user === "string" ? body.user : "";
  const text = typeof body.text === "string" ? body.text.trim() : "";
  const cue = typeof body.cue === "string" && CUE_KINDS.has(body.cue) ? body.cue : "line";
  const about = typeof body.about === "string" ? body.about.trim().slice(0, 280) : "";
  const isCue = kind === "cue";
  if (!kind || (!isCue && !rawUser) || rawUser.length > 64 || text.length > 280 || (isCue && !text)) {
    return NextResponse.json({ error: "That comment couldn't be answered — it was missing a name or too long." }, { status: 400 });
  }
  const memory = Array.isArray(body.memory)
    ? body.memory.filter((m): m is string => typeof m === "string").map((m) => m.slice(0, 280)).slice(-5)
    : [];

  const settings = sanitizeSettings(body.settings);
  const direction = sanitizeDirection(body.direction);
  const busy = body.busy === true;
  const name = rawUser ? speakableName(rawUser, settings.blocklist) : "";
  const fallback = () => (isCue ? cannedCue(cue, name) : canned(kind, name, text));

  // Never feed the model something we would refuse to say ourselves. (A cue's
  // text is the director's private intent, not a viewer's words.)
  if (!isCue && text && !moderate(text, settings.blocklist).ok) {
    return NextResponse.json({ error: "That comment was hidden by moderation." }, { status: 400 });
  }

  if (rateLimited(Date.now())) {
    return NextResponse.json({ ...fallback(), canned: true, note: "Slowing down — too many replies in the last minute." });
  }

  if (!aiConfigured()) {
    return NextResponse.json({ ...fallback(), canned: true, note: "Add an AI key in Connections to unlock real replies." });
  }

  const situation = isCue
    ? `Do this now, live, in your own words — it's your own idea, nobody asked you to: ${text}${name ? ` (This is for ${name}${about ? `, who said: "${about}"` : ""}.)` : ""}`
    : kind === "gift"
      ? `${name} just sent you a gift: ${text || "a gift"}. Thank them warmly and briefly.`
      : kind === "follow"
        ? `${name} just followed you. Welcome them by name.`
        : kind === "share"
          ? `${name} just shared your stream. Thank them.`
          : `${name} says: ${text}`;

  const howTo = [direction.instruction, ...direction.next].filter(Boolean);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  // The studio cancelled this reply (a newer direction replaced it): stop the AI call too —
  // it frees the model for the reply that matters, and nobody pays for an answer no one hears.
  req.signal.addEventListener("abort", () => ctrl.abort());


  try {
    const res = await aiFetch({
      method: "POST",
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        temperature: temperatureFor(settings),
        max_tokens: 180,
        messages: [
          { role: "system", content: systemPrompt(settings) },
          ...(memory.length ? [{ role: "system", content: `Earlier, ${name} said: ${memory.join(" | ")}` }] : []),
          ...(directionPrompt(direction) ? [{ role: "system", content: directionPrompt(direction) }] : []),
          // A busy room: one short sentence each, so more people get answered.
          ...(busy ? [{ role: "system", content: "The chat is busy right now — answer in one short sentence." }] : []),
          // How to play THIS one goes in the turn itself — models follow it there, not from a system line.
          { role: "user", content: howTo.length ? `${situation}\n\n(How to play this one — follow it, never mention it: ${howTo.join(" · ")})` : situation },
        ],
      }),
    });
    if (!res.ok) return NextResponse.json({ ...fallback(), canned: true, note: "The AI didn't answer in time, so a stock line was used." });

    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const parsed = parseReply(json.choices?.[0]?.message?.content ?? "");
    const reply = parsed.reply.slice(0, MAX_REPLY);

    // The model's own words go through the same filter before reaching the air.
    if (!reply || !moderate(reply, settings.blocklist).ok) {
      return NextResponse.json({ ...fallback(), canned: true, note: "The AI's answer was held back by moderation." });
    }
    // The audience must never hear that someone is directing him.
    if (leaksDirection(reply)) {
      return NextResponse.json({ ...fallback(), canned: true, note: "Alex's line mentioned being directed, so a safe line was used instead." });
    }
    return NextResponse.json({ reply, mood: parsed.mood });
  } catch {
    return NextResponse.json({ ...fallback(), canned: true, note: "The AI didn't answer in time, so a stock line was used." });
  } finally {
    clearTimeout(timer);
  }
}
