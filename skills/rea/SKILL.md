---
name: rea
description: >-
  Reverse-engineer a program, app, or website you own or are authorized to analyze — down to the
  binary — using REA (the rea-agents MCP). Use when asked to "rea", reverse engineer, understand how
  a feature works under the hood, inspect a native binary / Electron / .NET / JS app / website, trace
  runtime behavior, or rebuild a feature from an app whose source you don't have. Analysis is local
  and every finding comes with its evidence.
---

# REA — Reverse Engineer Anything

REA is an open-source (MIT) reverse-engineering toolkit that plugs into the agent as an MCP server.
The npm package is **`rea-agents`**; the project lives at **github.com/morluto/rea** and **rea.tools**.
Invoke this skill when the owner says "rea", "reverse engineer this", "how does this feature work
underneath", or asks to inspect/understand a binary, app, or site without its source.

Use only the official sources above. A repo with a similar name or a copied README is not proof a
download is genuine — follow the install links from rea.tools or the npm page.

## Before anything: scope and the line this skill will not cross

REA inspects things you own or are **authorized** to analyze — your own software, a competitor's
feature you want to understand and rebuild cleanly, your own device's firmware, a site's own API.
Confirm that footing before starting. This skill will **not**:

- break, strip, or circumvent DRM, licensing, copy-protection, or anti-tamper on paid/proprietary
  software — including decrypting an encrypted binary to read code the vendor protected;
- extract secrets (keys, credentials) from software to pirate it or defeat its licensing;
- help attack, intrude on, or exfiltrate from systems or accounts that aren't the owner's.

Understanding how a feature works so you can build your **own** version is fine, and is REA's main
use. Defeating a protection so you can run or resell someone else's product is not — decline that
and say why, then offer the legitimate path (black-box observation, or the vendor's own API/docs).

> Worked example from this hub: the "HFT Secret" `.ex4` the owner has is a **MetaTrader-encrypted**
> compiled EA (and a cracked copy at that). REA cannot read inside it, and this skill will not try to
> break that encryption. The right move is black-box: observe what it DOES — its trades — via
> EA World › Replay › **Fingerprint the original** (`src/lib/ea-replay/statement.ts`), which reads an
> MT4 statement or Strategy Tester report and measures the strategy from the outside. REA is for the
> cases where you're authorized to go inside: your own binaries, or understanding an unprotected
> feature to reimplement it.

## Setup (once per machine)

With Node.js + npm installed, register REA with the agent:

```bash
npx rea-agents setup
```

Setup registers the MCP server and installs its workflow instructions. Native-code analysis can reuse
an existing **Hopper, Ghidra, or IDA** install (setup can offer to install Hopper with approval);
**static JavaScript/Electron** analysis needs no native engine. On Linux, several launchers (Ghidra,
JADX, firmware tools, static JS/Electron) need a procps-compatible `ps` on `PATH` for process-owner
checks — see the project's `docs/installation.md` if a launch is refused.

On this account's machines: the owner's **VPS runs Windows (PowerShell)**, so give PowerShell, not
bash. The hub's model router and keys are separate from REA — REA runs its own local analysis engines.

## What REA can analyze

- **Native binaries** — Mach-O, PE, ELF, and more, across common CPU architectures, through a
  Ghidra/Hopper/IDA bridge: functions, cross-references, decompiled pseudocode, strings.
- **JavaScript & Electron apps** — unpack `.asar`, read bundles and source maps, trace modules and
  native hand-offs, statically, no run required.
- **.NET / managed assemblies** and **Android** (APK/JADX) and some **firmware** images.
- **Websites** — DOM, network captures (HAR/qlog, HTTP/2 and HTTP/3), bundled and source-mapped JS.
- **Runtime behavior** — with Frida / GDB, watch what a program actually does while it runs:
  calls, arguments, data in flight (on targets you're authorized to instrument).

## How to work with it

1. **State the goal and the authorization** in one line ("understand X's export format in my own
   app", "see how this unprotected widget renders so I can rebuild it"). If it's a protection-defeat
   request, stop here and offer the black-box path instead.
2. **Pick the surface**: static for structure and logic (binary, bundle, assembly); runtime
   (Frida/GDB) only when you need to see live values and you can instrument the target.
3. **Let REA gather evidence**, then read its findings. REA reports **evidence and limitations with
   every conclusion** — carry that through: say what was observed vs inferred, and don't overclaim.
4. **Rebuild cleanly.** When the aim is to reimplement a feature, write your own code from the
   understanding — never paste decompiled or extracted proprietary code into the owner's project.

## Where results go in this hub

Findings about trading bots feed **EA World** (`/apps/ea-world`): a strategy understood here can be
written as an MT4 `.mq4` or a Replay bot (`src/lib/ea-replay/strategies/`) and measured in Replay.
For anything else, summarize the mechanism and the evidence in the reply; commit rebuilt code to the
relevant app, not the decompiler output.
