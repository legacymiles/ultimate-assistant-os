# ---------------------------------------------------------------------------
# SearXNG on a WINDOWS VPS, via WSL2 + Docker.
#
# The Linux installer (install.sh) assumes apt, ufw and systemd. A Windows
# Server has none of those and SearXNG ships only Linux containers, so the way
# in is WSL2: a real Linux kernel on the Windows box, running the same
# docker-compose stack as a Linux VPS would.
#
# Run it ON THE VPS, in an ADMINISTRATOR PowerShell, from this folder:
#
#   cd C:\searxng
#   powershell -ExecutionPolicy Bypass -File .\setup-windows-vps.ps1 -Hostname search.example.com
#
# Replace search.example.com with your real domain. Its DNS A record must
# already point at this VPS, or Let's Encrypt cannot issue a certificate.
#
# Written for Windows PowerShell 5.1, which is what ships on Windows Server:
# no `&&`, no ternaries, no `??`.
#
# WHAT CAN GO WRONG, said up front because one of them is likely:
#
#   * No nested virtualization. WSL2 needs it, and many Windows VPS hosts do
#     not expose it. The preflight below checks and stops with a plain answer
#     rather than failing halfway through an install.
#   * WSL2 networking. WSL gets its own NAT address, so ports 80/443 on the
#     public interface do not reach it by default. Two fixes exist and this
#     script picks whichever your build supports: mirrored networking (clean,
#     needs a recent WSL), or a portproxy plus a scheduled task that re-applies
#     it on boot, because the WSL address changes every restart.
#   * A reboot. Installing WSL for the first time usually needs one. The script
#     stops and tells you to run it again afterwards; running it twice is safe.
# ---------------------------------------------------------------------------

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string] $Hostname,

    # Skip the virtualization check. Only if you know WSL2 works here and the
    # check is wrong about your hypervisor.
    [switch] $SkipPreflight,

    # The WSL distribution to use. Ubuntu is what install.sh is written for.
    [string] $Distro = "Ubuntu"
)

$ErrorActionPreference = "Stop"

function Say  { param($m) Write-Host "`n== $m" -ForegroundColor Cyan }
function Ok   { param($m) Write-Host "   $m" -ForegroundColor Green }
function Warn { param($m) Write-Host "!! $m" -ForegroundColor Yellow }
function Die  { param($m) Write-Host "xx $m" -ForegroundColor Red; exit 1 }

# ---------------------------------------------------------------------------
Say "Preflight"
# ---------------------------------------------------------------------------

$admin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()
         ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) {
    Die "Run this in an Administrator PowerShell. Right-click PowerShell > Run as administrator, then run it again."
}
Ok "Running as Administrator."

$os = Get-CimInstance Win32_OperatingSystem
Write-Host "   $($os.Caption) (build $($os.BuildNumber))"
if ([int]$os.BuildNumber -lt 19041) {
    Die "WSL2 needs build 19041 or newer; this is $($os.BuildNumber). Use the native-Python path instead, or a small Linux box."
}

if (-not $SkipPreflight) {
    # On a VPS the box is itself a virtual machine, so what matters is whether
    # the host exposes nested virtualization. Win32_Processor reports it, and
    # it is the single most common reason this whole path is a dead end.
    $cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
    $vmFirmware = $cpu.VirtualizationFirmwareEnabled
    $hypervisorPresent = $os.Caption -and (Get-CimInstance Win32_ComputerSystem).HypervisorPresent

    if ($vmFirmware -eq $false -and -not $hypervisorPresent) {
        Write-Host ""
        Warn "This VPS does not expose hardware virtualization, so WSL2 cannot run here."
        Warn "That is a limit of the host, not something this script can configure."
        Write-Host ""
        Write-Host "   Your options, in the order I'd try them:" -ForegroundColor Gray
        Write-Host "     1. Ask your provider to enable nested virtualization for this VM." -ForegroundColor Gray
        Write-Host "     2. Run SearXNG natively from Python on Windows (no Docker, no WSL)." -ForegroundColor Gray
        Write-Host "     3. Put SearXNG on a small Linux VPS and use infra/searxng/install.sh." -ForegroundColor Gray
        Write-Host ""
        Write-Host "   Tell Claude which, and it will write that path." -ForegroundColor Gray
        exit 2
    }
    Ok "Virtualization looks available."
}

