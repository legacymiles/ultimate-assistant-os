// ---------------------------------------------------------------------------
// What a 24/7 agent may do when NOBODY IS THERE.
//
// The harness gate (harness-gate.mjs) exists for a session the owner is
// watching: anything it is unsure about, it ASKS. A wake runner has nobody to
// ask — it starts at six in the morning because the laptop opened — so the
// same policy would either hang forever on the first question or, if someone
// "fixed" that by skipping permissions, hand an unattended model a shell.
//
// So this is a deliberately different policy, not a copy of that one:
//
//   ALLOW or BLOCK. Never ask.
//
// Anything not plainly on the list is blocked with a sentence that tells the
// agent what to do instead — mark itself blocked and let the owner see it.
// Being stopped and saying why is always better than guessing on someone's
// machine while they sleep.
//
// The rule of thumb for what belongs here: could this, done wrong at 3am with
// nobody watching, cost the owner something they cannot get back? Writing a
// rendered frame cannot. Pushing a branch, deleting a file, installing
// software, or spending money can.
// ---------------------------------------------------------------------------

/** Tools that only look. Reading is never the thing that ruins a morning. */
const READ_TOOLS = new Set(["Read", "Glob", "Grep", "LS", "NotebookRead", "TodoWrite"]);

/**
 * Looking things up on the web.
 *
 * A research agent ("find the newest MT4/MT5 EAs") is useless without these,
 * and neither one can change anything on this machine. Curl stays local-only
 * below: these are the search tools, not a general way to send files out.
 */
const WEB_TOOLS = new Set(["WebSearch", "WebFetch"]);

/** The agent's own bookkeeping on the hub. Refusing these would strand it. */
const BOOKKEEPING = /^mcp__[a-z0-9_-]*(jarvis[-_]?memory)[a-z0-9_-]*__(agent_|queue_|log_activity|add_finding|get_findings|get_router|search_memory|get_skill|list_skills)/i;

/**
 * Programs a render job genuinely needs.
 *
 * Named exactly. "python" is here because WanGP is a Python API and the
 * picture drawer is a Python worker; it is also the widest door on the list,
 * which is why the argument rules below still apply to it.
 */
const ALLOWED_BIN = new Set([
  "node",
  "npm",
  "npx",
  "python",
  "python3",
  "py",
  "ffmpeg",
  "ffprobe",
  "blender",
  "unrealeditor",
  "unrealeditor-cmd",
  "runuat",
  "curl",
  "git",
  "echo",
  "cd",
  "ls",
  "dir",
  "type",
  "cat",
  "mkdir",
]);

/**
 * PowerShell cmdlets that only look.
 *
 * Found the hard way: on Windows the agent reaches for the PowerShell tool
 * rather than Bash, so a policy that only knew about binaries refused every
 * single command. It failed closed, which is the right way to fail, but it
 * made the whole feature useless on the owner's actual machine.
 *
 * Writing is deliberately absent -- Set-Content and New-Item -Force both
 * truncate -- so the agent writes through the Write tool, whose path IS
 * checked, instead of through a shell.
 */
const PS_READONLY = new Set([
  "get-childitem",
  "get-content",
  "get-item",
  "get-command",
  "get-date",
  "get-location",
  "test-path",
  "join-path",
  "resolve-path",
  "select-object",
  "where-object",
  "measure-object",
  "sort-object",
  "foreach-object",
  "select-string",
  "write-output",
  "write-host",
  "out-string",
  "convertfrom-json",
  "convertto-json",
]);

/** git is allowed, but only the half of it that reads. */
const GIT_READONLY = new Set(["status", "log", "diff", "show", "branch", "rev-parse", "describe", "ls-files"]);

