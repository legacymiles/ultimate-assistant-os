# EA Lab runner

Upload a MetaTrader 4 Expert Advisor and it is backtested headless on the machine
this runs on. The runner serves the EA Lab page itself, so a VPS needs nothing
but Node.js and this folder.

## Set it up on the VPS

1. Install Node.js (LTS) from https://nodejs.org.
2. Have a **spare MT4 install** you do not trade on, logged in to a demo account,
   with history for the symbols you test (open an XAUUSD H1 chart once and let it
   download). The runner closes and restarts that terminal for every test.
3. Copy this whole `ea-lab-runner` folder to the VPS (include `ui\`).
4. Double-click `install-autostart.cmd`. It starts the runner, makes it start at
   every sign-in, and opens http://127.0.0.1:42030.
5. On the page, pick the spare MT4 under "Choose the MetaTrader 4 install to
   test with". Then click **Upload EA** (or drag an `.ex4` onto the page).

`start.cmd` runs it in a window instead, for watching the log. The log of the
hidden runner is `out\runner.log`. `uninstall-autostart.cmd` removes it.

## Where things live

| | |
|---|---|
| `C:\EA-Lab\inbox` | drop folder; files here are taken in like an upload |
| `C:\EA-Lab\installed` | every EA the lab has taken |
| `C:\EA-Lab\reports` | the tester's .htm reports |
| `C:\EA-Lab\config.json` | which MT4 install is the test terminal |

Environment overrides: `EA_LAB_ROOT`, `EA_LAB_PORT`, `EA_LAB_RIG_EXE`,
`EA_LAB_RIG_DATA`, `EA_LAB_TIMEOUT_MS`.

## Changing the page

The page in `ui\` is built from `src/components/ea-lab` and `src/lib/ea-lab`.
After changing those, rebuild on the PC and copy `ui\` to the VPS again:

```
node tools/ea-lab-runner/build-ui.mjs
```

Only `.ex4` can be tested (the rig is MT4). `.ex5` and source files are filed
and show why they cannot be tested yet.
