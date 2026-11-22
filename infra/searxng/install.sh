#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Put SearXNG on the VPS, behind TLS, reachable only with a bearer token.
#
#   scp -r infra/searxng youruser@your-vps:~/searxng
#   ssh youruser@your-vps
#   cd ~/searxng && sudo bash install.sh search.example.com
#
# It installs Docker if it is missing, generates the two secrets, brings the
# stack up, waits for the JSON API to actually answer, and then prints the
# three environment variables to paste into Vercel. Running it again is safe:
# existing secrets are kept, so it doubles as the upgrade path.
#
# What it does NOT do: point DNS. The A record for the hostname must already
# resolve to this machine, or Let's Encrypt cannot issue a certificate — the
# script checks and says so rather than failing inside Caddy.
# ---------------------------------------------------------------------------
set -euo pipefail

HOSTNAME_ARG="${1:-}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"

say()  { printf '\n\033[1m== %s\033[0m\n' "$*"; }
warn() { printf '\033[33m!! %s\033[0m\n' "$*"; }
die()  { printf '\033[31mxx %s\033[0m\n' "$*" >&2; exit 1; }

[ -n "$HOSTNAME_ARG" ] || die "Usage: sudo bash install.sh <hostname>   e.g. search.example.com"
[ "$(id -u)" = "0" ] || die "Run it with sudo — it installs packages and writes to /etc/docker."

# ---------------------------------------------------------------------------
say "Checking DNS for $HOSTNAME_ARG"
# ---------------------------------------------------------------------------
PUBLIC_IP="$(curl -fsS --max-time 10 https://api.ipify.org || true)"
RESOLVED="$(getent ahostsv4 "$HOSTNAME_ARG" 2>/dev/null | awk 'NR==1{print $1}' || true)"
if [ -z "$RESOLVED" ]; then
  warn "$HOSTNAME_ARG does not resolve yet. Add an A record pointing at ${PUBLIC_IP:-this machine} and run this again."
  warn "Continuing anyway — Caddy will keep retrying the certificate until DNS catches up."
elif [ -n "$PUBLIC_IP" ] && [ "$RESOLVED" != "$PUBLIC_IP" ]; then
  warn "$HOSTNAME_ARG resolves to $RESOLVED but this machine is $PUBLIC_IP."
  warn "If that is a proxy (Cloudflare), turn the orange cloud OFF until the certificate is issued."
fi

# ---------------------------------------------------------------------------
say "Docker"
# ---------------------------------------------------------------------------
if ! command -v docker >/dev/null 2>&1; then
  echo "Installing Docker from get.docker.com…"
  curl -fsSL https://get.docker.com | sh
else
  echo "Docker $(docker --version | awk '{print $3}' | tr -d ,) already installed."
fi
docker compose version >/dev/null 2>&1 || die "The Docker Compose plugin is missing. Install docker-compose-plugin and run this again."
systemctl enable --now docker >/dev/null 2>&1 || true

# ---------------------------------------------------------------------------
say "Secrets"
# ---------------------------------------------------------------------------
# Kept across runs, so re-running is an upgrade rather than a key rotation —
# rotating SEARXNG_TOKEN silently would break the hub until Vercel was updated.
touch .env
chmod 600 .env

get_env() { grep -E "^$1=" .env 2>/dev/null | tail -n1 | cut -d= -f2- || true; }
set_env() {
  if grep -qE "^$1=" .env 2>/dev/null; then
    sed -i "s|^$1=.*|$1=$2|" .env
  else
    printf '%s=%s\n' "$1" "$2" >> .env
  fi
}

SECRET="$(get_env SEARXNG_SECRET)"
if [ -z "$SECRET" ]; then
  SECRET="$(openssl rand -hex 32)"
  echo "Generated SEARXNG_SECRET."
else
  echo "Keeping the existing SEARXNG_SECRET."
fi

TOKEN="$(get_env SEARXNG_TOKEN)"
if [ -z "$TOKEN" ]; then
  TOKEN="$(openssl rand -hex 32)"
  echo "Generated SEARXNG_TOKEN."
