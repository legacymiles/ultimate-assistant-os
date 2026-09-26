import type { Feature, KnowledgeEntry, Version } from "../types";
import { uid, nowIso } from "../utils";

// ---------------------------------------------------------------------------
// Rich seed content for Cook Connect.
//
// This file exists because of a specific failure: Cook Connect was built as a
// merge of two existing apps, and the agent doing the merging had no record of
// what had already been asked for, so it shipped without features Cookbook
// Genie had had for months. Projects Timeline is meant to be that record.
//
// So this is written for the next agent, not for a reader. Every decision the
// owner made out loud, every thing they rejected, and every feature that has
// to survive a rewrite is written down, because none of it is visible in the
// finished UI.
// ---------------------------------------------------------------------------

export function cookConnectDetailed(): string {
  return `Cook Connect is **Cookbook Genie and Pod Play Connect merged into one app** at \`/apps/cook-connect\`: a place where a person's cookbooks and their game record are the same profile. You publish and save cookbooks, search a directory of cooks, and challenge any of them to spades or chess without leaving the page.

Source lives in \`src/components/cook-connect/\` and \`src/lib/cook-connect/\`, with routes under \`src/app/api/cook-connect/\` and two migrations in \`supabase/migrations/\`.

---

## 1. The two apps it replaces, and the rule about them

- **Cookbook Genie** — the AI cookbook app. Removed from the hub on 26 Sep 2026, once the merge had proved itself.
- **Pod Play Connect** (\`/pod-play-connect\`) — the Vite SPA with spades, chess, chat and video.

**Neither could be deleted until the owner said so.** That was lifted for Cookbook Genie on 26 Sep 2026 — it is off the hub and its pages are deleted. Pod Play Connect came off the hub the same day: its catalog entry is gone, so it has no tile and no detail page, but the app itself still runs at \`/pod-play-connect\` on its own bundle and its own \`pod\` data — ask before deleting those.

---

## 2. Four decisions the owner made up front

These were asked as direct questions before any code was written, and each one changes the build:

1. **Port the games natively.** Not an iframe of the Vite bundle — the game code was rewritten into hub components so there is one login and one profile.
2. **Its own \`cook\` schema, starting empty.** No import from either source app. The hub owns \`public\`, Pod Play owns \`pod\`, Cook Connect owns \`cook\`.
3. **Players ranked on wins and win rate, not Elo**, with a minimum-games qualifier.
4. **Carry over text chat, WebRTC video and computer opponents. Not groups/pods.**

---

## 3. "Start empty" means empty

The first build seeded six demo members so the feed and leaderboards had something in them. **The owner rejected this**: *"theres a lot of stuff on the cookbooks page, i didnt enter it should be empty until i put something there."*

There is now **no seeding of any kind**, in either backend. \`local/provision()\` creates a profile and nothing else. Every empty state has to teach the screen instead, because an empty app is the normal first experience.

---

## 4. The tabs, and why they are these tabs

\`Play · Explore · Cookbooks · Journal · Boards\`, with Play as home.

- **Play** — the lobby *and* the activity feed. The feed used to be its own tab; the owner asked for it to be folded into Play, because what people are cooking and who is at a table are one glance.
- **Explore** — was called "People". Renamed on the owner's instruction. It is where you find who is online, search everyone, look through somebody's cookbooks **without leaving the row**, and invite them to a game.
- **Cookbooks** — yours, everyone's, saved, and a way through to what has been shared with you.
- **Journal** — the food journal, which feeds the city restaurant board.
- **Boards** — players, cookbooks, and restaurants by city.

---

## 5. An invite is a table plus a message

Opening a table and hoping somebody notices it in the lobby is not an invitation. \`ExploreView.invite()\` creates the match **and** writes a line into that person's direct messages naming the game. This is deliberate; do not reduce it back to just creating a table.

---

## 6. The two leaderboards

**Players** — \`src/lib/cook-connect/stats.ts\`, 18 tests. Ranked on win rate, wins breaking a tie. A record is *provisional* until \`QUALIFYING_GAMES\` (5) and sorts below every qualified player, so a 3–0 newcomer cannot top a 40–25 season. Draws count as half a win. Computed from the match record, never a stored tally.

**Cookbooks** — ranked by saves, ties broken by the deeper cookbook.

**Restaurants by city** — \`journal.ts\`, aggregated across everybody's journals. Places are matched on a normalised name inside a normalised city, with apostrophes *dropped rather than treated as separators* so "Katz's" and "Katzs" are one place. One person is one fan however many times they log it.

---

## 7. The games

Ported from \`C:\\Users\\honey\\OneDrive\\Desktop\\pod-play-connect\` and rewritten onto hub tokens and the \`cook\` schema.

- **Spades** — full rules including nil, bags and the ten-bag penalty; 30 tests. Computer players fill empty seats and take over anyone who leaves.
- **Chess** — alpha-beta with piece-square tables, quiescence and iterative deepening, in a worker with a main-thread fallback. **The board is authored here** (\`play/ChessBoard.tsx\`) rather than using \`react-chessboard\`.
- Both rooms carry text chat and the WebRTC video mesh.

---

## 8. Offline

With no keys the whole app runs on a localStorage backend in \`lib/cook-connect/local/\`, whose realtime shim rides a **BroadcastChannel** — so two tabs of the same browser genuinely play each other. It is an empty app, not a populated one.`;
}