# ---------------------------------------------------------------------------
Say "DNS"
# ---------------------------------------------------------------------------
try {
    $publicIp = (Invoke-RestMethod -Uri "https://api.ipify.org?format=json" -TimeoutSec 10).ip
} catch {
    $publicIp = $null
}
try {
    $resolved = (Resolve-DnsName -Name $Hostname -Type A -ErrorAction Stop | Select-Object -First 1).IPAddress
} catch {
    $resolved = $null
}

if (-not $resolved) {
    Warn "$Hostname does not resolve yet. Add an A record pointing at $publicIp before TLS can be issued."
    Warn "Continuing -- Caddy retries until DNS catches up."
} elseif ($publicIp -and $resolved -ne $publicIp) {
    Warn "$Hostname resolves to $resolved but this VPS is $publicIp."
    Warn "If that is Cloudflare, turn the orange cloud OFF until the certificate is issued."
} else {
    Ok "$Hostname -> $resolved"
}

# ---------------------------------------------------------------------------
Say "WSL"
# ---------------------------------------------------------------------------
$wslPresent = $null -ne (Get-Command wsl.exe -ErrorAction SilentlyContinue)
$needsReboot = $false

if (-not $wslPresent) {
    Write-Host "   Installing WSL and $Distro..."
    # --no-launch keeps it from opening an interactive first-run shell, which
    # would block a script with no console to type into.
    wsl.exe --install -d $Distro --no-launch
    $needsReboot = $true
} else {
    # `wsl --status` returns non-zero when the feature is present but no
    # distribution is installed, so the distro list is the real check.
    $distros = (wsl.exe --list --quiet) -replace "`0", ""
    $have = $false
    foreach ($d in $distros) { if ($d.Trim() -eq $Distro) { $have = $true } }
    if (-not $have) {
        Write-Host "   WSL is here but $Distro is not. Installing it..."
        wsl.exe --install -d $Distro --no-launch
        $needsReboot = $true
    } else {
        Ok "$Distro is installed."
    }
}

wsl.exe --set-default-version 2 | Out-Null

if ($needsReboot) {
    Write-Host ""
    Warn "WSL was just installed, which needs a reboot before the distribution will start."
    Write-Host "   Reboot, then run this exact command again:" -ForegroundColor Gray
    Write-Host "     powershell -ExecutionPolicy Bypass -File .\setup-windows-vps.ps1 -Hostname $Hostname" -ForegroundColor Gray
    Write-Host "   Running it twice is safe -- it picks up where it left off." -ForegroundColor Gray
    exit 3
}

# A distro installed with --no-launch has no user yet; this creates one on
# first run. Running as root inside WSL is fine here: the box exists to run
# one container stack.
wsl.exe -d $Distro -u root -- echo "wsl-ready" | Out-Null
if ($LASTEXITCODE -ne 0) {
    Die "$Distro is installed but would not start. Try: wsl --shutdown, then run this again."
}
Ok "$Distro starts."

# ---------------------------------------------------------------------------
Say "Networking"
# ---------------------------------------------------------------------------
# WSL2 sits behind a NAT, so the public interface's 80/443 do not reach it.
# Mirrored mode removes the problem entirely by sharing the host's network;
# where it is unavailable, a portproxy plus a boot task is the fallback, and
# the boot task matters because the WSL address changes on every restart.
$wslVersionText = (wsl.exe --version 2>$null) -join " "
$mirroredSupported = $false
if ($wslVersionText -match "WSL version:\s*(\d+)\.(\d+)") {
    $major = [int]$Matches[1]
    if ($major -ge 2) { $mirroredSupported = $true }
}

