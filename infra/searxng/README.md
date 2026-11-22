# SearXNG — the hub's primary search provider

A metasearch engine the owner runs. It queries Google, Bing, Brave, DuckDuckGo,
Wikipedia and others, strips the tracking, and hands back JSON. No API key, no
quota, no per-call cost, and the queries carry no account.

Two instances, and the hub prefers them in this order:

| Where | Reached as | Who can reach it | Why it exists |
|---|---|---|---|
| **This machine** | `http://127.0.0.1:8080` | only code running on this laptop | free, instant, and the search never leaves the house |
| **The VPS** | `https://<your-host>` | the deployed hub, with a bearer token | answers when the laptop is off, which is most of the time |

The honest limit, because it decides how this gets deployed: **the deployed hub
cannot reach the laptop.** A Vercel function has no route to `127.0.0.1` on a
laptop in another country. So the real chains are:

- `npm run dev` on the laptop → laptop → VPS → DuckDuckGo → Tavily
- the deployed site → VPS → DuckDuckGo → Tavily

That is not a special case in the code — a localhost endpoint simply fails fast
from anywhere else, and the circuit breaker stops it being retried — but it is
why `SEARXNG_URL` (the VPS) is the one variable that actually matters in
production.

---

## On the VPS

```bash
scp -r infra/searxng youruser@your-vps:~/searxng
```

```bash
ssh youruser@your-vps 'cd ~/searxng && sudo bash install.sh search.example.com'
```

The DNS A record for that hostname must already point at the VPS, or Let's
Encrypt cannot issue a certificate. The script checks and tells you rather than
failing inside Caddy.

It installs Docker if missing, generates `SEARXNG_SECRET` and `SEARXNG_TOKEN`,
starts SearXNG + Valkey + Caddy, waits until the **JSON API** actually answers,
confirms that a request *without* the token is refused, and prints the two
variables to put in Vercel. Run it again any time — existing secrets are kept,
so it is also the upgrade path.

Then, on this machine:

```bash
vercel env add SEARXNG_URL production
```

```bash
vercel env add SEARXNG_TOKEN production
```

Environment variables are baked in at build time, so **redeploy** before
testing the live site.

## On a WINDOWS VPS

`install.sh` is for Linux. A Windows Server has no `apt`, `sudo` or systemd,
and SearXNG ships only Linux containers, so the way in is **WSL2**: a real
Linux kernel on the Windows box running the same compose stack.

Copy this folder to the VPS (from **your laptop**, not from the VPS):

```bash
scp -r infra/searxng Administrator@your-vps:C:/searxng
```

Then on the VPS, in an **Administrator** PowerShell:

```powershell
cd C:\searxng; powershell -ExecutionPolicy Bypass -File .\setup-windows-vps.ps1 -Hostname search.example.com
```

It checks the box can actually do this before changing anything, installs WSL
and Ubuntu, installs Docker inside it, copies the stack to `/opt/searxng`,
strips the carriage returns Windows adds (bash fails on them with the
unhelpful `$'': command not found`), and then runs the same `install.sh` a
Linux VPS would. Running it twice is safe.

Three things are different from Linux, and all three are handled:

- **Nested virtualization.** WSL2 needs it and many Windows VPS hosts do not
  expose it. The script checks first and stops with the options rather than
  failing halfway through.
- **A reboot.** Installing WSL for the first time needs one. The script says so
  and exits; run the same command again afterwards.
- **WSL2 networking.** WSL sits behind a NAT, so public 80/443 do not reach it.
  Where the WSL build supports *mirrored* networking the script turns it on and
  there is nothing to forward. Otherwise it sets a `netsh` portproxy **and**
  registers `refresh-portproxy.ps1` as a startup task — because WSL takes a new
  address on every boot, and a portproxy set once silently dies at the first
  restart.

If the preflight says virtualization is unavailable, WSL2 is a dead end on that
box. The honest options are: ask the provider to enable nested virtualization,
run SearXNG natively from Python on Windows (unsupported upstream, more
fragile), or put it on a small Linux VPS where `install.sh` works as written.

The PowerShell files here are **ASCII with a BOM** on purpose. Windows
PowerShell 5.1 reads a BOM-less UTF-8 file as the ANSI codepage, which turns an
em dash into `â€"` — and that stray quote terminates a string early and
breaks the script in a way the error message does not explain.

## On this machine

Needs Docker Desktop (`winget install Docker.DockerDesktop`).

```powershell
cd infra\searxng; .\start-local.ps1
```

Then add one line to the repo root's `.env.local` and restart `npm run dev`:

```bash
SEARXNG_LOCAL_URL=http://127.0.0.1:8080
```

No TLS and no token here: the container binds to loopback, so nothing outside
this machine can reach it anyway.

---

## The one thing that goes wrong

A stock SearXNG **serves HTML only**. `GET /search?format=json` returns **403**
until `json` is in its formats list. The `searxng/settings.yml` in this folder
already has it:

```yaml
search:
  formats:
    - html
    - json
```

If you ever regenerate settings from the upstream default, that line is the
first thing to put back. The hub names this failure exactly — the dashboard
says *"SearXNG serves HTML only until you add json to the formats list"* rather
than "the VPS is down" — because it is the mistake everybody makes once.

Two more worth knowing:

- **`server.limiter` is off.** It counts requests per client IP, and every
  request arrives from one server (the hub), so with it on the instance
  throttles its only user. That is safe *because* the instance is private:
  Caddy demands the token and the container is loopback-only. Open the instance
  to other people and both of those have to change together.
- **Some engines refuse datacentre addresses.** Qwant, Startpage and Yahoo are
  disabled in settings for that reason — each one left on costs a timeout on
  every search. The instance's own `/stats` page shows what is really answering.

## Day to day

```bash
docker compose --profile public logs -f searxng
```

```bash
docker compose --profile public pull && docker compose --profile public up -d
```

```bash
curl -H "Authorization: Bearer $SEARXNG_TOKEN" "https://search.example.com/search?q=test&format=json" | head -c 400
```

## Files here

| File | What it is |
|---|---|
| `docker-compose.yml` | SearXNG + Valkey, plus Caddy under the `public` profile (VPS only) |
| `searxng/settings.yml` | the instance config — JSON format on, limiter off, dead engines disabled |
| `Caddyfile` | TLS, security headers, the bearer-token gate, and query strings redacted from the access log |
| `install.sh` | the VPS installer and upgrader |
| `start-local.ps1` | the laptop starter |
| `setup-windows-vps.ps1` | the Windows VPS installer: WSL2 + Docker, then `install.sh` |
| `refresh-portproxy.ps1` | re-points 80/443 at WSL after a reboot (portproxy path only) |
| `.env.example` | what ends up in `.env` — names only, no values |

`.env` and `.env.local` are gitignored. `.env.example` is not, on purpose.

Everything about the API in front of this — endpoints, auth, the client
libraries, the dashboard — is in [`docs/search-api.md`](../../docs/search-api.md).
