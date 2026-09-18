# aios/ — the owner's AI OS context

This is the **Context** layer of the AIS-OS structure (github.com/nateherkai/AIS-OS, MIT).
Claude reads these files to know who the owner is before answering anything about them.

| File | What's in it | Source of truth |
|---|---|---|
| `context/about-me.md` | Who they are, what eats their week | New Dashboard → Export |
| `context/about-business.md` | What they build, where money lands | New Dashboard → Export |
| `context/priorities.md` | 90-day priorities | New Dashboard → Export |
| `references/voice.md` | Two pasted writing samples | New Dashboard → Export |
| `connections.md` | Every system the AI OS can reach | New Dashboard → Export |
| `decisions/log.md` | Append-only decisions and why | Append here directly, or log in the dashboard and re-export |
| `references/3ms-framework.md` | The Three Ms framework (read-only) | AIS-OS kit |

**Refreshing:** edit in the New Dashboard app (`/apps/new-dashboard`), then Export → "All files",
and ask Claude: *"install my New Dashboard export into aios/"* (the `ai-os-dashboard` skill does it).

Files marked **DRAFT** below were written by Claude from what it knew before onboarding. Replace
them by finishing onboarding in the app and exporting.
