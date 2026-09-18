import { execFile } from "node:child_process";

// Unblock Unreal's platform-SDK check when it hangs.
//
// On a project's first launches the editor (and the Python commandlet) run
// `Build.bat -Mode=ValidatePlatforms`. Build.bat guards itself with a lock file
// in %TEMP% and, when it cannot take the lock, retries forever (`ping` +
// `goto :Lock`). On this PC that loop sometimes never ends even though the
// lock is free and the same command finishes in ~3 s when run by hand; the
// editor then sits at 40 MB for as long as you let it. Ending the stuck
// Build.bat lets the editor carry on normally (verified 2026-09-18). The check
// only reports which platform SDKs are installed, so nothing is lost.

const STUCK_AFTER_MS = 120_000;

function run(cmd, args) {
  return new Promise((resolve) => execFile(cmd, args, { windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => resolve(err ? "" : String(stdout))));
}

/** Ids of Build.bat ValidatePlatforms shells older than STUCK_AFTER_MS. */
export async function stuckSdkChecks(now = Date.now()) {
  if (process.platform !== "win32") return [];
  const script =
    "Get-CimInstance Win32_Process -Filter \"Name='cmd.exe'\" | Where-Object { $_.CommandLine -match 'Build\\.bat' -and $_.CommandLine -match 'ValidatePlatforms' } | ForEach-Object { '{0} {1}' -f $_.ProcessId, ([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds() }";
  const out = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script]);
  return out
    .split(/\r?\n/)
    .map((l) => l.trim().split(/\s+/).map(Number))
    .filter(([pid, started]) => pid > 0 && started > 0 && now - started > STUCK_AFTER_MS)
    .map(([pid]) => pid);
}

/** End every stuck SDK check. Returns how many were ended. */
export async function unstickSdkChecks() {
  const pids = await stuckSdkChecks();
  for (const pid of pids) await run("taskkill", ["/PID", String(pid), "/T", "/F"]);
  return pids.length;
}

/** Run `unstickSdkChecks` every `everyMs` until the returned stop() is called. */
export function watchSdkChecks({ everyMs = 30_000, onUnstick } = {}) {
  let busy = false;
  const timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      const n = await unstickSdkChecks();
      if (n) onUnstick?.(n);
    } finally {
      busy = false;
    }
  }, everyMs);
  return () => clearInterval(timer);
}