export function cookConnectFeatures(projectId: string): Feature[] {
  const ts = nowIso();
  const feature = (title: string, description: string, group: Feature["group"] = "core"): Feature => ({
    id: uid("feat"),
    project_id: projectId,
    title,
    description,
    group,
    created_at: ts,
  });

  return [
    feature(
      "Add a recipe from a video link",
      "Paste a TikTok, Instagram or YouTube cooking video and it is watched — visuals, speech and "
      + "on-screen text — then written up as a recipe. Falls back to an uploaded video (20 MB) or a "
      + "pasted caption when a post is login-walled. Reuses /api/cookbook/import-from-link. This was "
      + "MISSING from the first Cook Connect build and the owner had to ask for it; it is not optional.",
    ),
    feature(
      "Describe a dish and get a recipe",
      "The other half of the add-recipe screen. One sentence in, a full editable recipe out, via "
      + "/api/cook-connect/recipe. Works with no AI key through a heuristic template.",
    ),
    feature(
      "Edit any saved recipe in words",
      "\"Make it vegan. Double it. Cut the cooking time.\" Rewrites the stored recipe in place. The "
      + "photo is only regenerated when the title actually changed, so a timing tweak does not cost "
      + "a new image.",
    ),
    feature(
      "Auto-tagging",
      "Protein, meal type and cuisine are classified from the recipe rather than typed, via "
      + "/api/cookbook/auto-tag-recipe, and merged into the single tags array Cook Connect stores.",
    ),
    feature(
      "Explore: find, search, invite",
      "Who is online, a search over name / handle / city / bio, each person's cookbooks openable "
      + "inline, and an invite that creates the table AND messages them.",
    ),
    feature(
      "Spades",
      "Four seats in two partnerships. Bidding including nil, follow-suit enforcement with illegal "
      + "cards dimmed, bags, the ten-bag penalty, rematch votes. Computer players fill empty seats.",
    ),
    feature(
      "Chess",
      "Authored board with click-to-move, legal-move dots, last-move and check highlighting, and a "
      + "promotion picker. Alpha-beta engine at three strengths. Resign and draw offers.",
    ),
    feature(
      "Table chat and video",
      "Every room carries text chat and a WebRTC video mesh signalled over the realtime channel. "
      + "Rooms are plain strings: lounge, match:<id>, dm:<a>:<b>.",
    ),
    feature(
      "Two player leaderboards and a cookbook one",
      "Wins and win rate with a five-game qualifier; cookbooks by saves. Both computed from the "
      + "record rather than stored.",
    ),
    feature(
      "Food journal and the city restaurant board",
      "Cities, restaurants and dishes. Cities and restaurants are world-readable so the city board "
      + "can be built from everyone's entries; dishes are private to whoever logged them.",
    ),
    feature(
      "Share a cookbook by link",
      "Distinct from saving. A link lets one named person into a cookbook even when it is private; "
      + "the first person to open it claims it and it stops working for anyone else.",
    ),
    feature(
      "Groups and group chat",
      "Interest groups carried over from Pod Play Connect, with the cooking slant: join a group and "
      + "its chat and video room open. Only members can read or post, enforced by RLS through "
      + "cook.is_group_member, not just by the screen. Member counts are derived, not stored.",
    ),
    feature(
      "Works with no keys",
      "localStorage backend with a BroadcastChannel realtime shim, so two tabs can play each other "
      + "offline. Starts empty, like the real thing.",
    ),
  ];
}

