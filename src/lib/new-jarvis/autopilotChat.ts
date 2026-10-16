// ---------------------------------------------------------------------------
// The Camera Autopilot conversation.
//
// The owner talks to Jarvis ABOUT the photo queue: "that's a song, it goes in
// my Classifier", "file the confident ones", "screenshots of repos always go to
// Folders". Jarvis answers and PROPOSES actions. It never performs them: every
// action comes back as data, the Deck draws it as a card, and only the owner's
// "Yes" runs it. That is the "talk before acting" rule, enforced by shape — the
// route has no way to file a photo even if the model wanted to.
//
// Pure module: the route and the Deck both import it, and the tests cover it.
// ---------------------------------------------------------------------------

export type AutopilotAction =
  | { type: "file"; ids: string[] }
  | { type: "reject"; ids: string[] }
  /** Re-triage one photo with the owner's instruction ("it's a song"). */
  | { type: "reroute"; id: string; instruction: string }
  /** Remember a standing habit for future photos. */
  | { type: "rule"; text: string };

export interface AutopilotPhotoBrief {
  id: string;
  title: string;
  caption: string;
  where: string;
  tags: string[];
  flagged?: string;
}

export interface AutopilotTurn {
  role: "user" | "assistant";
  content: string;
}

export interface AutopilotRequest {
  messages: AutopilotTurn[];
  photos: AutopilotPhotoBrief[];
  selectedId?: string | null;
  rules: string[];
  ownerName?: string;
}

export interface AutopilotReply {
  reply: string;
  actions: AutopilotAction[];
}

const MAX_ACTIONS = 6;

function strArr(v: unknown, known: Set<string>): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && known.has(x)) : [];
}

/**
 * The trust boundary for what the model proposes. Unknown photo ids are
 * dropped, empty actions are dropped, and a proposal can never name a photo
 * that is not in the queue the owner is looking at.
 */
export function parseActions(raw: unknown, knownIds: string[]): AutopilotAction[] {
  if (!Array.isArray(raw)) return [];
  const known = new Set(knownIds);
  const out: AutopilotAction[] = [];
  for (const a of raw) {
    if (!a || typeof a !== "object") continue;
    const r = a as Record<string, unknown>;
    if (r.type === "file" || r.type === "reject") {
      const ids = strArr(r.ids, known);
      if (ids.length) out.push({ type: r.type, ids });
    } else if (r.type === "reroute") {
      const id = typeof r.id === "string" && known.has(r.id) ? r.id : null;
      const instruction = typeof r.instruction === "string" ? r.instruction.trim().slice(0, 400) : "";
      if (id && instruction) out.push({ type: "reroute", id, instruction });
    } else if (r.type === "rule") {
      const text = typeof r.text === "string" ? r.text.trim().slice(0, 240) : "";
      if (text) out.push({ type: "rule", text });
    }
    if (out.length >= MAX_ACTIONS) break;
  }
  return out;
}

export function systemPrompt(req: AutopilotRequest): string {
  const owner = (req.ownerName || "the owner").trim();
  const sel = req.photos.find((p) => p.id === req.selectedId);
  const list = req.photos
    .slice(0, 60)
    .map(
      (p) =>
        `- id=${p.id} | "${p.title}" | ${p.caption.slice(0, 140)} | proposed: ${p.where}` +
        (p.tags.length ? ` | tags: ${p.tags.slice(0, 5).join(", ")}` : "") +
        (p.flagged ? ` | flag: ${p.flagged}` : ""),
    )
    .join("\n");
  return (
    `You are Jarvis, ${owner}'s assistant, running Camera Autopilot: new photos from ${owner}'s camera roll ` +
    "arrive in a review queue with a proposed destination, and you talk them through with " +
    `${owner}.\n\n` +
    "RULES\n" +
    "- You never act on your own. You PROPOSE actions; each is shown to the user as a card and only runs if they say yes. So say plainly what you propose and why, briefly.\n" +
    "- Be short and direct: one to three sentences.\n" +
    '- When the user says where a KIND of photo should go in general ("songs go to my classifier"), propose a "rule" AND, if a photo in the queue fits, a "reroute" for it.\n' +
    '- When the user says a specific photo goes somewhere else, propose "reroute" with their instruction in their words.\n' +
    '- "file" files photos to their proposed destination; "reject" removes them from the queue (the picture is deleted from the queue, not from the phone).\n' +
    "- Only use photo ids from the list. If unsure which photo they mean, ask.\n" +
    "- Destinations that exist: Folders (any folder path), Photos albums for people, Calendar, Audio Studio › Classifier (songs), Folders › Repos (code repositories, looked up on GitHub), Skills Library (prompts), Cookbook (recipes), AI Rankings.\n\n" +
    `RULES ${owner.toUpperCase()} HAS ALREADY SET:\n${req.rules.length ? req.rules.map((r) => `- ${r}`).join("\n") : "- (none yet)"}\n\n` +
    `QUEUE (${req.photos.length} ready):\n${list || "- (empty)"}\n\n` +
    (sel ? `The user is looking at: id=${sel.id} "${sel.title}".\n\n` : "") +
    'Reply as JSON only: {"reply": string, "actions": [ {"type":"file","ids":[...]} | {"type":"reject","ids":[...]} | ' +
    '{"type":"reroute","id":string,"instruction":string} | {"type":"rule","text":string} ]}'
  );
}

