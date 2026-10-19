# Felix intake — question sets by topic

Jarvis's **Goal check** panel (`src/lib/new-jarvis/felix.ts`) asks these when a chat prompt is
about building or fixing something. In Claude Code, ask them with AskUserQuestion: at most four
in one round, options first, recommended option first. Skip any the request already answers.

Every set starts with the end goal, because features are chosen to serve it.

## App (a new app, tool, dashboard, game or feature)

1. **End goal** — What should be true for people once this exists? *(free text)*
2. **Who it's for** — Just me · My clients · Jarvis users · The public
3. **How we'll know it worked** — People finish the main task without help · Saves me time every
   week · Makes money · Never crashes and is fast on phones · *(other)*
4. **Must-have features, your way** *(free text — kept exactly as described)*
5. **Look & feel** — Match Jarvis (minimal, futuristic) · Clean & professional · Bold & playful ·
   I have a reference
6. **What it touches** *(multi)* — Accounts / sign-in · Payments · Personal data · Other apps ·
   AI · Works offline

## Website (a client site, landing page or portfolio)

1. **The one thing a visitor should do** — Call · Book · Buy · Fill in a form · *(other)*
2. **The business and who visits** *(free text)*
3. **How we'll know it worked** — More calls/bookings · Loads in under a second on phones ·
   Ranks for local searches · The client can edit it themselves
4. **Pages and features, your way** *(free text)*
5. **Look & feel** — as App
6. **Handoff** *(multi)* — Domain & email · Analytics · Contact form · Client Review link ·
   Jarvis error script

## Plugin (something added to Jarvis or the hub)

1. **End goal** *(free text)*
2. **Where it lives** — Dashboard widget · Toolbox tab · App plugins card · A chat tool
3. **How we'll know it worked** — I use it every day · It replaces a manual chore · Other users
   set it up without help
4. **Must-have features, your way** *(free text)*
5. **What it touches** *(multi)* — as App

## Fix (something broken, slow or annoying)

1. **What's wrong, and where** *(free text)*
2. **How often** — Every time · Sometimes · Happened once
3. **How far to go** — Fix this one · Fix every case like it · Fix it and stop it happening
   again *(recommended)*
4. **How we'll know it's fixed** — A test that failed now passes · No new logged errors for a
   week · I can do the thing again

## Content (copy, a post, an email, a script)

1. **What should the reader do or feel after?** *(free text)*
2. **Who reads it** *(free text)*
3. **Where it goes** — Website · Social post · Email · Video script · Ad

## Which checklist lines each answer pulls in

Always: R1 R2 R3 R4 U1 U2 O1 · Website: P1 U3 C1–C6 · Accounts: S3 S4 D4 · Payments: S5 (label
`money` → human merge) · Personal data: S2 D2 D4 · Other apps: R5 · AI: S5 R4 · Offline: D3
