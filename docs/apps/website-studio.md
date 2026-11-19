# Website Studio

Route: `/apps/website-studio` · Category: Websites · Live

Record reviewed: 2026-11-18

> **This file is the truth about this app.** Read it before changing the app and update it in the
> same commit. Everything above the "From the code" block is written by hand and kept; that block
> is rewritten from the code by `npm run apps:records`, and `npm run check:records` (part of
> `npm run verify`) fails when it is stale. Edit prompt: `npm run change-it -- website-studio "what to change"`.

## What it does

One place for every website: describe what you want and it is built, paste an address and it is redesigned without losing a single thing the site does, or open one you have already shipped and change it with the client who owns it. Underneath it is one super harness — Felix, the prompt enhancer, two stages of mockups (the main design, then the supporting pages as a prototype you can actually walk), the design skills you picked, Impeccable and a security check — and the first working site goes LIVE before Software Factory deepens it, so there is something to open in minutes rather than at the end. Every website you have is in one library with its screenshot, and opening any of them lands in the same workspace: the site full-screen, the assistant folded beside it, and every build, file change and version in one panel.

## Features

**Where you find it.** A panel on Jarvis's **Studio tab**, next to Image, Audio, Music Video,
Personas, Money Agent, Game and Trading Studio — not a card on App plugins. App Builder and Client
Review came off that page in the same edit (owner's call, 14 Nov 2026) and are reached through this
Studio; the panel names them as what moved in. Since 15 Nov 2026 their front doors REDIRECT here
(`src/lib/website-studio/redirects.ts`): `/apps/app-builder` (and `?p=<id>`, which opens that draft
here), `/apps/website-redesigner` (onto the start's "Redesign a website", address carried), and the
owner's bare `/apps/client-review` (and `?app=`). What deliberately does not move: App Builder framed
inside Jarvis chat's sheet (read from `Sec-Fetch-Dest: iframe`), the edit-mockup board, the
bake-off and the Showcase (`?section=redesign&v=edit|2|showcase`), `?classic=1`, every client link
`/apps/client-review?site=`, and Client Review's Ship console (`?tab=admin`).

**Everything the three old apps did, drawn here.** Starts, recordings and pictures, design
skills, Felix and the feature list, depth, Send to board, delete, both mockup stages, the build,
the edit look pass, versions with their pictures and Undo, changes, Mark ready, the client's link,
and the Ship console with Move into hub. App Builder's feature Orbit was left out on purpose (owner,
15 Nov 2026 — the feature table does the same job). One press away: the full build log
(`?p=<id>&classic=1`, linked from a draft's Build tab), the old console for the brief lane and
invites (linked at the foot of Ship), and the edit-mockup board, the bake-off and the Showcase
(**More tools** under the library).

**Versions — a picture of each one, and a real Undo.** Send photographs the page in the frame
before the edit is built (`beforeImage`), and once a version lands and the frame reloads on it, the
page is photographed again (`image`). Each version shows its picture (its own, else the next
version's before picture — `shotFor` in `src/lib/website-studio/undo.ts`). **Undo to vN** goes back
for real: the newer edits at the same address come off main and the site redeploys (about 3
minutes). The website asks GitHub to revert each one's pull request and merge the revert
(`revertPullRequests` in `src/lib/client-review/github.ts`, admin action `revert`), so it works with
the PC off; when GitHub can't (no `JARVIS_GITHUB_TOKEN`, or one without "Pull requests: read and
write"), the same undo goes to the PC as a quick thread (`startUndoBuild`). Versions that each have
their own address (branch previews) only move the client's link back, and say so. A finished build
now saves the pull request it ended on (`prUrl`, via the publish), which is what makes this
possible.

**Ship — the Ship console, as a tab.** On a live site, owner only: where it lives (live address,
GitHub repo and Vercel project — hidden for hub apps, which always build in the hub's repo), the
client link (copy, new link, release the claiming account), **Move into hub** for a site App Builder
built on its own folder and repo (the same pull-request move as App Builder, retire only after
typing its name), archive / unarchive, and delete (type the name). `ShipPanel.tsx`.

**Draft add-ons.** Under a draft's feature table: **Commercial foundation** (on by default for
anything with a second person or a server; untick for a one-screen tool) with **Charge for it (2x)**
under it — the same `depth` App Builder's brief reads, locked once the build has started. **Send to
board** files one Software Factory card per accepted feature in Backlog, never twice, with links to
the cards. **Delete** sits in the draft's header (asks first). A built standalone draft shows **Move
into hub** on its Build tab.

**Starting a website — one slab, two modes.**
- **Build from a prompt** — describe the site; reference pictures and screen recordings can be
  attached (up to 6, dropped on the slab or picked). It becomes an App Builder project in the same
  synced store, so `?p=<id>` opens it here or in App Builder.
- **Redesign a website** — paste an address and a note about what should change. The live site is
  read (`/api/redesign/scrape`) and everything it does today becomes must-keep features.
- **Web design skills** — a dropdown built from the real design-skill roster, so a skill installed
  tomorrow appears tomorrow. One look at a time (bases replace each other), craft passes and
  centrepieces stack, Impeccable always closes, and anything that spends money is flagged opt-in.
  The picks reach the build brief as `<design_skills>`, in run order.

**My websites.** One library from three sources, each website shown exactly once: client sites and
hub apps (their Client Review documents, read where they already live) and builds that have not
shipped yet. Thumbnail from the newest screenshot or a mockup lane, search by name / client /
address, filters (All · Client sites · My apps · Needs you · Drafts) with live counts, ordered by
what is waiting on the owner, then what is building, then most recent; apps never opened sink to
the bottom.

**One workspace for every website.** Full-screen canvas with the assistant folded on the LEFT —
`Ctrl+\` or the fold button maximises the page, and the choice is remembered per device. Desktop
/ phone (390px) widths, reload, open in a new tab, and the address always on screen.
- **Which model runs it** — the same `ModelPicker` the Jarvis chat and App Builder use: your Claude
  plan (Opus 5.5 / Opus 5 on the subscription), Claude through the API, the other LLMs, and a search
  of every OpenRouter model. On the home beside the Skills button, and in the side panel's compose
  bar on a draft and on a live site. It writes the one pick (`useChatModel`) that `autoBuild` and
  `useBuild` both read, so what you choose is what actually starts.
- **`/` lists the website design skills, and only those** — the design roster, in the Skills
  dropdown's own order (looks, craft passes, centrepieces, ways to start; `slashEntries` in
  `skills.ts`, menu `DesignSlash.tsx`), in the idea box on the home, in a draft's chat and in a
  live site's edit box. It used to list the first eight skills in the whole store. Picking one
  writes it into the words as a sentence the build agent acts on AND ticks it in the Skills menu.
  Client Review's owner box and the Redesigner bake-off use the same menu.
- **Quick edits** — an edit to a live site takes the quick lane by default
  (`src/lib/website-studio/lane.ts`, brief `quickEditPrompt` + `autoBuild.ts`): find the code,
  change it, typecheck — no skills pipeline, no full test suite or build, no waiting on CI, no PC
  re-check, and no Software Factory afterwards. "Make it blue" took 24 minutes on the full road.
  CI's full gate still runs on main after the merge and Vercel never promotes a failed build.
- **Look before it is committed** (owner, 15 Nov 2026) — a quick edit stops with nothing committed
  and says `READY: <what changed>`. The PC serves that build's own folder (`harness/preview`, from
  port 3290) and the canvas shows the change running there at once, tagged "not live yet", with a
  **Ready for you to look** card in the chat: **Ship it** says `<ship>` into the same thread (commit,
  pull request, merge, live in about 3 minutes), **Throw it away** stops it with nothing committed,
  and anything typed instead is more to change — it adjusts and shows it again. While any build
  runs, the chat box talks to the agent doing it ("stop", "don't commit", "make it darker"). A PC
  restart brings a waiting edit back to the same `READY:` point, never on to shipping
  (`build-jobs.mjs` `awaiting`).
- **Where the time went** — the purple Personas Studio edit made its change in about 2 minutes,
  then sat 17m 43s on an "Allow once" card: the gate read the chained `git commit -F - … && git
  push` as a force push (`-F` matched a case-insensitive `-f`). `pushIsGrave` now judges only the
  push itself, with `-f` case-sensitive.
- **Software Factory switch** — in the side panel of a live site, off by default ("off for
  edits"), remembered per site on this device. On puts the next edit on the full road and sends
  Software Factory after it is live; a new website's first build gets it as before.
- **A checklist of what Claude is doing** — in the chat while an edit builds, above the one live
  line ("Writing the code · …", "Deep diving for 40s …"): Claude's own task list (the PC helper relays TodoWrite / TaskCreate as `plan` events,
  `tools/jarvis-bridge/harness-plan.mjs`), otherwise the lane's own steps ticked off from the tools
  it ran, ending with "Live on the site".
- **Is the PC there** — the helper is probed on open and every 20s, and the answer is on screen
  BEFORE Send is pressed, with the one button that can fix it. A build that cannot start says so
  in the owner's language instead of looking like nothing happened.
- On a live site: **Chat** (the client's requests and notices, and — owner, 15 Nov 2026 — the
  build itself: checklist, live line, review card; there is no separate Build tab), **Changes**
  (`harness/diff` — the files being changed, with the diff), **Versions** (pictures, Undo, Mark
  ready), **Ship**.
- On a draft: **Chat**, **Features** (Felix's questions, then the feature table), **Pages**,
  **Build**. The panel follows the work — there is one thing to do at a time and it opens on it.

**Two stages of mockups.** Stage one is the three-direction bake-off: each direction is a real
page Claude writes in HTML and CSS from the spec (instant layout drawings stand in while it
writes). Stage two is new: the supporting pages as a prototype you can walk —
every screen drawn in the approved look, clickable links between them, loading / empty / success /
error states per screen, and Revise on any one screen without redrawing the others. A plan whose
links point nowhere, or that has a screen nothing can reach, cannot be approved.

**Feature ideas, for new builds and for edits.** A new website gets App Builder's full list —
Felix's questions, then 10-14 features to accept or deny on the draft's **Features** tab (the Orbit
is not drawn; the table does the same). An edit to a live site gets the same idea, sized for an
edit: as soon as the owner sends it, 3-5 ideas that belong WITH that change (carry it through to
related elements, phone layout, states, contrast, speed) appear in the side panel, each with **Add**
or **Skip** (`EditIdeas.tsx`; written by `/api/app-builder` action `editIdeas`, offline ideas from
`src/lib/website-studio/ideas.ts` with no AI key). The edit never waits for them — it is already
filed and the look pass is already being mocked up. Added ideas are folded into the same request's wording
(the owner's reword) so they are built in the same pass; once the build has started they go in as
**the next edit** instead. Nothing is added unless Add is pressed.

**Three mockups before an edit is built.** The owner's standing rule (10 Nov 2026) holds here:
Send files the request and opens **Look**, where the edit is mocked up three ways (`LookPass`, the
same one Client Review uses). **Coded mockups (owner's call, 18 Nov 2026 — replaced Flux 2: better
looking, more accurate, faster):** the page is photographed on the PC (headless Chrome — the
screenshot helper in `tools/wangp-image`, started by the page itself through the Jarvis helper when
it is off) and its markup is read (`/api/mockup/page`, or straight from the browser for a hub page);
then Claude recreates the page in HTML and CSS three times with only the change made — As asked,
Polished, Bold — all three at once, each landing in seconds. Claude on the owner's plan writes them
(`brain/claude` through the PC helper); the hub's AI (`/api/mockup/code`) only when the PC can't.
Each mockup names its own idea and reading in its `<head>`, which become the lane's label and what
the pick carries. Code: `src/lib/mockup/coded.ts` (prompts, sanitising — no scripts, handlers or
frames ever reach a screen), `useCodedMockups.ts` (writers, IndexedDB cache), `MockupBakeOff.tsx`.
The pick is saved on the project and is what starts the build — carried into the brief by
`pickedMockupLine`. The three mockups are saved to the link (sanitised again on the server) so the
client sees the same three pages. `Skip the mockups and build it as asked` is one press away, and a
site with no address yet skips straight to the build, because there is nothing to mock up. The rule
lives in `src/lib/website-studio/edits.ts`, not in the screen. Each card says what is happening
while it is written — "Recreating your page in HTML with the change made", a clock, a sweep. **Not
quite?** under the three takes a note ("a deeper purple, keep the white cards"): it is added to the
edit's wording, and Claude applies it to all three as a tweak; the build reads the same words.

**Ship first.** The approved routes go into the build brief as a specification, never as pictures.
The first working site goes live after a fast security check; the Studio then says the after-live
message into the same harness thread, which is what starts Software Factory and the deep security
scan. Sent once — the thread itself is the record, so a second device cannot send it again.

**Commercial and Commercial 2x on an edit.** Two switches sit under Software Factory in the chat
box, remembered per website on this device. Off (the default), an edit changes only what it asks
for. Commercial makes the same build also bring the whole site up to the `commercial` depth —
logins, profiles, admin, onboarding, legal pages, billing wired and off, still free; Commercial 2x
(only with Commercial on) switches the money on: pricing, paywalls, upgrade moments and a critic
panel to 9/10. A commercial edit always takes the full road, so the factory switch reads "on with
Commercial" while it is on. The brief carries a `<depth>` block (`editDepthBlock` in
`src/lib/app-builder/clientEdit.ts`); the quick lane never does.

**Change the mockups by talking to them.** While the three mockups wait for a pick, the chat box
at the bottom (button "Redo mockups") and the "Not quite?" box under the board both take a note on
them — "a darker purple, pink gradient buttons", "the bold one but keep the logo". The note is added
to the edit's wording (so the build reads it too), and Claude edits each of the three pages on
screen with it (a tweak on every lane, `revision` in `MockupBakeOff.tsx`) — on the owner's plan
first, the hub's AI when the PC can't. The whole request reaches the writer (6,000 characters), so
a note at the end of a long edit is never cut.

**Long prompts.** Every Jarvis chat box takes a prompt up to 100,000 characters — this chat box,
the steer box while a build runs, Client Review, App Builder, In Queue, the main chat and Enhance —
one number, `MAX_PROMPT_CHARS` in `src/lib/new-jarvis/promptLimit.ts`, read by the browser boxes
and the server alike. It used to be 2,000 here, and a pasted prompt was cut off without a word.

**No sign-in inside the frame.** A hub app is framed on the Studio's own address
(`frameAddress` in `src/lib/client-review/frame.ts`), whichever hub address the build reported —
`ultimate-assistant-os.vercel.app`, `bighomieai.com` or `www.` — so the owner's session is already
there and the frame never shows the login wall. When a frame does reach a sign-in (a client's
link, a signed-out device), Google opens in a small popup instead of inside the frame, where Google
refuses with a bare "403. That's an error."; the popup closes itself at `/auth/popup-done` and the
frame lands on the page it was on (`signInFromFrame` in `src/lib/auth/google.ts`). The hub login
now returns every visitor to the page the wall stood in front of (`/login?next=`).

## Must keep working

- Every existing Client Review website opens with its own id and link secret unchanged. Nothing was
  copied or migrated.
- The client's own address `/apps/client-review?site=<token>` still opens their site — it now mounts
  this workspace. Their push notifications, their home-screen app and the service worker are all
  scoped to that address and must stay there. `?classic=1` opens the old screen.
- A hub app opened for the first time still gets its project made (`ensureApp`).
- Send still files the request and still reaches a build on the PC, and a failed start still undoes
  its own approval. What changed (14 Nov 2026) is that the owner's Send stops at the look pass
  first — the pick, or Skip, is what approves and starts. A client's Send is unchanged.
- The model pick is the harness pick, not a second setting: anything that reads `readChatModel()`
  must keep seeing what this menu wrote.
- A finished build still publishes itself onto the version, and the owner still presses Mark ready
  before anything reaches a client. The `Preview:` link is the first word after the label, so a
  build that adds a sentence after it on the same line still publishes (the blue Baby No Scroll
  edit merged and went live but sat on "Building" because of exactly that).
- `/apps/app-builder?p=<id>` opens that draft here; inside Jarvis chat's sheet it stays App
  Builder, and `?classic=1` always does. The edit-mockup board link the `website-edit-mockups` skill
  hands out (`?section=redesign&v=edit…`) never redirects. All three old apps are in `MERGED_INTO`
  (pointing here), which takes their tiles away — it must not take their routes away.
- Nothing from a quick edit is committed until the owner presses Ship it (or types `<ship>`).
- A quick edit never stops to ask: a build lane deleting its own scratch files inside its worktree
  and Claude's `Monitor` tool pass the PC helper's gate (`harness-gate.mjs`); a delete that could
  reach outside it — `..`, absolute paths, `node_modules` (a junction into the main checkout),
  `.git`, a `cd` first — still asks.
- Edit ideas never hold an edit up and never add anything on their own: only Add changes the
  request, and only the accepted ones are in its wording.
- Undo never pretends: a newer version at the same address with no pull request on record blocks
  the undo with the reason; it never just flips the link. Reverts go newest first. `Undo to vN` is
  off while a build runs.
- Delete asks: a draft by confirm, a live website by typing its name. Deleting a website removes its
  requests, versions and link — never its code or the live site.
- A hub app in the frame never asks to sign in, and Google's sign-in never loads inside a frame:
  it always opens as a popup (or a tab when pop-ups are blocked) and the frame follows on its own.
- With Commercial off, an edit's brief has no `<depth>` block and the quick lane is unchanged.
  Commercial 2x can never be on without Commercial.
- A pasted prompt is never cut short below `MAX_PROMPT_CHARS`.
- A message typed while the mockups wait for a pick changes the mockups; it never files a second
  edit. Switching to the Chat tab is how a separate edit is sent.
- Offline: the whole page works with no keys and no PC. The pages plan is written with no model at
  all, and the look-mode mockups fall back to the instant layout drawings when Claude can't write.
- A mockup never runs a script: coded mockups are sanitised (`cleanMockupHtml`) before they are
  shown or saved, and the iframes are sandboxed without `allow-scripts`.

## Requested, not built yet

- Migration step 7 in `docs/superpowers/specs/website-studio.md` (deleting the old shells). What is
  still only on them: the full build log, Client Review's brief lane / brief model and invite email.
- `harness/preview` refuses a new-app project thread, so a draft has no local preview until it is
  deployed.
- Stage two can be written by a model or by a design engine (`FlowPlan.engine`); today it is the
  offline planner. Google Stitch was researched for this and left out on purpose — it is a
  quota-metered Google cloud service, its build half assumes Vite + React Router, and its output is
  static HTML with `href="#"` stubs.

<!-- code:start -->
## From the code

_Rewritten by `npm run apps:records` from the source — do not edit by hand. `npm run check:records` fails when it is out of date._

### Where it lives

- Page `/apps/website-studio` — owner's sign-in
- `src/components/website-studio/`
- `src/lib/website-studio/`

### Sign-in & who can use it

- _No sign-in code of its own; the hub middleware decides access (see routes below)._

### Server routes

- _None._

### Data & database rules

- _No database, storage or saved data of its own._

### Keys & outside services

- _None._

### Tests

- `src/lib/website-studio/edits.test.ts`
- `src/lib/website-studio/flows.test.ts`
- `src/lib/website-studio/ideas.test.ts`
- `src/lib/website-studio/lane.test.ts`
- `src/lib/website-studio/library.test.ts`
- `src/lib/website-studio/pipeline.test.ts`
- `src/lib/website-studio/redirects.test.ts`
- `src/lib/website-studio/skills.test.ts`
- `src/lib/website-studio/undo.test.ts`
<!-- code:end -->
