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