/** Parse the model's JSON, tolerating a fenced block. */
export function parseReply(text: string, knownIds: string[]): AutopilotReply {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  try {
    const j = JSON.parse(cleaned) as { reply?: unknown; actions?: unknown };
    return {
      reply: typeof j.reply === "string" && j.reply.trim() ? j.reply.trim() : "Done thinking — nothing to change.",
      actions: parseActions(j.actions, knownIds),
    };
  } catch {
    return { reply: cleaned.slice(0, 800) || "I couldn't read that one — try again?", actions: [] };
  }
}

/**
 * No AI key: still useful. Understands the handful of things people actually
 * say to a photo queue, and is honest that it is the simple version.
 */
export function localReply(req: AutopilotRequest): AutopilotReply {
  const last = [...req.messages].reverse().find((m) => m.role === "user")?.content ?? "";
  const t = last.toLowerCase();
  const sel = req.photos.find((p) => p.id === req.selectedId);
  const actions: AutopilotAction[] = [];

  // A habit names WHERE a kind of thing goes ("songs go to my classifier").
  // "file all of them" names no place, so it is a command, not a rule.
  const generalRule = /\b(go|goes|belong|belongs|put|send)\b.*\b(to|in|into)\b/.test(t);
  if (generalRule && last.length > 8) actions.push({ type: "rule", text: last.trim() });

  if (/\b(song|music|track|spotify|classifier)\b/.test(t) && sel) {
    actions.push({ type: "reroute", id: sel.id, instruction: "This is a song — file it in the Music Classifier in Jarvis Audio Studio." });
  } else if (/\b(repo|github|repository)\b/.test(t) && sel) {
    actions.push({ type: "reroute", id: sel.id, instruction: "This is a code repository — find it and save it to Folders › Repos." });
  } else if (/\b(delete|remove|reject|trash|don'?t need|skip)\b/.test(t) && sel) {
    actions.push({ type: "reject", ids: [sel.id] });
  } else if (/\b(file|approve|yes|do it|go ahead|looks good)\b/.test(t)) {
    const ids = /\ball\b|everything/.test(t) ? req.photos.map((p) => p.id) : sel ? [sel.id] : [];
    if (ids.length) actions.push({ type: "file", ids });
  } else if (sel && !generalRule && last.trim()) {
    actions.push({ type: "reroute", id: sel.id, instruction: last.trim() });
  }

  const reply = actions.length
    ? "Here's what I'd do — tap Yes on anything you want. (Simple mode: no AI key is set, so I'm matching keywords.)"
    : "I'm in simple mode (no AI key set). Pick a photo and tell me where it goes, or say \"file all\".";
  return { reply, actions };
}

/** One line for the confirm card. */
export function describeAction(a: AutopilotAction, titleOf: (id: string) => string): string {
  switch (a.type) {
    case "file":
      return a.ids.length === 1 ? `File "${titleOf(a.ids[0])}" where proposed` : `File ${a.ids.length} photos where proposed`;
    case "reject":
      return a.ids.length === 1 ? `Remove "${titleOf(a.ids[0])}" from the queue` : `Remove ${a.ids.length} photos from the queue`;
    case "reroute":
      return `Re-read "${titleOf(a.id)}": ${a.instruction}`;
    case "rule":
      return `Remember: ${a.text}`;
  }
}
