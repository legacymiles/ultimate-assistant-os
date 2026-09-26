import { NextResponse } from "next/server";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { mintToken } from "@/lib/jarvis/record/inbox";
import { sessionUid, storageFailed } from "@/lib/jarvis/record/http";
import { zipSync, type ZipEntry } from "@/lib/server/zip";

// POST — hand back the browser extension, already paired with this hub.
//
// Setting this up used to be: clone the repo, find the folder, mint a token,
// open the options page, paste the token, paste the hub's address. Every one of
// those steps except the two Chrome itself insists on happens here instead. The
// download carries a config.js holding this hub's address and a token minted for
// this account, and a manifest whose connect bridge is scoped to this exact
// origin — so the Record tab can SEE the extension afterwards and re-pair it
// without anyone typing anything.
//
// It is a POST because it rotates the token, and a GET that quietly invalidates
// the browser you already connected is a trap.
//
// Session-authenticated: only the signed-in owner can mint their own token.

export const runtime = "nodejs";

const SOURCE = "extension/jarvis-record";
/** Shipped for people reading the repo; the download says it better in place. */
const SKIP = new Set(["README.md"]);

/** This hub as the browser reached it — behind Vercel's proxy, that is a header. */
function hubOrigin(req: Request): string {
  const host =
    req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? new URL(req.url).host;
  const local = /^(localhost|127\.|\[::1\])/.test(host);
  const proto = req.headers.get("x-forwarded-proto") ?? (local ? "http" : "https");
  return `${proto}://${host}`;
}

async function sources(dir: string): Promise<ZipEntry[]> {
  const found = await readdir(dir, { withFileTypes: true });
  const out: ZipEntry[] = [];
  for (const entry of found) {
    if (!entry.isFile() || SKIP.has(entry.name)) continue;
    out.push({ name: entry.name, body: await readFile(path.join(dir, entry.name)) });
  }
  return out;
}

/**
 * Point this copy at one origin and one origin only.
 *
 * The committed manifest carries the localhost ports and a broad https rule so
 * a copy loaded straight from the repo can reach whichever hub it is told
 * about. This copy has been told already, so it is narrowed to that host: the
 * connect bridge runs on your hub and nowhere else, and the extension can fetch
 * your hub and nothing else.
 */