if ($mirroredSupported) {
    $wslConfig = Join-Path $env:USERPROFILE ".wslconfig"
    $desired = "[wsl2]`nnetworkingMode=mirrored`n"
    $write = $true
    if (Test-Path $wslConfig) {
        $existing = Get-Content $wslConfig -Raw
        if ($existing -match "networkingMode\s*=\s*mirrored") { $write = $false }
    }
    if ($write) {
        Add-Content -Path $wslConfig -Value $desired -Encoding utf8
        wsl.exe --shutdown
        Start-Sleep -Seconds 3
    }
    Ok "Mirrored networking on -- WSL shares this machine's network, so no port forwarding is needed."
    $usingMirrored = $true
} else {
    Warn "This WSL build has no mirrored networking; falling back to a port proxy."
    $usingMirrored = $false
}

# ---------------------------------------------------------------------------
Say "Docker inside $Distro"
# ---------------------------------------------------------------------------
$dockerCheck = wsl.exe -d $Distro -u root -- bash -lc "command -v docker >/dev/null 2>&1 && echo yes || echo no"
if ($dockerCheck -match "no") {
    Write-Host "   Installing Docker (this takes a few minutes)..."
    wsl.exe -d $Distro -u root -- bash -lc "curl -fsSL https://get.docker.com | sh"
    if ($LASTEXITCODE -ne 0) { Die "Docker failed to install inside $Distro. See the output above." }
} else {
    Ok "Docker is already installed."
}

# systemd keeps dockerd running across restarts; without it the daemon has to
# be started by hand every time WSL comes up.
$wslConfInside = wsl.exe -d $Distro -u root -- bash -lc "cat /etc/wsl.conf 2>/dev/null"
if ($wslConfInside -notmatch "systemd\s*=\s*true") {
    wsl.exe -d $Distro -u root -- bash -lc "printf '[boot]\nsystemd=true\n' >> /etc/wsl.conf"
    wsl.exe --shutdown
    Start-Sleep -Seconds 5
    Ok "Enabled systemd and restarted WSL."
}
wsl.exe -d $Distro -u root -- bash -lc "systemctl enable --now docker >/dev/null 2>&1 || service docker start >/dev/null 2>&1; true" | Out-Null

# ---------------------------------------------------------------------------
Say "Copying the stack into $Distro"
# ---------------------------------------------------------------------------
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not (Test-Path (Join-Path $here "docker-compose.yml"))) {
    Die "docker-compose.yml is not beside this script. Copy the whole infra\searxng folder to this VPS and run it from there."
}

# WSL reads the Windows drive at /mnt/c, so the copy is a cp inside Linux
# rather than anything clever. The CRLF strip is not optional: a .sh file
# copied through Windows gets carriage returns, and bash fails on them with
# the famously unhelpful "$'\r': command not found".
# wslpath is what WSL ships for this. The manual fallback is there because a
# distro that has not finished first-run setup can lack it, and a scriptblock
# -replace would be PowerShell 7+ only.
$wslSource = (wsl.exe -d $Distro -u root -- wslpath -a "$here" 2>$null)
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($wslSource)) {
    $drive = $here.Substring(0, 1).ToLower()
    $rest = $here.Substring(2) -replace "\\", "/"
    $wslSource = "/mnt/$drive$rest"
}
$wslSource = $wslSource.Trim()

wsl.exe -d $Distro -u root -- bash -lc "rm -rf /opt/searxng && mkdir -p /opt/searxng && cp -r '$wslSource/.' /opt/searxng/ && find /opt/searxng -type f \( -name '*.sh' -o -name '*.yml' -o -name 'Caddyfile' \) -exec sed -i 's/\r$//' {} +"
if ($LASTEXITCODE -ne 0) { Die "Could not copy the stack into $Distro." }
Ok "Copied to /opt/searxng and line endings normalised."

