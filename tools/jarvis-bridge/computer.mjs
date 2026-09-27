// ---------------------------------------------------------------------------
// The machine itself: shell, files, windows, screen, clipboard.
//
// Every one of these is a thing a web page cannot do and the owner asked for
// anyway, which is the whole reason this process exists.
//
// Two rules run through all of it:
//
//   Output is bounded. A command that prints a gigabyte must not take the
//   bridge down with it, and the page cannot render a gigabyte either. Every
//   reader here truncates and SAYS it truncated, because silently handing the
//   model the first 200 KB of a file and letting it conclude the rest does not
//   exist is worse than refusing outright.
//
//   Nothing runs forever. A shell command with no timeout is a hung bridge and
//   a spinner the owner has to go and kill by hand.
// ---------------------------------------------------------------------------

import { exec, spawn } from "node:child_process";
import { readdir, readFile, stat, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { randomUUID } from "node:crypto";

const MAX_OUTPUT = 60_000;
const MAX_FILE = 400_000;
const DEFAULT_TIMEOUT = 120_000;

function clip(text, limit) {
  const s = String(text ?? "");
  if (s.length <= limit) return { text: s, truncated: false };
  return {
    text: `${s.slice(0, limit)}\n\n… truncated at ${limit.toLocaleString()} characters; ${(s.length - limit).toLocaleString()} more were not read.`,
    truncated: true,
  };
}

/**
 * Run a command and report what it did.
 *
 * A non-zero exit is not an error here — it is a result, and the page needs to
 * show it. Throwing on exit 1 would turn "the test suite found 3 failures" into
 * "the bridge broke", which sends the owner looking in the wrong place.
 */
export function runCommand({ command, cwd, shell = "powershell", timeoutMs = DEFAULT_TIMEOUT }) {
  return new Promise((done) => {
    const started = Date.now();
    const isPwsh = shell !== "cmd";
    const file = isPwsh ? "powershell.exe" : process.env.ComSpec || "cmd.exe";
    const args = isPwsh
      ? ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", command]
      : ["/d", "/s", "/c", command];

    const child = spawn(file, args, {
      cwd: cwd || process.env.USERPROFILE || undefined,
      windowsHide: true,
    });

    let out = "";
    let err = "";
    let killed = false;
    child.stdout.on("data", (d) => { if (out.length < MAX_OUTPUT * 2) out += d; });
    child.stderr.on("data", (d) => { if (err.length < MAX_OUTPUT * 2) err += d; });

    const timer = setTimeout(() => {
      killed = true;
      child.kill("SIGKILL");
    }, Math.min(Math.max(1_000, timeoutMs), 600_000));

    child.on("error", (e) => {
      clearTimeout(timer);
      done({ ok: false, exitCode: null, stdout: "", stderr: String(e.message), ms: Date.now() - started });
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      const o = clip(out, MAX_OUTPUT);
      const e = clip(err, MAX_OUTPUT);
      done({
        ok: code === 0 && !killed,
        exitCode: killed ? null : code,
        timedOut: killed,
        stdout: o.text,
        stderr: e.text,
        truncated: o.truncated || e.truncated,
        ms: Date.now() - started,
        shell: isPwsh ? "powershell" : "cmd",
        cwd: cwd || process.env.USERPROFILE || "",
      });
    });
  });
}

/** One PowerShell expression, answered as parsed JSON. */
function ps(script, timeoutMs = 30_000) {
  return new Promise((done, fail) => {
    exec(
      `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "${script.replace(/"/g, '\\"')}"`,
      { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, windowsHide: true },
      (e, stdout) => {
        if (e && !stdout) return fail(new Error(e.message));
        const raw = String(stdout).trim();
        if (!raw) return done(null);
        try {
          done(JSON.parse(raw));
        } catch {
          done(raw);
        }
      },
    );
  });
}

// --- files ----------------------------------------------------------------

export async function listDir({ path }) {
  const dir = resolve(path);
  const names = await readdir(dir, { withFileTypes: true });
  const entries = [];
  for (const d of names.slice(0, 500)) {
    const full = join(dir, d.name);
    let size = null;
    let modified = null;
    try {
      const s = await stat(full);
      size = s.isFile() ? s.size : null;
      modified = s.mtime.toISOString();
    } catch { /* a locked or vanished entry still gets listed, without stats. */ }
    entries.push({ name: d.name, path: full, dir: d.isDirectory(), size, modified });
  }
  return { path: dir, entries, more: names.length > 500 ? names.length - 500 : 0 };
}

export async function readTextFile({ path }) {
  const full = resolve(path);
  const s = await stat(full);
  if (!s.isFile()) throw new Error(`${full} is a directory, not a file.`);
  const raw = await readFile(full, "utf8");
  const { text, truncated } = clip(raw, MAX_FILE);
  return { path: full, size: s.size, modified: s.mtime.toISOString(), text, truncated };
}

export async function writeTextFile({ path, text }) {
  const full = resolve(path);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, String(text ?? ""), "utf8");
  const s = await stat(full);
  return { path: full, size: s.size, written: true };
}

