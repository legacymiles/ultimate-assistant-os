# EA Lab runner

Upload a MetaTrader Expert Advisor and it is backtested headless on the machine
this runs on. The runner serves the EA Lab page itself, so a VPS needs nothing
but Node.js and this folder.

| Upload | What happens |
|---|---|
| `.ex4` | installed into the MT4 test terminal and backtested |
| `.mq4` | compiled with that terminal's MetaEditor, then backtested |
| `.ex5` | installed into the MT5 test terminal and backtested (real ticks) |
| `.mq5` | compiled with that terminal's MetaEditor, then backtested |

## Set it up on the VPS

1. Install Node.js (LTS) from https://nodejs.org.
2. Have a **spare MT4 and/or MT5 install** you do not trade on, logged in to a
   demo account, with history for the symbols you test (open an XAUUSD H1 chart
   once and let it download). The runner closes and restarts the chosen
   terminal for every test.
3. Copy this whole `ea-lab-runner` folder to the VPS (include `ui\`).
4. Double-click `install-autostart.cmd`. It starts the runner, makes it start at
   every sign-in, and opens http://127.0.0.1:42030.
5. On the page, under "Test terminals", pick the spare MT4 and the spare MT5.
   Then click **Upload EA** (or drag files onto the page).

`start.cmd` runs it in a window instead, for watching the log. The log of the
hidden runner is `out\runner.log`. `uninstall-autostart.cmd` removes it.

## Compiling source

Source is compiled every time it is tested, in `C:\EA-Lab\build`, using the
include files of the chosen test terminal. If an EA includes its own `.mqh`
files, copy them into that terminal's `MQL4\Include` / `MQL5\Include` first, or
compile it yourself and upload the `.ex4` / `.ex5`. The page shows the compile
errors when it fails.

## Where things live

| | |
|---|---|
| `C:\EA-Lab\inbox` | drop folder; files here are taken in like an upload |
| `C:\EA-Lab\installed` | every EA the lab has taken, and compiled builds |
| `C:\EA-Lab\reports` | the testers' reports |
| `C:\EA-Lab\config.json` | which MT4 and MT5 installs are the test terminals |

Keep `C:\EA-Lab` (or `EA_LAB_ROOT`) a short path with no OneDrive sync:
MetaEditor fails silently on long paths.

Environment overrides: `EA_LAB_ROOT`, `EA_LAB_PORT`, `EA_LAB_RIG_EXE`,
`EA_LAB_RIG_DATA` (MT4), `EA_LAB_MT5_EXE`, `EA_LAB_MT5_DATA`,
`EA_LAB_TIMEOUT_MS`.

## Changing the page

The page in `ui\` is built from `src/components/ea-lab` and `src/lib/ea-lab`.
After changing those, rebuild on the PC and copy `ui\` to the VPS again:

```
node tools/ea-lab-runner/build-ui.mjs
```

The MT5 report parser was written against a hand-made sample
(`src/lib/ea-lab/__fixtures__/mt5-report.htm`). Once the VPS has produced a real
MT5 report, copy it over that file and run `npx vitest run src/lib/ea-lab`.
