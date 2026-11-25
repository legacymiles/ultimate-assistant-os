# 24/7 Queue API — connecting a website or app

Any website, app or studio can hand work to the owner's 24/7 Queue, take work from it, and report
progress, results and discoveries back to Jarvis. Hub apps (everything in `src/lib/catalog.ts`) are
connected automatically; this API is for everything outside the hub.

Base URL: `https://bighomieai.com` (or the hub you run).

## 1. Get a key

Jarvis › 24/7 Queue › **Apps** › Connect an app: give it an id (`photo-vault`), a name, its URL, what
it can do, and optionally a **callback URL**. You get a key `q247_…` **once** — store it as a server
secret in that app. Keys can be revoked and re-issued there. Only the sha256 is stored.

Every call: `Authorization: Bearer q247_…`, JSON bodies.

## 2. Describe yourself on start-up

```http
POST /api/queue247/v1/apps
{ "name": "Photo Vault", "url": "https://photos.example.com",
  "description": "Family photo library: tagging, faces, backups",
  "capabilities": ["face-tagging", "backup-check"],
  "callback_url": "https://photos.example.com/api/queue-hook" }
```

`GET /api/queue247/v1/apps` returns what the queue knows about you.

## 3. Submit work to the queue

```http
POST /api/queue247/v1/tasks
{ "title": "Find better open-source face recognition models",
  "executor": "research",
  "kind": "recurring",
  "schedule": { "dailyAt": "07:00", "tz": "America/New_York" },
  "config": { "topic": "open-source face recognition 2026", "sources": ["web", "github"] } }
→ 201 { "task": { "id": "…", "status": "scheduled", … } }
```

Executors an outside app may use: `research`, `monitor`, `h3-recreate`, `mt4-discovery`.
`kind`: `once` · `scheduled` (needs `schedule.at`) · `recurring` (`schedule.everyMinutes` or
`dailyAt`) · `continuous` (a standing workflow, `everyMinutes` between rounds, min 5).

To have the queue track work **your app** does, send `"assign_to_me": true`: the task is delivered
to your callback URL (or you poll for it) and you report on it below.

`GET /api/queue247/v1/tasks?status=queued,running` lists your tasks.

## 4. Receive work (callback)

When a task is assigned to your app, the queue POSTs to your `callback_url`:

```json
{ "event": "task.assigned",
  "task": { "id": "…", "title": "…", "instruction": "…", "config": {}, "kind": "once" },
  "report": "/api/queue247/v1/task?id=…" }
```

Answer 2xx to accept. No callback URL? Poll `GET /api/queue247/v1/tasks?status=queued,scheduled`.
A task with no report for `config.timeoutHours` (default 24) fails and the owner is told.

## 5. Report back

`GET /api/queue247/v1/task?id=<id>` — one task. `POST` the same URL with one of:

```json
{ "type": "progress", "progress": 40, "step": "Tagging 1,204 photos", "message": "optional log line" }
{ "type": "log", "message": "Backup drive 2 is 91% full", "level": "warn" }
{ "type": "finding", "kind": "duplicate-faces", "key": "cluster-88", "title": "Same person in 2 albums",
  "summary": "…", "url": "https://…", "score": 72, "data": {}, "notable": true }
{ "type": "complete", "summary": "Tagged 1,204 photos, 3 new people" }
{ "type": "fail", "error": "Drive not mounted" }
{ "type": "ask", "question": "Merge these two people?" }
{ "type": "control", "action": "pause" }
```

Findings are de-duplicated by `(kind, key)` — reporting the same key again updates it. `notable`
findings notify the owner. `ask` puts the task in **Needs you** on the board until the owner answers.

## Rules

- An app sees only tasks it submitted or was assigned — never anyone else's.
- Nothing irreversible (spending, trading, posting, sending) happens without the owner: use `ask`.
- Errors are plain English in `{ "error": "…" }` with a 4xx/5xx status.
