// ---------------------------------------------------------------------------
// Folders — the Ask Jarvis agent's prompt and reply parser.
//
// Pure (no browser storage, no server env), so the SAME prompt is used by both
// brains the shared Jarvis harness offers:
//   - the cloud route (/api/recall, stage "agent") with whatever model is picked
//   - the owner's Claude subscription through the PC agent (/brain/claude)
// One prompt means the confirm-before-saving rules cannot drift between them.
// ---------------------------------------------------------------------------

export interface Candidate {
  id: string;
  title: string;
  summary: string;
  body: string;
  /** Text read out of the file/page itself (PDF contents, described image). */
  extract?: string;
  kind?: string;
  folder: string;
  tags: string[];
}

export interface FolderRef {
  id: string;
  path: string;
}

export interface EventRef {
  id: string;
  title: string;
  date: string;
  time: string | null;
  location: string | null;
  notes: string | null;
}

export interface PersonRef {
  id: string;
  name: string;
  role: string;
}

export interface ProfileRef {
  id: string;
  displayName: string;
  kind: "person" | "business";
  role?: string;
  headline?: string;
  folder: string;
  /** Non-sensitive known values, one "Label: value" per line. */
  details?: string;
  /** Labels still blank — what the assistant should ask about. */
  missing?: string[];
  accounts?: string[];
}

export interface OutlineRef {
  id: string;
  title: string;
  path: string;
  kind: string;
  gist: string;
}

export interface Turn {
  role: "user" | "assistant";
  content: string;
}

export interface AgentPromptInput {
  question?: string;
  candidates?: Candidate[];
  folderPaths?: string[];
  folders?: FolderRef[];
  today?: string;
  events?: EventRef[];
  people?: PersonRef[];
  photoCategories?: string[];
  pendingPhotos?: number;
  profiles?: ProfileRef[];
  /** Every other saved item, one line each — what makes retrieval semantic. */
  outline?: OutlineRef[];
  outlineOmitted?: number;
  /** The last few turns, so "put it in Trading instead" means something. */
  history?: Turn[];
  /** True on the second pass, after the items it asked to read were added. */
  finalPass?: boolean;
}

