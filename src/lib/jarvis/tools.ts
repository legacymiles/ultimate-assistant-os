// ---------------------------------------------------------------------------
// Which of Jarvis's tools may run by themselves, and which need a yes.
//
// The owner's rule (spec §1): anything with an effect outside the app gets
// confirmed first. Getting that classification wrong in the unsafe direction
// means an email leaves without permission, so the rule here is deliberately
// pessimistic: a tool is confirmed unless it is *known* to be read-only.
//
// Connector tools arrive at runtime from Composio, with names this app has
// never seen, so the test has to work on a name and an optional metadata flag.
// ---------------------------------------------------------------------------

export interface ToolSpec {
  /** Full name as the model will call it, e.g. "gmail.find_email". */
  name: string;
  description: string;
  /** JSON-schema properties for the arguments. */
  parameters: Record<string, unknown>;
  /** Set when the connector states it plainly. Trusted over the name. */
  readOnlyHint?: boolean;
  /** Which app it belongs to, for the confirm card's badge. */
  app?: string;
}

/** Verbs that only ever look. Anything else is treated as an action. */
const READ_VERBS = [
  "get", "list", "find", "search", "read", "fetch", "lookup", "look_up",
  "retrieve", "check", "view", "count", "describe",
];

/**
 * True when this tool can run without asking.
 *
 * The connector's own hint wins when present. Otherwise the leading verb of
 * the tool name decides, and an unrecognised name is an action — which costs a
 * needless confirmation at worst, versus an unwanted send at best.
 */
export function isReadOnly(tool: { name: string; readOnlyHint?: boolean }): boolean {
  if (typeof tool.readOnlyHint === "boolean") return tool.readOnlyHint;
  const bare = tool.name.includes(".") ? tool.name.slice(tool.name.indexOf(".") + 1) : tool.name;
  const verb = bare.toLowerCase().split(/[_\-.]/)[0] ?? "";
  return READ_VERBS.includes(verb);
}

/** The app half of "gmail.find_email", for the confirm card. */
export function appOf(tool: { name: string; app?: string }): string {
  if (tool.app) return tool.app;
  return tool.name.includes(".") ? tool.name.slice(0, tool.name.indexOf(".")) : "jarvis";
}

/**
 * A one-line, human summary of what a call would do. Shown on the confirm card
 * above the exact arguments, so the owner can say yes without reading JSON.
 */
export function summarise(tool: string, args: Record<string, unknown>): string {
  const s = (k: string): string => {
    const v = args[k];
    return typeof v === "string" ? v : "";
  };
  if (tool === "lists_add_item") {
    return `Add "${s("text")}" to your ${s("list") || "To-Do"} list${args.private === true ? " as a private entry" : ""}${s("priority") ? ` (${s("priority")})` : ""}.`;
  }
  if (tool === "dashboard_add_note") {
    return `Save a note "${s("title")}" in ${s("folder") ? `your ${s("folder")} folder` : "Unfiled"}.`;
  }
  if (tool === "dashboard_add_event") {
    return `Add "${s("title")}" to your calendar on ${s("date")}${s("time") ? ` at ${s("time")}` : ""}, with a reminder.`;
  }
  const bare = tool.includes(".") ? tool.slice(tool.indexOf(".") + 1) : tool;
  if (/event/i.test(bare) && /create|add|schedule|book/i.test(bare)) {
    const when = [s("start"), s("date"), s("start_time")].filter(Boolean)[0] ?? "";
    return `Add "${s("title") || s("summary") || "an event"}" to your calendar${when ? ` on ${when}` : ""}.`;
  }
  if (/event/i.test(bare) && /update|move|reschedule|edit/i.test(bare)) {
    return `Change the event "${s("title") || s("event_id") || "selected"}" in your calendar.`;
  }
  if (/event/i.test(bare) && /delete|cancel|remove/i.test(bare)) {
    return `Delete "${s("title") || s("event_id") || "an event"}" from your calendar.`;
  }
  if (/mail|message|send|reply|dm|post/i.test(bare)) {
    const to = s("to") || s("recipient") || s("channel") || s("thread") || "";
    return `Send a message${to ? ` to ${to}` : ""}${s("subject") ? ` — "${s("subject")}"` : ""}.`;
  }
  if (tool === "studio_generate") {
    const jobs = Array.isArray(args.jobs) ? args.jobs.length : 0;
    const medium = s("medium") === "image" ? "image" : "video clip";
    const where =
      s("medium") === "image"
        ? "with Gemini (a few cents)"
        : s("engine") === "cloud"
          ? "on RunPod (paid)"
          : "free on this PC (Pinokio / WanGP, ~6 min per 5 s clip)";
    return `Render ${jobs} ${medium}${jobs === 1 ? "" : "s"} ${where}, from the Studio prompt${jobs === 1 ? "" : "s"} below.`;
  }
  return `Run ${tool}.`;
}

