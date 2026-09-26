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
function retarget(raw: string, origin: string): string {
  const manifest = JSON.parse(raw) as Record<string, unknown> & {
    content_scripts?: { matches: string[] }[];
  };
  manifest.host_permissions = [`${origin}/*`];
  for (const script of manifest.content_scripts ?? []) script.matches = [`${origin}/*`];
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

echo Putting the extension somewhere permanent:
echo    %DEST%
echo.
echo A browser reads an unpacked extension off disk every time it starts, so it
echo must not live in Downloads, where it will be tidied away one day and the
echo extension will break with it.
echo.

if not exist "%DEST%" mkdir "%DEST%" >nul 2>&1
xcopy "%~dp0*" "%DEST%" /E /I /Y /Q >nul
if errorlevel 1 (
  echo Could not copy the files. Move this folder somewhere else and run it again.
  pause
  exit /b 1
)
del "%DEST%\Install on Windows.cmd" >nul 2>&1

powershell -NoProfile -Command "Set-Clipboard -Value '%DEST%'" >nul 2>&1
echo Done. The folder's path is on your clipboard.
echo.
echo Two steps left, and only the browser can do them:
echo.
echo    1. Turn on Developer mode, top right.
echo    2. Press Load unpacked, and paste the path into the folder picker.
echo.
echo Opening the extensions page now.
echo.

start chrome "chrome://extensions/" 2>nul || start msedge "edge://extensions/" 2>nul || echo Open chrome://extensions yourself - the path is on your clipboard.

echo Jarvis handles the rest. The Record tab will say connected on its own.
timeout /t 15 >nul 2>&1
`;

const READ_ME = `Jarvis Record
=============

This folder IS the extension, and it already knows your hub and carries its own
token. There is nothing to paste and no options page to fill in.

Windows, the short way
----------------------
Double-click "Install on Windows.cmd". It moves the extension somewhere
permanent, copies that path to your clipboard, and opens the extensions page.
Then: Developer mode on, Load unpacked, paste.

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

  const entries: ZipEntry[] = files.map((file) => {
    if (file.name === "manifest.json") {
      return { name: file.name, body: retarget(file.body.toString("utf8"), origin) };
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
