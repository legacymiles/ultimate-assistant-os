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
