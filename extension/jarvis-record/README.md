# Jarvis Record — browser extension

Saves what you type into job and benefits applications to your Life Record, and fills the next
application from what it already knows.

A web page cannot see what you type on another website — that is the origin boundary the whole web
rests on. This extension is the one thing that legitimately crosses it.

## Install it once

1. In Jarvis → **Record** → **Connect your browser**, press the button and copy the token. It is
   shown once; minting a new one stops the old one working.
2. Go to `chrome://extensions`, turn on **Developer mode**, press **Load unpacked**, and choose
   this folder. (Edge: `edge://extensions`. Brave: `brave://extensions`.)
3. The options page opens on install. Paste your hub's address and the token.
   - Deployed: `https://your-hub.vercel.app`
   - Local: `http://localhost:3240`

## Using it

On any application form, click the extension's icon:

- **Save what I typed here** — reads the fields you have filled in, works out what each one is,
  and sends them to Jarvis. Nothing enters your Record until you confirm it on the Record tab.
- **Fill this form from my Record** — types in what it already knows. It never overwrites a field
  you have already answered, and it tells you which fields it had nothing for.

Always read the form before you submit it. The extension prepares applications; you submit them.

## What it can reach

Nothing, until you press one of those buttons.

There is no background script watching your browsing and no list of sites it runs on. The content
script is injected on a click, under `activeTab` — a permission Chrome grants for that one tab and
revokes when you navigate away. That is a property of `manifest.json`, not a promise in a README:
there is no `content_scripts` block to run anything automatically.

It reads form fields. It never reads a password, a hidden input, a file picker or a CAPTCHA.

## Where your Social Security number lives

Not on the server. The snapshot the extension fills from is built by `publishSnapshot`, which
strips every field marked sensitive — Social Security number, driver's licence number, Medicaid
member ID — before anything is written down. They are not withheld from the extension; they are
not there.

If you want those typed in automatically, put them in this extension's **options**, where they stay
in this browser's local storage and are merged into a fill at the last moment. Leave them empty and
the extension simply skips those fields, which is the safer default on a benefits portal.

## How a field is recognised

Three rungs, cheapest first (`src/lib/jarvis/record/fields.ts` and the `/api/jarvis/record/map`
route):

1. **The `autocomplete` attribute.** A standard with a fixed vocabulary — when a site sets it, it
   is stating the field's meaning. Most commercial job boards are solved entirely here, instantly
   and for free.
2. **The field's name, then its visible label.** Patterns ordered most-specific-first, so `/name/`
   cannot swallow `first_name`.
3. **The model**, on whatever is left — the `ctl00$Main$txt17` inputs state portals are built
   from. Its answer is cached against the domain, so a site is only ever puzzled out once.

A field it cannot place is left alone. `null` is a common and correct answer: a wrong mapping
writes a phone number into a licence-number field, and a record you cannot trust is worse than one
with holes in it.

## Files

| File | What it does |
|---|---|
| `manifest.json` | MV3. No `content_scripts` — nothing runs on its own. |
| `content.js` | Runs inside the page: reads fields, finds labels, fills values. |
| `popup.js` | The only thing that starts a read. Injects `content.js`, talks to Jarvis. |
| `options.js` | Hub address, token, and the numbers that stay on this computer. |
| `background.js` | Opens the options page on install. Nothing else, deliberately. |

## The one subtle thing in here

`setValue` in `content.js` goes through the prototype's native `value` setter and then dispatches
an `input` event, rather than assigning `el.value` directly.

React keeps its own copy of an input's state and tracks the last value it wrote on the DOM node. A
direct assignment is invisible to it: the text appears on screen, React never learns about it, and
the form submits blank. Going through the native setter bypasses React's own property descriptor,
and the dispatched event then reaches its handler. Every React, Vue and Angular form depends on
this; it is verified in the app against a real controlled input.
