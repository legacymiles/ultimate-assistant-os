# Start WSL, bring SearXNG up, point the forward -- then HOLD WSL OPEN.
#
# The holding is the whole point and the thing that was wrong before. An
# earlier version launched the keepalive with Start-Process and then exited;
# when a scheduled task's own process ends, Windows tears down its children, so
# the keepalive died immediately and WSL went with it. The last call here
# blocks forever instead, so the task process IS the thing keeping WSL alive.
#
# Everything else exists because of something that actually broke on this box:
#   * WSL is not a service - it runs only while something holds it open.
#   * containerd takes up to a couple of minutes under WSL and docker waits on
#     it, so this polls rather than trusting a fixed delay.
#   * WSL can take a new NAT address on any start, so the forward is re-pointed
#     every run rather than set once.
$ErrorActionPreference = "Continue"

# Wake the distro and wait for Docker. Up to ~3 minutes.
$ready = $false
foreach ($i in 1..36) {
    $out = (wsl -d Ubuntu -u root -- bash -lc "systemctl start docker >/dev/null 2>&1; docker info >/dev/null 2>&1 && echo OK") 2>$null
    if (($out -join '') -match 'OK') { $ready = $true; break }
    Start-Sleep -Seconds 5
}
Write-Host $(if ($ready) { "docker: ready" } else { "docker: did not come up in time" })

wsl -d Ubuntu -u root -- bash -lc "cd /opt/searxng && docker compose up -d" 2>$null | Out-Null
$names = (wsl -d Ubuntu -u root -- bash -lc "docker ps --format '{{.Names}}' | tr '\n' ' '") 2>$null
Write-Host ("containers: " + ($names -join ' ').Trim())

$raw = (wsl -d Ubuntu -u root -- hostname -I) 2>$null
$ip = ($raw -join ' ').Trim().Split(' ')[0]
if (-not [string]::IsNullOrWhiteSpace($ip)) {
    foreach ($p in 80, 443) {
        netsh interface portproxy delete v4tov4 listenport=$p listenaddress=0.0.0.0 2>$null | Out-Null
        netsh interface portproxy add v4tov4 listenport=$p listenaddress=0.0.0.0 connectport=$p connectaddress=$ip | Out-Null
        if (-not (Get-NetFirewallRule -DisplayName "SearXNG $p" -ErrorAction SilentlyContinue)) {
            New-NetFirewallRule -DisplayName "SearXNG $p" -Direction Inbound -Action Allow -Protocol TCP -LocalPort $p | Out-Null
        }
    }
    Write-Host "forwarding 80 and 443 to $ip"
} else {
    Write-Host "no wsl address - forward not set"
}

# BLOCKS FOREVER. This process is the keepalive. If WSL ever stops anyway, the
# loop re-enters and brings it back rather than leaving the box dark.
Write-Host "holding WSL open"
while ($true) {
    wsl -d Ubuntu -u root -- /bin/sh -c "exec sleep infinity" 2>$null | Out-Null
    Start-Sleep -Seconds 5
}
