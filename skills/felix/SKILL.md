---
name: felix
description: Ambitious, end-goal-first planning for anything worth doing well — building or improving an app, website, plugin or Jarvis itself, fixing something that keeps breaking, or any task where "ok" isn't good enough. Finds the goal beyond the goal, sets a pro-commercial bar (Felix Rieseberg's Altitude, Depth and Range, plus the website backend checklist), names an outside judge, then does the work or hands a sharp brief to the prompt-enhancer or super-board. Use when the user types /felix, says "be more ambitious", "aim higher", "what's the end goal", "make this pro", "Apple-level", "trillion-dollar", "self-improving", or starts building or improving an app, site or plugin.
license: MIT
metadata:
  author: legacymiles (built on RoboNuggets' be-ambitious, MIT)
  source: https://felixrieseberg.com/how-to-be-more-ambitious-a-tutorial-for-humans-with-models/
---

# Felix — know the end goal, then raise the bar

Named after Felix Rieseberg, who works on Claude at Anthropic and wrote *How to be more
ambitious: a tutorial for humans with models* (13 Oct 2026). The Altitude / Depth / Range
method and its rules are his; RoboNuggets turned them into the `be-ambitious` skill (MIT),
which this extends with an end-goal intake, a pro-commercial standard and hand-offs to the
owner's other skills.

Most requests arrive at the size they were typed. "Build me a to-do app" gets a to-do app.
Felix's point: the model can do far more when it knows what the work is *for* and is aimed
higher than feels reasonable — as long as something other than the model checks the result.

## The rules that matter most

1. **End goal before features.** Know why the thing exists and for whom before deciding what
   it has. Features are chosen *because of* the goal, never listed for their own sake.
2. **The user's features, the user's way.** What the user asked for is kept and shaped the way
   they described it. Felix raises the bar around it; it never quietly swaps the request for a
   different one. If the best move would replace what they asked for, ask first.
3. **Better, not bigger.** Raise the outcome (Altitude), the standard (Depth) or the set of
   perspectives (Range). A suggestion that makes the job larger without making it better is
   dropped.
4. **Do what the expert does, not how they talk.** Bring in a field's methods and tools, not
   its vocabulary. Talking like an Apple support lead is role play; running their checklist,
   their usability test and their crash triage is the job.
5. **An outside judge decides.** Never grade your own work. A test, a measurement, a
   Lighthouse run, a logged-error count, a real user completing the task — something other
   than you or the user says it worked. Every plan names its judge and what counts as a pass.
6. **Hard targets, honest reports.** Treat the ambitious target as reachable and keep going.
   Report against the judge with real numbers; a missed hard target reported honestly is a good
   result, a faked one is not.
7. **Get the access, don't fake it.** Name exactly which data, tool or connection is missing and
   what it would unlock. Never invent a source, result or measurement.

## Step 1 — The intake: what is this for?

Work these out first. For each, use what the request, the repo and memory already say; ask
only for what is genuinely missing **and** would change the plan.

| Question | Why it matters |
|---|---|
| **End goal** — what should be true for people once this exists? | Everything else is chosen to serve it |
| **Who it's for** — the owner, their clients, Jarvis users, the public? | Sets the bar for polish, onboarding and support |
| **What success looks like** — how would we *see* it worked? | Becomes the outside judge |
| **Must-have features**, the way the user described them | Kept as asked (rule 2) |
| **Look & feel** — any reference, mood or existing design system? | Avoids a generic default |
| **Data & backend** — accounts? payments? stores personal data? talks to other apps? | Pulls in the right checklist lines |
| **Off-limits** — budget, deadline, things not to touch | Ambition raises the standard, not the permissions |

- If a question tool is available (AskUserQuestion, or Jarvis's Goal check panel), ask up to
  four of these in **one** round, each with sensible options and a recommended one first.
- If the user isn't there, or the request is quick to redo, don't ask: take the most
  reasonable reading, write the assumptions at the top, and carry on.
- Never ask what the request already answers. Never ask more than once per task.

See `references/intake-questions.md` for the per-topic question sets (app, website, plugin,
fix, content) that Jarvis's UI uses.

## Step 2 — Pick the types of ambition that fit

| Type | Fits when | Skip when |
|---|---|---|
| **Altitude** — aim at the outcome | The task serves something beyond itself (people will hold meetings about it) | Creative work with no outcome beyond itself |
| **Depth** — work like the field's best | It should be done really well | Throwaway work |
| **Range** — bring in other fields | It has to land with people, or the obvious field is out of ideas | A narrow fix with one right answer |

Most tasks need one or two. Speed (same work, less time) needs no skill and is skipped.

### Altitude: the goal beyond the goal

Build a ladder of three rungs, each more ambitious. Felix's own example: he stopped asking
Claude to fix single crashes and asked it to keep the apps crash-free.

1. **Do it properly** — the request, done with a check that proves it.
2. **Fix the cause, not the instance** — every case of this kind, not just the one in front of you.
3. **Make it keep itself right** — a durable loop that takes the human out: logs, alerts,
   tickets, automatic re-checks. Name the setup this rung needs (crash reports, a version→commit
   map, a test device, a connector) as part of the plan.

If a rung has no outside judge, step down one rung.

### Depth: the pro-commercial standard

Go one level below the task, to the raw data, tools and problems, until even the best people
in the field could learn something. Run every Depth pass through Felix's prompt:

> I want a deeper version of this task, not a bigger one. Before rewriting it: (1) say what a
> top professional in this field would do here that I'm not asking for; (2) name the rawest
> material they would start from instead of what has already been digested for me; (3) name
> the specific methods and tools they would use; (4) say what, other than you or me, would show
> the result is right. Then rewrite my prompt to ask for exactly that.

For anything with a backend or users — an app, a website, a plugin, a client site — Depth
**always** includes `references/website-backend-checklist.md`: pick the lines that apply
(every **Must**, plus the **Should**s that fit), and put them in the plan as checks, not
aspirations. "Apple-grade" means: it never crashes on people, every error is logged and
explained in plain words, it works on a phone, and someone finds out before the customer does.

Set an unreasonable target and treat it as reasonable: the page loads in 8 s and they asked for
5 → aim for 1 s.

### Range: assemble the crew

- **Replace the nouns with verbs.** A client website isn't "a site"; it's "getting a stranger
  to trust a small business enough to call them, within ten seconds, on a phone". The verbs show
  which fields help.
- **Assemble the crew** that verb needs — e.g. a conversion copywriter, a UX researcher, a
  support lead who reads every complaint, a security reviewer, a performance engineer.
- **Borrow their tools**, and **do, don't play**: if subagents are available, give each field its
  own subagent with that field's method and tools.

## Step 3 — Output

Size the output to the task: a one-line request gets a few lines of plan. In this order:

1. **End goal** — one line. **Goal beyond the goal** — one line.
2. **Assumptions** you made instead of asking (if any).
3. **Types that fit**, one line each on why, plus the ones skipped.
4. **The plan**: Altitude ladder · Depth answers + hard target + checklist lines · Range crew.
5. **What it needs**: data, tools, access — marked *there* or *missing*.
6. **The brief**: one fenced block the user can copy, written the way they'd type it, ending
   with the outside judge and what counts as a pass.
7. **Next**: name the highest rung you can finish and check with the access you have now.
   For a prompt to improve, stop there. For a task to do, start. Ask first only when the rung
   replaces what was asked for, spends money, or can't be undone.

## Hand-offs (how Felix wires into the other skills)

- **prompt-enhancer** calls Felix as its first pass whenever the prompt is about building or
  improving something. Felix supplies the end goal, the bar and the judge; the enhancer turns
  them into the strongest prompt for the model that will run it.
- **super-board / software-factory**: when the plan is bigger than one sitting, turn the
  ladder into board tickets in super-board's ticket format — one card per PR under ~400 lines,
  each with 2–5 checkable Acceptance Criteria taken straight from the outside judges, a type
  label (`bug`/`feature`/`ux`/`tests`/`docs`/`tech-debt`), and the checklist line it closes
  (e.g. "closes R2"). New cards go to **Backlog**; the owner moves them to Ready. Never set a
  board to auto-merge: `human_approves_merge` stays `true` unless the owner says otherwise.
- **Jarvis self-improvement**: the standing goal beyond the goal for Jarvis and every site in
  the hub is *crash-free and getting better on its own* — errors are logged (Deck › Site
  errors), logged errors become Backlog cards, and the Improvements widget proposes the next
  rung. When working on any hub app, check it against the checklist and file what's missing.

## Example

`/felix build a booking app for my barber client`

- **End goal:** the barber's chairs stay full without him answering the phone mid-cut.
  **Beyond:** regulars rebook themselves and no-shows drop.
- **Assumptions:** one shop, one to three barbers, customers on phones, the barber manages it
  from his phone too.
- **Types:** Altitude, Depth, Range (it has to land with real customers).
- **Altitude:** (1) book a slot in under 30 s on a phone; (2) reminders + one-tap reschedule to
  cut no-shows; (3) a rebooking nudge timed to each customer's usual gap, with a weekly
  "chairs filled" report.
- **Depth:** start from his real week (when is he busy, when does he lose bookings). Checklist
  R1–R4, S1–S4, D1, P1, U1–U3, C1–C3. Hard target: booking in 3 taps, LCP under 1 s.
- **Range:** a front-desk receptionist (what customers actually ask), a conversion
  designer (the booking flow), an SMS deliverability engineer (reminders that arrive).
- **Judge:** five real customers book on their own phones without help; no-show rate measured
  for four weeks before and after; zero logged crashes in the first week.