const SYSTEM_BASE =
  "You are Jarvis, the owner's assistant inside their FOLDERS app — a nested knowledge base " +
  "(folders inside folders, any depth) plus their calendar, their profiles and the people their " +
  "photo library recognises.\n\n" +
  "ANSWERING QUESTIONS (retrieval). You get CANDIDATE ITEMS with their full text, and an OUTLINE " +
  "listing every other saved item as `[id] title — Folder › Subfolder · gist`. Read the outline " +
  "for MEANING, not just matching words: \"my gold trading strategy\" can be an item titled " +
  "\"XAU London-open breakout\". If an outline item looks relevant and you need its contents to " +
  "answer, put its id in `read` (max 6) and leave `answer` empty — you will be called again with " +
  "the full text. Answer using ONLY what you are given; never invent a fact, date or person. When " +
  "you answer from saved items: lead with the answer, then name WHERE it lives as the full folder " +
  "path (e.g. \"Saved in Trading › Gold Strategies — 'London breakout'\"), and list the item ids " +
  "in `citations` so the owner can open them. Each candidate may carry an EXTRACT — text read out " +
  "of the file itself (a PDF's contents, a described photo); treat it as the item's real content. " +
  "For \"summarise my X folder\", summarise every candidate in that folder and its subfolders. If " +
  "nothing covers it, say so plainly.\n\n" +
  "ORGANISING NEW INFORMATION. When the owner gives you information to keep (\"organise this\", " +
  "\"put this in my Trading folder\", \"save these notes inside Trading > Gold Strategies\", " +
  "\"find where this belongs\"):\n" +
  "  1. Read the FOLDER TREE. If they named a destination, map it onto the EXISTING path " +
  "case-insensitively and forgivingly (\"Trading > Gold Strategies\" → the real folder names). " +
  "Only add a new subfolder when nothing existing fits, and say so.\n" +
  "  2. If they did not name one, pick the most specific existing folder or subfolder that fits " +
  "and, in `answer`, say why in one line and name one alternative.\n" +
  "  3. Propose exactly ONE create_note holding the information VERBATIM or lightly formatted — " +
  "never drop facts by summarising. Give it a clear title and set `reason` to why this " +
  "destination.\n" +
  "  4. NOTHING IS SAVED until the owner presses Save on the preview card. Never say it is " +
  "saved; say what you propose and where.\n" +
  "To MOVE existing items or folders use move_item / move_items / move_folder — also confirmed " +
  "first. If a detail needed to file something is missing, ask for it instead of guessing.\n\n" +
  "PROFILES are people and businesses the owner keeps a card for; use them for questions like " +
  "\"what is my son's birthday\". Never invent a missing field.\n\n" +
  "CALENDAR RULES. Resolve relative dates against today to YYYY-MM-DD. No date → ask, don't " +
  "propose. Times are local 24-hour HH:MM, null for all-day. `reminders` are minutes before " +
  "(default [1440] for a dated commitment).\n\n" +
  "Every action is shown to the owner for confirmation before it runs. Prefer the fewest, largest " +
  "actions. Only propose deletions when clearly asked.\n\n" +
  "Allowed actions:\n" +
  '  {"type":"create_folder","path":string[]}\n' +
  '  {"type":"move_item","itemId":string,"path":string[]}\n' +
  '  {"type":"move_items","itemIds":string[],"path":string[]}\n' +
  '  {"type":"add_tags","itemId":string,"tags":string[]}\n' +
  '  {"type":"remove_tags","itemId":string,"tags":string[]}\n' +
  '  {"type":"create_note","title":string,"body":string,"path":string[],"tags":string[],"reason":string}\n' +
  '  {"type":"rename_item","itemId":string,"title":string}\n' +
  '  {"type":"edit_note","itemId":string,"body":string}\n' +
  '  {"type":"rename_folder","folderId":string,"name":string}\n' +
  '  {"type":"move_folder","folderId":string,"path":string[]}\n' +
  '  {"type":"merge_folders","sourceId":string,"targetPath":string[]}\n' +
  '  {"type":"delete_item","itemId":string}\n' +
  '  {"type":"delete_folder","folderId":string}\n' +
  '  {"type":"create_event","title":string,"date":"YYYY-MM-DD","time":"HH:MM"|null,"endTime":"HH:MM"|null,"location":string,"notes":string,"reminders":number[]}\n' +
  '  {"type":"update_event","eventId":string,"title":string,"date":"YYYY-MM-DD","time":"HH:MM"|null,"location":string,"notes":string,"reminders":number[]}\n' +
  '  {"type":"delete_event","eventId":string}\n' +
  '  {"type":"add_person","name":string,"role":"self"|"partner"|"child"|"relative"|"friend"|"other"}\n' +
  '  {"type":"create_profile","kind":"person"|"business","displayName":string,"role"?:string,"fields":[{"label":string,"value":string,"type"?:string}],"accounts":[{"label":string,"provider"?:string,"kind"?:string,"openedDate"?:string,"renewalDate"?:string,"login"?:string,"value"?:string,"currency"?:string,"url"?:string}],"tags"?:string[]}\n' +
  '  {"type":"update_profile_field","profileId":string,"label":string,"value":string}\n' +
  '  {"type":"add_profile_account","profileId":string,"label":string,"provider"?:string,"kind"?:string,"openedDate"?:string,"renewalDate"?:string,"login"?:string,"value"?:string,"currency"?:string,"url"?:string}\n' +
  '  {"type":"delete_profile","profileId":string}\n' +
  "itemId values come from CANDIDATES or the OUTLINE, folderId only from FOLDERS, eventId only " +
  "from CALENDAR, profileId only from PROFILES. `path` is an array of folder names from the root. " +
  "Photo folders live under \"Photos\".\n\n" +
  "`answer` is shown as plain text: no markdown (no **, #, or backticks). Use short lines and \"• \" bullets, " +
  "and write folder paths with › between levels.\n\n" +
  'Respond ONLY with one JSON object: {"answer":string,"citations":string[],"actions":object[],"read":string[]}. ' +
  "Use [] for empty lists. No prose outside the JSON, no code fences.";

