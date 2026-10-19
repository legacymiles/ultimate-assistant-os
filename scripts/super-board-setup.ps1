<#
  super-board setup for the Jarvis hub — run once on your PC or VPS.

    powershell -ExecutionPolicy Bypass -File scripts\super-board-setup.ps1

  What it does, in order (safe to run again; it skips what's already done):
    1. Installs what the board needs if missing: Git (for Git Bash), GitHub CLI, jq, Python, Node.
    2. Signs the GitHub CLI in with the "project" permission the board needs.
    3. Creates the "Jarvis Factory" board (or reuses it) with the columns
       Backlog, Ready, Building, QA, Review, Blocked, Done, linked to this repo.
    4. Writes the board number into .claude/super-board/configs/ultimate-assistant-os.json
       and pushes that one change.
    5. Makes the error-feed token and saves it on this PC (JARVIS_ERRORS_TOKEN).
    6. Puts JARVIS_GITHUB_TOKEN, JARVIS_BOARD_PROJECT and JARVIS_ERRORS_TOKEN into Vercel
       if the Vercel CLI is signed in — otherwise prints them for you to paste.

  Every merge still waits for you: the config has human_approves_merge = true.
#>

$ErrorActionPreference = "Stop"
$Owner = "legacymiles"
$Repo = "legacymiles/ultimate-assistant-os"
$Title = "Jarvis Factory"
$Columns = @("Backlog", "Ready", "Building", "QA", "Review", "Blocked", "Done")
$Root = Split-Path -Parent $PSScriptRoot
$Config = Join-Path $Root ".claude\super-board\configs\ultimate-assistant-os.json"

function Say($t) { Write-Host "  $t" }
function Step($t) { Write-Host ""; Write-Host "▸ $t" -ForegroundColor Cyan }
function Has($cmd) { [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }
function Refresh-Path {
  $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
}

# ---- 1. tools -------------------------------------------------------------
Step "Checking the tools the board needs"
$need = @(
  @{ cmd = "git";    id = "Git.Git";          name = "Git (gives you Git Bash)" },
  @{ cmd = "gh";     id = "GitHub.cli";       name = "GitHub CLI" },
  @{ cmd = "jq";     id = "jqlang.jq";        name = "jq" },
  @{ cmd = "python"; id = "Python.Python.3.12"; name = "Python 3" },
  @{ cmd = "node";   id = "OpenJS.NodeJS.LTS"; name = "Node.js" }
)
foreach ($t in $need) {
  if (Has $t.cmd) { Say "✓ $($t.name)"; continue }
  if (-not (Has "winget")) { throw "Missing $($t.name), and winget isn't available to install it. Install it, then run this again." }
  Say "Installing $($t.name)…"
  winget install --id $t.id -e --silent --accept-package-agreements --accept-source-agreements | Out-Null
  Refresh-Path
  if (-not (Has $t.cmd)) { Say "! $($t.name) installed — close this window, open a new one, and run the script again."; exit 1 }
  Say "✓ $($t.name)"
}
$bash = Join-Path ${env:ProgramFiles} "Git\bin\bash.exe"
if (Test-Path $bash) { Say "✓ Git Bash at $bash" } else { Say "! Git Bash not found where expected; Claude Code will look for it on PATH." }

# ---- 2. GitHub sign-in ------------------------------------------------------
Step "Signing in to GitHub (the board needs the 'project' permission)"
$status = (gh auth status 2>&1) -join "`n"
if ($LASTEXITCODE -ne 0) {
  gh auth login --hostname github.com --git-protocol https --web --scopes "project,repo,read:org"
} elseif ($status -notmatch "project") {
  gh auth refresh --hostname github.com --scopes "project"
}
gh auth status | Out-Null
Say "✓ Signed in as $((gh api user --jq .login))"

# ---- 3. the board -----------------------------------------------------------
Step "Making the board"
$existing = gh project list --owner $Owner --format json --limit 100 | ConvertFrom-Json
$proj = $existing.projects | Where-Object { $_.title -eq $Title } | Select-Object -First 1
if ($proj) {
  Say "✓ '$Title' already exists (#$($proj.number))"
} else {
  $proj = gh project create --owner $Owner --title $Title --format json | ConvertFrom-Json
  Say "✓ Created '$Title' (#$($proj.number))"
}
$number = [int]$proj.number

# Status columns, in the order the board flows.
$fieldQuery = 'query($o:String!,$n:Int!){ user(login:$o){ projectV2(number:$n){ id field(name:"Status"){ ... on ProjectV2SingleSelectField { id options { name } } } } } }'
$info = gh api graphql -f query=$fieldQuery -f o=$Owner -F n=$number | ConvertFrom-Json
$field = $info.data.user.projectV2.field
$have = @($field.options | ForEach-Object { $_.name })
if (($have -join ",") -ne ($Columns -join ",")) {
  $colors = @{ Backlog = "GRAY"; Ready = "BLUE"; Building = "YELLOW"; QA = "ORANGE"; Review = "PURPLE"; Blocked = "RED"; Done = "GREEN" }
  $opts = ($Columns | ForEach-Object { "{name:`"$_`",color:$($colors[$_]),description:`"`"}" }) -join ","
  $mutation = "mutation(`$f:ID!){ updateProjectV2Field(input:{fieldId:`$f,singleSelectOptions:[$opts]}){ projectV2Field { ... on ProjectV2SingleSelectField { id } } } }"
  gh api graphql -f query=$mutation -f f=$($field.id) | Out-Null
  Say "✓ Columns set: $($Columns -join ' → ')"
} else {
  Say "✓ Columns already right"
}
gh project link $number --owner $Owner --repo $Repo 2>$null | Out-Null
Say "✓ Linked to $Repo"

# ---- 4. config --------------------------------------------------------------
Step "Pointing the board config at #$number"
$json = Get-Content $Config -Raw | ConvertFrom-Json
if ($json.project.number -ne $number) {
  $json.project.number = $number
  # No byte-order mark: super-board reads this with Python, which rejects one.
  [IO.File]::WriteAllText($Config, ($json | ConvertTo-Json -Depth 20), (New-Object Text.UTF8Encoding($false)))
  Push-Location $Root
  git add ".claude/super-board/configs/ultimate-assistant-os.json"
  git commit -m "super-board: point config at board #$number" | Out-Null
  git push | Out-Null
  Pop-Location
  Say "✓ Saved and pushed"
} else {
  Say "✓ Already set"
}

# ---- 5. error-feed token ----------------------------------------------------
Step "Error feed token (lets the board read Jarvis's crash log)"
$errToken = [Environment]::GetEnvironmentVariable("JARVIS_ERRORS_TOKEN", "User")
if (-not $errToken) {
  $bytes = New-Object byte[] 32
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $errToken = [Convert]::ToBase64String($bytes).TrimEnd("=").Replace("+", "-").Replace("/", "_")
  [Environment]::SetEnvironmentVariable("JARVIS_ERRORS_TOKEN", $errToken, "User")
  Say "✓ Made one and saved it on this PC"
} else {
  Say "✓ Already saved on this PC"
}

# ---- 6. Vercel --------------------------------------------------------------
Step "Connecting the website (Send to board + error feed)"
Write-Host "  Jarvis needs a GitHub token to file cards. Best: a fine-grained token with"
Write-Host "  Issues read/write on $Repo and Projects read/write. Paste it, or press Enter"
Write-Host "  to use your GitHub CLI login's token (simpler, but it can reach all your repos)."
$ghToken = Read-Host "  GitHub token"
if (-not $ghToken) { $ghToken = (gh auth token).Trim() }

$vars = [ordered]@{ JARVIS_GITHUB_TOKEN = $ghToken; JARVIS_BOARD_PROJECT = "$number"; JARVIS_ERRORS_TOKEN = $errToken }
$pushed = $false
if (Has "vercel") {
  Push-Location $Root
  try {
    vercel whoami 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) {
      foreach ($k in $vars.Keys) {
        vercel env rm $k production --yes 2>$null | Out-Null
        $vars[$k] | vercel env add $k production | Out-Null
      }
      $pushed = $true
      Say "✓ Added to Vercel (production). They apply on the next deploy — the next push does it."
    }
  } catch {}
  Pop-Location
}
if (-not $pushed) {
  Say "Add these in Vercel → your project → Settings → Environment Variables (Production), then redeploy:"
  foreach ($k in $vars.Keys) {
    $v = if ($k -eq "JARVIS_GITHUB_TOKEN") { "<the GitHub token>" } else { $vars[$k] }
    Write-Host "    $k = $v" -ForegroundColor Yellow
  }
}

Write-Host ""
Write-Host "Done. Board: https://github.com/users/$Owner/projects/$number" -ForegroundColor Green
Write-Host "Next, in Claude Code inside this folder:"
Write-Host "  /super-board onboard            (once — answers are already in the config)"
Write-Host "  /super-board run ultimate-assistant-os"
Write-Host "Cards land in Backlog. Drag one to Ready to have it built; you approve every merge."
