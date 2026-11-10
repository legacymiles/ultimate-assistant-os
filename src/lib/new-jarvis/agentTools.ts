// ---------------------------------------------------------------------------
// The tools New Jarvis's agent can reach, and where each one actually runs.
//
// The unusual part: none of these run on the server. They run in the OWNER'S
// BROWSER, because the bridge listens on 127.0.0.1 and Vercel cannot see this
// desk — only the tab can. So the loop here is client-driven: the route decides
// the next call, the page makes it, and the result comes back up as the next
// message. That inversion is why New Jarvis needs its own loop instead of
// reusing src/lib/jarvis/server/agent.ts, whose read tools all run server-side.
//
// Descriptions are written for the model and they are blunt on purpose. A tool
// description that oversells what it can do produces an agent that confidently
// tries the wrong thing and reports success.
// ---------------------------------------------------------------------------

export interface AgentTool {
  name: string;
  /**
   * Where this runs.
   *
   *   "bridge" — the local agent on 127.0.0.1, so it needs the PC.
   *   "hub"    — the owner's own stores, in this tab, with no agent at all.
   *              Memory, the Life Record, folders, lists and the calendar keep
   *              working when the bridge is down, which is most of the time.
   */
  kind: "bridge" | "hub";
  /** The bridge route, or a "hub/…" key the page dispatches on. */
  route: string;
  description: string;
  parameters: Record<string, unknown>;
  /**
   * Which capability must be up for this to be offered. Undefined means it
   * always is — which is what makes the hub tools survive a stopped agent.
   */
  needs?: "browser" | "shell" | "files" | "system" | "harness" | "mcp" | "cli";
}

import { FIELD_BY_KEY } from "@/lib/jarvis/record/types";

const str = (description: string) => ({ type: "string", description });

/**
 * The Record's real field keys, handed to the model.
 *
 * Without them it invents plausible ones — "council_tax_account" for a council
 * tax page — and the write silently matches nothing and saves nothing, which
 * looks from the outside exactly like the feature not working.
 */
export const RECORD_KEYS = [...FIELD_BY_KEY.keys()].sort();
const KEY_LIST = RECORD_KEYS.join(", ");