/** The tools Jarvis always has, independent of any connector. */
export const CORE_TOOLS: ToolSpec[] = [
  {
    name: "search_memory",
    description:
      "Search everything Jarvis remembers about the owner: their notes, past conversations, their " +
      "master Claude folder (CLAUDE.md, aios/), their skills, and anything synced from connected " +
      "apps. Use this before answering any question about the owner, their work, their decisions " +
      "or their history. Returns the memories with their sources and dates.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "What to look for, in natural language." },
        limit: { type: "number", description: "How many memories to return (default 8, max 20)." },
      },
      required: ["query"],
    },
    readOnlyHint: true,
    app: "jarvis",
  },
  {
    name: "propose_memory",
    description:
      "Propose something worth remembering long-term: a durable fact, preference, decision or " +
      "lesson the owner stated. It is NOT saved — the owner reviews it first. Never propose " +
      "passwords, keys or whole message histories, and never propose something you inferred " +
      "without saying so in the content.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "A short title, as a citation would show it." },
        content: { type: "string", description: "The fact itself, in one or two sentences." },
      },
      required: ["title", "content"],
    },
    readOnlyHint: true,
    app: "jarvis",
  },
];

/**
 * Writes into the Dashboard side of Jarvis — folders, the owner's own
 * calendar and the family Lists. Deliberately NOT read-only-hinted, so each
 * one stops the loop for a yes; they then run in the browser, where two of
 * those three stores live (see src/lib/jarvis/dashboardBridge.ts).
 */
export const DASHBOARD_TOOLS: ToolSpec[] = [
  {
    name: "lists_add_item",
    description:
      "Add an entry to one of the family Lists (To-Do, To-Buy, Remember, Ideas, Goals, Projects, Bills, " +
      "Notes, or a custom list named in the context). Set private to true only when the owner asks to keep " +
      "it private; otherwise it is public and every family member sees it.",
    parameters: {
      type: "object",
      properties: {
        list: { type: "string", description: "The list's name, e.g. To-Buy." },
        text: { type: "string", description: "The entry itself, short: 'Milk', 'Call the dentist'." },
        priority: { type: "string", enum: ["urgent", "low", "wish"], description: "urgent = now, low = running low, wish = someday. Omit for normal." },
        due_date: { type: "string", description: "YYYY-MM-DD, only if the owner gave one." },
        private: { type: "boolean", description: "True = only the owner (admin) sees it." },
      },
      required: ["list", "text"],
    },
    app: "lists",
  },
  {
    name: "dashboard_add_note",
    description:
      "Save a note into one of the owner's Dashboard folders (listed in the context by path). Use the exact " +
      "folder path from the context; leave folder empty for Unfiled.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" },
        content: { type: "string" },
        folder: { type: "string", description: "Folder path as shown in the context, e.g. 'Recipes / Desserts'." },
      },
      required: ["title", "content"],
    },
    app: "folders",
  },
  {
    name: "dashboard_add_event",
    description:
      "Add an event to the owner's own calendar (the one with reminders, not a connected Google calendar). " +
      "Use when no calendar app is connected, or when the owner asks for a reminder.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" },
        date: { type: "string", description: "YYYY-MM-DD, local." },
        time: { type: "string", description: "HH:MM 24h, omit for all day." },
        location: { type: "string" },
        notes: { type: "string" },
        reminder_minutes: { type: "number", description: "Minutes before to remind. Default 1440 (a day before)." },
      },
      required: ["title", "date"],
    },
    app: "calendar",
  },
];

/** The OpenAI-compatible shape both providers accept. */
/**
 * Studio tools — only offered while a Studio skill is running.
 *
 * `studio_form` is neither a read nor a write: it pauses the loop and hands the
 * owner a form (agent.ts returns it as `form`). `studio_generate` spends money,
 * so it is an ordinary write: it stops for a yes and then runs in the browser
 * (src/lib/studio/render.ts), where the reference photos are.
 */
export const STUDIO_TOOL_NAMES = ["studio_form", "studio_storyboard", "studio_generate"];

