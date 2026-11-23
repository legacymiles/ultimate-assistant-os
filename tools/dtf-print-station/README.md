# DTF print station

The Windows companion for **DTF Studio's print bridge**. It runs on the production PC next to
ColorboxRIP and the Lancelot M1630 Pro, fetches the print files the owner sends to the station
queue, files them by order number, and shows everything the operator needs on a page that only
this PC can open.

**It never prints.** It does not talk to the printer, has no ColorboxRIP API (there is none
it could use), and changes nothing in ColorboxRIP. Every status after "downloaded" is an
operator's click.

Plain Node.js, no `npm install`: Node 22 or newer, nothing else.

## Set it up (once)

1. **Install Node.js** 22 LTS or newer from <https://nodejs.org> on the production PC.
2. **Copy this folder** (`tools/dtf-print-station`) onto the production PC, e.g. `C:\DTF\station`.
3. **Pair it.** On the website open **DTF Production › Print bridge** and click **Pair station**.
   A token is shown **once** — copy it. Pairing again makes a new token and the old one stops
   working immediately; **Unpair** stops it too.
4. **Configure it.** Copy `station.config.example.json` to `station.config.json` in the same
   folder and fill it in:

   | Key | What it is |
   |---|---|
   | `siteUrl` | The website address exactly as the browser shows it after loading, e.g. `https://shop.example` (no trailing slash). Use `https://`. |
   | `token` | The token from step 3. |
   | `exportDir` | Where print files go. Default `C:\\DTF\\Print Jobs` (double every backslash in JSON). Created if missing. |
   | `colorboxRipPath` | Optional. The ColorboxRIP **.exe** (not a desktop shortcut). Right-click the shortcut › Open file location to find it. |
   | `openMode` | `"reveal"` (default): **Open in ColorboxRIP** starts ColorboxRIP if it is not running and opens Explorer with the file selected — drag it into ColorboxRIP or use its Import. `"argument"`: passes the file path to the ColorboxRIP .exe as its first argument. **Only if your ColorboxRIP build accepts a file argument — test it once** with one job before relying on it. |
   | `pollSeconds` | How often to check the website. Default 15 (5–300). |
   | `port` | The local page's port. Default 7316. |

5. **Run it:** double-click `start-station.cmd`. The window prints a link like
   `http://127.0.0.1:7316/?key=…` — open it once in a browser on this PC. It sets a cookie and
   remembers you; afterwards `http://127.0.0.1:7316` is enough.

`station.config.json` and `state.json` hold the token and the station's memory. They are
git-ignored; never send them to anyone.

## What a job looks like on disk

```
C:\DTF\Print Jobs\
  DTF-24117\
    DTF-24117_front_28.0x31.5cm_300dpi.png    artwork only, 300 DPI, transparent, sRGB
    DTF-24117_back_29.0x40.0cm_300dpi.png
    job.json                                   the website's metadata for every job in the order
    PRODUCTION.txt                             garment, colour, size, qty, placement, press
                                               position, artwork size, DPI, upsample warning,
                                               production notes, and the ColorboxRIP checklist
```

Two prints of the same side and size on one order get `_1`, `_2` so nothing is overwritten.

`PRODUCTION.txt` ends with what **ColorboxRIP owns** — the export does none of it on purpose:
RGB → CMYK (the ICC profile), white ink generation / choke / underbase, ink limits and density,
mirroring for film, print mode / passes / head settings. **Verify the profile, white, mirror and
ink limits in ColorboxRIP before every print.**

## The station page

`http://127.0.0.1:7316` — answers only on this PC (bound to 127.0.0.1, key cookie, and every
button also sends the key in a header).

- Jobs grouped by order: thumbnail on a transparency grid, placement, press position, artwork
  size, pixels and DPI, lowest source DPI, upsample warning, garment / colour / size / qty,
  production notes and the customer's note, file path, status.