/** Never, whatever else is on the line. */
const FORBIDDEN = [
  { re: /\brm\b|\bdel\b|\brmdir\b|Remove-Item|\bunlink\b/i, why: "it deletes things" },
  { re: /\bformat\b|\bmkfs\b|\bdiskpart\b/i, why: "it formats a disk" },
  { re: /shutdown|restart-computer|\breboot\b/i, why: "it shuts the machine down" },
  { re: /\bgit\s+(push|reset|clean|rebase|checkout|switch|branch\s+-[dD]|commit)/i, why: "it changes the owner's git history or branches" },
  { re: /npm\s+(install|i|add|uninstall|update)\b|pip\s+install|winget|choco\b|apt(-get)?\s+install/i, why: "it installs software" },
  { re: /\bcurl\b[^|]*\|\s*(sh|bash|powershell|cmd)/i, why: "it pipes something off the internet into a shell" },
  { re: /Invoke-Expression|\biex\b|eval\s*\(/i, why: "it runs text as code" },
  { re: /\bsudo\b|runas\b|Start-Process[^|]*-Verb\s+RunAs/i, why: "it asks for administrator rights" },
  { re: /\bssh\b|\bscp\b|\bnet\s+use\b/i, why: "it reaches another machine" },
];

/**
 * Where a command would write by redirecting.
 *
 * `node render.mjs > C:/dev/app/src/page.tsx` runs an allowed program and
 * still overwrites the owner's code. Checking only the program misses it
 * entirely, in either shell.
 */
export function redirectTargets(command) {
  const out = [];
  const text = String(command || "");
  for (const m of text.matchAll(/(?:^|\s)>>?\s*("([^"]+)"|'([^']+)'|(\S+))/g)) {
    out.push(m[2] || m[3] || m[4] || "");
  }
  for (const m of text.matchAll(/\b(?:Out-File|Set-Content|Add-Content|Tee-Object)\b[^|;]*?(?:-(?:FilePath|Path)\s+)?("([^"]+)"|'([^']+)'|([A-Za-z]:[\\/][^\s|;]+))/gi)) {
    out.push(m[2] || m[3] || m[4] || "");
  }
  return out.filter(Boolean);
}

/** A curl that only talks to this machine is how the picture drawer is used. */
const LOCAL_URL = /^(https?:\/\/)?(127\.0\.0\.1|localhost|\[::1\])(:\d+)?(\/|$)/i;

/**
 * Split a command line into the pieces that will actually run.
 *
 * Every piece has to pass on its own: `node render.mjs && rm -rf out` is not a
 * node command, it is a node command AND a delete, and a check that only read
 * the first word would wave it through.
 */
export function segments(command) {
  return String(command || "")
    .split(/&&|\|\||;|\||\n|\r/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** The program a segment runs, lowercased and stripped of any path. */
export function binaryOf(segment) {
  const first = String(segment).trim().match(/^"([^"]+)"|^'([^']+)'|^(\S+)/);
  if (!first) return "";
  const raw = first[1] || first[2] || first[3] || "";
  const base = raw.split(/[\\/]/).pop() || raw;
  return base.replace(/\.(exe|cmd|bat|ps1)$/i, "").toLowerCase();
}

/** Is this shell command safe to run with nobody watching? */
export function bashAllowed(command, roots = []) {
  const text = String(command || "");
  if (!text.trim()) return { allow: false, why: "an empty command" };

  for (const rule of FORBIDDEN) {
    if (rule.re.test(text)) return { allow: false, why: rule.why };
  }

  // An allowed program redirected over the owner's code is still a write.
  for (const target of redirectTargets(text)) {
    if (/^[A-Za-z]:[\\/]|^[\\/]/.test(target) && !insideWorkspace(target, roots)) {
      return { allow: false, why: `it writes to ${target}, outside the folder this agent was given` };
    }
  }

  for (const seg of segments(text)) {
    const bin = binaryOf(seg);
    if (!ALLOWED_BIN.has(bin) && !PS_READONLY.has(bin)) {
      return { allow: false, why: `"${bin || seg.slice(0, 20)}" isn't on the unattended list` };
    }
    if (bin === "git") {
      const sub = (seg.match(/\bgit\s+(\S+)/i) || [])[1]?.toLowerCase() || "";
      if (!GIT_READONLY.has(sub)) return { allow: false, why: `git ${sub || "(nothing)"} changes the repo` };
    }
    if (bin === "curl") {
      // Only this machine. A curl that can reach the internet unattended is a
      // way to send the owner's files somewhere.
      const url = (seg.match(/(?:^|\s)(?:"([^"]+)"|'([^']+)'|(https?:\/\/\S+|localhost\S*|127\.0\.0\.1\S*))/i) || []);
      const target = url[1] || url[2] || url[3] || "";
      if (!LOCAL_URL.test(target)) return { allow: false, why: "curl may only talk to this machine" };
    }
  }
  return { allow: true, why: "" };
}

/** Is this path inside somewhere the agent is allowed to write? */
export function insideWorkspace(filePath, roots) {
  const norm = (p) => String(p || "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  const target = norm(filePath);
  if (!target) return false;
  return roots.some((r) => {
    const root = norm(r);
    return root && (target === root || target.startsWith(root + "/"));
  });
}

/**
 * The one decision.
 *
 * `roots` are the folders writing is allowed in — the worktree the runner
 * made and a scratch folder, never the checkout the owner has open.
 */
export function decide(name, args, { roots = [] } = {}) {
  if (READ_TOOLS.has(name)) return { allow: true, why: "" };
  if (WEB_TOOLS.has(name)) return { allow: true, why: "" };
  if (BOOKKEEPING.test(name)) return { allow: true, why: "" };

  // PowerShell is the SAME decision as Bash: on Windows it is the shell the
  // agent actually reaches for, and leaving it to the default-deny below
  // refused every legitimate render command.
  if (name === "Bash" || name === "BashOutput" || name === "PowerShell") {
    return bashAllowed(args?.command ?? "", roots);
  }

  if (name === "Write" || name === "Edit" || name === "MultiEdit" || name === "NotebookEdit") {
    const p = args?.file_path ?? args?.notebook_path ?? "";
    if (!insideWorkspace(p, roots)) {
      return { allow: false, why: "writing outside the folder this agent was given" };
    }
    return { allow: true, why: "" };
  }

  // Everything else — browsers, other MCP servers, anything new a future
  // version adds — is blocked by default rather than by omission. A tool this
  // policy has never heard of is exactly the one not to run unwatched.
  return { allow: false, why: `${name} isn't allowed when nobody's watching` };
}

/** What the agent is told when it is stopped, so it can do the right thing. */
export function denial(why) {
  return (
    `Blocked: ${why}. Nobody is at the machine, so this can't be approved right now. ` +
    `If the goal genuinely needs it, call agent_note with blocked: true saying exactly what you need, ` +
    `and the owner will see it on their screen. Otherwise carry on another way.`
  );
}