function retarget(raw: string, origin: string, present: Set<string>): string {
  const manifest = JSON.parse(raw) as Record<string, unknown> & {
    content_scripts?: { matches: string[] }[];
    icons?: Record<string, string>;
  };
  manifest.host_permissions = [`${origin}/*`];
  for (const script of manifest.content_scripts ?? []) script.matches = [`${origin}/*`];

  // A manifest that names a file which is not in the folder makes Chrome refuse
  // the WHOLE extension — "Could not load icon 'icon.png'" and nothing installs.
  // An icon is decoration; being unable to install is not. So if the picture did
  // not travel (it is gitignored by a blanket *.png rule on some checkouts, and
  // therefore absent from a deployed host), drop the claim rather than the
  // extension, and let Chrome use its default.
  if (manifest.icons && Object.values(manifest.icons).some((f) => !present.has(f))) {
    delete manifest.icons;
  }
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function config(origin: string, token: string): string {
  return [
    `// Written by your hub when you downloaded this, on ${new Date().toISOString().slice(0, 10)}.`,
    "// background.js copies these into the browser's storage the moment Chrome",
    "// installs the folder, so there is nothing to paste and no options page to open.",
    "//",
    "// Rotating the token is one button in Jarvis (Record, then Reconnect this",
    "// browser); it reaches the extension through connect.js, and this file going",
    "// stale afterwards is harmless.",
    "self.JARVIS_RECORD_CONFIG = {",
    `  hubUrl: ${JSON.stringify(origin)},`,
    `  token: ${JSON.stringify(token)},`,
    "};",
    "",
  ].join("\n");
}

/**
 * Chrome has no command line for "load this unpacked folder", and no web page
 * may open chrome://extensions. Those two steps belong to the owner,
 * permanently. What a script CAN do is everything around them: put the folder
 * somewhere it will still exist next month, leave its path on the clipboard for
 * the folder picker, and open the page the button is on.
 */
const INSTALLER = String.raw`@echo off
setlocal
title Jarvis Record - install

set "DEST=%LOCALAPPDATA%\Jarvis Record"

rem Double-clicking this from inside the zip window is the one way the whole
rem thing goes wrong quietly: Windows unpacks ONLY the file you clicked, to a
rem temporary folder, so there is nothing beside this script to copy and the
rem install ends up empty while reporting success. Refuse instead.
if not exist "%~dp0manifest.json" (
  echo.
  echo   Stop - this is running from inside the zip.
  echo.
  echo   Windows only unpacked this one file, so the extension itself is not
  echo   here and there is nothing to install yet.
  echo.
  echo   Close this window, then:
  echo.
  echo     1. Right-click jarvis-record.zip and choose "Extract All..."
  echo     2. Open the folder it creates
  echo     3. Run "Install on Windows" again from inside THAT folder
  echo.
  pause
  exit /b 1
)

echo Putting the extension somewhere permanent:
echo    %DEST%
echo.
echo A browser reads an unpacked extension off disk every time it starts, so it
echo must not live in Downloads, where it will be tidied away one day and the
echo extension will break with it.
echo.

if not exist "%DEST%" mkdir "%DEST%" >nul 2>&1
xcopy "%~dp0*" "%DEST%" /E /I /Y /Q >nul
del "%DEST%\Install on Windows.cmd" >nul 2>&1

rem Trust the result, not the exit code: what matters is that the browser will
rem find a manifest there.
if not exist "%DEST%\manifest.json" (
  echo   The copy did not work - nothing arrived at
  echo      %DEST%
  echo.
  echo   Move the unzipped folder somewhere simple, such as your Desktop, and
  echo   run this again. Or skip this script entirely: in chrome://extensions,
  echo   turn on Developer mode, press Load unpacked, and choose the unzipped
  echo   folder yourself.
  echo.
  pause
  exit /b 1
)

powershell -NoProfile -Command "Set-Clipboard -Value '%DEST%'" >nul 2>&1

rem "start chrome" depends on a PATH entry that often is not there. The browser
rem registers its real location under App Paths, so ask for that.
set "BROWSER="
set "PAGE=chrome://extensions/"
for /f "tokens=2,*" %%a in ('reg query "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe" /ve 2^>nul ^| find "REG_SZ"') do set "BROWSER=%%b"
if not defined BROWSER (
  for /f "tokens=2,*" %%a in ('reg query "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe" /ve 2^>nul ^| find "REG_SZ"') do set "BROWSER=%%b"
  if defined BROWSER set "PAGE=edge://extensions/"
)

echo Done. The extension is installed and its folder path is on your clipboard.
echo.
echo Two steps left, and only the browser can do them:
echo.
echo    1. Turn on Developer mode - the switch at the top right.
echo    2. Press "Load unpacked", then paste ^(Ctrl+V^) into the folder picker
echo       and press Select Folder.
echo.

if defined BROWSER (
  echo Opening the extensions page now.
  start "" "%BROWSER%" "%PAGE%"
) else (
  echo Open chrome://extensions yourself - the path is already on your clipboard.
)

echo.
echo Then go back to Jarvis. The Record tab will say connected on its own -
echo there is nothing to type in and nothing else to press.
echo.
pause
`;

const READ_ME = `Jarvis Record
=============

This folder IS the extension, and it already knows your hub and carries its own
token. There is nothing to paste and no options page to fill in.

FIRST: unzip it
---------------
Right-click jarvis-record.zip and choose "Extract All...". Do not run anything
straight from the zip window - Windows unpacks only the single file you click,
so the installer would find nothing to install.

Windows, the short way
----------------------
From the UNZIPPED folder, double-click "Install on Windows.cmd". It moves the
extension somewhere permanent, copies that path to your clipboard, and opens the
extensions page. Then: Developer mode on, Load unpacked, paste.

Any browser, by hand
--------------------
1. Move this folder somewhere permanent - NOT Downloads. A browser reads an
   unpacked extension off disk every time it starts, so if the folder goes, the
   extension goes with it.
2. Open chrome://extensions  (Edge: edge://extensions, Brave: brave://extensions)
3. Turn on Developer mode, press Load unpacked, choose this folder.

That is all. Go back to Jarvis, Record tab: it notices the extension by itself
and says your browser is connected.

Using it
--------
On any application form, click the extension's icon:

  Save what I typed here   reads the answers you filled in and sends them to
                           Jarvis. Nothing enters your Record until you confirm
                           it on the Record tab.

  Fill this form           types in what your Record already knows. It never
                           overwrites an answer you have already given.

Read every form before you submit it. The extension prepares applications; you
submit them.

Your Social Security number
---------------------------
It is not in this download, because it is not on the server: Jarvis strips every
sensitive field before anything is stored. If you want it typed in for you, put
it in this extension's own options, where it stays on this computer only.
`;

export async function POST(req: Request) {
  const origin = hubOrigin(req);
  const dir = path.resolve(process.cwd(), SOURCE);

  let files: ZipEntry[];
  try {
    files = await sources(dir);
  } catch {
    return NextResponse.json(
      {
        error:
          "This host does not have the extension's source files. Download it from a hub running out of the repo.",
      },
      { status: 500 },
    );
  }

  if (!files.some((f) => f.name === "manifest.json")) {
    return NextResponse.json({ error: "The extension is missing its manifest." }, { status: 500 });
  }

  const token = await mintToken(await sessionUid());
  if (!token) return storageFailed();

  const present = new Set(files.map((f) => f.name));
  const entries: ZipEntry[] = files.map((file) => {
    if (file.name === "manifest.json") {
      return { name: file.name, body: retarget(file.body.toString("utf8"), origin, present) };
    }
    if (file.name === "config.js") return { name: file.name, body: config(origin, token) };
    return file;
  });
  entries.push({ name: "READ ME FIRST.txt", body: READ_ME.replace(/\n/g, "\r\n") });
  entries.push({ name: "Install on Windows.cmd", body: INSTALLER.replace(/\n/g, "\r\n") });

  const zip = zipSync(entries);
  return new NextResponse(new Uint8Array(zip), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": 'attachment; filename="jarvis-record.zip"',
      "Content-Length": String(zip.length),
      "Cache-Control": "no-store",
    },
  });
}
