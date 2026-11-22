#!/usr/bin/env bash
#
#   ###########################################################
#   #                                                         #
#   #   THIS IS A LINUX SCRIPT. IT IS NOT POWERSHELL.         #
#   #                                                         #
#   #   Your prompt must look like   root@machine:/#          #
#   #   NOT like                     PS C:\Users\...>         #
#   #                                                         #
#   #   If it says PS C:\...  then STOP and run first:        #
#   #       wsl -d Ubuntu -u root                             #
#   #                                                         #
#   ###########################################################
#
# ---------------------------------------------------------------------------
# SearXNG on a VPS, with NOTHING copied there first.
#
# This exists because getting infra/searxng onto a Windows VPS turned out to
# be the hard part: scp needs OpenSSH Server running on the far end, and every
# "run this on your laptop" instruction is one paste away from landing in the
# wrong window. So this script copies nothing. It is pasted straight into a
# shell on the VPS and builds the stack from upstream sources.
#
# WINDOWS VPS, after `wsl.exe --install --no-launch -d Ubuntu` and a reboot:
#   wsl -d Ubuntu -u root
#   ...then paste this whole file.
#
# LINUX VPS: paste it, or use install.sh in this folder, which does the same
# thing from files that are already present.
#
# It is built on github.com/searxng/searxng-docker, SearXNG's own deployment
# repo, so upgrades are `git pull && docker compose up -d` and the parts this
# does not touch stay upstream's problem rather than ours.
#
# Safe to run twice: secrets already generated are kept, so it is also the
# upgrade path.
# ---------------------------------------------------------------------------
# Checked before anything else: pasted into PowerShell, "set -euo pipefail"
# complains about a parameter named 'euo', which explains nothing, and the
# lines after it half-run.
if [ -z "${BASH_VERSION:-}" ]; then
  echo "This needs bash, not PowerShell. Run first:  wsl -d Ubuntu -u root" >&2
  exit 1
fi
set -euo pipefail

# --- Set these two BEFORE running, as environment variables ----------------
#
#   export SEARX_HOST=search.yourdomain.com
#   export SEARX_EMAIL=you@yourdomain.com
#
# Editing them in the file works too, but the environment is easier when the
# script is piped straight into bash, and it means nobody has to find a text
# editor on a fresh box.
SEARX_HOST="${SEARX_HOST:-search.example.com}"   # DNS A record must point here
SEARX_EMAIL="${SEARX_EMAIL:-you@example.com}"    # Let's Encrypt expiry warnings
# ---------------------------------------------------------------------------

say()  { printf '\n\033[1m== %s\033[0m\n' "$*"; }
warn() { printf '\033[33m!! %s\033[0m\n' "$*"; }
die()  { printf '\033[31mxx %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" = "0" ] || die "Run as root. On WSL that is: wsl -d Ubuntu -u root"
case "$SEARX_HOST" in
  search.example.com|"")
    die "Set your hostname first:  export SEARX_HOST=search.yourdomain.com  (and SEARX_EMAIL), then run this again." ;;
esac

say "Packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq git curl ca-certificates openssl python3 >/dev/null
echo "git, curl, openssl ready."

say "Docker"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
else
  echo "Already installed."
fi
# WSL often has no systemd, so start the daemon whichever way works.
if ! docker info >/dev/null 2>&1; then
  (systemctl enable --now docker >/dev/null 2>&1 || service docker start >/dev/null 2>&1) || true
  sleep 3
fi
docker info >/dev/null 2>&1 || die "Docker will not start. On WSL, enable systemd: printf '[boot]\nsystemd=true\n' >> /etc/wsl.conf, then run 'wsl --shutdown' from Windows and come back."
echo "Docker is up."

say "SearXNG's own compose stack"
mkdir -p /opt && cd /opt
if [ -d searxng-docker ]; then
  cd searxng-docker && git pull --quiet || true
else
  git clone --quiet https://github.com/searxng/searxng-docker.git
  cd searxng-docker
fi
echo "At $(pwd)."

say "Configuration"
# Secrets are kept across runs: rotating SEARXNG_TOKEN silently would break the
# hub until Vercel was updated to match.
TOKEN_FILE="/opt/searxng-docker/.jarvis-token"
if [ -s "$TOKEN_FILE" ]; then
  SEARX_TOKEN="$(cat "$TOKEN_FILE")"
  echo "Keeping the existing bearer token."
else
  SEARX_TOKEN="$(openssl rand -hex 32)"
  printf '%s' "$SEARX_TOKEN" > "$TOKEN_FILE"
  chmod 600 "$TOKEN_FILE"
  echo "Generated a bearer token."
fi

cat > .env <<ENVEOF
SEARXNG_HOSTNAME=${SEARX_HOST}
LETSENCRYPT_EMAIL=${SEARX_EMAIL}
SEARXNG_TOKEN=${SEARX_TOKEN}
ENVEOF
chmod 600 .env

# Upstream ships a settings.yml with a placeholder secret; this generates a
# real one on first run only.
if [ -f searxng/settings.yml ]; then
  if grep -q "ultrasecretkey" searxng/settings.yml; then
    sed -i "s|ultrasecretkey|$(openssl rand -hex 32)|g" searxng/settings.yml
    echo "Generated SearXNG's secret key."
  fi
else
  die "searxng/settings.yml is missing from the upstream clone - something went wrong above."
fi

# THE line everybody misses. A stock SearXNG serves HTML only and answers 403
# on /search?format=json, which is the exact call the hub makes.
if ! grep -qE '^\s+-\s+json\s*$' searxng/settings.yml; then
  python3 - <<'PYEOF'
