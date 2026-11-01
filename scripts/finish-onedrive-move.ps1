# Finish moving the hub repo out of OneDrive.
#
# Run this from a PLAIN PowerShell window with every Claude Code session closed.
# Two reasons it cannot run from inside Claude:
#   - ~/.claude.json is rewritten by live sessions, so an edit made now gets clobbered.
#   - a Claude session's working directory is the old folder, which is what we are leaving.
#
# It is re-runnable and it never deletes the original. Deleting that is a separate,
# deliberate step you take once you are happy (see the end of this file).

$ErrorActionPreference = 'Stop'

$old = 'C:\Users\honey\OneDrive\Desktop\claude code files'
$new = 'C:\dev\claude-code-files'

# The five spellings of the old path that appear across the repo and the user config.
# Order matters: the JSON-escaped (doubled backslash) form is replaced before the plain one.
$map = [ordered]@{
  'C:\\Users\\honey\\OneDrive\\Desktop\\claude code files' = 'C:\\dev\\claude-code-files'
  'C:/Users/honey/OneDrive/Desktop/claude code files'       = 'C:/dev/claude-code-files'
  'C:\Users\honey\OneDrive\Desktop\claude code files'       = 'C:\dev\claude-code-files'
  '/c/Users/honey/OneDrive/Desktop/claude code files'       = '/c/dev/claude-code-files'
  'C--Users-honey-OneDrive-Desktop-claude-code-files'       = 'C--dev-claude-code-files'
}

# Files whose "OneDrive" mentions are prose, generic pick-list options, or records of a
# past run. Rewriting these would corrupt meaning, not fix a path.
$skip = @(
  'src/lib/new-dashboard/model.ts'
  'src/lib/new-dashboard/questions.ts'
  'src/lib/new-dashboard/known.ts'
  'src/lib/seed-content/cook-connect.ts'
  'docs/superpowers/specs/2026-09-14-realtime-lucy-design.md'
  'tools/studio-bridge/server.mjs'
  'tools/realtime-lucy/bench/bench-192x256_cs1_s2_kv6.json'
  'tools/realtime-lucy/bench/bench-288x384_cs1_s2_kv9.json'
)

$exts = '.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.md', '.cmd', '.ps1', '.sh', '.py',
        '.txt', '.yml', '.yaml', '.env', '.mq4', '.sql'

