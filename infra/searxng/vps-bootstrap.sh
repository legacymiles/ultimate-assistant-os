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
# Pasted into a shell on the VPS, it writes the whole stack itself and brings
# it up. Nothing is copied from the laptop, and nothing is cloned.
#
# WINDOWS VPS, after `wsl.exe --install -d Ubuntu` and a reboot:
#   wsl -d Ubuntu -u root
#   export SEARX_HOST=search.example.com
#   ...then paste this whole file.
#
# It WRITES its own compose file, settings and Caddyfile rather than cloning
# searxng-docker. That repo was the obvious base and it is now deprecated and
# empty - a clone of it gets a LICENSE and a README, which is exactly how this
# script failed the first time. Three files we control beat a fourth party's
# directory layout, and the official searxng/searxng image is the stable part
# worth depending on.
#
# Safe to run twice: secrets already generated are kept, so it is also the
# upgrade path.
# ---------------------------------------------------------------------------

# Checked before anything else: pasted into PowerShell, "set -euo pipefail"
# complains about a parameter named 'euo', which explains nothing.
if [ -z "${BASH_VERSION:-}" ]; then
  echo "This needs bash, not PowerShell. Run first:  wsl -d Ubuntu -u root" >&2
  exit 1
fi
set -euo pipefail

# --- Set these BEFORE running, as environment variables --------------------
#   export SEARX_HOST=search.yourdomain.com
#   export SEARX_EMAIL=you@yourdomain.com     # optional
SEARX_HOST="${SEARX_HOST:-search.example.com}"
SEARX_EMAIL="${SEARX_EMAIL:-}"
STACK_DIR="${STACK_DIR:-/opt/searxng}"
# ---------------------------------------------------------------------------

say()  { printf '\n\033[1m== %s\033[0m\n' "$*"; }
warn() { printf '\033[33m!! %s\033[0m\n' "$*"; }
die()  { printf '\033[31mxx %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" = "0" ] || die "Run as root. On WSL that is: wsl -d Ubuntu -u root"
case "$SEARX_HOST" in
  search.example.com|"")
    die "Set your hostname first:  export SEARX_HOST=search.yourdomain.com  then run this again." ;;
esac

say "Packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates openssl >/dev/null
echo "curl, openssl ready."

say "Docker"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
else
  echo "Already installed."
fi
if ! docker info >/dev/null 2>&1; then
  (systemctl enable --now docker >/dev/null 2>&1 || service docker start >/dev/null 2>&1) || true
  sleep 3
fi
docker info >/dev/null 2>&1 || die "Docker will not start. On WSL enable systemd, then run 'wsl --shutdown' from Windows and come back."
docker compose version >/dev/null 2>&1 || die "The docker compose plugin is missing."
echo "Docker is up."

say "Secrets"
mkdir -p "$STACK_DIR/searxng"
cd "$STACK_DIR"
# Kept across runs: rotating the token silently would break the hub until
# Vercel was updated to match.
if [ -s .jarvis-token ]; then
  SEARX_TOKEN="$(cat .jarvis-token)"
  echo "Keeping the existing bearer token."
else
  SEARX_TOKEN="$(openssl rand -hex 32)"
  printf '%s' "$SEARX_TOKEN" > .jarvis-token
  chmod 600 .jarvis-token
  echo "Generated a bearer token."
fi
if [ -s .searxng-secret ]; then
  SEARX_SECRET="$(cat .searxng-secret)"
else
  SEARX_SECRET="$(openssl rand -hex 32)"
  printf '%s' "$SEARX_SECRET" > .searxng-secret
  chmod 600 .searxng-secret
fi

say "Writing the stack"
{
  printf 'SEARXNG_HOSTNAME=%s\n' "$SEARX_HOST"
  printf 'SEARXNG_TOKEN=%s\n'    "$SEARX_TOKEN"
  printf 'SEARXNG_SECRET=%s\n'   "$SEARX_SECRET"
  # Only for expiry notices, and ACME works without a contact. A placeholder
  # here would be an invalid registration and fail the order outright.
  if [ -n "$SEARX_EMAIL" ]; then
    printf 'LETSENCRYPT_EMAIL=%s\n' "$SEARX_EMAIL"
  fi
} > .env
chmod 600 .env

