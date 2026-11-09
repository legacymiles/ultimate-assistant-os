// ---------------------------------------------------------------------------
// CLIs: what is installed on this PC, and installing the rest.
//
// "Use and manage CLIs" is a real request and a surprisingly awkward one. The
// shell can already run anything, so running is solved. What is not solved is
// knowing WHICH command-line tools are here: a model that assumes `gh` exists
// produces four failed steps and an apology, and one that runs `npx supabase`
// on every call downloads the same package forty times.
//
// So this is a small inventory with a version for each — enough for the model
// to choose the tool that is actually present — plus one install path per
// manager. Installing software is gated as grave by the page; this file only
// executes what it is told to.
// ---------------------------------------------------------------------------

import { spawn } from "node:child_process";

const WHICH = process.platform === "win32" ? "where" : "which";
const SHELL = process.platform === "win32";

/**
 * The tools worth knowing about.
 *
 * Not "every program on the machine" — that is a `where *` and a page of noise.
 * These are the ones the hub's own work asks for, so the model can say "gh is
 * not installed, but git is" instead of guessing.
 */
export const KNOWN = [
  { name: "git", label: "Git", manager: "winget", pkg: "Git.Git", why: "Commits, branches, worktrees." },
  { name: "gh", label: "GitHub CLI", manager: "winget", pkg: "GitHub.cli", why: "Repos, pull requests, issues, Actions." },
  { name: "vercel", label: "Vercel CLI", manager: "npm", pkg: "vercel", why: "Deploy, logs, env, domains." },
  { name: "supabase", label: "Supabase CLI", manager: "npm", pkg: "supabase", why: "Local stack, migrations, db push." },
  { name: "node", label: "Node.js", manager: "winget", pkg: "OpenJS.NodeJS.LTS", why: "Runs every JS tool here." },
  { name: "npm", label: "npm", manager: "winget", pkg: "OpenJS.NodeJS.LTS", why: "Installs the JS tools." },
  { name: "npx", label: "npx", manager: "winget", pkg: "OpenJS.NodeJS.LTS", why: "Runs a package without installing it." },
  { name: "python", label: "Python", manager: "winget", pkg: "Python.Python.3.12", why: "Runs Python tools and scripts." },
  { name: "uv", label: "uv", manager: "winget", pkg: "astral-sh.uv", why: "Fast Python installs and tools." },
  { name: "pip", label: "pip", manager: "winget", pkg: "Python.Python.3.12", why: "Installs Python packages." },
  { name: "docker", label: "Docker", manager: "winget", pkg: "Docker.DockerDesktop", why: "Containers." },
  { name: "aws", label: "AWS CLI", manager: "winget", pkg: "Amazon.AWSCLI", why: "AWS resources." },
  { name: "gcloud", label: "Google Cloud CLI", manager: "winget", pkg: "Google.CloudSDK", why: "Google Cloud resources." },
  { name: "wrangler", label: "Wrangler", manager: "npm", pkg: "wrangler", why: "Cloudflare Workers and Pages." },
  { name: "netlify", label: "Netlify CLI", manager: "npm", pkg: "netlify-cli", why: "Netlify deploys." },
  { name: "railway", label: "Railway CLI", manager: "npm", pkg: "@railway/cli", why: "Railway deploys." },
  { name: "claude", label: "Claude Code", manager: "npm", pkg: "@anthropic-ai/claude-code", why: "The coding agent this harness can run." },
  { name: "dsh", label: "DeepSeek Harness", manager: "npm", pkg: "@deepseek-ai/dsh", why: "The other coding agent this harness can run." },
  { name: "ffmpeg", label: "ffmpeg", manager: "winget", pkg: "Gyan.FFmpeg", why: "Audio and video conversion." },
  { name: "yt-dlp", label: "yt-dlp", manager: "winget", pkg: "yt-dlp.yt-dlp", why: "Downloads video from links." },
];

function run(command, args, timeoutMs) {
  return new Promise((resolve) => {
    let out = "";
    let done = false;
    let child;
    try {
      child = spawn(command, args, { shell: SHELL, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
      return resolve({ ok: false, out: String(e?.message ?? e) });
    }
    const finish = (ok) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        child.kill();
      } catch {
        /* gone. */
      }
      resolve({ ok, out: out.trim() });
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (c) => {
      out = `${out}${c}`.slice(0, 8_000);
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (c) => {
      out = `${out}${c}`.slice(0, 8_000);
    });
    child.on("error", (e) => {
      out = `${out}${e?.message ?? e}`;
      finish(false);
    });
    child.on("exit", (code) => finish(code === 0));
  });
}

/** First line, trimmed — versions are one line for every tool here. */
function versionLine(text) {
  return text.split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? "";
}

export async function listTools() {
  const found = [];
  // In parallel, because twenty sequential `where` calls is a second and a half
  // of the owner's life on every page load.
  const rows = await Promise.all(
    KNOWN.map(async (tool) => {
      const where = await run(WHICH, [tool.name], 4_000);
      if (!where.ok) return { ...tool, installed: false, path: "", version: "" };
      const path = where.out.split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? "";
      const args = tool.name === "ffmpeg" ? ["-version"] : ["--version"];
      const version = await run(tool.name, args, 6_000);
      return {
        name: tool.name,
        label: tool.label,
        installed: true,
        path,
        version: versionLine(version.out),
        why: tool.why,
        manager: tool.manager,
        pkg: tool.pkg,
      };
    }),
  );
  for (const row of rows) found.push(row);
  return {
    tools: found,
    installed: found.filter((t) => t.installed).length,
    total: found.length,
    note: "`installed` is read from this PC right now. To run one, use shell_run.",
  };
}

export async function installTool(body = {}) {
  const name = String(body.name ?? body.tool ?? "").trim().toLowerCase();
  if (!name) throw Object.assign(new Error("Which CLI should be installed?"), { status: 400 });
  const known = KNOWN.find((t) => t.name === name);
  const manager = String(body.manager ?? known?.manager ?? "npm");
  const pkg = String(body.pkg ?? known?.pkg ?? name);

  let command;
  let args;
  if (manager === "npm") {
    command = "npm";
    args = ["install", "-g", pkg];
  } else if (manager === "winget") {
    command = "winget";
    args = ["install", "--id", pkg, "-e", "--accept-source-agreements", "--accept-package-agreements", "--silent"];
  } else if (manager === "pip") {
    command = "python";
    args = ["-m", "pip", "install", "--user", pkg];
  } else if (manager === "uv") {
    command = "uv";
    args = ["tool", "install", pkg];
  } else {
    throw Object.assign(new Error(`Jarvis can install with npm, winget, pip or uv — not "${manager}".`), { status: 400 });
  }

  const out = await run(command, args, 240_000);
  return {
    name,
    manager,
    package: pkg,
    ok: out.ok,
    said: out.out.split(/\r?\n/).slice(-12).join("\n"),
    note: out.ok
      ? "Installed. Open a NEW shell for PATH changes to take effect; `cli` action=list should show it."
      : "That did not finish cleanly. The last lines of its output are above.",
  };
}