export function cookConnectVersions(projectId: string): Version[] {
  const ts = nowIso();
  const version = (number: string, summary: string): Version => ({
    id: uid("ver"),
    project_id: projectId,
    number,
    summary,
    created_at: ts,
    files: [],
  });

  return [
    version(
      "0.1 — the merge",
      "Built from four answered questions: port the games natively rather than iframing the Vite "
      + "bundle; own `cook` schema starting empty; wins-and-win-rate ranking with a minimum-games "
      + "qualifier; carry chat, video and bots but not groups. Five tabs: Feed, People, Cookbooks, "
      + "Play, Boards. Shipped with 48 tests and verified by playing a real hand and a real game.",
    ),
    version(
      "0.1.1 — three bugs found while verifying",
      "Nested <button> causing a hydration error in the lobby. An empty chess move list, because a "
      + "board rebuilt from a FEN has no history — it has to come from the PGN. And the significant "
      + "one: useChess cancelled the engine's reply on every re-render, so the computer moved once "
      + "and then went silent forever. Staleness is now decided by the board, not by effect identity.",
    ),
    version(
      "0.2 — what the first build missed",
      "The owner's review: the app was missing a lot of Cookbook Genie, and the record of what had "
      + "been asked for was supposed to be in Projects Timeline. Added: add-by-link import, AI "
      + "editing of saved recipes, auto-tagging, the food journal with the city restaurant board, "
      + "and cookbook sharing. The add-recipe screen was rebuilt on Cookbook Genie's shape (two "
      + "modes across the top, the draft as a readable recipe, one box to change it in words) "
      + "because the owner did not like the form-first version. Feed folded into Play; People "
      + "renamed Explore and given inline cookbooks and real invites. All demo seeding removed. "
      + "Added to the Jarvis Studio plugin allowlist. This file written so the gap cannot recur.",
    ),
  ];
}

