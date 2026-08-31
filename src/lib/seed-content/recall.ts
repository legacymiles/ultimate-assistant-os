import type { Feature, KnowledgeEntry, Version } from "../types";
import { uid, nowIso } from "../utils";

// ---------------------------------------------------------------------------
// Rich seed content for Recall.
//
// This is deliberately exhaustive. The point is that another agent (or the user
// six months from now) can read this project and rebuild or redesign Recall
// WITHOUT losing the small decisions — the ones that came out of back-and-forth
// editing and are invisible in the finished UI. Rejected alternatives, exact
// crypto parameters, storage layout, the invariants that stop data being
// hidden, and the bugs that were found and fixed all live here on purpose.
// ---------------------------------------------------------------------------

export function recallDetailed(): string {
  return `Recall is a personal RAG "second brain": a private, local-first place to keep everything about a project — notes, tasks, links, files, logins and websites — organised as **folders you open like pages**, searchable by one box that reaches inside your documents, and steerable by an agent that proposes changes and waits for your confirmation.

It lives at \`/apps/recall\`. All source is under \`src/components/recall/\` and \`src/lib/recall/\`, plus two API routes at \`src/app/api/recall/\`.

---

## 1. The core idea: a folder is a page, not a filter

This is the single most important design decision and everything else follows from it.

In most note apps a folder is a **filter** — you click it and a list re-renders. In Recall a folder is a **destination**. You open it and you are on its page, which holds typed sections stacked vertically:

- **Sub-Folders** — rendered as a tile grid *inside the folder*, not as rows in a permanent sidebar
- **Notes & Ideas**
- **To-Do List**
- **Links & Resources** — URLs *and* files
- **Logins & Passwords**
- **Websites**

Sub-folders open the exact same page, recursively, as deep as you like. A breadcrumb (\`All › TRADING FX › Copy Trading\`) is the only navigation chrome, and it costs one line.

**Why tiles instead of a sidebar tree:** a sidebar tree grows without bound and taxes every screen forever. Tiles live inside the folder they belong to, so twenty sub-folders cost four tidy rows *on that page only* and zero permanent chrome. This is what makes deep nesting feel free.

The folder tree still exists, but as a **toggle** in the header (the sidebar icon), not permanent furniture.

---

## 2. Home is folders and nothing else

The root view (\`FolderHome.tsx\`) shows **only** a grid of large folder tiles. No sections, no item rows, no counts competing for attention. You pick a folder and everything it holds is one click in.

Each home tile carries:
- a **chosen icon** (12 to pick from)
- the folder **name**
- an optional **one-line description** — this is what makes a grid of twelve tiles readable instead of twelve identical rectangles
- an item count and sub-folder count

An **Unfiled** tile appears *only* when items exist outside every folder (e.g. the Capture button classified something with nowhere obvious to put it). It is never a permanent tile. Without it, loose items would silently disappear the moment home stopped showing item rows — this tile is a data-visibility safeguard, not decoration.

**First run is completely empty.** No seed folders, no demo content. \`buildSeed()\` returns \`{ folders: [], items: [] }\` and the empty state says "Start with a folder". Nothing has to be deleted before you begin.

---

## 3. Sections are opt-in — and two invariants protect your data

A new folder opens with **no sections at all**: a name and a single **+ Add section** button. The menu lists the six section types, each with a one-line description of what it holds. Pick one and it appears. Once you have sections, the **+ Add section** control drops to a quiet grey line beneath the stack and offers only what you have not already added.

A folder holding two kinds of thing is two lines tall. That is the entire point.

Removing a section is an **×** on its header, revealed on hover.

**Two invariants make this safe, and any redesign MUST preserve both:**

1. **A section holding items always renders — listed or not.** If the agent files a website into a folder with no Websites section, the section appears rather than the website vanishing. Implemented in \`FolderWorkspace.visible\`: the union of \`folder.sections\` and every section whose bucket is non-empty.
2. **A section can only be removed while it is empty.** The × is simply not rendered when \`count > 0\`, so you cannot accidentally hide six logins by tidying up.

These two rules also gave a free migration: folders created before opt-in sections have \`sections: undefined\`, so they now display exactly the sections that hold something and nothing else.

Canonical order is fixed (\`SECTION_ORDER\`): sub-folders, notes, to-dos, links, logins, websites. Sections never reorder themselves.

---

## 4. The vault (Logins & Passwords)

Real cryptography, not obfuscation. \`src/lib/recall/vault.ts\`.

| Parameter | Value |
|---|---|
| Key derivation | PBKDF2-SHA256, **310,000 iterations**, 16-byte random salt |
| Cipher | **AES-GCM 256**, fresh 12-byte IV per secret |
| Storage | base64 \`{ iv, ct }\` only — plaintext never touches disk |
| Idle auto-lock | **5 minutes** |
| Clipboard wipe after copy | **30 seconds** |
| Recovery | **None.** No reset, no backdoor |

The derived key lives in **module memory only** and is dropped on lock, idle timeout, or page reload. A "verifier" — a known plaintext encrypted at setup — is what proves the master password on unlock.

**Only the password is encrypted.** Username, email, URL and 2FA notes stay plaintext so they remain searchable and copyable. This was a deliberate call, matching the reference app's behaviour.

**Credentials are excluded from the agent entirely** (\`retrieveForQuestion\` filters \`kind !== "credential"\`). The agent posts its candidate items to the AI Gateway; a saved login's title and username have no business leaving the device just because a question happened to match them. This is a privacy decision that is invisible in the UI and easy to accidentally undo — do not remove that filter.

The UI carries an honest amber notice: encrypted for convenience, but *not* a hardened password manager — for bank, email and root accounts, keep the real secret in 1Password or Bitwarden and store only a pointer here.

Verified end-to-end: saved \`S3cret-Value-42\`, confirmed storage held only ciphertext, confirmed reveal decrypted correctly, confirmed locking wiped the revealed value from the DOM.

---

## 5. Files and the RAG — the part that makes it a second brain

Links & Resources holds URLs **and** files. Files are not just stored, they are **read**, and the extracted text is what search and the agent actually reason over. You do not have to remember what was inside a document.

### Storage architecture (important)

**File blobs go to IndexedDB, never localStorage.** localStorage caps around 5MB total — a single phone photo or PDF would break the entire app. Only the extracted text and a tiny JPEG thumbnail live in localStorage.

- localStorage \`recall:v1\` — folders, items, extracted text, thumbnails
- localStorage \`recall:vault:v1\` — vault salt + verifier
- IndexedDB \`recall-files\` / object store \`blobs\` — the actual file bytes, keyed by \`attachment.fileId\`

Orphaned blobs (whose item was deleted by the agent or a folder purge) are swept on app load via \`pruneOrphans\`.

Max file size: **100MB**. Extracted text capped at **40,000 characters**.

### What gets read

| Type | Stored | Read | How |
|---|---|---|---|
| PDF | yes | yes | \`pdf-parse\` v2 (\`new PDFParse({data}).getText()\`) server-side |
| .docx | yes | yes | \`mammoth.extractRawText\` server-side |
| .txt .md .csv .json .log | yes | yes | browser \`FileReader\`, no round trip |
| Images | yes | yes* | vision model via AI Gateway — describes the image **and transcribes visible text** |
| Video | yes | **no** | never read; the row says "not read" rather than pretending |

\Note: images require \`AI_GATEWAY_API_KEY\`. Without it they are stored and findable by filename, and the row honestly reports "not read".

Extraction happens at \`POST /api/recall/extract\` (multipart form). It **always returns 200 with a status** so a failed read degrades to "stored but not read" instead of failing the whole upload.

Every file row shows an extraction badge: **read** (green) / **reading…** (amber) / **not read** (grey) / **could not read** (red).

### Verified

A PDF containing the phrase \`PINEAPPLE-TROMBONE-42\` — a string existing nowhere but inside the file — was uploaded. Searching that phrase returned the PDF, tagged **"in contents"**. The offline agent then answered a question **from** the PDF's contents with no AI key present at all.

---

## 6. Search

One box over everything: titles, note bodies, tags, folder names, every structured field on a website or login, and the text read out of files.

Scoring weights (\`search.ts\`): **title 6, tag 5, field 4, summary 2, body 1, extract 1**. Extract is lowest because it is long and therefore matches easily — but it is what lets you find a document by something that only ever existed inside it.

Results are **grouped by type** (Websites, Logins, Notes, Links, To-Dos) with the folder path shown on the right of every row. A hit that came from inside a file — and not from its title — is badged **"in contents"** in green.

**Encrypted passwords are never searched.** They are unreadable by design while locked, and deliberately not indexed.

---

## 7. The agent ("Ask Recall")

Retrieval-augmented over your own content, with the ability to reorganise — but never without asking.

### Action vocabulary (13)

\`create_folder\`, \`move_item\`, \`move_items\` (bulk), \`add_tags\`, \`remove_tags\`, \`create_note\`, \`rename_item\`, \`edit_note\`, \`rename_folder\`, \`move_folder\`, \`merge_folders\`, \`delete_item\`, \`delete_folder\`.

\`move_items\` exists specifically so *"add these five trading bots to my FX Bots sub-folder"* is **one action and one confirmation**, not five.

### The confirmation contract

Every proposed action lands in a **Plan** panel. Nothing executes until clicked.

- **Apply all** / **Dismiss all**, plus per-action **Apply** / **No**
- Destructive actions (\`delete_item\`, \`delete_folder\`, \`merge_folders\`, \`edit_note\` — the \`DESTRUCTIVE_ACTIONS\` set) get a **red dot**, a red **Confirm** button instead of Apply, and a plain-English caveat such as *"The folder goes; everything inside moves up to its parent."*
- Applied actions strike through and show **Done**
- \`applyAll\` runs actions **in order**, each seeing the previous step's result

The system prompt explicitly instructs: *never state that you have already done it; say what you are proposing.*

Folder deletion is non-destructive by design — children and items **lift up to the parent**, they are never removed.

### Offline behaviour

With no \`AI_GATEWAY_API_KEY\`, the agent falls back to local extractive retrieval. It still finds and answers from file contents (verified), and still parses simple commands like *"create a folder called Archive / 2026"*. The chat footer says "Offline answer · add an AI key for synthesis + actions".

---

## 8. Websites

A single general record shape usable in **any** folder — a site you own, a service you pay for, a dashboard you keep losing.

Fields: URL, what it's for, account (pointer to a login), hosted on, host/IP, registrar, renews, deploy command.

A coloured dot shows renewal health: green (>30 days), **amber (≤30 days)**, red (expired), grey (no date set). Collapsed a record is one line; expanded it is the full field table with a copy button on every value.

---

## 9. Design language

Dark-first, using the hub's existing tokens (\`globals.css\`): \`--color-canvas #0a0b0f\`, \`--color-panel #12141c\`, \`--color-line #262a38\`, ink \`#e9ecf3\` / muted \`#9aa3b5\` / faint \`#6b7385\`, brand indigo \`#6366f1\`.

A \`--font-mono\` token (JetBrains Mono, falling back to system mono) was added specifically for this app — IPs, ports, hostnames, URLs and deploy commands only read as a table when monospaced.

**Folder tile colours** use six hues with an anti-clustering rule (\`accents.ts\`): the hue is hashed from the folder id so it is stable across sessions, then a pass walks the grid and nudges any tile matching the one to its **left** or the one **above** it. A pure hash happily produced three golds in a row; this fixes that while keeping colours stable.

Content is capped at \`max-w-5xl\` and centred. Motion is minimal — a 0.18s fade-in, nothing bouncy.

---

## 10. Decisions and rejected alternatives

Things that are invisible in the finished product but expensive to rediscover:

- **Rejected: three abstract design directions.** An early pass offered "Ops Console / Command Deck / Constellation" style options. They were rejected as meaningless without something concrete to look at. The design that shipped came from a screenshot of an existing app the user liked, which communicated more in one image than the three named directions did in three paragraphs. **Show, don't name.**
- **Rejected: Servers & Sites as two record types.** Originally there were separate \`server\` and \`site\` kinds with different field schemas. They collapsed into one **Website** record, because they are one idea and two schemas doubled the maintenance for no gain. A one-time migration (\`migrateRecords\`) folds old \`server\`/\`site\` items into \`website\` and maps \`domain\` → \`url\`.
- **Rejected: demo seed content.** The app originally opened with fake notes (a pasta recipe, a restaurant review) so it "felt alive". The user's reaction was *"what is this? lol"* — placeholder content in a personal tool reads as clutter you have to clean up, not as a welcome. Now it opens empty.
- **Rejected: browser \`prompt()\` for folder names.** Functional, but it renders as browser chrome that ignores the app's design and blocks the main thread — in the interaction people use most. Replaced with an in-app dialog that also collects the description and icon.
- **Rejected: all sections present by default.** The version before the final one showed all six sections in every folder. Correct-but-cluttered: most folders need two or three. Opt-in sections were the fix.
- **Kept deliberately: usernames in plaintext.** Encrypting them would break search and copy for no real security gain, since the threat model is "someone reads the stored JSON", and a username alone is not the secret.

---

## 11. Bugs found and fixed during development

- **Empty-section add was dead.** Clicking \`+\` on an empty section set the "adding" flag, but the section rendered its empty *hint* instead of its body — so the inline form had nowhere to appear and nothing happened. Fixed with a \`bodyOverride\` prop on \`Section\`.
- **setState during render.** \`vault.isUnlocked()\` auto-locked a stale key *inside a render pass*, which fired subscribers and set state on other components. Split into a pure \`isUnlocked()\` (safe during render) and \`enforceIdleLock()\` (called from a timer or an event handler only).
- **Hydration mismatch on the vault button.** \`vaultExists()\` reads localStorage, which the server cannot see, so server and first client render disagreed. \`useVault\` now reports "no vault" until mounted.

## 12. Environment and operational notes

- \`AI_GATEWAY_API_KEY\` — enables AI classification, agent synthesis, multi-step action plans, and **image reading**. Everything else works without it.
- \`AI_MODEL\` / \`AI_VISION_MODEL\` — optional overrides (default \`anthropic/claude-sonnet-4-6\`).
- \`NEXT_PUBLIC_GOOGLE_CLIENT_ID\` + \`NEXT_PUBLIC_GOOGLE_API_KEY\` — Google Drive pick-and-import. Imported files land in Links & Resources; you then ask the agent to organise them.
- **Dev gotcha:** stopping and restarting the dev server repeatedly corrupts \`.next\` and the server then fails to boot with no useful error. \`rm -rf .next\` fixes it. Two dev servers sharing one \`.next\` causes the same class of failure.

---

## 13. Lists — the shared family board

The second half of Recall's home page, added after the RAG side was working. A tab switch at the top of home: **Folders** (everything above) and **Lists**.

**Why it exists:** folders hold durable reference material. They are bad at the churn of daily life — buy milk, dentist Tuesday, renew the insurance. Those are short-lived, deleted constantly, and belong to the household rather than to a project. Forcing them into the folder tree would pollute it.

**The card wall.** A tile per list, 3-up on desktop, 1-up on a phone. Eight built-ins: To-Do, To-Buy, Remember, Ideas, Goals, Projects, Bills, Notes. An empty list collapses to its header row — that is what makes eight lists affordable, since the ones you are not using cost one line each rather than eight large empty cards. The admin can add custom lists and hide built-ins.

**Two colour axes, and they never overlap.**
- The **dot on the left** is urgency: red urgent, orange running low, yellow wish list, and a neutral grey default. Four states, not the three that were asked for — if every row had to pick one of three colours, the colours would stop carrying signal, because most shopping-list rows are simply normal.
- The **circle on the right** is identity: one colour per family member, unique across the board, picked at signup from whatever is still free.

**Storage — the one place Lists breaks Recall's rules.** The RAG side is \`localStorage\`. Lists cannot be, because the feature is defined by an invite link that someone opens on their own phone; shared data has to leave the device. So Lists is server-side, in \`.recall-lists.json\`, using the exact pattern \`gateStore.ts\` already established for the app password. Persistence is reported honestly rather than assumed: it survives on a long-lived Node host and is ephemeral on Vercel serverless, and the board says so in a banner instead of quietly losing the family's shopping list. \`RECALL_DATA_DIR\` moves both files onto a mounted volume. That store file is the Supabase seam — swapping it changes no types, no route shapes, no components.

**Two principals, two cookies.**
- \`recall_auth\` — the admin. Already existed; derived from the app password.
- \`recall_member\` — a family member. HMAC-signed with a secret kept inside the lists file.

The invariant the whole feature rests on: **a member token must never satisfy the admin check.** The member cookie is resolved *first*, deliberately — otherwise, on an ungated Recall everyone resolves to admin, including a member who signed in properly, and the permission rules quietly evaporate. A member who types \`/apps/recall\` is redirected; \`/api/recall\` and \`/api/recall/extract\` return 403. Hiding the UI was never considered sufficient.

**Invite flow.** The admin mints a single-use token, valid 7 days, revocable while pending. The invitee opens \`/recall-join?t=…\`, picks a name and a free colour, and sets their own password — PBKDF2 with the same parameters as the app password, which is why those parameters moved into \`src/lib/recall/passwords.ts\` rather than being copied. The token is consumed on success; after that they sign in with name and password and never need a link again. Members never learn the admin password.

**Permissions**, checked in the store on every mutation, never only in the UI:

| Action | Admin | Member |
|---|---|---|
| Add to any list | yes | yes |
| Edit / delete an item | anything | only their own |
| Tick something done | anything | **anything** |
| Add / hide lists, invite, remove members | yes | no |

\`done\` is open to everyone on purpose: if one person buys the milk another person added, they have to be able to tick it off. That is the entire point of a shared list. Deletion stays owner-scoped.

**Completed items** strike through, drop to the bottom of their tile, and are swept 24 hours after \`completedAt\` — lazily, on read, since there is no scheduler. Without the sweep a daily-use shopping list becomes an archive within a week.

**Honest gaps.** No realtime — a member sees changes on their next load. Lists items are deliberately invisible to search, the agent, and the RAG index. Removing a member asks two separate questions (remove them; then, separately, delete their items or keep them) so a mis-click cannot wipe a list.

---

## 14. If you are redesigning this

Change the look freely. These are the things that are load-bearing:

1. **A folder is a page.** Sub-folders as tiles inside it, recursive, breadcrumb navigation.
2. **Home shows folders only.**
3. **Sections are opt-in**, and both invariants hold — content forces a section visible; a non-empty section cannot be removed.
4. **Blobs in IndexedDB, never localStorage.**
5. **Extraction feeds the search index**, and video is honestly labelled as not read.
6. **Every agent mutation is confirmed before it runs**, with destructive ones visually distinct.
7. **Credentials never enter the agent's candidate set.**
8. **Only the password is encrypted; there is no recovery** — and the UI says so plainly.
9. **A member token never satisfies the admin check**, and the RAG routes refuse members server-side.
10. **Permission is enforced in the Lists store, not the components** — but ticking \`done\` stays open to everyone.
11. **Hiding a list never deletes its items**, and a custom list must be empty before it can go.`;
}