export const AGENT_TOOLS: AgentTool[] = [
  // --- browser ------------------------------------------------------------
  {
    name: "browser_open",
    kind: "bridge",
    route: "browser/open",
    needs: "browser",
    description:
      "Open a URL in the owner's automation browser. It keeps a real profile, so sites they have signed into stay signed in. Returns the tab id and title.",
    parameters: {
      type: "object",
      properties: { url: str("The address. A bare domain is fine.") },
      required: ["url"],
    },
  },
  {
    name: "browser_read",
    kind: "bridge",
    route: "browser/read",
    needs: "browser",
    description:
      "Read the current page: its visible text plus every clickable and typable control, each with a ref. You MUST call this before clicking or typing — refs only exist after a read, and they go stale when the page changes.",
    parameters: {
      type: "object",
      properties: { tabId: str("Which tab. Defaults to the most recent.") },
    },
  },
  {
    name: "browser_click",
    kind: "bridge",
    route: "browser/click",
    needs: "browser",
    description:
      "Click a control by the ref from browser_read. Always pass `name` as well — the owner's confirmation gate shows it, and a click on something irreversible is stopped for their yes.",
    parameters: {
      type: "object",
      properties: {
        ref: str("A ref from the last browser_read, e.g. ref_12."),
        name: str("The control's visible label, copied from the read."),
        tabId: str("Which tab."),
      },
      required: ["ref", "name"],
    },
  },
  {
    name: "browser_type",
    kind: "bridge",
    route: "browser/type",
    needs: "browser",
    description:
      "Type into a field by its ref. Set submit only when the form really should be sent — that stops for the owner's yes. Never type a password, a card number or a government ID.",
    parameters: {
      type: "object",
      properties: {
        ref: str("A ref from the last browser_read."),
        value: str("The text to put in the field."),
        name: str("The field's visible label."),
        submit: { type: "boolean", description: "Press Enter afterwards." },
        tabId: str("Which tab."),
      },
      required: ["ref", "value"],
    },
  },
  {
    name: "browser_scroll",
    kind: "bridge",
    route: "browser/scroll",
    needs: "browser",
    description: "Scroll the page. Read again afterwards — new controls get new refs.",
    parameters: {
      type: "object",
      properties: {
        direction: { type: "string", enum: ["up", "down"] },
        tabId: str("Which tab."),
      },
    },
  },
  {
    name: "browser_navigate",
    kind: "bridge",
    route: "browser/navigate",
    needs: "browser",
    description: "Go back, forward, or reload.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["back", "forward", "reload"] },
        tabId: str("Which tab."),
      },
      required: ["action"],
    },
  },
  {
    name: "page_fields",
    kind: "bridge",
    route: "browser/fields",
    needs: "browser",
    description:
      "List the form fields on the page — their keys, labels, whether they are filled, and a MASKED preview. "
      + "You never see the values themselves, by design. Use this to decide which fields are worth keeping, "
      + "then call record_capture with their keys; the value goes from the page to the owner's Record without "
      + "passing through you. This is the only way to save something sensitive, and the right way to save anything "
      + "read off a form.",
    parameters: { type: "object", properties: { tabId: str("Which tab.") } },
  },
  {
    name: "browser_tabs",
    kind: "bridge",
    route: "browser/tabs",
    needs: "browser",
    description: "List the open tabs with their ids, titles and URLs.",
    parameters: { type: "object", properties: {} },
  },

  // --- the machine --------------------------------------------------------
  {
    name: "shell_run",
    kind: "bridge",
    route: "shell",
    needs: "shell",
    description:
      "Run one PowerShell command on the owner's PC and read its output. Prefer one simple command over a chained pipeline — a chain cannot be vouched for, so it is treated as an action. Deleting, pushing and publishing always stop for their yes; everything else runs or asks according to how much they have trusted you, which is not yours to predict. Call the tool and let the gate decide — never ask in words first.",
    parameters: {
      type: "object",
      properties: {
        command: str("The command."),
        cwd: str("Where to run it. Defaults to their home folder."),
      },
      required: ["command"],
    },
  },
  {
    name: "files_list",
    kind: "bridge",
    route: "files/list",
    needs: "files",
    description: "List a folder on the owner's PC.",
    parameters: { type: "object", properties: { path: str("Absolute path.") }, required: ["path"] },
  },
  {
    name: "files_read",
    kind: "bridge",
    route: "files/read",
    needs: "files",
    description: "Read a text file on the owner's PC. Long files come back truncated, and say so.",
    parameters: { type: "object", properties: { path: str("Absolute path.") }, required: ["path"] },
  },
  {
    name: "files_write",
    kind: "bridge",
    route: "files/write",
    needs: "files",
    description:
      "Write a text file on the owner's PC, replacing whatever is there. Read it first if you mean to edit rather than replace. A path that holds secrets always stops for their yes; an ordinary file may simply be written, so do not ask in words first.",
    parameters: {
      type: "object",
      properties: { path: str("Absolute path."), text: str("The full new contents.") },
      required: ["path", "text"],
    },
  },
  {
    name: "system_windows",
    kind: "bridge",
    route: "system/windows",
    needs: "system",
    description: "List the windows open on the owner's PC, with their process ids.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "system_focus",
    kind: "bridge",
    route: "system/focus",
    needs: "system",
    description: "Bring a window to the front by its pid, from system_windows.",
    parameters: { type: "object", properties: { pid: { type: "number" } }, required: ["pid"] },
  },
  {
    name: "system_launch",
    kind: "bridge",
    route: "system/launch",
    needs: "system",
    description: "Start a program or open a file with its default app. Stops for the owner's yes.",
    parameters: {
      type: "object",
      properties: { target: str("An executable, a document, or a URL.") },
      required: ["target"],
    },
  },
  {
    name: "system_screenshot",
    kind: "bridge",
    route: "system/screenshot",
    needs: "system",
    description: "Take a picture of the owner's screen so you can see what they see.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "system_info",
    kind: "bridge",
    route: "system/info",
    needs: "system",
    description: "Read this PC: hostname, user, OS, memory.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "clipboard_read",
    kind: "bridge",
    route: "system/clipboard/read",
    needs: "system",
    description: "Read what the owner has copied.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "clipboard_write",
    kind: "bridge",
    route: "system/clipboard/write",
    needs: "system",
    description: "Put text on the owner's clipboard, replacing what was there. May stop for their yes.",
    parameters: {
      type: "object",
      properties: { text: str("The text to copy.") },
      required: ["text"],
    },
  },
  // --- the owner's own stores -------------------------------------------
  // No `needs`: these run in this tab against the same data /apps/jarvis
  // uses, so they keep working when the local agent is stopped.
  {
    name: "record_capture",
    kind: "hub",
    route: "hub/record_capture",
    description:
      "Save fields you listed with page_fields into the owner's Life Record. Name the field keys and say which "
      + "Record field each one is. You are naming keys, not values — the value is taken from the copy this tab "
      + "already holds and written locally, so it never reaches you. Use this for anything a form asked for: "
      + "account numbers, reference numbers, addresses, employer details. "
      + `The Record field key you map to must be one of: ${KEY_LIST}. If nothing fits, say so instead of inventing a key.`,
    parameters: {
      type: "object",
      properties: {
        map: {
          type: "object",
          description: "Page field key → Record field key, e.g. {\"acct\":\"council_tax_account\"}.",
          additionalProperties: { type: "string" },
        },
        because: str("Where this came from, shown beside each value in the Record."),
      },
      required: ["map"],
      // The Record key must be one of these; anything else matches no field
      // and saves nothing.
      "x-record-keys": KEY_LIST,
    },
  },
  {
    name: "record_set",
    kind: "hub",
    route: "hub/record_set",
    description:
      "Write facts the owner has TOLD you into their Life Record — address, household, income, work history, "
      + "schools, references. Never a value they did not give you. Sensitive keys are refused here by design; "
      + "use record_capture for those, which never shows you the value. "
      + `The Record field key must be one of: ${KEY_LIST}.`,
    parameters: {
      type: "object",
      properties: {
        fields: { type: "object", description: "Record field key → value.", additionalProperties: { type: "string" } },
        because: str("Where this came from."),
      },
      required: ["fields"],
    },
  },
  {
    // Hub, because the VALUE comes from the Record in the owner's own tab and
    // never passes through the model or a server; needs the browser, because
    // that tab then types it into the page through the bridge.
    name: "record_fill",
    kind: "hub",
    route: "hub/record_fill",
    needs: "browser",
    description:
      "Fill a box on the page from the owner's Life Record by its Record key — their name, email, phone, address and so on. "
      + "You name the key; their tab types the value in, so you never see it. Use this instead of browser_type for any "
      + "personal detail they've saved. Sensitive keys are refused. Never submits — pressing Enter or Send is a separate step. "
      + `The Record field key must be one of: ${KEY_LIST}.`,
    parameters: {
      type: "object",
      properties: {
        ref: str("The box's ref from the last browser_read."),
        key: str("The Record field key whose value goes in."),
        name: str("The box's visible label, copied from the read."),
        tabId: str("Which tab."),
      },
      required: ["ref", "key", "name"],
    },
  },
  // --- the vault ----------------------------------------------------------
  // The owner's Obsidian vault is the source of truth for everything they
  // wrote on purpose, so these rank above memory search when the question is
  // about their own notes, plans or decisions.
  {
    name: "vault_note",
    kind: "bridge",
    route: "vault/peek",
    needs: "files",
    description:
      "Read one note from the owner's Obsidian vault, by its vault-relative path (e.g. 'topics/Zone Recovery.md'). "
      + "Returns the note's full markdown including its frontmatter. Use this when you know which note you want; "
      + "search memory first if you do not.",
    parameters: {
      type: "object",
      properties: { path: str("Vault-relative path, with the .md extension.") },
      required: ["path"],
    },
  },
  {
    name: "vault_append",
    kind: "bridge",
    route: "vault/append",
    needs: "files",
    description:
      "Add text to the END of an existing note in the vault. This is the safe way to write: nothing already in "
      + "the note is changed or removed. Use it to log something under a note that already exists. To create a "
      + "NEW note use vault_write. Never use it to 'update' a note by appending a corrected copy — say what "
      + "changed instead.",
    parameters: {
      type: "object",
      properties: {
        path: str("Vault-relative path of the note to add to."),
        text: str("Markdown to add. It goes after everything already there."),
      },
      required: ["path", "text"],
    },
  },
  {
    name: "vault_write",
    kind: "bridge",
    route: "vault/write",
    needs: "files",
    description:
      "Create a new note in the vault at a path that does not exist yet. Write real markdown: frontmatter with a "
      + "title, then the body, and [[wikilinks]] to the notes it relates to — the links are what put it on the "
      + "owner's graph, so a note with none is a note they will not find again. It will NOT overwrite an existing "
      + "note; if one is already there you are told so and nothing is written.",
    parameters: {
      type: "object",
      properties: {
        path: str("Vault-relative path, ending .md. Put it in inbox/, notes/, people/, topics/ or decisions/."),
        text: str("The whole note, as markdown."),
      },
      required: ["path", "text"],
    },
  },
  {
    name: "propose_memory",
    kind: "hub",
    route: "hub/propose_memory",
    description:
      "Propose a durable memory when the owner states something lasting — a preference, a decision, a lesson, a "
      + "fact about how they work. It is a PROPOSAL: it waits on the Memory tab for their yes. Do not propose "
      + "something already in memory, and do not propose passing detail that will not matter next month.",
    parameters: {
      type: "object",
      properties: {
        title: str("A short name for it."),
        content: str("The fact itself, in one or two sentences."),
        origin: str("Where it came from, e.g. 'from the page you had open'."),
      },
      required: ["title", "content"],
    },
  },
  {
    name: "dashboard_add_note",
    kind: "hub",
    route: "hub/dashboard_add_note",
    description: "Save a note into one of the owner's folders.",
    parameters: {
      type: "object",
      properties: { title: str("Note title."), body: str("The note."), folder: str("Folder name.") },
      required: ["title", "body"],
    },
  },
  {
    name: "lists_add_item",
    kind: "hub",
    route: "hub/lists_add_item",
    description: "Add an entry to one of the owner's shared lists.",
    parameters: {
      type: "object",
      properties: {
        text: str("The entry."),
        list: str("Which list. Defaults to To-Do."),
        priority: str("high, medium or low."),
        private: { type: "boolean", description: "Keep it visible only to them." },
      },
      required: ["text"],
    },
  },
  {
    name: "dashboard_add_event",
    kind: "hub",
    route: "hub/dashboard_add_event",
    description:
      "Put something on the owner's calendar (the one their Dashboard Calendar widget, Calendar tab and reminders read). Use it whenever they say \"add this to my calendar\", \"remind me on…\", \"I have X on Friday\" — or attach a flyer/screenshot of an event: read the title, date, time and place off it. Work out the real date from TODAY (\"Friday\" = the coming Friday). A person's yearly birthday goes to birthday_add instead, not here. After it's added, say in one line what went on which day.",
    parameters: {
      type: "object",
      properties: {
        title: str("What it is."),
        date: str("YYYY-MM-DD, worked out from today when they said a weekday or 'tomorrow'."),
        time: str("HH:MM 24-hour, optional — leave out for an all-day event."),
        location: str("Where, optional."),
        notes: str("Anything else worth keeping, optional."),
        reminder_minutes: { type: "number", description: "Minutes before to remind them. Default 1440 (a day before)." },
      },
      required: ["title", "date"],
    },
  },
  {
    name: "birthday_add",
    kind: "hub",
    route: "hub/birthday_add",
    description:
      "Save a family member's or friend's birthday (\"add Mom's birthday, March 14\", \"my friend Tyler was born 7/4/1995\"). ONE call puts it everywhere: on their calendar every year, and in their Dashboard notifications starting 2 days before. If that person is already saved it updates them instead of adding a duplicate. Several people in one message = one call each. Afterwards say in one line who was saved and when.",
    parameters: {
      type: "object",
      properties: {
        name: str("Their name, or what the owner calls them (\"Mom\") when no name was given."),
        date: str("The birthday as said: \"March 14\", \"3/14\", \"1990-03-14\". Include the birth year only if they said it."),
        relation: str("Who they are to the owner: Mom, cousin, best friend… optional."),
        circle: str("family or friend. Optional — guessed from the relation."),
        notes: str("Gift ideas or anything else they said, optional."),
      },
      required: ["name", "date"],
    },
  },
  {
    name: "birthday_remove",
    kind: "hub",
    route: "hub/birthday_remove",
    description: "Remove a saved birthday by the person's name (it disappears from the calendar and notifications).",
    parameters: {
      type: "object",
      properties: { name: str("The person's name as saved.") },
      required: ["name"],
    },
  },
  {
    name: "app_builder",
    kind: "hub",
    route: "hub/app_builder",
    description:
      "The owner's App Builder. EVERY request to make a NEW app, website, web tool, plugin or workflow goes here — typed, spoken, or a Camera Autopilot job — and so does any request to recreate or change an app or workflow shown in an attached video or screenshot. It opens the request as an App Builder project: its super agent watches and reverse-engineers attached recordings (video-analyzer + rea), asks what the app is for, proposes features the owner accepts, denies or edits, then hands the build to Claude Code with felix, prompt-enhancer, the design skill, software-factory and claude-security. Pictures and videos attached to this message go with it automatically. Pass the request in the owner's own words, with everything they said about it. Do NOT use this for a small change to an app that already exists — edit that one directly. Calling it opens App Builder on the user's screen inside Jarvis (full screen on a phone), so after calling it just say in one short line that it's open in front of them — don't paste a link.",
    parameters: {
      type: "object",
      properties: {
        idea: str("What they want built (or recreated / changed from the attached recording), in their own words, complete."),
      },
      required: ["idea"],
    },
  },
  // Cloud tools: run by the website itself, so a job never stops at "this
  // needs your PC". See src/lib/new-jarvis/web.ts and /api/new-jarvis/web.
  {
    name: "web_search",
    kind: "hub",
    route: "hub/web_search",
    description:
      "Search the web from the website (works with the PC off). Returns titles, links and snippets. Use it to look things up, find a repo, docs, a product or a page, then web_read the best result for detail.",
    parameters: {
      type: "object",
      properties: { query: str("What to search for, as you'd type it into a search box.") },
      required: ["query"],
    },
  },
  {
    name: "web_read",
    kind: "hub",
    route: "hub/web_read",
    description:
      "Read a public web page from the website (works with the PC off) and get its text, with links shown as \"text (url)\". Use for docs, articles, GitHub READMEs, product pages. It cannot sign in or click — pages that need a login or the owner's own accounts need the PC's browser.",
    parameters: {
      type: "object",
      properties: { url: str("The page's full address.") },
      required: ["url"],
    },
  },
  {
    name: "queue_build",
    kind: "hub",
    route: "hub/queue_build",
    description:
      "Hand a change to one of the owner's EXISTING apps (a fix, a feature, a redesign) to Claude Code, which builds it in the cloud from the owner's repo — this is how code gets written when the PC is off. Files it in that app's In Queue folder; Claude Code picks it up, builds, and removes it when done. Pictures attached to this message go with it. Write the request complete and specific: what to change, where, and how it should behave on phone and computer. Not for NEW apps — those go to app_builder.",
    parameters: {
      type: "object",
      properties: {
        app: str("Which app — its name as the owner says it (e.g. \"Cook Connect\", \"Jarvis\") or its /apps/ slug."),
        request: str("The full change, in plain words, with everything the owner said about it."),
      },
      required: ["app", "request"],
    },
  },

  // --- a coding agent, for the jobs one edit cannot finish -----------------
  // These are the difference between an assistant that can read and one that
  // can build. The bridge cuts a real git worktree, starts a real coding
  // harness in it, and keeps it running after this turn. See workbench.ts.
  {
    name: "work_start",
    kind: "hub",
    route: "hub/work_start",
    needs: "harness",
    description:
      "Start a REAL coding agent (DeepSeek Harness or Claude Code) on this PC, in its own git worktree of the repo, and keep it running after you answer. Use it for work that is more than one edit: several files, a build or test loop, a feature that has to be wired end to end, or an app to change so much that doing it step by step would take thirty steps. Do NOT use it for a one-line change you can make with files_write, or for reading something. Give it the whole job in `task` — what to change, where, how it should behave on phone and computer, and how to know it is done. It can push, open a pull request and check the live site itself. After it starts, read progress with work_check. It runs under the Chat's Permissions setting.",
    parameters: {
      type: "object",
      properties: {
        task: str(
          "The complete brief, in the owner's words plus the specifics you learned: the files, the app path, the behaviour, the checks. This is the only thing the agent is told.",
        ),
        harness: {
          type: "string",
          enum: ["deepseek", "claude"],
          description: "Which harness. DeepSeek Harness (dsh) by default; Claude Code if dsh is not installed.",
        },
        repo: str("The repository's folder on this PC. Leave out to use the hub's own checkout, which is what app edits want."),
        project: str("A NEW project's slug, instead of a repo — makes a fresh folder with its own git repo. Only for a brand-new app."),
        title: str("A short name for the thread, shown in the owner's harness list."),
      },
      required: ["task"],
    },
  },
  {
    name: "work_check",
    kind: "hub",
    route: "hub/work_check",
    needs: "harness",
    description:
      "Read what a running agent has done: the last thing it said, its recent steps, and whether it is blocked on a permission question. Waits a few seconds for something to happen, so call it once rather than in a tight loop. Pass the `since` cursor from the previous result to read only the new stretch; pass nothing on the first call.",
    parameters: {
      type: "object",
      properties: {
        threadId: str("The threadId work_start returned."),
        since: { type: "number", description: "The cursor from the previous work_check. Omit on the first call." },
        waitMs: { type: "number", description: "How long to wait for news, in ms. Default 15000, max 30000." },
      },
      required: ["threadId"],
    },
  },
  {
    name: "work_say",
    kind: "hub",
    route: "hub/work_say",
    needs: "harness",
    description:
      "Send the running agent another instruction — a correction, a missing detail, an answer to something it asked in prose. Use work_decide for a permission gate, not this.",
    parameters: {
      type: "object",
      properties: {
        threadId: str("The thread."),
        text: str("What to tell it. It becomes part of its conversation."),
      },
      required: ["threadId", "text"],
    },
  },
  {
    name: "work_decide",
    kind: "hub",
    route: "hub/work_decide",
    needs: "harness",
    description:
      "Answer the permission gate a running agent is blocked on. NEVER call this on your own judgement: read the gate, tell the owner exactly what it wants to do and why, and call it only after they say yes or no. `always: true` stops it asking again for that same tool in that thread.",
    parameters: {
      type: "object",
      properties: {
        threadId: str("The thread."),
        gateId: str("The gateId from work_check."),
        allow: { type: "boolean", description: "True to allow, false to refuse." },
        always: { type: "boolean", description: "Also allow this tool for the rest of the thread. Only with allow=true." },
        what: str("The gate's title from work_check, copied exactly — the owner sees this on the confirmation."),
      },
      required: ["threadId", "gateId", "allow"],
    },
  },
  {
    name: "work_finish",
    kind: "hub",
    route: "hub/work_finish",
    needs: "harness",
    description:
      "Inspect or close out a thread. `diff` shows the actual change in its worktree; `land` commits it to the thread's branch and merges into the base checkout when that checkout is clean (it refuses rather than guessing, and never pushes); `stop` stops the agent and keeps the worktree; `discard` stops it and deletes the worktree and branch. LANDING IS A REAL CHANGE to the owner's local repo — it is gated, and you should only ask for it once the work is reviewed.",
    parameters: {
      type: "object",
      properties: {
        threadId: str("The thread."),
        action: { type: "string", enum: ["diff", "land", "stop", "discard"] },
        message: str("The commit message, for land. One line that says what changed."),
        merge: { type: "boolean", description: "For land: merge into the base branch. Default true; false leaves it on its own branch." },
      },
      required: ["threadId", "action"],
    },
  },
  {
    name: "work_list",
    kind: "hub",
    route: "hub/work_list",
    needs: "harness",
    description: "Every coding-agent thread the PC helper is holding, with its status and branch. Use it before starting a second thread on the same job.",
    parameters: { type: "object", properties: {} },
  },

  // --- the services an app ships through ----------------------------------
  // Run by the website, so they work with the PC off. See devops.ts.
  {
    name: "github",
    kind: "hub",
    route: "hub/github",
    description:
      "Read and write the owner's GitHub. Actions: whoami, repos, repo, branches, commits, pulls, pull, pull_files, create_pull, merge_pull, issues, create_issue, read_file, write_file, delete_file, commit_files, runs, rerun, branches_delete. Write a file with write_file (one file, one commit) or commit_files (several files in ONE commit — preferred for an app change). Repo is owner/name and defaults to the hub's own repo. It works with the PC off. Never merge a pull request or delete a branch unless the owner explicitly asked for that.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: [
            "whoami", "repos", "repo", "branches", "commits", "pulls", "pull", "pull_files",
            "create_pull", "merge_pull", "issues", "create_issue", "read_file", "write_file",
            "delete_file", "commit_files", "runs", "rerun", "branches_delete",
          ],
        },
        repo: str("owner/name. Defaults to the hub's repository."),
        path: str("File path inside the repo, for read_file / write_file / delete_file."),
        content: str("The file's FULL new contents, for write_file."),
        files: {
          type: "array",
          description: "For commit_files: the files to write, all in one commit.",
          items: {
            type: "object",
            properties: { path: { type: "string" }, content: { type: "string" } },
            required: ["path", "content"],
          },
        },
        message: str("Commit message."),
        branch: str("Branch to read from or write to. Defaults to the repo's default branch."),
        ref: str("A branch, tag or commit to read a file at."),
        title: str("Pull request or issue title."),
        body: str("Pull request or issue body."),
        head: str("For create_pull: the branch that has the change."),
        base: str("For create_pull: the branch to merge into. Default main."),
        number: { type: "number", description: "Pull request number, for pull / pull_files / merge_pull." },
        state: { type: "string", enum: ["open", "closed", "all"] },
        runId: { type: "number", description: "Actions run id, for rerun." },
        sha: str("Only when you already know it. Omit and Jarvis looks it up."),
        limit: { type: "number" },
      },
      required: ["action"],
    },
  },
  {
    name: "vercel",
    kind: "hub",
    route: "hub/vercel",
    description:
      "Read and control the owner's Vercel. Actions: whoami, teams, projects, project, deployments, deployment, logs, redeploy, env, env_set, domains. Use deployments + logs after a change ships to see whether it built and what it said; use redeploy to rebuild without a new commit. env_set is gated and immediately affects the live site — set the variable and tell the owner a redeploy is needed. Works with the PC off.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["whoami", "teams", "projects", "project", "deployments", "deployment", "logs", "redeploy", "env", "env_set", "domains"],
        },
        project: str("Vercel project name or id."),
        deploymentId: str("Deployment id or url, for deployment / logs / redeploy."),
        key: str("Environment variable name, for env_set."),
        value: str("Environment variable value, for env_set."),
        target: { type: "array", items: { type: "string" }, description: "production, preview, development." },
        limit: { type: "number" },
      },
      required: ["action"],
    },
  },
  {
    name: "supabase",
    kind: "hub",
    route: "hub/supabase",
    description:
      "Read and change the owner's Supabase. Actions: projects, project, api_keys, functions, secrets, set_secret, sql, tables, migrations. `sql` runs arbitrary SQL against the real database and is gated as a grave action — read first (tables, migrations) and prefer additive migrations over rewriting data. `api_keys` returns only the public anon key; never ask for the service-role key. Works with the PC off.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["projects", "project", "api_keys", "functions", "secrets", "set_secret", "sql", "tables", "migrations"],
        },
        project: str("The project's ref — the id in its dashboard URL."),
        sql: str("The SQL to run, for action=sql."),
        name: str("Secret name, for set_secret."),
        value: str("Secret value, for set_secret."),
      },
      required: ["action"],
    },
  },

  // --- the PC's own tool supply -------------------------------------------
  {
    name: "mcp",
    kind: "hub",
    route: "hub/mcp",
    needs: "mcp",
    description:
      "Manage MCP servers on the owner's PC and call their tools. Actions: list, tools (what one offers), call, add, remove, enable, disable, restart. A server is a command that speaks MCP over stdio — e.g. npx -y @modelcontextprotocol/server-filesystem <folder>. Adding one runs an arbitrary program on their PC, so it is gated as grave; call `tools` before `call` so you use a real tool name and its real arguments.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list", "tools", "call", "add", "remove", "enable", "disable", "restart"] },
        server: str("The server's short name, e.g. filesystem."),
        tool: str("The MCP tool's name, for call."),
        args: { type: "object", description: "The tool's arguments, matching its input schema from action=tools." },
        command: str("For add: the command that starts it, e.g. npx, uvx or node."),
        serverArgs: { type: "array", items: { type: "string" }, description: "For add: the command's arguments." },
        env: { type: "object", description: "For add: extra environment variables (API keys the server needs)." },
        cwd: str("For add: the folder to start it in."),
        note: str("For add: what this server is for."),
        enabled: { type: "boolean" },
      },
      required: ["action"],
    },
  },
  {
    name: "cli",
    kind: "hub",
    route: "hub/cli",
    needs: "cli",
    description:
      "The command-line tools installed on the owner's PC, and installing one that is missing. Actions: list (name, path, version, installed) and install (npm, winget, pip or uv). Check `list` before telling the owner a tool is missing, and before running a command that assumes one exists. Installing software is gated; for running a tool that IS installed, use shell_run.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list", "install"] },
        name: str("The tool's command name, e.g. gh, vercel, supabase, ffmpeg."),
        manager: { type: "string", enum: ["npm", "winget", "pip", "uv"] },
        pkg: str("The package id, when it differs from the name (e.g. GitHub.cli)."),
      },
      required: ["action"],
    },
  },
];