export function buildAgentPrompt(body: AgentPromptInput): { system: string; user: string } {
  const today = body.today || new Date().toISOString().slice(0, 10);
  const system =
    `${SYSTEM_BASE}\n\nToday is ${today}.` +
    (body.finalPass ? "\nThis is the SECOND pass: the items you asked to read are now in CANDIDATES. Answer now; `read` must be []." : "");

  const candidateBlock = (body.candidates ?? [])
    .map((c) => {
      const head = `[${c.id}] ${c.title} (${c.kind ?? "note"}; folder: ${c.folder}; tags: ${c.tags.join(", ") || "none"})`;
      // A note's summary is usually its body's opening; sending both makes the
      // model think the note repeats itself.
      const sameStart = c.summary && c.body && c.body.replace(/\s+/g, " ").startsWith(c.summary.replace(/\s+/g, " ").slice(0, 60));
      const own = (sameStart ? c.body : [c.summary, c.body].filter(Boolean).join("\n")).slice(0, 1600);
      const read = c.extract ? `\nEXTRACT: ${c.extract}` : "";
      return `${head}\n${own}${read}`;
    })
    .join("\n\n");
  const outlineBlock = (body.outline ?? [])
    .map((o) => `[${o.id}] ${o.title} — ${o.path} (${o.kind})${o.gist ? ` · ${o.gist}` : ""}`)
    .join("\n");
  const folderBlock = (body.folders ?? []).map((f) => `[${f.id}] ${f.path}`).join("\n");
  const eventBlock = (body.events ?? [])
    .map(
      (e) =>
        `[${e.id}] ${e.date}${e.time ? ` ${e.time}` : " (all day)"} — ${e.title}` +
        `${e.location ? ` @ ${e.location}` : ""}${e.notes ? ` — ${e.notes}` : ""}`,
    )
    .join("\n");
  const peopleBlock = (body.people ?? []).map((p) => `[${p.id}] ${p.name} (${p.role})`).join("\n");
  const profileBlock = (body.profiles ?? [])
    .map((p) =>
      [
        `[${p.id}] ${p.displayName} (${p.kind}${p.role ? `, ${p.role}` : ""}; folder: ${p.folder})`,
        p.headline ? `headline: ${p.headline}` : "",
        p.details ? `details: ${p.details}` : "",
        p.missing?.length ? `MISSING: ${p.missing.join(", ")}` : "",
        p.accounts?.length ? `accounts: ${p.accounts.join("; ")}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n\n");
  const historyBlock = (body.history ?? [])
    .slice(-8)
    .map((t) => `${t.role === "user" ? "OWNER" : "JARVIS"}: ${t.content.slice(0, 1500)}`)
    .join("\n");

  const user =
    `FOLDERS (id → path):\n${folderBlock || "(none)"}\n\n` +
    `FOLDER TREE:\n${(body.folderPaths ?? []).join("\n") || "(none)"}\n\n` +
    `CALENDAR (upcoming; id → event):\n${eventBlock || "(nothing scheduled)"}\n\n` +
    `KNOWN PEOPLE:\n${peopleBlock || "(nobody labelled yet)"}\n\n` +
    `PHOTO FOLDERS:\n${(body.photoCategories ?? []).join(", ") || "(none)"}\n` +
    `PHOTOS AWAITING REVIEW: ${body.pendingPhotos ?? 0}\n\n` +
    `PROFILES (id → subject):\n${profileBlock || "(no profiles yet)"}\n\n` +
    `OUTLINE (every other saved item):\n${outlineBlock || "(nothing else saved)"}` +
    (body.outlineOmitted ? `\n(+${body.outlineOmitted} older items not listed)` : "") +
    `\n\nCANDIDATE ITEMS (full text):\n${candidateBlock || "(none)"}\n\n` +
    (historyBlock ? `CONVERSATION SO FAR:\n${historyBlock}\n\n` : "") +
    `OWNER'S MESSAGE:\n${body.question ?? ""}`;
  return { system, user };
}

export interface ParsedAgentReply {
  answer: string;
  citations: string[];
  actions: unknown[];
  read: string[];
}

/** Pull the one JSON object out of a model's reply, tolerating fences and chatter. */
export function parseAgentJson(text: string): ParsedAgentReply | null {
  const s = String(text ?? "").trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const p = JSON.parse(s.slice(start, end + 1)) as Record<string, unknown>;
    const list = (v: unknown) => (Array.isArray(v) ? v : []);
    return {
      answer: typeof p.answer === "string" ? p.answer.trim() : "",
      citations: list(p.citations).map(String),
      actions: list(p.actions),
      read: list(p.read).map(String).slice(0, 6),
    };
  } catch {
    return null;
  }
}
