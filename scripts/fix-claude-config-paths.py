"""Repair ~/.claude.json after the hub repo moved out of OneDrive.

Companion to finish-onedrive-move.ps1, whose step 4 never landed: the config
still registers the OneDrive folder, and that is what makes Claude Code show
"<folder> no longer exists" and what breaks the `unreal` MCP server.

Three things are wrong and each needs different handling:

  1. mcpServers.unreal.args[0] points at the old tools/unreal-bridge/server.mjs
     -> rewrite the path. The file does exist at the new location.
  2. Project entries keyed by the old folder, in both slash spellings
     -> rename to the new key, or merge-and-drop when the new key already
        exists (the app creates it the first time a session opens the new
        folder). A renamed key whose folder is still missing is dropped
        instead, so the app stops offering a folder that is not there.
  3. An activeWorktreeSession naming a worktree under the old folder
     -> DROP it. Rewriting the path would only move the error, because that
        worktree was never recreated at the new location.

Re-runnable: a second run reports "already clean" and writes nothing.

Run it from a plain terminal with every Claude Code session closed. A live
session holds its own copy of this config and rewrites the file on exit,
which would undo whatever this changes.

    python scripts/fix-claude-config-paths.py
    python scripts/fix-claude-config-paths.py --dry-run
"""

import io
import json
import os
import shutil
import sys
import time

CONFIG = os.path.join(os.path.expanduser("~"), ".claude.json")

# chr(92) is a backslash. Writing one as a literal here is a trap: this file
# gets regenerated through shell heredocs that silently halve doubled
# backslashes, which turned a "[\/]" character class into "[\/]" -- a class
# matching only a forward slash. Paths are matched slash-normalized instead.
BS = chr(92)

OLD_FWD = "C:/Users/honey/OneDrive/Desktop/claude code files"
NEW_FWD = "C:/dev/claude-code-files"


def norm(path):
    """Slash-normalized and lowercased, for comparing Windows paths."""
    return path.replace(BS, "/").lower()


def is_stale(path):
    return norm(path).startswith(OLD_FWD.lower())


def repoint(path):
    """Swap the old repo path for the new one, keeping the original's slashes."""
    tail = path.replace(BS, "/")[len(OLD_FWD):]
    out = NEW_FWD + tail
    # A path written with backslashes should stay that way.
    return out if "/" in path else out.replace("/", BS)


def fix_mcp_servers(cfg, log):
    servers = cfg.get("mcpServers")
    if not isinstance(servers, dict):
        return 0

    fixed = 0
    for name, server in servers.items():
        args = server.get("args") if isinstance(server, dict) else None
        if not isinstance(args, list):
            continue
        for i, arg in enumerate(args):
            if isinstance(arg, str) and is_stale(arg):
                args[i] = repoint(arg)
                missing = "" if os.path.exists(args[i]) else "   (WARNING: not on disk)"
                log.append("  mcpServers.%s.args[%d] -> %s%s" % (name, i, args[i], missing))
                fixed += 1
    return fixed


def drop_dead_worktree_sessions(cfg, log):
    """Remove activeWorktreeSession blocks whose worktree is not on disk."""
    dropped = 0
    for key, entry in cfg.get("projects", {}).items():
        if not isinstance(entry, dict):
            continue
        session = entry.get("activeWorktreeSession")
        if not isinstance(session, dict):
            continue
        path = session.get("worktreePath") or ""
        if path and not os.path.isdir(path):
            del entry["activeWorktreeSession"]
            log.append("  dropped activeWorktreeSession (%s)"
                       % (session.get("worktreeName") or "unnamed"))
            log.append("      from %s" % key)
            dropped += 1
    return dropped


def fix_project_keys(cfg, log):
    """Rename old-path project keys onto the new path; drop the ones still gone."""
    projects = cfg.get("projects")
    if not isinstance(projects, dict):
        return 0

    stale = [k for k in projects if is_stale(k)]
    changed = 0

    for key in stale:
        entry = projects.pop(key)
        target = repoint(key)

        if not os.path.isdir(target):
            # Nothing was recreated here, so keeping the entry would just put
            # a dead folder back in the app's project list.
            log.append("  dropped %s" % key)
            log.append("      (target %s does not exist)" % target)
            changed += 1
            continue

        # One folder can already be registered under a different slash
        # spelling. Fold into whichever key is there rather than adding a
        # second entry for the same directory.
        existing = next((k for k in projects if norm(k) == norm(target)), None)

        if existing:
            # Keep what that entry has and only fill in fields it is
            # missing, so nothing already set there is lost.
            carried = [f for f in entry if f not in projects[existing]]
            for f in carried:
                projects[existing][f] = entry[f]
            log.append("  merged %s" % key)
            log.append("      into %s%s"
                       % (existing, (" (carried %s)" % ", ".join(carried)) if carried else ""))
        else:
            projects[target] = entry
            log.append("  renamed %s" % key)
            log.append("        to %s" % target)
        changed += 1

    return changed


def main():
    dry_run = "--dry-run" in sys.argv

    if not os.path.exists(CONFIG):
        print("No config at %s -- nothing to do." % CONFIG)
        return 0

    raw = io.open(CONFIG, encoding="utf-8").read()
    cfg = json.loads(raw)

    log = []
    n_mcp = fix_mcp_servers(cfg, log)
    n_wt = drop_dead_worktree_sessions(cfg, log)
    n_proj = fix_project_keys(cfg, log)

    if not (n_mcp or n_wt or n_proj):
        print("Already clean: no OneDrive repo paths in %s" % CONFIG)
        return 0

    print("Repairing %s" % CONFIG)
    print()
    for line in log:
        print(line)
    print()
    print("  %d MCP server path(s), %d dead worktree session(s), %d project entr(ies)"
          % (n_mcp, n_wt, n_proj))

    if dry_run:
        print()
        print("--dry-run: nothing written.")
        return 0

    backup = "%s.bak-%s" % (CONFIG, time.strftime("%Y%m%d-%H%M%S"))
    shutil.copy2(CONFIG, backup)

    # Write via a temp file so an interrupted run cannot leave a half-written
    # config -- this file is the only record of every project's trust decision.
    tmp = CONFIG + ".tmp"
    with io.open(tmp, "w", encoding="utf-8") as fh:
        json.dump(cfg, fh, indent=2, ensure_ascii=False)
    os.replace(tmp, CONFIG)

    print()
    print("  backup: %s" % backup)

    after = json.loads(io.open(CONFIG, encoding="utf-8").read())
    left = [k for k in after.get("projects", {}) if is_stale(k)]
    if left:
        print()
        print("WARNING: %d old-path project entr(ies) still present." % len(left))
        return 1

    print()
    print("Done. Reopen Claude Code at %s" % NEW_FWD.replace("/", BS))
    return 0


if __name__ == "__main__":
    sys.exit(main())
