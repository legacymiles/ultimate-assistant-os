---
name: claude-security
description: Deep security scan of an app or website before it goes to a client or the public — Anthropic's official Claude Security plugin, where a team of agents maps the code, hunts for holes, independently verifies every finding, writes a plain-English report and drafts reviewed patches. This skill installs the plugin if it's missing and runs it. Use when the user says "security scan", "check for holes", "is this safe to launch", "scan Jarvis", "scan my branch", "fix finding F3", or before handing any site or app over. Nicknames: claude security, security scan, security check, scan for holes, vulnerability scan, pentest my code.
metadata:
  category: Security, Testing
  nicknames: claude security, security scan, security check, scan for holes, vulnerability scan, pentest my code
  source: https://code.claude.com/docs/en/claude-security
---

# Claude Security — scan before you ship

The real work is done by Anthropic's official **claude-security** plugin (marketplace
`anthropics/claude-plugins-official`). This skill makes sure it is installed, then runs it.
Its agents, workflow and scripts live in the plugin, so never try to imitate the scan by hand.

## 1. Make sure the plugin is installed (do this yourself — don't ask the owner to)

Check first: `claude plugin list` (look for `claude-security`). If it's missing, run in the
terminal:

```bash
claude plugin marketplace add anthropics/claude-plugins-official   # only if the marketplace is missing
claude plugin install claude-security@claude-plugins-official
```

Inside a session the same thing is `/plugin install claude-security@claude-plugins-official`,
then `/reload-plugins` if the install summary asks for it.

Needs: a paid Claude plan (dynamic workflows — on Pro, turn on the "Dynamic workflows" row in
`/config`), `python3` 3.9+ on PATH (on Windows check `python3 --version`; if only `python`
exists, install Python 3 from python.org or the Microsoft Store), and git for branch scans and
patches. It runs in a Claude Code session on the PC or VPS, not in a claude.ai chat.

## 2. Run it

- `/claude-security` opens the menu: **Scan codebase**, **Scan changes**, **Suggest patches**.
- Or ask directly: `/claude-security scan my branch`, "scan commit abc1234", "fix finding F3".
- On a big repo like the hub, scan one area at a time (API routes, auth, a single app under
  `src/app/...`). The plugin offers scopes with file counts and relative cost.
- A full scan uses a lot of tokens and Claude Code must stay open. Say so before starting; it
  only runs after confirmation. Auto mode lets its agents work without a prompt at each step.

## 3. Read the results and fix

- Results land in `CLAUDE-SECURITY-<timestamp>/` in the repo (it has its own .gitignore):
  `CLAUDE-SECURITY-RESULTS.md` (each finding F1, F2… with impact, severity, fix), plus
  `.jsonl` and `.sarif` versions.
- Explain every finding to the owner in plain English: what could happen, who could do it,
  how bad it is.
- **Suggest patches** writes reviewed `patches/F<n>.patch` files. They are never applied
  automatically. Apply each one in its own branch/PR (`git apply CLAUDE-SECURITY-<ts>/patches/F1.patch`),
  run the tests, and follow the owner's normal commit-and-push rule.
- For anything with logins, payments or client data, add the fixes as checklist items (S codes)
  in the owner's `website-build-checklist` so they stay fixed.

## Other layers (mention only when useful)

`/security-review` is a quick single pass on the current branch; the plugin is the deep scan.
Use both: quick pass on every change, deep scan before a launch or a client handoff.