import re, pathlib
p = pathlib.Path("searxng/settings.yml")
s = p.read_text()
if re.search(r"^search:", s, re.M):
    # Append `json` to an existing formats list, or add the whole block.
    if re.search(r"^\s+formats:", s, re.M):
        s = re.sub(r"(^\s+formats:\s*\n(?:\s+-\s+\w+\s*\n)*)", lambda m: m.group(1) + "    - json\n", s, count=1, flags=re.M)
    else:
        s = re.sub(r"^(search:\s*\n)", r"\1  formats:\n    - html\n    - json\n", s, count=1, flags=re.M)
else:
    s += "\nsearch:\n  formats:\n    - html\n    - json\n"
p.write_text(s)
print("Enabled the JSON API.")
PYEOF
else
  echo "JSON API already enabled."
fi

# The limiter counts per client IP, and every request arrives from one server
# (the hub), so with it on the instance throttles its only user. Safe because
# the Caddy gate below means this instance is not open to the public.
if grep -qE '^\s+limiter:\s*true' searxng/settings.yml; then
  sed -i -E 's|^(\s+)limiter:\s*true|\1limiter: false|' searxng/settings.yml
  echo "Turned the per-IP limiter off."
fi

say "Locking it to the hub"
# Upstream's Caddyfile serves SearXNG to anyone who finds the hostname. This
# replaces it with one that demands the shared bearer token, so a public
# hostname does not become a public search engine within days.
cat > Caddyfile <<'CADDYEOF'
{$SEARXNG_HOSTNAME} {
	encode zstd gzip

	header {
		X-Content-Type-Options nosniff
		X-Frame-Options DENY
		Referrer-Policy no-referrer
		X-Robots-Tag "noindex, nofollow, noarchive"
		-Server
	}

	# The gate. Unconditional: an optional one is a gate that ends up off.
	@unauthorized not header Authorization "Bearer {$SEARXNG_TOKEN}"
	respond @unauthorized 401 {
		body "This SearXNG instance is private. Send the bearer token."
		close
	}

	reverse_proxy searxng:8080 {
		header_up X-Forwarded-For {remote_host}
		header_up X-Real-IP {remote_host}
		header_up X-Forwarded-Proto {scheme}
		header_up Host {host}
	}
}
CADDYEOF

# Caddy reads SEARXNG_TOKEN from its environment, so compose has to pass it.
printf 'SEARXNG_TOKEN=%s\n' "$SEARX_TOKEN" >> .env
if ! grep -q "SEARXNG_TOKEN" docker-compose.yaml 2>/dev/null; then
  python3 - <<'PYEOF'
import pathlib, re
for name in ("docker-compose.yaml", "docker-compose.yml"):
    p = pathlib.Path(name)
    if not p.exists():
        continue
    s = p.read_text()
    # Give the caddy service the token from .env. Without this the Caddyfile's
    # {$SEARXNG_TOKEN} expands to empty and the gate matches every request.
    s = re.sub(
        r"(\n\s+- SEARXNG_HOSTNAME=[^\n]*)",
        r"\1\n      - SEARXNG_TOKEN=${SEARXNG_TOKEN}",
        s, count=1,
    )
    p.write_text(s)
    print(f"Passed the token to Caddy in {name}.")
    break
PYEOF
fi

if ! grep -q "SEARXNG_TOKEN" docker-compose.yaml 2>/dev/null; then
  die "Could not pass the token to Caddy: no SEARXNG_HOSTNAME line was found in docker-compose.yaml to add it beside. Upstream's layout must have changed - add '- SEARXNG_TOKEN=\${SEARXNG_TOKEN}' to the caddy service's environment by hand, then run this again."
fi

say "Starting it"
docker compose pull --quiet 2>/dev/null || docker compose pull
docker compose up -d

say "Waiting for the JSON API"
# The JSON API specifically. A green container proves nothing: the format
# being disabled is the failure that actually happens.
OK=""
for _ in $(seq 1 40); do
  if docker compose exec -T searxng wget -qO- "http://127.0.0.1:8080/search?q=ping&format=json" 2>/dev/null | grep -q '"results"'; then
    OK="yes"; break
  fi
  sleep 3; printf '.'
done
echo

[ -n "$OK" ] || {
  warn "SearXNG did not answer on the JSON API."
  warn "Look at: docker compose logs --tail=50 searxng"
  die  "Fix that and run this again."
}
echo "JSON API is answering inside the container."

say "Checking it through TLS, the way the hub will"
if curl -fsS --max-time 20 -H "Authorization: Bearer ${SEARX_TOKEN}" \
     "https://${SEARX_HOST}/search?q=ping&format=json" | grep -q '"results"'; then
  echo "Reachable at https://${SEARX_HOST} with the token."
else
  warn "Not reachable through https://${SEARX_HOST} yet."
  warn "If DNS was only just pointed here, Caddy needs a minute: docker compose logs -f caddy"
  warn "On a WINDOWS VPS also check the port forward - see infra/searxng/README.md."
fi

CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "https://${SEARX_HOST}/search?q=ping&format=json" || echo 000)"
if [ "$CODE" = "401" ]; then
  echo "Confirmed: a request with no token is refused."
else
  warn "A request WITHOUT the token returned ${CODE}, not 401. The gate may not be active - check Caddyfile and .env."
fi

cat <<FINALEOF

$(printf '\033[1m== Done. Put these two in Vercel (Production and Preview), then redeploy.\033[0m')

  SEARXNG_URL=https://${SEARX_HOST}
  SEARXNG_TOKEN=${SEARX_TOKEN}

Environment variables are baked in at build time, so nothing changes on the
live site until the next deploy.

Day to day, from /opt/searxng-docker:
  docker compose logs -f searxng
  git pull && docker compose pull && docker compose up -d

The token is also saved at ${TOKEN_FILE} (mode 600).
FINALEOF