cat > docker-compose.yml <<'COMPOSEEOF'
services:
  caddy:
    image: docker.io/library/caddy:2-alpine
    container_name: searxng-caddy
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data
      - caddy-config:/config
    environment:
      - SEARXNG_HOSTNAME=${SEARXNG_HOSTNAME}
      - SEARXNG_TOKEN=${SEARXNG_TOKEN}
    depends_on:
      - searxng

  searxng:
    image: docker.io/searxng/searxng:latest
    container_name: searxng
    restart: unless-stopped
    volumes:
      - ./searxng:/etc/searxng:rw
    environment:
      - SEARXNG_BASE_URL=https://${SEARXNG_HOSTNAME}/
      - SEARXNG_SECRET=${SEARXNG_SECRET}
      - SEARXNG_REDIS_URL=redis://valkey:6379/0
    depends_on:
      - valkey
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"

  valkey:
    image: docker.io/valkey/valkey:8-alpine
    container_name: searxng-valkey
    restart: unless-stopped
    command: valkey-server --save 30 1 --loglevel warning
    volumes:
      - valkey-data:/data

volumes:
  caddy-data:
  caddy-config:
  valkey-data:
COMPOSEEOF

# The two lines that matter, and that a stock settings.yml gets wrong here:
# json in formats (without it /search?format=json is a 403, the exact call the
# hub makes), and the limiter off (it counts per client IP, and every request
# comes from one server, so it throttles its only user - safe because the
# Caddy gate below means this is not a public instance).
cat > searxng/settings.yml <<SETTINGSEOF
use_default_settings: true

general:
  instance_name: "Jarvis Search"
  donation_url: false
  contact_url: false

search:
  safe_search: 1
  autocomplete: ""
  default_lang: "en"
  formats:
    - html
    - json

server:
  secret_key: "${SEARX_SECRET}"
  limiter: false
  public_instance: false
  image_proxy: false

ui:
  default_locale: "en"
  query_in_title: true
  infinite_scroll: false
  default_theme: simple
  theme_args:
    simple_style: dark

outgoing:
  request_timeout: 5.0
  max_request_timeout: 12.0
  pool_connections: 100
  pool_maxsize: 20
  enable_http2: true
SETTINGSEOF

# A public hostname without a gate becomes a public search engine within days.
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

	# Unconditional: an optional gate is a gate that ends up off.
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

echo "Wrote docker-compose.yml, searxng/settings.yml and Caddyfile in $STACK_DIR."

say "Starting it"
docker compose pull
docker compose up -d

say "Waiting for the JSON API"
# The JSON API specifically. A green container proves nothing: the format being
# disabled is the failure that actually happens.
OK=""
for _ in $(seq 1 40); do
  if docker compose exec -T searxng wget -qO- "http://127.0.0.1:8080/search?q=ping&format=json" 2>/dev/null | grep -q '"results"'; then
    OK="yes"; break
  fi
  sleep 3; printf '.'
done
echo

if [ -z "$OK" ]; then
  warn "SearXNG did not answer on the JSON API."
  warn "Look at:  cd $STACK_DIR && docker compose logs --tail=50 searxng"
  die  "Fix that and run this again."
fi
echo "JSON API is answering inside the container."

say "Checking it through TLS, the way the hub will"
if curl -fsS --max-time 20 -H "Authorization: Bearer ${SEARX_TOKEN}" "https://${SEARX_HOST}/search?q=ping&format=json" | grep -q '"results"'; then
  echo "Reachable at https://${SEARX_HOST} with the token."
else
  warn "Not reachable through https://${SEARX_HOST} yet."
  warn "If DNS was only just pointed here, Caddy needs a minute for the certificate:"
  warn "  cd $STACK_DIR && docker compose logs -f caddy"
  warn "On a WINDOWS VPS this is also where the WSL port forward is still missing."
fi

CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "https://${SEARX_HOST}/search?q=ping&format=json" || echo 000)"
if [ "$CODE" = "401" ]; then
  echo "Confirmed: a request with no token is refused."
else
  warn "A request WITHOUT the token returned ${CODE}, not 401 - check the gate once TLS works."
fi

printf '\n\033[1m== Put these two in Vercel (Production and Preview), then redeploy.\033[0m\n\n'
printf '  SEARXNG_URL=https://%s\n' "$SEARX_HOST"
printf '  SEARXNG_TOKEN=%s\n\n' "$SEARX_TOKEN"
printf 'Env vars are baked in at build time - redeploy before testing the live site.\n\n'
printf 'Day to day, from %s:\n' "$STACK_DIR"
printf '  docker compose logs -f searxng\n'
printf '  docker compose pull && docker compose up -d\n\n'
printf 'The token is also saved at %s/.jarvis-token (mode 600).\n' "$STACK_DIR"
