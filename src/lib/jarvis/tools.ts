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
export const STUDIO_TOOL_NAMES = ["studio_form", "studio_storyboard", "studio_score", "studio_generate"];

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
      + "TWO RULES THAT DECIDE WHETHER IT IS A FILM AT ALL. They hold for every genre, and they hold "
      + "whether or not the owner touched the camera panel:\n"
      + "- NO SHOT IS A HELD POSE. Every shot's action names something that physically CHANGES inside "
      + "its own seconds — true at the end, not true at the start. A shot written as a situation that "
      + "merely exists ('a baby sits in a living room') renders as a still photograph, because that is "
      + "literally what it asked for. Write the event, not the scene: 'the baby stops drinking and "
      + "turns toward the hallway'.\n"
      + "- EVERY CUT COSTS SOMETHING. Shot N leaves the protagonist worse off, or closer to the thing, "
      + "or with one fewer way out, than shot N-1. If you cannot say what a shot took away, it is a "
      + "held pose with a camera move on it and the film has no shape. A film that ends where it began "
      + "has not happened.\n\n"
      + "GENRE DECIDES THE STORY, NOT ONLY THE LOOK. `mood` is where it lands, so write `mood` as what "
      + "HAPPENS as well as how it is shot: what the opposing force does and how it behaves wrongly, "
      + "what the protagonist registers and loses, how the pressure rises, and how it is allowed to "
      + "end. A horror film planned as a sunlit family scene and then graded dark is a correctly graded "
      + "film of the wrong story. If the camera panel set a Genre you will have been given its full "
      + "doctrine — follow it. If the owner only described one in words, write the same obligations "
      + "yourself from the genre they named.\n\n"
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
            "The genre doctrine, in one paragraph: BOTH how the film is shot AND what it obliges to happen. Take it "
            + "from the camera panel's Genre when the owner set one; otherwise write it from the genre they "
            + "described, and if they named none, from what the story actually is. Never leave it empty.\n"
            + "Half of it is the look — dread, warmth, grit — and it governs the lighting, the grade and the "
            + "framing, so it is repeated into every shot ahead of them. The other half is the story: what the "
            + "opposing force does and how its behaviour is wrong, what the protagonist registers and loses, how the "
            + "pressure rises cut by cut, and how the film is allowed to end. Write the second half as concretely as "
            + "the first. A genre that reaches only the grade gives you a horror film set in a family house that "
            + "comes out sunlit — or, once it is graded, a dark-looking film in which nothing frightening happens.",
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
    name: "studio_score",
    description:
      "Cut a film TO A PIECE OF AUDIO. Use this — never studio_storyboard — whenever the owner has "
      + "attached a song, a rap, a voiceover, a podcast or any other track and wants a video built "
      + "around it. The audio is the clock: you are given its real measurements (tempo, bar lines, "
      + "sections, energy, the exact moments it drops) and its words with timings, and every cut you "
      + "write has a TIME ON THAT CLOCK rather than a length of its own.\n\n"
      + "Like a form, this pauses the conversation: the owner edits the board and starts the render "
      + "themselves. Nothing is spent by planning.\n\n"
      + "HOW A SHOT'S LENGTH WORKS, because it is the one thing that is different here. You do not set "
      + "durations. You set `at_sec`, and a shot runs until the NEXT shot's `at_sec` (the last runs to "
      + "the end of the track). So consecutive cuts must be 4 to 15 seconds apart — closer and the "
      + "renderer cannot make the clip, further and it cannot either. Start the first shot at 0.0 or "
      + "the song opens on black.\n\n"
      + "WHAT MAKES THIS AUDIO-DRIVEN RATHER THAN CLIPS OVER A SONG:\n"
      + "- Put your cuts ON the measured bar lines you were given. Not near them — on them, to the "
      + "hundredth of a second. A cut 200 ms off the beat reads as a mistake.\n"
      + "- Cut on the DROPS. Those timestamps are where the arrangement arrives, and a cut landing "
      + "exactly there is most of what makes an edit feel professional.\n"
      + "- Do NOT cut on every beat or every accent. Long shots through a verse, shorter ones through a "
      + "chorus; pace is how the edit breathes. A cut every two seconds is a slideshow.\n"
      + "- Every shot must say in `because` what in the audio put it there — the line it covers, the "
      + "drop it lands on, the section it belongs to. A shot that cannot say is a shot you invented "
      + "rather than heard.\n"
      + "- A shot covering a lyric must be ABOUT that lyric — what it MEANS. \"She walked in the club "
      + "and everybody turned around\" is a woman entering, heads turning, the camera following her — "
      + "not a generic nightclub. Decide which lines earn a literal image and which are better carried "
      + "by the scene they are already in. Do not literally visualise every word.\n\n"
      + "LIP SYNC. `lipsync` is a list of ranges of the SONG where someone is singing or speaking to "
      + "camera. Any shot that overlaps one becomes a performance shot, and on those shots the sung "
      + "words OUTRANK everything else you wrote: the performer will be on camera with their face and "
      + "mouth large and unobstructed, and the shot's own action is demoted to the setting around them. "
      + "So put a lip-sync range where you actually want a performance, keep them on the vocal lines "
      + "you were given, and make sure those shots name someone from `cast` — otherwise the render has "
      + "no face to put the words in. Do not make the whole song a performance; a music video cuts "
      + "between the singer and everything else.\n\n"
      + "CONTINUITY is the same job as any film and is carried by the same four fields — `link` "
      + "('continuous' renders a shot from the LAST FRAME of the one before it, which is the only thing "
      + "that makes separate generations look like one take), `location` (the same string means the "
      + "same place and forbids re-staging), `ends_on` (always fill it; the next shot opens on it) and "
      + "`carry`. The film-wide fields (world, mood, look, wardrobe, lighting, grade, lens) are "
      + "repeated into every shot word for word, so write each one once, concretely, and never "
      + "contradict it in an action. `places` and `cast` are the location and character bibles: name a "
      + "place or a person once, describe them fully, then refer to them by name in shots.\n\n"
      + "Give any shot over about 6 seconds `beats` — a clock inside it, roughly one every 2 s — or the "
      + "renderer fills the seconds with a held pose.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "The film's title." },
        mode: {
          type: "string",
          enum: ["music-video", "lyric-video", "story", "voiceover", "reaction", "cinematic"],
          description:
            "music-video: lyrics drive cinematic scenes. lyric-video: typography lands on the words. "
            + "story: one continuous narrative. voiceover: visuals illustrate what is said. reaction: "
            + "visuals answer the spoken content. cinematic: abstract visuals answer rhythm and emotion.",
        },
        logline: { type: "string", description: "One sentence: what happens across the whole piece." },
        story: {
          type: "string",
          description:
            "The arc in a few sentences — the story bible. Where it starts, what changes, where it "
            + "ends. This is what stops a music video being a mood board with cuts in it.",
        },
        world: { type: "string", description: "One sentence fingerprinting the world and its texture; repeated into every shot." },
        look: { type: "string", description: "e.g. 'live action, anamorphic 2.39, photorealistic'." },
        mood: {
          type: "string",
          description:
            "The genre and how it is shot, in one paragraph. Take it from the audio's own measured "
            + "character (tempo, key, brightness, dynamics) and from what the words are about. Never "
            + "leave it empty — it governs the lighting, the grade and the framing of every shot.",
        },
        aspect_ratio: { type: "string", enum: ["16:9", "9:16", "1:1"] },
        lens: { type: "string", description: "The glass used throughout, e.g. 'anamorphic prime set'." },
        lighting: { type: "string", description: "The light, unchanged across shots." },
        grade: { type: "string", description: "The colour grade, unchanged across shots." },
        palette: { type: "array", items: { type: "string" }, description: "4-6 hex colours." },
        wardrobe: { type: "string", description: "Exactly what everyone wears; the most common continuity break." },
        soundscape: { type: "string", description: "The diegetic sound world. The real track is laid under the cut automatically." },
        cast: {
          type: "array",
          description: "Everyone who must look identical in every shot they appear in — the character bible.",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              name: { type: "string", description: "Short and in caps, as a call sheet writes it: 'MAYA'." },
              look: { type: "string", description: "Face, build, hair, skin, marks — what a frame must keep." },
              subject: { type: "number", description: "The upload that shows them, as a Subject number (1 = first uploaded)." },
              turns_at: { type: "number", description: "The cut number (1-based) where they stop looking like `look`, for a real on-screen transformation." },
              turns_into: { type: "string", description: "What they become from turns_at onward, written as fully as `look`." },
            },
            required: ["name", "look"],
          },
        },
        places: {
          type: "array",
          description:
            "The location bible. Describe each place once, fully, then name it in shots — a shot whose "
            + "`location` matches a name here inherits this description instead of re-inventing the room.",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              name: { type: "string", description: "Short and reusable: 'the stairwell', 'the car'." },
              look: { type: "string", description: "Surfaces, light sources, weather, clutter — what a frame must keep." },
            },
            required: ["name", "look"],
          },
        },
        lipsync: {
          type: "array",
          description:
            "Ranges of the SONG that are sung or spoken to camera. Use the vocal line timings you were "
            + "given. A shot overlapping one becomes a performance shot where the words outrank the "
            + "prompt, so place these deliberately.",
          items: {
            type: "object",
            properties: {
              start_sec: { type: "number", description: "Seconds into the track." },
              duration_sec: { type: "number", description: "How long the performance lasts." },
            },
            required: ["start_sec", "duration_sec"],
          },
        },
        shots: {
          type: "array",
          description:
            "The cuts, in time order. Consecutive `at_sec` values must be 4-15 seconds apart, and the "
            + "first should be 0.",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              title: { type: "string", description: "'Cut 3 — the headlights'." },
              at_sec: {
                type: "number",
                description:
                  "Where this cut starts in the track, in seconds, to two decimals. Put it on one of "
                  + "the measured bar lines or drops you were given. This is the ONLY timing field — "
                  + "the shot runs until the next one starts.",
              },
              action: {
                type: "string",
                description:
                  "What physically happens across the shot. On a shot that overlaps a lip-sync range "
                  + "this is the SETTING the performance happens in, not a shot of its own.",
              },
              because: {
                type: "string",
                description:
                  "What in the audio put this cut here: the lyric it covers and what that lyric means, "
                  + "the drop it lands on, or the section it belongs to. Required.",
              },
              framing: { type: "string", description: "'wide', 'medium', 'close-up', 'insert'." },
              move: { type: "string", description: "'slow push-in', 'handheld track', 'static'." },
              camera_note: {
                type: "string",
                description:
                  "The geometry behind the name in `move` — travel distance, focal length at each end, "
                  + "what stays locked. Required for any named trick move; the name alone renders as an "
                  + "ordinary move.",
              },
              lens_mm: { type: "number" },
              aperture: { type: "string" },
              location: { type: "string", description: "The place. Match a `places` name to inherit its description." },
              cast: { type: "array", items: { type: "string" }, description: "The `cast` names in this shot." },
              beats: {
                type: "array",
                description: "The clock inside this shot. Any shot over ~6 s needs a beat roughly every 2 s.",
                items: {
                  type: "object",
                  properties: {
                    at: { type: "number", description: "Seconds from the start of THIS shot." },
                    text: { type: "string", description: "One clause, present tense." },
                  },
                  required: ["at", "text"],
                },
              },
              link: { type: "string", enum: ["continuous", "cut"], description: "Ignored on the first shot." },
              carry: { type: "string", description: "Props, blocking, damage or weather that must survive from the shot before." },
              ends_on: { type: "string", description: "The frame this shot finishes on. The next shot is told to open on it." },
              references: { type: "array", items: { type: "number" }, description: "Subject numbers whose faces this shot needs." },
            },
            required: ["title", "at_sec", "action", "because"],
          },
        },
      },
      required: ["title", "shots"],
    },
    // Laying out a plan renders nothing; the owner starts that.
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
              composite_over: {
                type: "number",
                description:
                  "The reaction format: lay this clip over an attached VIDEO as a cut-out. The number is the "
                  + "Subject number of a clip in this conversation. What you prompt for here is then the PLATE "
                  + "— the reactor alone against a flat chroma-green field, framed for the composite — not the "
                  + "finished piece; the local renderer keys it and lays it over that video. Never a split screen. "
                  + "Only works on the local renderer, and only while the clip is still attached in this session.",
              },
              composite: {
                type: "object",
                description: "Where the cut-out stands. Every field is optional.",
                properties: {
                  corner: {
                    type: "string",
                    enum: ["bottom-left", "bottom-right", "top-left", "top-right"],
                    description: "Put it in the source video's dead space — where nothing the viewer needs happens.",
                  },
                  share: {
                    type: "number",
                    description:
                      "The REACTOR's share of the frame height, 0.1-0.5 (default 0.32). Measured on the reactor "
                      + "themselves, not on the plate, so the plate's own shape does not change their size.",
                  },
                  inset: { type: "number", description: "Gap from the side edge, as a share of frame width (default 0.06)." },
                  audio: {
                    type: "string",
                    enum: ["both", "base", "plate"],
                    description: "Whose sound to keep. Default both — the video's audio plus the reactor's.",
                  },
                  key: {
                    type: "string",
                    description:
                      "Leave unset: the renderer samples the real green off the plate. \"none\" if the plate "
                      + "already has an alpha channel.",
                  },
                },
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