export function cookConnectKnowledge(projectId: string): KnowledgeEntry[] {
  const ts = nowIso();
  const entry = (kind: KnowledgeEntry["kind"], title: string, content: string): KnowledgeEntry => ({
    id: uid("know"),
    project_id: projectId,
    kind,
    title,
    content,
    created_at: ts,
  });

  return [
    entry(
      "documentation",
      "Both source apps are off the hub; Pod Play Connect's data stays",
      `The owner's words: "dont delete the 2 apps until i like the merge and say delete the other 2."

That day came on 26 Sep 2026: Cookbook Genie was taken off the hub and its pages deleted, and the
Dashboard's photo-to-recipe destination now files into Cook Connect instead. Pod Play Connect left the
hub later the same day — no tile, no detail page — but only the catalog entry went. The bundle in
public/, the rewrite that serves it and the \`pod\` schema behind it are untouched, so /pod-play-connect
still runs for anyone holding the link. Ask before deleting those.`,
    ),
    entry(
      "documentation",
      "Start empty means empty — no demo seed",
      `The first build seeded six demo cooks so the feed and boards had content. The owner rejected it:

  "theres a lot of stuff on the cookbooks page, i didnt enter it should be empty until i put
   something there"

All seeding is gone, in both backends. If you are tempted to add sample data back so a screen looks
better in a screenshot: don't. Write a better empty state instead.`,
    ),
    entry(
      "documentation",
      "Ranking is wins and win rate, not Elo",
      `Asked and answered directly. The qualifier is the point: QUALIFYING_GAMES = 5, and anyone below
it sorts under every qualified player and is labelled provisional, so a 3-0 newcomer cannot top a
40-25 season. Draws count as half a win.

Rejected: Elo per game, and season points that reset. Do not "improve" this into a rating system.`,
    ),
    entry(
      "documentation",
      "The add-recipe screen follows Cookbook Genie, not a form",
      `The owner said plainly: "i dont likt the ui when adding a recipe."

The shape that was accepted is Cookbook Genie's: two modes across the top (From a video link /
Describe it), then the draft rendered as a recipe you can read — Georgia serif title, ingredients
beside method — editable in place, with one box for changing it in words.

You are never handed an empty form to fill in. If a redesign starts with labelled input rows, it is
going the wrong way.`,
    ),
    entry(
      "documentation",
      "Feed lives on Play; People is called Explore",
      `Both on the owner's instruction:
  "u can add the 'feed' to the 'play' tab"
  "the 'people' tAb should e called explore this is where u fi nf ppl online, or just search and
   explore users. u can invite users to games, u can also look at there cook books"

So Explore has to do four things, not one: show who is online, search everyone, let you open a
person's cookbooks in place, and invite them to a game. The invite writes them a direct message —
opening a table and hoping is not an invitation.`,
    ),
    entry(
      "bug_report",
      "useChess cancelled the engine's reply on every render",
      `The computer played its first move and then never moved again.

The bot effect returned a cleanup that set \`cancelled = true\`. Playing a move calls setRow
optimistically, which re-runs the effect, whose cleanup cancels the in-flight engine promise — and
the new run bails out because lastBotFen already matches. The reply was thrown away every time.

Fixed by deleting the cleanup cancel and deciding staleness from the board instead: the move is
played only if \`rowRef.current.fen\` still equals the position the engine was asked about.

DO NOT reintroduce a cleanup-based cancel there. It looks like correct React and it silently breaks
the game.`,
    ),
    entry(
      "bug_report",
      "The optimistic row described two positions at once",
      `The optimistic setRow wrote a new fen but kept the old pgn. Any later move rebuilt the game
from that pgn and replayed to the wrong position. applyMove now reads a ref and writes fen and pgn
together, with a guard that reloads from the fen if the pgn has fallen behind.`,
    ),
    entry(
      "bug_report",
      "An empty chess move list",
      `game.history() returns nothing when the Chess object was built from a FEN — a position has no
past. The move list has to be replayed from the stored PGN.`,
    ),
    entry(
      "note",
      "The cook schema must be exposed in Supabase",
      `Same trap as the pod schema: add "cook" under Settings -> Data API -> Exposed schemas or
PostgREST answers every request with PGRST106. Two migrations:
  supabase/migrations/20260922000000_cook_connect.sql          (core)
  supabase/migrations/20260922120000_cook_connect_journal_and_shares.sql`,
    ),
    entry(
      "note",
      "The chess board is authored, not react-chessboard",
      `play/ChessBoard.tsx is an 8x8 grid with SVG pieces drawn to match the app's icon set. This is
deliberate: react-chessboard v4 renders NOTHING unless you measure the container and pass
boardWidth, and v5 changes the API. Authoring it removed the dependency and the trap, and let the
pieces share one construction language with the rest of the UI.`,
    ),
    entry(
      "note",
      "Restaurant name matching drops apostrophes",
      `"Katz's Delicatessen" and "katzs delicatessen" have to be one place. If apostrophes are turned
into separators the keys differ and the board splits the restaurant in two. journal.test.ts covers
this case specifically.`,
    ),
    entry(
      "note",
      "Routes that are reused rather than duplicated",
      `Cook Connect calls two of Cookbook Genie's API routes directly, because they are generic:
  /api/cookbook/import-from-link  — watches a video and writes a recipe
  /api/cookbook/auto-tag-recipe   — protein / meal / cuisine tags
Only /api/cook-connect/recipe is its own. If Cookbook Genie is ever deleted, those two routes have
to move, not go with it.`,
    ),
    entry(
      "note",
      "Sign in with Google",
      `Google is enabled on the hub's Supabase project (kiiwaiwrfslqankcsnkf) — confirmed by reading
/auth/v1/settings, which reports external.google = true. Cook Connect's Google button goes through
the hub's existing /auth/callback route with ?next=/apps/cook-connect.

History worth knowing: Google sign-in used to fail with "Unsupported provider: provider is not
enabled" because Pod Play Connect pointed at Lovable's Supabase project, which this account cannot
administer. That is fixed and unrelated to this app — but AuthView still special-cases that exact
error message, because it reads like a code bug and is not one.

The button is hidden behind a check in local mode: OAuth needs a real project.`,
    ),
    entry(
      "note",
      "PGRST106 hides whether the tables exist",
      `Running the migrations is only half of it. Until "cook" is added under Settings -> Data API ->
Exposed schemas, PostgREST answers EVERY request with PGRST106 before it looks at the tables — and
it does this for the service role too, so there is no way to confirm from outside whether the SQL
landed. The error text names the schemas that are exposed, which is the quickest diagnosis.

CookConnect.tsx now detects this on load and renders a "One step left" screen naming the exact
setting, because otherwise a correctly-installed app and a missing schema look identical: both are
an empty app.`,
    ),
    entry(
      "documentation",
      "Groups were excluded, then wanted",
      `In the first round the owner was asked directly whether to carry groups/pods across and did not
pick them. Later: "it should have spads, chess, video chat, group chat etc."

So groups came in on the third pass. Two things were deliberately NOT copied from Pod Play:
  - the emoji per group — Cook Connect draws its own icons and uses a stored hue instead
  - member_count as a column, incremented client-side. It drifts the moment a join half-fails.
    The count is read from cook.group_members on every load.

Group rooms are 'group:<id>' in the same messages table as the lounge, tables and DMs.`,
    ),
    entry(
      "bug_report",
      "An app that cannot reach its schema shows the sign-in screen forever",
      `Worth knowing because it looked like missing features. When Supabase is configured but "cook" is
not in the exposed schemas, the profiles query fails, ensureProfile returns without setting a
profile, and the render falls through to \`!userId || !profile\` — the sign-in screen. A signed-in
person sees a login form and concludes the app is empty or broken.

CookConnect.tsx now checks isSchemaMissing() on that query and renders the "One step left" screen
instead. If a future change makes the profile load fail for some other reason, make sure it fails
loudly rather than falling back to AuthView.`,
    ),
    entry(
      "note",
      "Why this file exists",
      `Cook Connect shipped its first version missing several Cookbook Genie features, because the
agent building it had no record of what had already been asked for. The owner's point:

  "thats what projects timeline is for, so the ai knows what i already prompted for what i do and
   dont want"

That record did not exist — only amhe and recall had seed-content files, and anything typed into
the Timeline app itself lives in the owner's browser where an agent cannot read it. So: if you
change this app, update this file in the same pass. It is the thing that stops the next rebuild
losing work again.`,
    ),
  ];
}
