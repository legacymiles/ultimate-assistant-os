# ---------------------------------------------------------------------------
# Re-point the Windows port proxy at WSL's current address.
#
# WSL2 gets a new NAT address on almost every boot, so a portproxy set once
# stops working at the first restart and SearXNG silently becomes unreachable
# from the internet. setup-windows-vps.ps1 registers this as a SYSTEM task at
# startup when mirrored networking is unavailable.
#
# Only needed on the portproxy path. With mirrored networking WSL shares the
# host's network and there is nothing to forward.
#
# Safe to run by hand any time the VPS is reachable on neither 80 nor 443:
#   powershell -ExecutionPolicy Bypass -File .\refresh-portproxy.ps1
# ---------------------------------------------------------------------------

[CmdletBinding()]
param(
    [string] $Distro = "Ubuntu"
)

$ErrorActionPreference = "Continue"

# `hostname -I` lists every address the distro holds; the first is the one the
# host can reach. cut rather than awk, because an awk '{print $1}' has to
# survive two layers of quoting on the way into bash and usually does not.
$ip = (wsl.exe -d $Distro -u root -- bash -lc "hostname -I | cut -d' ' -f1")
if ($null -ne $ip) { $ip = $ip.Trim() }

if ([string]::IsNullOrWhiteSpace($ip)) {
    Write-Host "WSL is not running or has no address yet; nothing to forward."
    exit 1
}

foreach ($port in 80, 443) {
    netsh interface portproxy delete v4tov4 listenport=$port listenaddress=0.0.0.0 2>$null | Out-Null
    netsh interface portproxy add v4tov4 listenport=$port listenaddress=0.0.0.0 `
        connectport=$port connectaddress=$ip | Out-Null
}

Write-Host "Forwarding 80 and 443 to $ip."
