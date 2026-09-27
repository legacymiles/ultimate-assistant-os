---
version: 1
slug: "src-components-new-jarvis-newjarvis-tsx"
primary_target: "src/components/new-jarvis/NewJarvis.tsx"
related_targets: ["src/app/apps/new-jarvis/page.tsx"]
---

Scope: New Jarvis, the assistant shell at /apps/new-jarvis. Visitor mode: Operate.
Audience: the repository's owner, alone, at speed, often hands-busy. Task: run a
whole day — ask, capture, delegate, watch an agent act on the real machine.
Constraints: the hub's incumbent dark world is fixed; existing Jarvis tabs mount
unchanged against the same stores; everything must stay usable with the local
bridge down. Unresolved: whether this eventually replaces /apps/jarvis.

## Direction contract

THESIS: Work accumulates instead of being replaced. Every request — typed,
spoken, or fired by a routine — becomes one addressable block owning its
verbatim input, live output, tool trace and re-run. It refuses the arrangement
Jarvis has now and that every assistant ships: a rail whose every click throws
the pane away, and a chat whose transcript flattens a six-step agent run into
one sentence saying "Done."

OWN-WORLD: The hub's own dark set, inherited whole — canvas #0a0b0f, panel
#12141c, elevated #1d212d, hairline #262a38, ink #e9ecf3 over muted #9aa3b5
over faint #6b7385. Restrained: indigo #6366f1 for the armed command line and
current selection only; green #22c55e up, amber waiting on you, red refused —
state, never decoration. JetBrains Mono carries every command, path, ref, count
and elapsed time; the system sans carries prose. Blocks are bordered strips on
canvas, no cards, no nesting, no shadow used as rank.

STORY: The owner sees a command line already listening and a right column
saying exactly what this machine can do right now. They believe the assistant
is connected to their actual computer because the bridge row names the
capability, not a status colour. They speak or type, watch the steps arrive,
and approve only the one step that cannot be undone.

FIRST VIEWPORT: 56px rail hard left, icons with a per-tab live dot. Centre
column from x=56 to x=-300: the command line pinned at the top at 44px, mono,
indigo hairline when armed, mode chips Ask/Do/Browse/Run on its left and a live
mic on its right. Beneath it, blocks newest-first, each a 1px-bordered strip —
the command in mono on the header row with elapsed ms right-aligned, then a
numbered step ledger filling downward as it runs, then the result inline at
full size: a real table, a browser frame, a diff, a confirm gate. Right column
300px, fixed, never scrolls away: a live waveform and wake state above a bridge
row that lists shell / files / system / browser each with its own dot and its
own reason when off. Signature interaction: a block writes itself as it runs —
each step appears already visible and settles, never fading in from nothing, so
a run reads as a ledger being kept rather than a spinner. Motion grammar: one
exponential ease-out, 160–220ms, on step arrival and block collapse; nothing
else moves.

FORM: Command Blocks — index 5 of my seven ranked structures (mission-control
triptych, dispatch board, split workbench, console ledger spine, command
blocks, dockable desk, drawer stack); the dice dealt 5, 7, 6 with 5 leading and
the owner locked it. Seed key cd3cd928, scope surface, mode operate. Code-led:
no image generation on this machine.

FINISH: unreviewed and undocumented is unfinished; this build ends with the
finish review, the verdict, DESIGN.md, and every shipping raster carrying its
provenance.
