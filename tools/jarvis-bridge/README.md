# jarvis-bridge — the half of New Jarvis that can touch this PC

```cmd
tools\jarvis-bridge\install.cmd
```

**Run that once.** It installs the dependencies, downloads the browser New Jarvis
drives, starts the agent now and at every Windows sign-in with no console window,
and pairs it with the hub. After it, `/apps/new-jarvis` can open real pages in a
browser that keeps your logins, run commands, read and write files, list and focus
windows, and see your screen.

Undo the sign-in part with `uninstall-autostart.cmd`. Re-pair any time with
`pair.cmd`. `start.cmd` opens it in a visible window when you want to watch the
log; the hidden one writes to `out\bridge.log`.

## Why it exists

New Jarvis runs on Vercel, and Vercel cannot reach this desk. Your browser can.
So the page posts to `127.0.0.1:42020` and this process does the things a web
page is not allowed to do. Same trick as `tools\studio-bridge`, different job.

**The site is built to work with this switched off.** Every capability is
reported through `/health`, and New Jarvis greys out what is missing and says
which one, rather than offering a button that cannot work. With the agent off it
still thinks, remembers and answers.

## What it can do

| | |
|---|---|
| `POST /shell` | One PowerShell command, with its real output and exit code. Bounded output, bounded time. |
| `POST /browser/*` | `open`, `read`, `click`, `type`, `press`, `scroll`, `navigate`, `tabs`, `screenshot`, `close`, `quit`. |
| `POST /files/*` | `list`, `read`, `write`. |
| `POST /system/*` | `windows`, `focus`, `launch`, `screenshot`, `info`, `clipboard/read`, `clipboard/write`. |
| `GET /health` | No auth. What is installed and whether the browser is up. |
| `GET /status` | Everything the page's panels draw. |

### The browser is headed, and it keeps a profile

It launches a real Chromium with a profile in `out\browser-profile`, not a
throwaway headless one, for two reasons. A browser that forgets every login can
read public pages and nothing else, which rules out most of what you would
actually ask for — so you sign in **once, by hand**, and every later run is
already signed in. And an agent clicking through a site you cannot watch is a
thing you switch off after the first surprise, so you can watch it.

`JARVIS_BRIDGE_HEADLESS=1` turns the window off for unattended runs.

Elements are addressed by `ref` — a number stamped onto the page during a
`read`. **You must `read` before you `click` or `type`**: refs only exist after a
read, and they go stale when the page changes. That is deliberate. A CSS
selector or a text match breaks silently between the model deciding and the
click landing; a stale ref is an error we can report instead of a wrong element
we quietly clicked.

## What is holding the door

Any page in any tab can send a request to `127.0.0.1`. The browser will not let
that page *read* the answer without CORS — but a plain `fetch` still **arrives**,
and by then the command has run. An origin check alone therefore protects
nothing.

So:

1. **A token, on every route but `/health`.** It goes in `Authorization`, which
   is a non-simple header, which forces a CORS preflight — and the preflight is
   where an unknown origin is turned away *before* the request body, and
   therefore the command, is ever delivered. Requests without a valid token are
   refused whatever origin they claim.
2. **An origin allowlist**: the live hub, and any localhost dev server.
3. **Bound to `127.0.0.1`**, never the network interface.
4. **A short refusal list** for the irreversible — formatting a drive,
   `diskpart`, deleting `HKLM` keys, wiping shadow copies, shutting down. It is
   short on purpose: shell quoting has infinite ways to spell the same thing, so
   a long blocklist buys a false sense of safety. It catches the honest spelling
   of a catastrophe. **The token is what actually keeps the machine safe.**

The token lives in `out\token.txt` and reaches the page through the URL
**fragment** (`#pair=…`), which no browser ever sends to a server — not to
Vercel, not to a proxy, not into an access log. The page stores it and strips it
from the address bar immediately.

Above all this sits the page's own gate: New Jarvis reads freely and stops for
your yes on anything that cannot be undone. That gate is the one you read; this
list is the one that holds when something bypasses it.

## When something is wrong

| What you see | What it means |
|---|---|
| "The local agent is not running on this PC." | Nothing is listening on 42020. Run `start.cmd` and read the window. |
| "Running, but New Jarvis is not paired with it yet." | It is up; this browser has no token. Run `pair.cmd`. |
| Browser row says "off" | Chromium is not downloaded. `npx playwright install chromium` here. |
| `Port 42020 is already taken` | It is already running. That is the normal case. |
| Nothing in `out\bridge.log` | The hidden start could not launch node. Run `start.cmd` to see the error. |

Stopping it: `uninstall-autostart.cmd` stops it **by the port it holds**, not by
its command line. Started from the Startup shortcut the command line carries the
full script path and matching it works; started from `start.cmd` it is only
`node server.mjs`, matches nothing, and a kill written that way reports success
while the agent keeps running.
