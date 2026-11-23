# Start WSL and point the port forward at whatever address it came up with.
#
# Both halves are needed on a Windows VPS. WSL is not a service: nothing starts
# it at boot, so SearXNG simply would not be running. And WSL takes a NEW NAT
# address nearly every start, so a portproxy set once is stale by the next
# reboot - which is exactly what happened here twice.
$ErrorActionPreference = "Continue"

Start-Process wsl.exe -ArgumentList '-d','Ubuntu','-u','root','--','/bin/sh','-c','exec sleep infinity' -WindowStyle Hidden
Start-Sleep -Seconds 20

$raw = (wsl -d Ubuntu -u root -- hostname -I) 2>$null
if ($null -eq $raw) { Write-Host "wsl did not answer"; exit 1 }
$ip = ($raw -join ' ').Trim().Split(' ')[0]
if ([string]::IsNullOrWhiteSpace($ip)) { Write-Host "no wsl address"; exit 1 }

foreach ($p in 80, 443) {
    netsh interface portproxy delete v4tov4 listenport=$p listenaddress=0.0.0.0 2>$null | Out-Null
    netsh interface portproxy add v4tov4 listenport=$p listenaddress=0.0.0.0 connectport=$p connectaddress=$ip | Out-Null
    if (-not (Get-NetFirewallRule -DisplayName "SearXNG $p" -ErrorAction SilentlyContinue)) {
        New-NetFirewallRule -DisplayName "SearXNG $p" -Direction Inbound -Action Allow -Protocol TCP -LocalPort $p | Out-Null
    }
}
Write-Host "forwarding 80 and 443 to $ip"
