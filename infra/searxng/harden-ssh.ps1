# Port 22 is now open to the internet and will see brute-force attempts within
# hours. Key auth makes them futile; turning passwords off entirely means there
# is nothing to guess at all.
$ErrorActionPreference = "Continue"
$cfg = "C:\ProgramData\ssh\sshd_config"
if (-not (Test-Path $cfg)) { Write-Host "no sshd_config"; exit 1 }
Copy-Item $cfg "$cfg.bak" -Force
$t = Get-Content $cfg
$t = $t -replace '^\s*#?\s*PasswordAuthentication\s+.*$', 'PasswordAuthentication no'
$t = $t -replace '^\s*#?\s*PermitEmptyPasswords\s+.*$', 'PermitEmptyPasswords no'
if (-not ($t -match '^PasswordAuthentication no')) { $t += 'PasswordAuthentication no' }
Set-Content -Path $cfg -Value $t -Encoding ascii
Restart-Service sshd
Start-Sleep -Seconds 3
Write-Host ("sshd: " + (Get-Service sshd).Status)
Get-Content $cfg | Select-String -Pattern '^PasswordAuthentication|^PermitEmptyPasswords' | ForEach-Object { Write-Host ("  " + $_.Line) }