export const STUDIO_TOOLS: ToolSpec[] = [
  {
    name: "studio_form",
    description:
      "Show the owner an interactive form and wait for their answers. Use it for every question or " +
      "choice a Studio skill asks for (the brief, picking a direction, uploading references). The " +
      "conversation pauses until they submit; their answers come back as the next message.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Form title, e.g. 'Actor card'." },
        intro: { type: "string", description: "One or two lines above the fields (optional)." },
        fields: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              label: { type: "string" },
              type: { type: "string", enum: ["text", "textarea", "choice", "multi", "image"] },
              options: { type: "array", items: { type: "string" }, description: "For choice/multi." },
              required: { type: "boolean" },
              placeholder: { type: "string" },
              default: { type: "string", description: "Pre-filled value; for multi, options joined by ' | '." },
            },
            required: ["id", "label", "type"],
          },
        },
        submit_label: { type: "string" },
      },
      required: ["title", "fields"],
    },
    app: "studio",
  },
  {
    name: "studio_storyboard",
    description:
      "Lay a film out as a shot plan the owner can edit, then render as ONE continuous film. Use this "
      + "whenever the piece is longer than a single clip, has more than one shot, or tells a story — not "
      + "studio_generate, which makes unrelated takes. Every shot is rendered in order on the owner's own "
      + "GPU and cut together automatically, so the plan is the film. Like a form, this pauses the "
      + "conversation: the owner edits the sheet and presses Make the film themselves.\n\n"
      + "Write it like a call sheet, and remember that each shot is a SEPARATE generation that has never "
      + "seen the others. What holds them together is that the film-wide fields (mood, world, wardrobe, "
      + "lighting, grade, lens, look) are repeated into every shot word for word — so write each of them "
      + "once, concretely and visually, and never contradict them in a shot's action.\n\n"
      + "CONTINUITY IS THE WHOLE JOB, and it is decided by four fields:\n"
      + "- link. 'continuous' renders the shot from the LAST FRAME of the one before it, so the join is "
      + "not a match — it is the same frame, and it is the only thing that makes separate generations "
      + "look like one take. 'cut' starts cold from the reference photos and re-invents the room, the "
      + "light and the time of day. Default to 'continuous' inside a scene and reserve 'cut' for a real "
      + "change of angle you want the audience to feel. ONE CONTINUOUS ACTION — a chase, a fall, a run "
      + "through a house — is a chain of 'continuous' shots, never a series of cuts.\n"
      + "- location. Name the room or place on every shot. Same string as the shot before means the "
      + "prompt forbids re-staging; a different string is declared as a real move. Leave it out and a "
      + "cut will wander outdoors on its own.\n"
      + "- ends_on. Always fill it: it is literally what the next shot is told to open on.\n"
      + "- carry. Props, damage, weather and blocking that must survive the join.\n\n"
      + "Two more fields decide whether a shot is any good:\n"
      + "- beats. A timed clock inside the shot. A shot given seconds and no clock fills them with a "
      + "held pose — give any shot over about 6 s a beat roughly every 2 s.\n"
      + "- camera_note. The mechanics behind the name in `move`. A move named and not specified renders "
      + "as the ordinary move its words describe.\n\n"
      + "If someone TRANSFORMS during the film, that is cast[].turns_at and turns_into — not a line in "
      + "an action. `look` is repeated verbatim into every shot so it cannot drift, which means a change "
      + "written anywhere else silently never happens.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "The film's title." },
        logline: { type: "string", description: "One sentence: what happens." },
        world: { type: "string", description: "One sentence fingerprinting the location and its texture; repeated into every shot." },
        look: { type: "string", description: "e.g. 'live action, anamorphic 2.39, photorealistic'." },
        mood: {
          type: "string",
          description:
            "The genre and how it is shot, in one paragraph — dread, warmth, grit, whatever the film is. Take it from "
            + "the camera panel's Genre when the owner set one; otherwise write it from the genre they described, and "
            + "if they named none, from what the story actually is. Never leave it empty. It governs the lighting, "
            + "the grade and the framing, so it is repeated into every shot ahead of them — without it the film is "
            + "graded like whatever its location suggests, and a horror film set in a family house comes out sunlit.",
        },
        aspect_ratio: { type: "string", enum: ["16:9", "9:16", "1:1"] },
        lens: { type: "string", description: "The glass used all film, e.g. 'anamorphic prime set'." },
        lighting: { type: "string", description: "The light, unchanged across shots." },
        grade: { type: "string", description: "The colour grade, unchanged across shots." },
        palette: { type: "array", items: { type: "string" }, description: "4-6 hex colours." },
        wardrobe: { type: "string", description: "Exactly what everyone wears; the single most common continuity break." },
        soundscape: { type: "string", description: "The diegetic sound world of the whole film." },
        music: { type: "string", description: "The score, or 'none'." },
        cast: {
          type: "array",
          description: "Everyone who must look identical in every shot they appear in.",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              name: { type: "string", description: "Short and in caps, as a call sheet writes it: 'FATHER'." },
              look: { type: "string", description: "Face, build, hair, skin, marks — what a frame must keep." },
              subject: { type: "number", description: "The upload that shows them, as a Subject number (1 = first uploaded)." },
              turns_at: {
                type: "number",
                description:
                  "The cut number (1-based) where this character stops looking like `look`. Only for a real "
                  + "on-screen transformation — infection, possession, injury, age, a mask coming off.",
              },
              turns_into: {
                type: "string",
                description:
                  "What they become from turns_at onward, written as fully as `look`. The face and build stay "
                  + "theirs; describe the skin, eyes, hair, bearing and damage that are new.",
              },
            },
            required: ["name", "look"],
          },
        },
        shots: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              title: { type: "string", description: "'Cut 3 — the turn'." },
              duration_sec: { type: "number", description: "4-15. H3 cannot render longer in one go." },
              lens_mm: { type: "number" },
              aperture: { type: "string" },
              move: { type: "string", description: "'slow push-in', 'handheld track', 'static'." },
              camera_note: {
                type: "string",
                description:
                  "What the camera physically DOES — the geometry behind the name in `move`. Travel distance in "
                  + "metres, the focal length at each end, what stays locked in frame, what the background does, "
                  + "where the camera is relative to the subject. Required for any named trick move (dolly zoom, "
                  + "whip pan, crash-in, Snorricam, parallax): the name alone renders as an ordinary move.",
              },
              framing: { type: "string", description: "'wide', 'medium', 'close-up', 'insert'." },
              location: {
                type: "string",
                description:
                  "The room or place, short and reusable: 'the living room', 'the upstairs hallway'. Repeat the "
                  + "same string while the scene stays put — that is what stops a cut wandering somewhere else.",
              },
              action: { type: "string", description: "What physically happens across these seconds." },
              beats: {
                type: "array",
                description:
                  "The clock inside this shot — what is happening at each second, so the seconds are not filled "
                  + "with a held pose. Give any shot over ~6 s a beat roughly every 2 s.",
                items: {
                  type: "object",
                  properties: {
                    at: { type: "number", description: "Seconds from the start of THIS shot." },
                    text: { type: "string", description: "One clause, present tense: what happens at that second." },
                  },
                  required: ["at", "text"],
                },
              },
              dialogue: { type: "string", description: "One spoken line at most; H3 lip-syncs it." },
              link: { type: "string", enum: ["continuous", "cut"], description: "Ignored on the first shot." },
              carry: { type: "string", description: "Props, blocking, damage or weather that must survive from the shot before." },
              ends_on: { type: "string", description: "The frame this shot finishes on. The next shot is told to open on it." },
              references: { type: "array", items: { type: "number" }, description: "Subject numbers whose faces this shot needs." },
            },
            required: ["title", "action", "duration_sec"],
          },
        },
      },
      required: ["title", "shots"],
    },
    // Nothing is rendered by laying out a plan; the owner starts that.
    readOnlyHint: true,
    app: "studio",
  },
  {
    name: "studio_generate",
    description:
      "Render the approved Studio prompt(s). Call only after the owner has seen and approved the " +
      "final prompt. One job = one video clip (4-15 s) or one image. Reference photos the owner " +
      "uploaded in this conversation are attached in upload order when use_references is true. " +
      "Anyone the owner @-mentioned from their photo library is attached automatically as well, so " +
      "each prompt must describe them in words rather than naming them: the render sees the face, " +
      "the model reading the prompt does not.",
    parameters: {
      type: "object",
      properties: {
        medium: { type: "string", enum: ["video", "image"] },
        engine: {
          type: "string",
          enum: ["local", "cloud"],
          description:
            "Video only. 'local' (default) = free, on the owner's PC via Pinokio/WanGP, ~6 min per 5 s clip. " +
            "'cloud' = paid RunPod — use ONLY when the owner explicitly asks for it.",
        },
        jobs: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string", description: "Short label, e.g. 'Shot 1 — the hook'." },
              prompt: { type: "string", description: "The full model-ready prompt for this clip or image." },
              duration_sec: { type: "number", description: "Video only, 4-15." },
              aspect_ratio: { type: "string", description: "16:9, 9:16 or 1:1 for video; images also 4:5, 3:4, 2:3, 3:2, 4:3, 21:9." },
              use_references: { type: "boolean" },
              references: {
                type: "array",
                items: { type: "number" },
                description: "Which uploads this job gets, as Subject numbers (1 = first uploaded). Omit to attach all.",
              },
            },
            required: ["title", "prompt"],
          },
        },
      },
      required: ["medium", "jobs"],
    },
    app: "studio",
  },
];

export function toApiTools(tools: ToolSpec[]): unknown[] {
  return tools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}