const BY_NAME = new Map(AGENT_TOOLS.map((t) => [t.name, t]));

export function toolByName(name: string): AgentTool | undefined {
  return BY_NAME.get(name);
}

/** The bridge route a tool name maps to, or "" when it is not one of ours. */
export function routeFor(name: string): string {
  return BY_NAME.get(name)?.route ?? "";
}

/**
 * The tools to offer, given what the bridge can actually do right now.
 *
 * A tool the agent cannot run must never appear: offered browser control with
 * no Chromium installed, the model spends the whole turn trying to open a page
 * and then explains its failure, instead of saying at the start that browser
 * control is off.
 */
export function toolsFor(caps: Partial<Record<NonNullable<AgentTool["needs"]>, boolean>>): AgentTool[] {
  // A tool with no `needs` is a hub tool and is always offered — that is what
  // keeps memory, the Record, folders, lists and the calendar alive when the
  // local agent is stopped, which is most of the time.
  return AGENT_TOOLS.filter((t) => !t.needs || caps[t.needs] === true);
}

/** Whether this call runs against the owner's own stores rather than the PC. */
export function isHubTool(name: string): boolean {
  return BY_NAME.get(name)?.kind === "hub";
}

/** OpenAI-shaped function definitions for the model. */
export function toApiTools(tools: AgentTool[]): unknown[] {
  return tools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

/**
 * An assistant turn, safe to send back to the provider.
 *
 * Echoing the provider's own message verbatim is what makes a client-driven
 * tool loop work at all (a rebuilt one loses the fields a Responses-API
 * provider matches its tool result against). But verbatim includes the keys it
 * set to null — `reasoning` is the one seen in the wild — and sending those
 * back is rejected with "Invalid input: expected string, received null" at
 * `messages.N.reasoning`, which kills the run several steps in, after real work
 * has already happened.
 *
 * So: keep every key the provider sent, drop the ones it left null. That is
 * narrower than rebuilding the message and it fixes the only thing wrong with
 * echoing it.
 */
export function sanitizeAssistant<T extends Record<string, unknown>>(message: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(message)) {
    if (v === null) continue;
    out[k] = v;
  }
  return out as Partial<T>;
}