- **Open in ColorboxRIP** — see `openMode` above; tells the website "opened".
- **Show in folder** — Explorer with the file selected.
- **Mark printed** — asks first, then tells the website "printed" (the order moves on to heat
  transfer when every print on it is printed).
- **Report problem** — your note goes to the website and the print shows as failed; the owner
  fixes the file and sends it again, and the station downloads the new copy.
- **Download again** — appears when the file was deleted from the folder or a download failed.
- **Other files in the export folder** — anything copied in by hand shows up live (the folder is
  watched).
- The banner says **Online**, **Offline — retrying** or **Not paired**.

## When the website is unreachable

Nothing is lost. Files already downloaded still open and the buttons still work; each click is
saved in `state.json` and sent when the connection returns. Retries back off from `pollSeconds`
doubling up to 5 minutes. The website keeps working without the station; jobs simply wait in
its queue.

## Start it with Windows (Task Scheduler)

1. Open **Task Scheduler** › **Create Task…** (not "Basic Task").
2. **General:** name `DTF print station`; choose **Run only when user is logged on** (so
   Explorer and ColorboxRIP can open on the desktop).
3. **Triggers:** New › **At log on** › your user.
4. **Actions:** New › **Start a program** ›
   Program: `C:\DTF\station\start-station.cmd` · Start in: `C:\DTF\station`
5. **Settings:** untick **Stop the task if it runs longer than…**; tick **If the task fails,
   restart every 1 minute**.
6. Right-click the task › **Run** to test, then open the station page.

To stop it, close the console window (or End the task in Task Scheduler).

## What it will and will not do

| Will | Will not |
|---|---|
| Download print files the owner queued, verify they are PNGs, save them atomically | Print, send anything to the printer, or click anything in ColorboxRIP |
| Write `job.json` and `PRODUCTION.txt` beside them | Change colours, add white, mirror, or resize — ColorboxRIP owns those |
| Report "downloaded" by itself once the file is on disk | Report opened / printed / failed without an operator's click |
| Show the jobs on a page only this PC can open | Accept connections from other computers |
| Keep working offline and catch up later | Delete files from the export folder |

## Troubleshooting

- **"Not paired" / "Station token is not valid."** Pair again on the website and paste the new
  token into `station.config.json`, then restart.
- **"The website could not be reached."** Check `siteUrl` (https, with or without `www`
  exactly as the browser ends up on — the station does not follow redirects, so the token never
  goes to another address) and the PC's internet.
- **"The website has no print-bridge endpoint at that address."** `siteUrl` points at the wrong
  site.
- **"Windows would not let the station write the file."** The PNG is open in ColorboxRIP or
  another program, or the folder is read-only. Close it; the station retries on its next check.
- **Open in ColorboxRIP does nothing visible.** In `reveal` mode check `colorboxRipPath` points
  at the .exe (the header says "ColorboxRIP path not found" otherwise). In `argument` mode your
  ColorboxRIP build may not accept a file argument — switch back to `reveal`.
- **"Port 7316 is already in use."** The station is already running (check the taskbar /
  Task Scheduler), or change `port`.
- **The page says "Station locked".** Open the `?key=` link printed in the console window.
- **`state.json` was corrupted.** The station keeps it as `state.corrupt-<time>.json` and starts
  fresh; on the next check it re-downloads anything the website still lists.
- **Run it by hand to see errors:** `node station.mjs` in this folder, or
  `node station.mjs --config D:\elsewhere\station.config.json`.

## For developers

- `lib.mjs` — pure helpers (file names, folder layout, state merge, transition guards,
  PRODUCTION.txt). Tested by `src/lib/dtf/station-lib.test.ts` with the repo's vitest:
  `npx vitest run src/lib/dtf`.
- Website side: `src/lib/dtf/server/jobs.ts` (transition table) and
  `src/app/api/dtf/station/{jobs,file,status}/route.ts`.