else
  echo "Keeping the existing SEARXNG_TOKEN."
fi

set_env SEARXNG_SECRET "$SECRET"
set_env SEARXNG_TOKEN "$TOKEN"
set_env SEARXNG_HOSTNAME "$HOSTNAME_ARG"
set_env SEARXNG_BASE_URL "https://$HOSTNAME_ARG/"
# Bound to loopback: Caddy is the only way in.
set_env SEARXNG_BIND "127.0.0.1"
set_env SEARXNG_WORKERS "$(nproc 2>/dev/null || echo 2)"

# ---------------------------------------------------------------------------
say "Firewall"
# ---------------------------------------------------------------------------
if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
  ufw allow 80/tcp  >/dev/null 2>&1 || true
  ufw allow 443/tcp >/dev/null 2>&1 || true
  echo "Opened 80 and 443 in ufw. Port 8080 stays closed — it is loopback-only."
else
  echo "ufw is not active; skipping. Make sure 80 and 443 are open in your provider's firewall."
fi

# ---------------------------------------------------------------------------
say "Starting SearXNG, Valkey and Caddy"
# ---------------------------------------------------------------------------
[ -f searxng/settings.yml ] || die "searxng/settings.yml is missing — copy the whole infra/searxng folder, not just this script."
docker compose --profile public pull
docker compose --profile public up -d

# ---------------------------------------------------------------------------
say "Waiting for the JSON API"
# ---------------------------------------------------------------------------
# The JSON API specifically, because that is the thing the hub uses and the
# thing a stock settings.yml leaves disabled. A green container proves nothing.
OK=""
for attempt in $(seq 1 30); do
  if curl -fsS --max-time 5 "http://127.0.0.1:8080/search?q=ping&format=json" | grep -q '"results"'; then
    OK="yes"
    break
  fi
  sleep 3
  printf '.'
done
echo

if [ -z "$OK" ]; then
  warn "SearXNG did not answer on the JSON API. The usual causes, in order:"
  warn "  1. settings.yml lost its 'formats: [html, json]' — check searxng/settings.yml."
  warn "  2. The container is still starting. Try: docker compose logs -f searxng"
  die  "Fix that and run this again."
fi
echo "JSON API is answering locally."

# Then through Caddy, with the token, which is what the hub will actually do.
say "Checking it through TLS with the token"
if curl -fsS --max-time 15 -H "Authorization: Bearer $TOKEN" \
     "https://$HOSTNAME_ARG/search?q=ping&format=json" | grep -q '"results"'; then
  echo "Reachable at https://$HOSTNAME_ARG with the token."
else
  warn "Not reachable through https://$HOSTNAME_ARG yet."
  warn "If DNS was only just pointed here, Caddy needs a minute to get the certificate: docker compose logs -f caddy"
fi

# And confirm the gate actually refuses an unauthenticated caller.
if [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "https://$HOSTNAME_ARG/search?q=ping&format=json" || echo 000)" = "401" ]; then
  echo "Confirmed: a request with no token is refused."
else
  warn "A request WITHOUT the token was not refused with 401. Check the Caddyfile is the one in this folder."
fi

# ---------------------------------------------------------------------------
cat <<EOF

$(printf '\033[1m== Done. Put these three in Vercel (Production and Preview), then redeploy.\033[0m')

  SEARXNG_URL=https://$HOSTNAME_ARG
  SEARXNG_TOKEN=$TOKEN
  TAVILY_API_KEY=<optional, from tavily.com — the fallback when this box is unreachable>

  vercel env add SEARXNG_URL production
  vercel env add SEARXNG_TOKEN production

Environment variables are baked in at build time, so nothing changes on the
live site until the next deploy.

Day to day:
  docker compose --profile public logs -f searxng   what the engines are doing
  docker compose --profile public pull && docker compose --profile public up -d   upgrade
  curl -H "Authorization: Bearer \$SEARXNG_TOKEN" "https://$HOSTNAME_ARG/search?q=test&format=json" | head -c 400

The secrets are in ./.env (mode 600). Keep it off git — it is already ignored.
EOF
