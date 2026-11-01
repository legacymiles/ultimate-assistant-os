# ---------------------------------------------------------------------------
# Register the daily "refresh the folder index" task on the owner's PC.
#
#   powershell -ExecutionPolicy Bypass -File scripts\install-memory-index-task.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\install-memory-index-task.ps1 -Remove
#
# Runs as the owner, interactively, so it needs no stored password and no
# elevation. Three settings exist because this is a laptop, not a server:
#
#   -StartWhenAvailable        03:00 on a laptop usually means "asleep". Without
#                              this the run is simply missed; with it Windows
#                              catches up once the machine is awake, which turns
#                              the schedule into "once a day, whenever it's on".
#   -AllowStartIfOnBatteries   the default REFUSES to start on battery, which on
#       and -DontStopIfGoing-  a laptop is most of the time.
#       OnBatteries
#   -ExecutionTimeLimit        a first full index is ~25 minutes; two hours is
#                              room to spare without hanging forever.
#
# The work itself is incremental - unchanged chunks are skipped - so the daily
# cost after the first run is seconds, not another full embed.
# ---------------------------------------------------------------------------

param(
  [string]$Name = "Jarvis folder index",
  [string]$Repo = "C:\dev\claude-code-files",
  [string]$At = "03:00",
  [switch]$Remove
)

$ErrorActionPreference = "Stop"

if ($Remove) {
  Unregister-ScheduledTask -TaskName $Name -Confirm:$false
  Write-Host "Removed scheduled task '$Name'."
  exit 0
}

$cmd = Join-Path $Repo "scripts\memory-index.cmd"
if (-not (Test-Path $cmd)) { throw "Not found: $cmd" }

$action = New-ScheduledTaskAction -Execute $cmd -WorkingDirectory $Repo
$trigger = New-ScheduledTaskTrigger -Daily -At $At
$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Hours 2) `
  -MultipleInstances IgnoreNew

Register-ScheduledTask `
  -TaskName $Name `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Description "Re-index the master folder into Jarvis's memory (scripts/sync-folder-rag.mjs). Incremental: only changed chunks are re-embedded. Log: .data\memory-index.log" `
  -Force | Out-Null

$info = Get-ScheduledTask -TaskName $Name | Get-ScheduledTaskInfo
Write-Host "Registered '$Name' - daily at $At, next run $($info.NextRunTime)."
Write-Host "Log: $Repo\.data\memory-index.log"
