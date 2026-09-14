#!/usr/bin/env node
// Register the ueos:// link handler for the current Windows user.
//
// Writes HKEY_CURRENT_USER\Software\Classes\ueos so a "Play" or "Open in
// Unreal" button on the Game Creator page runs open.mjs. Per-user, so no
// administrator rights are needed; remove it with:
//   reg delete HKCU\Software\Classes\ueos /f

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "win32") {
  console.error("The ueos:// handler is Windows-only.");
  process.exit(1);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const handler = path.join(here, "open.mjs");
const command = `"${process.execPath}" "${handler}" "%1"`;
const key = "HKCU\\Software\\Classes\\ueos";

const reg = (...args) => execFileSync("reg", args, { stdio: "pipe" });
reg("add", key, "/ve", "/d", "URL:Game Creator", "/f");
reg("add", key, "/v", "URL Protocol", "/d", "", "/f");
reg("add", `${key}\\shell\\open\\command`, "/ve", "/d", command, "/f");

console.log("Registered ueos:// ->", command);
console.log("\nOptional: run the builder automatically when you sign in:");
console.log(
  `  schtasks /Create /SC ONLOGON /TN "Game Creator Builder" /TR "cmd /c cd /d \\"${here}\\" && npm run builder" /RL LIMITED`,
);
