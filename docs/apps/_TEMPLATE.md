# <App title>

`/apps/<slug>` · <category> · <live | coming-soon> · shows as: <hub tile | App plugins card | Dashboard widget | Toolbox tab | section of <home>>

> <the catalog tag line>

<Two or three sentences: what it is, who uses it, what it is for. Plain English.>

![<App title>](../../public/look/<slug>.jpg)

## Features — every one of these must still exist after your change

The owner asked for each of these. Removing, hiding or "simplifying away" one is a regression,
even if the code looked unused. If a change needs one gone, ask first.

- **<Feature name>** — <what the user sees or does, one line>. `<path/to/main/file>`
- ...

## How it looks

- **Look:** <name of the look, and which design skill made it, if known>
- **Colours / type:** <the palette or tokens it uses; fonts; anything it does differently from DESIGN.md>
- **Layout:** <laptop layout · phone layout>
- **Signature pieces:** <the components that make it recognisable>
- **Motion:** <what moves, and the reduced-motion fallback>

## Where the code is

| Part | Path |
|---|---|
| Page | `src/app/apps/<slug>/page.tsx` |
| UI | `src/components/<folder>/` |
| Logic + tests | `src/lib/<folder>/` |
| API | `src/app/api/<folder>/` |
| Saved data | <synced key / Supabase table / server_docs doc> |

## Owner's rules for this app

- <rules the owner set that are not obvious from the code>

## Described but not found in code

- <a feature the docs or change log describe that this checkout does not have — or "None found.">
