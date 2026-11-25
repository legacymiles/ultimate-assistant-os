# 24/7 Queue worker

The process that actually runs 24/7 Queue tasks. It lives on the VPS so work continues with the
owner's PC off and no browser open. Source: `src/lib/queue247/worker/` (runtime) and
`src/lib/queue247/executors/` (the kinds of work); this folder only bundles and ships it.

## How it works

- Every task is a row in `public.queue_tasks` (Supabase). The worker claims due tasks with the
  `queue_claim` SQL function (`FOR UPDATE SKIP LOCKED`), so any number of workers on any machines
  never run the same task twice.
- It runs **one bounded step** (≤ 4 min) of the task's executor, renewing a 5-minute lease every
  minute, then writes back state, steps, progress, the run record and the log. Everything needed to
  continue is in Postgres, so a crash, restart or reboot only costs the step in flight: its lease
  expires and the next claim re-runs it.
- Pausing or terminating a task on the board makes the lease renew fail; the step is aborted.
- `SIGTERM` (docker stop / restart / deploy) hands running tasks straight back to the queue.
- Heartbeat every 30 s into `queue_workers` (capabilities, running tasks, memory, load) — that is
  what the board's "Workers" strip shows.

## Build and run

```bash
node tools/queue-worker/build.mjs          # → tools/queue-worker/dist/worker.mjs (one file)
node tools/queue-worker/dist/worker.mjs --doctor   # what this machine can do
```

On the VPS (Windows Server → WSL2 Ubuntu → Docker):

```bash
cd /opt/queue-worker            # dist/, Dockerfile, docker-compose.yml, .env
docker compose up -d --build
docker compose logs -f --tail 100
```

`restart: always` brings it back after a crash or a Docker restart. WSL itself is kept alive by the
VPS's existing boot script (see `~/.claude/aios/connections.md`), the same way SearXNG is.

Deploy an update from the PC: `node tools/queue-worker/deploy.mjs` (builds, copies `dist/` over
SSH, rebuilds the container).

## Capabilities

Detected at start (`--doctor` prints them): `web` always, `ai` with an AI key, `storage` with the
service key, `ffmpeg`, `ytdlp` when the binaries answer. A task lists what it `needs`; a worker only
claims tasks it can run. `QUEUE_CAPABILITIES=web,ai` restricts a worker.

## Safety

Executors never execute downloaded code, never trade, never post or spend: anything irreversible
returns `needs_approval` and waits for the owner on the board.