export function recallFeatures(projectId: string): Feature[] {
  const ts = nowIso();

  const core: { title: string; description: string }[] = [
    {
      title: "Folder-as-page workspace",
      description:
        "Opening a folder shows its own page, not a filtered list. Sub-folders render as a tile grid inside it and open the same page recursively, so nesting costs no permanent sidebar. A breadcrumb (All › TRADING FX › Copy Trading) is the only navigation chrome. The folder tree still exists but as a header toggle, not fixed furniture.",
    },
    {
      title: "Folders-only home",
      description:
        "The root view is a grid of large folder tiles and nothing else — icon, name, one-line description, item and sub-folder counts. No sections or rows compete for attention. An Unfiled tile appears only when items sit outside every folder, so loose captures can never become invisible.",
    },
    {
      title: "Opt-in sections with data-safety invariants",
      description:
        "A new folder starts with zero sections; one + menu offers the six types, each with a description. Two invariants protect data: a section holding items always renders whether or not it is on the folder's list, and a section can only be removed while empty. Folders predating this feature migrate for free — they show exactly the sections that hold something.",
    },
    {
      title: "Encrypted password vault",
      description:
        "AES-GCM 256 under a PBKDF2-SHA256 key (310,000 iterations, random salt); only base64 ciphertext reaches storage. The key lives in memory and is dropped on lock, 5-minute idle, or reload. Copy wipes the clipboard after 30 seconds. No recovery exists and the UI says so. Only the password is encrypted — username, email and URL stay searchable.",
    },
    {
      title: "File ingestion with real text extraction",
      description:
        "PDFs (pdf-parse), .docx (mammoth), and plain-text formats are read into item.extract and indexed. Images are described and their visible text transcribed by a vision model when an AI key is present. Video is stored but never read, and the row says so rather than pretending. Every row carries a read / reading / not-read badge.",
    },
    {
      title: "IndexedDB blob store",
      description:
        "File bytes live in IndexedDB (db recall-files, store blobs) keyed by attachment.fileId; only extracted text and a small JPEG thumbnail go to localStorage. localStorage caps near 5MB, so a single photo or PDF would otherwise break the app. Orphaned blobs are swept on load. 100MB per-file ceiling, 40,000-character extract cap.",
    },
    {
      title: "One search box over everything",
      description:
        "Indexes titles, bodies, tags, folder names, every structured field on a website or login, and text read out of files. Weights: title 6, tag 5, field 4, summary 2, body 1, extract 1. Results group by type with folder paths, and a hit found only inside a file's contents is badged 'in contents'. Encrypted passwords are never indexed.",
    },
    {
      title: "Confirm-before-act agent",
      description:
        "Answers from your own content with cited sources and proposes reorganisation across 13 actions including bulk move, folder merge and delete. Everything lands in a Plan panel with Apply all / Dismiss all and per-action control; destructive actions get a red Confirm button and a plain-English caveat. Nothing runs until clicked, and applyAll executes in order so each step sees the last one's result.",
    },
  ];

  const supporting: { title: string; description: string }[] = [
    {
      title: "Website records",
      description:
        "One general record shape usable in any folder: URL, purpose, account pointer, hosting, host/IP, registrar, renewal date, deploy command. A renewal dot goes amber within 30 days and red when expired. Collapsed it is one line; expanded it is a field table with per-value copy buttons.",
    },
    {
      title: "Notes, to-dos and links",
      description:
        "Notes open in a detail modal that also shows the text extracted from any attached file. To-dos are checkbox rows where completed items sink to the bottom and the header shows a done/total badge. Links fetch their page title and readable text on save, so a URL is findable by its contents too.",
    },
    {
      title: "Inline capture, no modals",
      description:
        "Every section adds inline — one field, Enter, done. Adding a to-do keeps the field open because entering several in a row is the common case. The full Capture modal with AI classification remains in the header for when you want something filed automatically.",
    },
    {
      title: "Folder identity: icon and description",
      description:
        "Folders carry a chosen icon (12 options) and an optional one-line description, both set in the create/edit dialog. Without them a home grid of twelve folders is twelve identical rectangles. Sub-folder tiles use the same icon.",
    },
    {
      title: "Stable, non-clustering tile colours",
      description:
        "Six hues hashed from folder id so a folder keeps its colour across sessions, then a pass nudges any tile that matches its left or upper neighbour. A pure hash produced three golds in a row; this keeps stability and visual variety at once.",
    },
    {
      title: "Credential isolation from the agent",
      description:
        "retrieveForQuestion filters out credential items entirely, so a saved login's title and username never reach the AI Gateway just because a question matched them. Invisible in the UI and easy to undo accidentally — a redesign must keep it.",
    },
    {
      title: "Offline-first fallbacks",
      description:
        "With no AI key the app still captures, files, searches and answers — retrieval is local and extractive, and simple commands like 'create a folder called Archive / 2026' still parse into a confirmable action. The chat footer states when an answer was produced offline.",
    },
    {
      title: "Google Drive pick-and-import",
      description:
        "Uses Google Identity Services with the narrow drive.file scope plus the Picker API, so you hand-select exactly which files enter — no broad scopes, no background sync. Imported files land in Links & Resources for the agent to organise. Shows a setup note instead of a broken button when unconfigured.",
    },
    {
      title: "In-app dialogs over browser prompts",
      description:
        "Folder naming uses a styled dialog that also collects description and icon. window.prompt() renders as browser chrome that ignores the design and blocks the main thread — unacceptable in the app's most-used interaction.",
    },
  ];

  const mk = (
    list: { title: string; description: string }[],
    group: "core" | "supporting",
  ): Feature[] =>
    list.map((f) => ({
      id: uid("feat"),
      project_id: projectId,
      title: f.title,
      description: f.description,
      group,
      created_at: ts,
    }));

  return [...mk(core, "core"), ...mk(supporting, "supporting")];
}