# ---------------------------------------------------------------------------
Say "Running the Linux installer"
# ---------------------------------------------------------------------------
# From here it is exactly the Linux path: the same install.sh a Linux VPS
# would run, generating the same secrets and bringing up the same stack.
wsl.exe -d $Distro -u root -- bash -lc "cd /opt/searxng && bash install.sh $Hostname"
$installExit = $LASTEXITCODE

# ---------------------------------------------------------------------------
Say "Opening the firewall"
# ---------------------------------------------------------------------------
foreach ($port in 80, 443) {
    $ruleName = "SearXNG $port"
    $existing = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
    if ($null -eq $existing) {
        New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Action Allow `
            -Protocol TCP -LocalPort $port | Out-Null
    }
}
Ok "Windows Firewall allows 80 and 443 inbound."
Warn "Your VPS provider may have its own firewall as well -- open 80 and 443 there too."

if (-not $usingMirrored) {
    Say "Port forwarding into WSL"
    $wslIp = (wsl.exe -d $Distro -u root -- bash -lc "hostname -I | cut -d' ' -f1").Trim()
    if ([string]::IsNullOrWhiteSpace($wslIp)) {
        Warn "Could not read the WSL address; set the portproxy by hand once it is up."
    } else {
        foreach ($port in 80, 443) {
            netsh interface portproxy delete v4tov4 listenport=$port listenaddress=0.0.0.0 2>$null | Out-Null
            netsh interface portproxy add v4tov4 listenport=$port listenaddress=0.0.0.0 `
                connectport=$port connectaddress=$wslIp | Out-Null
        }
        Ok "Forwarding 80 and 443 to $wslIp."

        # The WSL address changes on every boot, so a one-off portproxy breaks
        # at the first restart. This re-reads it and re-applies the rules.
        $taskName = "SearXNG WSL port forward"
        $script = Join-Path $here "refresh-portproxy.ps1"
        if (-not (Test-Path $script)) {
            Warn "refresh-portproxy.ps1 is missing from this folder; the forward will break on the next reboot."
        }

        $action = New-ScheduledTaskAction -Execute "powershell.exe" `
            -Argument "-ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`""
        $trigger = New-ScheduledTaskTrigger -AtStartup
        $principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -RunLevel Highest
        Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
        Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
            -Principal $principal -Description "Re-point 80/443 at WSL after a reboot." | Out-Null
        Ok "Registered a startup task to re-apply it after every reboot."
    }
}

# ---------------------------------------------------------------------------
Say "Result"
# ---------------------------------------------------------------------------
if ($installExit -ne 0) {
    Warn "The Linux installer exited with $installExit -- read its output above."
    Warn "Most often: DNS not pointing here yet, so Caddy has no certificate."
    Write-Host "   Inside WSL you can watch it with:" -ForegroundColor Gray
    Write-Host "     wsl -d $Distro -u root -- bash -lc 'cd /opt/searxng && docker compose --profile public logs -f caddy'" -ForegroundColor Gray
    exit 1
}

Write-Host ""
Write-Host "Done. install.sh printed SEARXNG_URL and SEARXNG_TOKEN above -- put both in Vercel:" -ForegroundColor Green
Write-Host "  vercel env add SEARXNG_URL production" -ForegroundColor Gray
Write-Host "  vercel env add SEARXNG_TOKEN production" -ForegroundColor Gray
Write-Host ""
Write-Host "Env vars are baked in at build time, so redeploy before testing the live site." -ForegroundColor Gray
Write-Host ""
Write-Host "Day to day, from this VPS:" -ForegroundColor Gray
Write-Host "  wsl -d $Distro -u root -- bash -lc 'cd /opt/searxng && docker compose --profile public logs -f searxng'" -ForegroundColor Gray
Write-Host "  wsl -d $Distro -u root -- bash -lc 'cd /opt/searxng && docker compose --profile public pull && docker compose --profile public up -d'" -ForegroundColor Gray