function Rewrite-Paths {
  param([string[]]$Files, [string]$Root)

  $changed = 0
  foreach ($f in $Files) {
    if (-not (Test-Path $f)) { continue }

    if ($Root) {
      $rel = $f.Substring($Root.Length + 1).Replace('\', '/')
      if ($skip -contains $rel) { continue }
    }

    $txt = [IO.File]::ReadAllText($f)
    if ($txt -notmatch 'OneDrive') { continue }
    # A path string inside a .pyc or a LevelDB file must never be text-replaced.
    if ($txt.Contains([char]0)) { continue }

    $orig = $txt
    foreach ($k in $map.Keys) { $txt = $txt.Replace($k, $map[$k]) }
    if ($txt -ne $orig) {
      [IO.File]::WriteAllText($f, $txt)
      $changed++
      Write-Host "    fixed $($f.Replace($Root, '.'))"
    }
  }
  return $changed
}

Write-Host ''
Write-Host '== 1. checking no Claude session is running ==' -ForegroundColor Cyan
$live = @(Get-Process claude -ErrorAction SilentlyContinue)
if ($live.Count -gt 0) {
  Write-Host "  $($live.Count) claude process(es) still running." -ForegroundColor Yellow
  Write-Host '  Close every Claude Code session and run this again --' -ForegroundColor Yellow
  Write-Host '  a live session will overwrite the ~/.claude.json edit in step 4.' -ForegroundColor Yellow
  exit 1
}
Write-Host '  none running.'

Write-Host ''
Write-Host '== 2. bringing across anything written since the copy ==' -ForegroundColor Cyan
# /XO copies only files NEWER at the source. The files already repointed at the
# destination are newer there, so they survive. node_modules is rebuilt by npm,
# and jarvis-bridge\out is a regenerable Chrome profile.
robocopy $old $new /E /XO /R:1 /W:1 /NFL /NDL /NJH /NP /MT:16 `
  /XD node_modules .next .next-preview .next-verify-nj .next-deploycheck __pycache__ "$old\tools\jarvis-bridge\out" `
  /XF *.log *.pyc | Select-Object -Last 6

Write-Host ''
Write-Host '== 3. re-applying the path rewrite (in case step 2 carried an old copy over) ==' -ForegroundColor Cyan
$repoFiles = Get-ChildItem $new -Recurse -File -Force -ErrorAction SilentlyContinue |
  Where-Object {
    $_.FullName -notlike '*\node_modules\*' -and
    $_.FullName -notlike '*\.git\*' -and
    ($exts -contains $_.Extension.ToLower())
  } | Select-Object -ExpandProperty FullName
$n = Rewrite-Paths -Files $repoFiles -Root $new
Write-Host "  $n file(s) rewritten."

Write-Host ''
Write-Host '== 4. repointing ~/.claude.json (MCP server path + project entries) ==' -ForegroundColor Cyan
$cfg = 'C:\Users\honey\.claude.json'
Copy-Item $cfg "$cfg.bak-onedrive-move" -Force
Write-Host "  backup written to $cfg.bak-onedrive-move"
# 'assistant ai folder' also lives under OneDrive\Desktop and is a different project --
# the patterns above only match 'claude code files', so it is left alone.
$n = Rewrite-Paths -Files @($cfg) -Root ''
Write-Host "  $n file(s) rewritten."

Write-Host ''
Write-Host '== 5. verifying the new location ==' -ForegroundColor Cyan
Push-Location $new
try {
  if (-not (Test-Path (Join-Path $new 'node_modules\next\package.json'))) {
    Write-Host '  node_modules missing or incomplete -- running npm install' -ForegroundColor Yellow
    npm install --no-audit --no-fund | Select-Object -Last 3
  }
  Write-Host '  typecheck...'
  npx tsc --noEmit
  if ($LASTEXITCODE -ne 0) { throw 'typecheck failed -- stopping before you switch over' }
  Write-Host '  typecheck clean.'

  Write-Host '  tests...'
  npx vitest run --reporter=basic 2>&1 | Select-Object -Last 4
}
finally { Pop-Location }

Write-Host ''
Write-Host '== 6. any OneDrive repo paths left anywhere? ==' -ForegroundColor Cyan
$left = Get-ChildItem $new -Recurse -File -Force -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -notlike '*\node_modules\*' -and $_.FullName -notlike '*\.git\*' -and ($exts -contains $_.Extension.ToLower()) } |
  Select-String -Pattern 'OneDrive[\\/]+Desktop[\\/]+claude code files', 'C--Users-honey-OneDrive' -List -ErrorAction SilentlyContinue
if ($left) {
  Write-Host '  still referencing the old path:' -ForegroundColor Yellow
  $left | ForEach-Object { Write-Host "    $($_.Path.Replace($new, '.'))" }
  Write-Host '  (expected: only the skip-list files, which are prose or past-run records)'
} else {
  Write-Host '  none.'
}

Write-Host ''
Write-Host 'Done. Now reopen Claude Code at C:\dev\claude-code-files and check the apps run.' -ForegroundColor Green
Write-Host ''
Write-Host 'The original is still at:' -ForegroundColor Green
Write-Host "  $old"
Write-Host 'Leave it until you have used the new one for a few days. To delete it then:'
Write-Host '  1. OneDrive settings > Account > Choose folders -- make sure it is no longer synced,'
Write-Host '     or deleting it locally also deletes it from the cloud.'
Write-Host "  2. Remove-Item '$old' -Recurse -Force"
Write-Host ''
