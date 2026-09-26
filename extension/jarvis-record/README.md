# Jarvis Record — browser extension

Saves what you type into job and benefits applications to your Life Record, and fills the next
application from what it already knows.

A web page cannot see what you type on another website — that is the origin boundary the whole web
rests on. This extension is the one thing that legitimately crosses it.

## Install it from Jarvis, not from here

Go to Jarvis → **Record** (or press **Record** on the Chat tab's composer) and press **Set up in one
click**. You get this folder as a zip with a `config.js` already holding your hub's address and a
token minted a second earlier, and a `manifest.json` narrowed to that one origin.

Then the two steps Chrome keeps for itself, and nothing else:

1. Run **Install on Windows.cmd** from the download. It parks the extension in
   `%LOCALAPPDATA%\Jarvis Record` — an unpacked extension is read off disk forever, so it must not
   live in Downloads — puts that path on your clipboard, and opens `chrome://extensions`.
2. Developer mode on, **Load unpacked**, paste.

There is no third step. No token to copy, no options page to open, and nothing to press in Jarvis
afterwards: `connect.js` answers a ping on your hub's origin, so the Record tab notices the
extension and says so by itself.

Chrome has not allowed a web page to install an extension since 2018, and no page may open
`chrome://extensions`. Those two clicks are permanently yours; everything that used to surround them
is gone.

### Loading this folder straight from the repo

It works, but it knows nothing: no hub, no token. On install it opens its options page. Mint a token
in Jarvis → Record → *Setting it up by hand instead*, and paste it there with your hub's address
(deployed: `https://your-hub.vercel.app`, local: `http://localhost:3240`).

Easier: load it, then open your hub. Jarvis sees an extension with no token and hands it one without
being asked.

## Using it

On any application form, click the extension's icon:

- **Save what I typed here** — reads the fields you have filled in, works out what each one is,
  and sends them to Jarvis. Nothing enters your Record until you confirm it on the Record tab.
- **Fill this form from my Record** — types in what it already knows. It never overwrites a field
  you have already answered, and it tells you which fields it had nothing for.

Always read the form before you submit it. The extension prepares applications; you submit them.

## What it can reach

Your own hub, and — only while you are pressing one of those buttons — the tab you are on.

The content script that runs automatically, `connect.js`, is matched to your hub's origin and no
other site, and is only capable of two things: marking the page so Jarvis can see the extension is
installed, and accepting a hub address and token from it. A ping is answered with *whether* a token
exists, never with the token, so a page on your hub can replace the connection but cannot read it.

Nothing runs on the sites you fill in until you click. `content.js` is injected on that click under
`activeTab` — a permission Chrome grants for one tab and revokes when you navigate away. That is a
property of `manifest.json`, not a promise in a README.

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
| `manifest.json` | MV3. One content script, on your hub only; nothing runs on other sites. |
| `content.js` | Runs inside an application page, on a click: reads fields, finds labels, fills values. |
| `popup.js` | The only thing that starts a read. Injects `content.js`, talks to Jarvis. |
| `connect.js` | Runs on your hub only. Lets Jarvis see the extension and hand it a token. |
| `config.js` | The hub and token the download was built with. Empty in the repo copy. |
| `options.js` | Hub address, token, and the numbers that stay on this computer. |
| `background.js` | Adopts `config.js` on install, or opens the options page. Nothing else. |

The zip is assembled by `src/app/api/jarvis/record/extension/route.ts`, which rewrites `config.js`
and narrows the manifest to the requesting origin.

## The one subtle thing in here

`setValue` in `content.js` goes through the prototype's native `value` setter and then dispatches
an `input` event, rather than assigning `el.value` directly.

React keeps its own copy of an input's state and tracks the last value it wrote on the DOM node. A
direct assignment is invisible to it: the text appears on screen, React never learns about it, and
the form submits blank. Going through the native setter bypasses React's own property descriptor,
and the dispatched event then reaches its handler. Every React, Vue and Angular form depends on
this; it is verified in the app against a real controlled input.