export function recallVersions(projectId: string): Version[] {
  const ts = nowIso();
  const v = (number: string, summary: string): Version => ({
    id: uid("ver"),
    project_id: projectId,
    number,
    summary,
    created_at: ts,
    files: [],
  });

  return [
    v(
      "v0.1 — Original build",
      "Sidebar folder tree + centred card grid, capture-with-AI-classification, hybrid search, floating agent bubble, Drive import. Seeded with demo content (game engines, video models, a pasta recipe, a restaurant). Worked, but the layout was generic: a max-w cap next to a sidebar left a dead gutter on wide screens, a 15-pill tag rail ate the fold, every item opened as a black-overlay modal, and note/link/password would all have rendered identically.",
    ),
    v(
      "v0.2 — Folder-as-page rebuild",
      "Rebuilt around a reference app the user liked: a folder became a page holding typed sections (sub-folders as tiles, notes, to-dos, links, logins) instead of a filter over a card grid. Sidebar demoted to a header toggle; modals replaced by inline editing. Added the encrypted vault (AES-GCM + PBKDF2) and structured Server/Site records. Fixed a self-inflicted bug where clicking + on an empty section did nothing because the body never rendered.",
    ),
    v(
      "v0.3 — Real RAG, and Websites",
      "Servers & Sites collapsed into one Website record with a migration. Seed content removed so first run is empty. Links & Resources gained file upload with genuine extraction — pdf-parse, mammoth, and a vision model for images — with blobs moved to IndexedDB because localStorage's ~5MB cap would break on the first photo. Search began indexing extracted text ('in contents' badge). Agent grew from 5 to 13 actions with a Plan/confirm panel and red confirmation on destructive ones. Fixed a setState-during-render in the vault and a hydration mismatch on the lock button.",
    ),
    v(
      "v0.4 — Folders-only home",
      "Root view became a dedicated grid of large folder tiles and nothing else — sections only appear once you are inside a folder. Folders gained an icon and a one-line description so a grid of twelve is readable. Tile colours got an anti-clustering pass after a pure hash produced three golds in a row. An Unfiled tile appears only when items sit outside every folder.",
    ),
    v(
      "v0.5 — Opt-in sections",
      "A new folder now starts with no sections at all: one + Add section menu listing the six types with descriptions. Sections can be removed while empty. Two invariants keep this safe — a section holding items always renders, and a non-empty section cannot be removed — which also migrated existing folders for free to showing only what they actually hold.",
    ),
  ];
}