// --- windows and apps -----------------------------------------------------

export async function listWindows() {
  const out = await ps(
    "Get-Process | Where-Object { $_.MainWindowTitle } | "
    + "Select-Object Id, ProcessName, MainWindowTitle | ConvertTo-Json -Compress",
  );
  const rows = Array.isArray(out) ? out : out ? [out] : [];
  return {
    windows: rows.map((w) => ({ pid: w.Id, process: w.ProcessName, title: w.MainWindowTitle })),
  };
}

/**
 * Bring a window to the front.
 *
 * Windows refuses `SetForegroundWindow` from a process that does not own the
 * foreground, and it refuses it SILENTLY — the call returns and nothing moves.
 * Sending a no-op ALT keystroke first makes the shell treat this as a user
 * gesture, which is the difference between this working and this appearing to
 * do nothing at all.
 */
export async function focusWindow({ pid }) {
  const id = Number(pid);
  if (!Number.isInteger(id)) throw new Error("focus needs a numeric pid");
  const script = [
    "Add-Type -Namespace W -Name U -MemberDefinition '",
    "[DllImport(\\\"user32.dll\\\")] public static extern bool SetForegroundWindow(IntPtr h);",
    "[DllImport(\\\"user32.dll\\\")] public static extern bool ShowWindow(IntPtr h, int c);';",
    `$p = Get-Process -Id ${id} -ErrorAction Stop;`,
    "(New-Object -ComObject WScript.Shell).SendKeys('%');",
    "[W.U]::ShowWindow($p.MainWindowHandle, 9) | Out-Null;",
    "[W.U]::SetForegroundWindow($p.MainWindowHandle) | Out-Null;",
    "@{ focused = $true; title = $p.MainWindowTitle } | ConvertTo-Json -Compress",
  ].join(" ");
  return (await ps(script)) ?? { focused: false };
}

export async function launchApp({ target, args = [] }) {
  const quoted = args.length ? ` ${args.map((a) => `'${String(a).replace(/'/g, "''")}'`).join(",")}` : "";
  const list = args.length ? ` -ArgumentList${quoted}` : "";
  await ps(`Start-Process -FilePath '${String(target).replace(/'/g, "''")}'${list}`);
  return { launched: target };
}

// --- screen and clipboard -------------------------------------------------

export async function screenShot() {
  const out = join(tmpdir(), `jarvis-screen-${randomUUID()}.png`);
  const script = [
    "Add-Type -AssemblyName System.Windows.Forms, System.Drawing;",
    "$b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds;",
    "$bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height;",
    "$g = [System.Drawing.Graphics]::FromImage($bmp);",
    "$g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size);",
    `$bmp.Save('${out}', [System.Drawing.Imaging.ImageFormat]::Png);`,
    "$g.Dispose(); $bmp.Dispose();",
    "@{ width = $b.Width; height = $b.Height } | ConvertTo-Json -Compress",
  ].join(" ");
  const meta = await ps(script, 45_000);
  const png = await readFile(out);
  return { png: png.toString("base64"), width: meta?.width ?? null, height: meta?.height ?? null };
}

export async function readClipboard() {
  const text = await ps("Get-Clipboard -Raw | ConvertTo-Json -Compress");
  return { text: typeof text === "string" ? text : "" };
}

export async function writeClipboard({ text }) {
  await ps(`Set-Clipboard -Value '${String(text ?? "").replace(/'/g, "''")}'`);
  return { copied: true };
}

export async function systemInfo() {
  const info = await ps(
    "$os = Get-CimInstance Win32_OperatingSystem;"
    + "$cs = Get-CimInstance Win32_ComputerSystem;"
    + "@{ host = $env:COMPUTERNAME; user = $env:USERNAME; os = $os.Caption;"
    + " freeMemMb = [math]::Round($os.FreePhysicalMemory/1kb);"
    + " totalMemMb = [math]::Round($cs.TotalPhysicalMemory/1mb);"
    + " home = $env:USERPROFILE } | ConvertTo-Json -Compress",
  );
  return info ?? {};
}

export const __test = { clip };