/**
 * What the owner is told when the model call fails.
 *
 * The provider's own payload is not an error message. Concatenating it into a
 * sentence hands over a schema path like `messages.2.reasoning` — which names
 * neither the problem nor the recovery, and is the exact failure "degrade,
 * never fail" exists to forbid. The detail belongs in the server log, where it
 * is useful; the block gets one line in the product's voice.
 */
/**
 * What this failure means FOR THIS RUN, on top of why it happened.
 *
 * The cause now comes from the router's own diagnosis (describeFailure in
 * src/lib/ai/provider.ts), which knows which models were tried and what each one
 * said — this used to duplicate that badly, from a status code alone, and could
 * only ever describe the last attempt.
 *
 * What is left here is the part only this surface knows: a run is a ledger of
 * steps that already happened, and the owner reading an error under three
 * completed shell steps needs to be told those steps still stand.
 */
export function runNote(status: number): string {
  if (status === 408 || status === 504) return "Running it again usually works.";
  if (status === 400 || status === 422) {
    // A 400 is ours, not theirs. Say so rather than implying the owner did
    // something wrong, and say what survived.
    return "That is a fault in how the next step was built, not something you did. The steps above already ran; the details are in the server log.";
  }
  // Scoped to the round that failed, not to the run. This sentence can land
  // under a ledger showing three completed shell steps, and an unscoped
  // "nothing was touched" would contradict what is on screen.
  return "This run stopped here. The steps above already ran; nothing new was touched.";
}