export function recallKnowledge(projectId: string): KnowledgeEntry[] {
  const ts = nowIso();
  const k = (
    kind: KnowledgeEntry["kind"],
    title: string,
    content: string,
  ): KnowledgeEntry => ({
    id: uid("kn"),
    project_id: projectId,
    kind,
    title,
    content,
    created_at: ts,
  });

  return [
    k(
      "dev_update",
      "The reference that set the design",
      `The whole layout came from a screenshot of an existing app the user had built elsewhere ("golden-print-flow" on Lovable). What it communicated instantly:

· Opening a folder shows a page with typed sections stacked inside: Sub-Folders, Notes & Ideas, To-Do List, Links & Resources, Logins & Passwords.
· Each section is one quiet header row with a + when empty, so a folder with six sections still reads as minimal.
· Sub-folders are tiles INSIDE the folder — adding twenty costs no sidebar.
· A security notice sits above saved passwords ("encrypted for convenience only; use a dedicated manager for sensitive accounts").
· Clicking a sub-folder opens the same page again, recursively.

A second screenshot showed the home page: a search bar over a grid of large pastel folder tiles with icons and descriptions, and pagination. That drove the folders-only home.

Lesson worth keeping: three named design directions in prose ("Ops Console / Command Deck / Constellation") communicated less than one screenshot. When the user cannot picture an option, the option is not real. Show, don't name.`,
    ),
    k(
      "feature_request",
      "The user's own words, in order",
      `The requirements as actually stated across the session, kept verbatim because the phrasing carries intent:

1. "i really need to get that how i like it .. i need this to be very organized" — plus a new VPS and a website whose logins needed keeping.
2. "i dont like the layout design" — the trigger for the rebuild.
3. "i could easily add subfolders without it taking up any extra space. so i still looks minimal" — the tile-grid requirement.
4. "i definetly want a search bar still that can filter and search all info" — one box over everything, non-negotiable.
5. "i wiill need a ai super rag agent help find information for me. it can merge edit, move. etc. .it will have a confirmation of the tasks that it will do so it doesnt mess anything up" — the confirm-before-act contract.
6. "all of these except video can be read and remembered. thats why this is vwery important rag. it doesnt have to try to rememeber everything if it organizes correct."
7. "u can remove the sites and servers tab. u can add a 'websites' tab instead."
8. "the first folder should be empty. users can create there own."
9. "the homepage should look like folders and u have to click it to see the content inside"
10. "i dont like how it has all of the sections already open in a sub folder... maybe click 1 plus and a dropdown menu appears of sections"

Note the direction of travel: every single piece of feedback pushed toward LESS on screen by default, with more available on demand. That is the app's design principle, derived rather than declared.`,
    ),
    k(
      "documentation",
      "Vault cryptography — exact parameters",
      `src/lib/recall/vault.ts. Do not change these casually.

· PBKDF2-SHA256, 310,000 iterations, 16-byte random salt (per device)
· AES-GCM 256, fresh 12-byte IV per secret
· Stored shape: { iv: base64, ct: base64 } — nothing else
· A "verifier" (known plaintext "recall-vault-ok", encrypted at setup) proves the password on unlock
· Derived key held in a module-level variable; never persisted, never logged
· Dropped on: explicit lock, 5-minute idle, page reload
· copyEphemeral() clears the clipboard after 30s, but only if it still holds what we put there

Design constraints that came out of implementation:

· isUnlocked() MUST stay pure — it is called during render. An earlier version auto-locked a stale key inside it, which fired subscribers and caused a React "setState during render" error. Stale-key clearing lives in enforceIdleLock(), called from a timer or event handler only.
· useVault() must report "no vault" until mounted. vaultExists() reads localStorage, which the server cannot see; disagreeing on the first client render is a hydration mismatch.
· changeMasterPassword() re-keys every stored ciphertext in one pass and rewrites the salt + verifier.

Honest limitation stated in the UI: this protects saved passwords from anyone reading the stored JSON. It cannot protect against malicious script on this origin while the vault is unlocked.`,
    ),
    k(
      "documentation",
      "Storage layout and the IndexedDB decision",
      `Three stores, deliberately separated:

· localStorage "recall:v1" — folders and items, including extracted text and small thumbnails
· localStorage "recall:vault:v1" — vault salt + verifier
· IndexedDB "recall-files" / object store "blobs" — actual file bytes, keyed by attachment.fileId

Why the split: localStorage caps around 5MB across the whole origin. Storing a PDF or a phone photo as a data URL would blow that on the first upload and take the entire app's data with it. IndexedDB gives hundreds of MB and hands back real Blobs for preview and download.

What stays small on purpose:
· thumbnail() downscales images to max 320px, JPEG quality 0.7 — this is the only image data in localStorage
· extracted text capped at 40,000 characters
· per-file ceiling 100MB

pruneOrphans() runs on app load with the set of referenced fileIds and deletes any blob nothing points at — needed because the agent and folder deletion can remove items without going through the file-delete path.

Verified: after uploading a PDF, localStorage contained no "%PDF" bytes and the blob key was present in IndexedDB.`,
    ),
    k(
      "documentation",
      "Extraction pipeline and what is deliberately NOT read",
      `POST /api/recall/extract (multipart form: file, category), runtime nodejs.

· PDF → pdf-parse v2: new PDFParse({ data: Uint8Array }).getText(), then destroy()
· .docx → mammoth.extractRawText with a Buffer
· .txt .md .csv .json .log → read in the browser via FileReader, no server round trip
· images → AI Gateway chat completion with an image_url content part; system prompt asks for a 1-3 sentence description followed by a verbatim transcription of all legible text under a "Text:" heading (screenshots of dashboards and error messages are the main use case)
· video → returns { text: "", status: "unsupported" } immediately; the client does not even send it

The route ALWAYS returns 200 with a status field. A failed read must degrade to "stored but not read", never fail the upload — losing the file because the parser choked would be the worst outcome.

Statuses surface on the row as: read / reading… / not read / could not read.

Verified with a hand-built PDF containing "PINEAPPLE-TROMBONE-42", a string existing nowhere but inside the file. Search found it and badged the row "in contents"; the offline agent quoted it back. This was the acceptance test for "it is a real RAG".`,
    ),
    k(
      "documentation",
      "Agent action vocabulary and the confirmation contract",
      `13 actions: create_folder, move_item, move_items, add_tags, remove_tags, create_note, rename_item, edit_note, rename_folder, move_folder, merge_folders, delete_item, delete_folder.

DESTRUCTIVE_ACTIONS = { delete_item, delete_folder, merge_folders, edit_note }. These render with a red dot, a red "Confirm" button (not "Apply"), and a caveat line — e.g. "The folder goes; everything inside moves up to its parent."

UI contract:
· Panel titled "Proposed change" (1) or "Plan · N changes"
· Apply all / Dismiss all, plus per-action Apply / No
· Applied actions strike through and show "Done"
· applyAll runs in order so each step sees the previous step's result

Prompt contract (server): "EVERY action is shown to the user for explicit confirmation before it runs — never state that you have already done it; say what you are proposing." Also: "Prefer the fewest, largest actions: use move_items for a batch rather than many move_item." And: "Only propose deletions when the user clearly asked for them."

Non-destructive by construction: deleteFolder lifts child folders and items to the parent rather than removing them. mergeFolders moves contents across and then removes the empty source. Neither can lose an item.

The agent receives folder ids alongside paths so it can target rename/move/merge/delete precisely rather than guessing by name.`,
    ),
    k(
      "note",
      "Invariants a redesign must not break",
      `Eight things that are load-bearing and easy to destroy while "improving" the UI:

1. A folder is a page — sub-folders as tiles inside it, recursive, breadcrumb navigation.
2. Home shows folders only.
3. Sections are opt-in AND: content forces a section visible; a non-empty section cannot be removed.
4. File blobs live in IndexedDB, never localStorage.
5. Extracted text feeds the search index; video is honestly labelled not-read rather than silently empty.
6. Every agent mutation is confirmed before it runs; destructive ones look different.
7. Credentials never enter the agent's candidate set (retrieveForQuestion filters kind !== "credential").
8. Only the password is encrypted, there is no recovery, and the UI says so plainly.

Items 3 and 7 are the ones most likely to be lost in a rewrite, because neither is visible in a screenshot.`,
    ),
    k(
      "bug_report",
      "Three bugs found and fixed",
      `1. Empty-section add was dead. Clicking + on an empty section set the "adding" flag, but Section rendered its empty HINT instead of its body, so the inline form had nowhere to appear and nothing happened. Fixed with a bodyOverride prop. Worth noting because the same shape of bug recurs whenever a component decides between "empty state" and "children" — the mid-add case is a third state.

2. setState during render. vault.isUnlocked() auto-locked a stale key inside a render pass, firing subscribers and setting state on other components. Split into pure isUnlocked() and side-effecting enforceIdleLock().

3. Hydration mismatch on the vault lock button. vaultExists() reads localStorage; the server cannot, so server and first client render disagreed on which button to draw. useVault now returns exists:false until mounted.

All three were caught by reading the browser console rather than by looking at the page — the UI appeared to work in every case.`,
    ),
    k(
      "dev_update",
      "Dev environment gotcha: .next corruption on restart",
      `Stopping and restarting the Next dev server repeatedly corrupts .next, after which the server reports "started successfully" but never binds — every request returns connection refused, with no useful error in the logs.

Fix: rm -rf .next, then start again. Hit twice during this build.

Related, previously recorded: running two dev servers against the same .next causes the same class of failure (EINVAL readlink, blanket 500s). Use NEXT_DIST_DIR to run a second server safely.`,
    ),
    k(
      "idea",
      "Known gaps and what is unverified",
      `Honest state at the end of the build:

· AI-driven multi-step plans are typechecked and the confirmation UI is verified end-to-end, but only via the offline heuristic path (which produces a single create_folder action). A real model producing, say, a five-step merge-and-move plan has NOT been observed. Needs AI_GATEWAY_API_KEY.
· Image reading is implemented but unverified for the same reason — no key present locally.
· Google Drive import is wired but needs NEXT_PUBLIC_GOOGLE_CLIENT_ID and NEXT_PUBLIC_GOOGLE_API_KEY.
· Recall is still local-only (isLocal() returns true unconditionally). The folder+item shape was designed to map onto Supabase + pgvector later without touching the UI, but that backend does not exist yet.
· Search is keyword/field scoring, not embeddings. It is called "hybrid" in older copy; that is aspirational for now.
· No pagination on the home grid. The reference app had it; with a realistic number of top-level folders it has not been needed.

None of this was committed to git during the build — 27 files changed or added, still in the working tree.`,
    ),
  ];
}
