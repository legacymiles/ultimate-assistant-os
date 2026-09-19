# Decisions Log

Append-only. Capture the *why*, not just the *what*.

**Format:** `## YYYY-MM-DD — Title` then **Decision:** / **Why:** / **Alternatives considered:**

---

## 2026-09-18 — Organise the master folder as an AI OS (AIS-OS structure)

**Decision:** Add a root `CLAUDE.md` routing manual, an `aios/` context folder, and the New Dashboard
app as the editor for personal context. Save the AIS-OS repo at `C:\Users\honey\AIS-OS` and wrap it as
the `ai-os-dashboard` skill so other people can be onboarded the same way.

**Why:** Sessions were spending time re-finding which app lives where and what was decided. A routing
manual lets Claude go straight to the right folder; one editor + export avoids parallel sources of truth.

**Alternatives considered:** Cloning the whole kit into the repo root (would add `context/`, `.agents/`
etc. next to Next.js files and duplicate the memory system).

## 2026-09-18 — Music Classified Style Prompt: production only, ≤1,000 characters, 12-point gate

**Decision:** The Style Prompt mode (Music Classified's third tab) writes only how the song should sound
and be produced — no lyrics. The prompt has a hard 1,000-character ceiling, and every draft is checked
on 12 points (length, uses the space, sonic identity, drums + bass, melody, human vocal behaviour, vocal
production, arrangement movement, no filler, no artist/song names, instructions not a review, no lyrics).
Failing drafts go back to the AI for up to two rewrites; cutting text is only a last resort and is flagged.

**Why:** Generic AI prompts ("catchy, professional, modern") produce looping, robotic songs. Forcing
concrete production decisions — arrangement movement, human vocals, a sonic identity — into a fixed
budget makes every character count, and the open-source generator gets instructions it can act on.
Names are stripped because generators reject them and the goal is the idea, not a copy.

**Alternatives considered:** Generating lyrics in the same pass (kept out to keep the feature focused);
letting the model write long and truncating (loses the most important decisions at random).

## 2026-09-19 — Style prompts belong to every song, not a separate tab (supersedes the entry above)

**Decision:** Removed the Style Prompt tab. Every song filed in Music Classified now gets its own
style prompt automatically: at most 1,000 characters describing *that exact recording* as accurately
as possible (measured tempo and key used exactly), in words a song generator can follow. Same quality
gate (now 13 checks, incl. tempo & key; vocal checks skipped for instrumentals), no names, no lyrics.
Songs filed earlier get one the first time they're opened.

**Why:** People use the site to look up real songs they love. The job is to describe the song they
searched so a generator can reproduce its sound — not to invent a new song from a brief.

**Alternatives considered:** Keeping the brief-based tab alongside (rejected by the owner: wrong job).

## 2026-09-18 — AI switchboard with automatic fallback; per-game model choice in Game Creator

**Decision:** The hub's AI provider is chosen on the front page (AI pill next to V1/V2): Auto,
OpenRouter or Vercel AI Gateway. Every AI call goes through `aiFetch`, which retries on the other
provider when the chosen one is out of credit, rate-limited, down or rejects the key. The panel shows
credit left, last errors, builder health and missing keys, and a red strip appears when something is
broken. Game Creator gets a per-game Model dropdown: Claude models run on the Claude plan; GPT,
Gemini, Grok, Kimi, GLM and DeepSeek run Claude Code through OpenRouter. If the Claude plan fails on
the PC (limit, credit, logged out), the build retries once through OpenRouter with the same Claude model.

**Why:** One empty balance or expired key used to break apps silently, each in its own words. One
switch, one fallback path and one status panel make problems visible and keep the site working. The
model choice lets the owner try other LLMs on the builder without changing code.

**Alternatives considered:** A separate agent harness for non-Claude models (more work; Claude Code
through OpenRouter was verified to work); fallback per app (26 places to keep in sync). Caveat: the
gateway's free credit serves no Claude model, so falling back to it only helps non-Claude models until
it is topped up.

## 2026-09-18 — Smart Shot flow: brief → storyboard with AI director chat → play + download

**Decision:** Smart Shot Videos has three pages. Page 1 takes the prompt and images. Page 2 is the
editable shot-plan storyboard with a docked AI Director chat: the user says what to change, the
model returns the whole revised plan keeping the ids of what it left alone, and only panels whose
content changed are redrawn. The storyboard ends with "Edit with AI" and "Create video" (which
opens page 3 and starts the render). Page 3 is just the player, Download MP4 and Recreate; the
compiled H3 prompt and per-cut retakes are folded under "Advanced". A one-line prompt is expanded
into production detail by the planner LLM and compiled into the MiniMax H3 brief format by code.

**Why:** The owner wants users to review and re-edit the plan by talking to it, not by hand-editing
every field, and wants the video page to be simple. Redrawing only changed panels keeps a chat edit
at ~$0.04 per panel instead of ~$0.60 for a whole sheet.

**Alternatives considered:** A diff/patch format from the model (fragile); redrawing the whole
sheet after every chat turn (slow and costly).

## 2026-09-18 — One LLM picker for the whole site, with fallback models

**Decision:** The front-page AI panel's "Website AI" section now has a searchable Model dropdown
(OpenRouter's catalogue with prices and image support) and two fallback models. Every app call that
asks for the hub's general model (DEFAULT_MODEL, AI_MODEL, or any hard-coded Claude model) is sent
to the picked model, then to the fallbacks if it fails; requests with photos skip models that can't
see images. Specialist models (image painting, audio listening, web search, video) are not changed.
The default fallbacks are Gemini 3.8 Flash and GPT-5.6 Sol, so no app depends on Claude. The Game
Creator builder section is labelled as Game Creator only.

**Why:** The owner doesn't want any app to depend on one vendor, and wants to switch the whole site
to any LLM from one place.

**Alternatives considered:** A model setting per app (26 places to keep in sync); using OpenRouter's
native `models` array (does not work on the Vercel gateway).
