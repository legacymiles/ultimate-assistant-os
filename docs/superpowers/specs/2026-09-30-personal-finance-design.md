# Personal Finance — design

**Date:** 2026-09-30
**Surface:** a `role: "finance"` folder inside Jarvis (`/apps/jarvis` › Folders › Personal Finance)
**Status:** approved design, ready for an implementation plan

---

## 1. What this is for

The owner connects a bank. From then on Jarvis knows what is owed and when, and says
something when a charge looks wrong.

Four promises, in the owner's words:

1. **Upcoming bills and payments appear on the calendar**, with alerts and reminders that
   are configurable per bill.
2. **Credit cards show their payment due date and statement closing date** — fetched from
   the bank where the bank publishes them, never typed if typing can be avoided.
3. **A form captures every bill and its due date** for anything the bank cannot tell us.
4. **The Jarvis dashboard reports suspicious things** — being charged twice above all.
5. **Daily and weekly spend on cards, excluding bills**, in a tab on the dashboard (§13).
6. **The ledger is answerable from any MCP-aware assistant**, read-only (§14).

Anything beyond those six is out of scope for this spec. In particular: no budgeting, no
net-worth tracking, no investment accounts, no spend-by-category *reporting* beyond the top
merchants in §13, and no bill paying.

## 2. The central decision: two ledgers and one reconciliation

The app keeps two separate ledgers and its single job is to reconcile them.

- **The plan** — bills the owner declares (typed in the form, or detected from history and
  confirmed). What *should* happen.
- **The actuals** — charges observed on the connected accounts. What *did* happen.

Every alert the owner asked for is a reconciliation outcome rather than a bespoke rule:

| Finding | What it means in the two ledgers |
|---|---|
| `duplicate-charge` | Two or more actuals matching one plan occurrence, or two matching each other with no plan |
| `missed-bill` | A plan occurrence past its grace period with no actual |
| `amount-changed` | A matched actual outside the plan row's tolerance |
| `unplanned-recurring` | Evenly-spaced repeating actuals with no plan row at all |
| `card-due-soon` | A credit account's `next_due_date` inside the lead time |
| `card-statement-closing` | A credit account's next closing date inside the lead time |

Two consequences worth stating, because they are the reason for the shape:

- **With no bank connected the app is still useful.** The plan alone produces the calendar,
  the reminders and the due-date emails. This satisfies the repo rule that an app must work
  with no keys set, and it is why the bill form is not a fallback but a first-class input.
- **Reconciliation is a pure function.** It takes two arrays and a clock and returns
  findings. No network, no database, no React. It is the part most likely to be wrong, so
  it is the part that is unit tested hardest.

## 3. Where it lives

`src/components/recall/FolderHome.tsx:47` already branches on `f.role === "photos"` to mount
a different surface for a folder the app itself manages. Finance uses the same seam:

- A folder named **Personal Finance** with `role: "finance"`, created once on first open.
- Opening it mounts `<FinanceHome/>` instead of the ordinary folder workspace, with its own
  accent, the way the Photos folder keeps its warm palette.
- `Folder.role` widens from `"photos"` to `"photos" | "finance"`. Both existing call sites
  (`FolderHome.tsx`, the folder create path) are updated; a folder whose `role` is undefined
  behaves exactly as it does today.
- No new rail tab, no `catalog.ts` entry, no second login — Jarvis is already behind
  `appGate` and already listed in `UNPREVIEWABLE`, so the hub carousel will never frame it.
- Deep link: `/apps/jarvis?tab=folders&folder=<id>`.

### Surface layout

Dense, database-style, built with the **`interactive-web-studio`** skill — now the one default
for everything user-facing. Its own guidance governs how it applies here: fintech sits low on
the intensity dial ("avoid anything that reads as unstable"), and its invention playbook says
conservative briefs dial invention to micro-scale, one tasteful signature interaction rather
than a game world. So the surface gets **one** mechanic, and the mechanic is the data:

> **The time rail.** A draggable horizontal spine — today at the left seam, 60 days to the
> right. Bills sit on it as weighted markers. Pulling the rail forward scrubs time, and the
> account balances above it deplete as each bill lands, so the owner watches the money go
> before it goes. It answers the question actually under "when are my bills due": will I be
> short before payday.
>
> Three supporting moments, each carrying information rather than decoration: hovering a bill
> threads it to the account it is paid from and dims that row by the amount; scrubbing past a
> card's closing date seals its ring and ignites its due marker, showing the statement cycle as
> cause and effect; a duplicate charge appears as two notches where the rhythm says one, so the
> anomaly is visible before it is read. Today's seam pulses slowly. Pending charges shimmer,
> because they are genuinely provisional — the motion encodes a property of the data.
>
> The dominant emotion is **control**, never wonder. Under `prefers-reduced-motion` the rail
> degrades to a static table with a date field: scrubbing is a reward layer, and every number
> is reachable without it.

Five panes inside the folder:

1. **Due** — the next 60 days of plan occurrences and card dates as one sorted table:
   what, from which account, how much, when, paid or not, autopay or not.
2. **Bills** — the plan ledger. The form lives here: add, edit, pause, delete. Rows show
   `origin` so a detected bill is visibly different from a typed one.
3. **Accounts & cards** — one row per account. Credit rows show due date, statement closing
   date, minimum payment, statement balance, limit and utilisation, each tagged with where
   the number came from.
4. **Alerts** — open findings, newest first, each with its evidence and three buttons:
   *that's fine* (dismiss), *looks wrong* (acknowledge and keep), *I've sorted it* (resolve).
5. **Spend** — daily and weekly card spending excluding bills, per §13.

## 4. Data model

One migration, `supabase/migrations/20260930000000_jarvis_finance.sql`. Additive and
idempotent. Owner-only RLS on every table and `user_id uuid not null references auth.users`,
modelled directly on `20260919120000_jarvis_memory.sql` — multi-user from day one so opening
this to real users later is not a rewrite.

Nothing here goes in `localStorage` or the `app_state` sync table. Bank tokens and
transaction history are not client-side data.

### `finance_connections`

| Column | Notes |
|---|---|
| `id`, `user_id`, `created_at`, `updated_at` | |
| `provider` | `'plaid' \| 'gocardless' \| 'manual'` |
| `institution_id`, `institution_name` | As the provider reports them |
| `access_token_enc` | AES-256-GCM, key from `FINANCE_ENC_KEY`. Never leaves the node runtime; no route returns it in any form |
| `item_id` | Plaid Item id / GoCardless requisition id |
| `sync_cursor` | Plaid `/transactions/sync` cursor |
| `status` | `'active' \| 'needs_reauth' \| 'error' \| 'revoked'` |
| `status_detail` | The provider's error, kept for display |
| `consent_expires_at` | The EU 90-day clock. Null for Plaid |
| `last_synced_at`, `sync_count_today`, `sync_count_day` | Enforces the GoCardless per-day ceiling |

### `finance_accounts`

Normalized across providers. `provider_account_id` unique per connection.

Common: `name`, `official_name`, `mask`, `type` (`'depository' | 'credit'`), `subtype`,
`currency`, `balance_current`, `balance_available`, `balances_as_of`.

Credit-only: `credit_limit`, `apr_purchase`, `last_statement_balance`,
`statement_last_closed`, `statement_next_closing`, `next_due_date`, `minimum_payment`,
`is_overdue`, `cycle_days`.

`count_in_spend boolean` — whether this account's charges count toward the daily and weekly
spend figures (§13). Default `true` for `type='credit'`, `false` for `type='depository'`, which
gives "card spending" its literal meaning out of the box and takes one click to widen if the
owner's day-to-day actually runs on a debit card.

Provenance, which exists so the UI can never lie:

- `dates_source` — `'bank' | 'typed' | 'inferred'`
- `dates_verified_at` — when a human or the bank last confirmed them
- `statement_next_closing_estimated` — boolean

### `finance_bills` — the plan

`name`, `payee`, `merchant_matchers text[]`, `amount_expected numeric`,
`amount_tolerance numeric` (absolute, default 1.00) and `amount_tolerance_pct numeric`
(default 5), `currency`, `account_id` (nullable), `autopay boolean`, `category`,
`origin` (`'typed' | 'detected'`), `notes`, `paused boolean`.

Cadence, stored as parts rather than a cron string so the UI can round-trip it:

- `cadence` — `'monthly' | 'weekly' | 'fortnightly' | 'quarterly' | 'annual' | 'one_off'`
- `day_of_month smallint` — 1–31, where 31 means "last day" for short months
- `weekday smallint` — 0–6, for weekly and fortnightly
- `month_of_year smallint` — for annual
- `first_due date`, `end_date date` (nullable)
- `grace_days smallint` default 3 — how late a payment may be before `missed-bill` fires
- `reminders int[]` — minutes before, reusing the calendar's existing vocabulary and the
  `REMINDER_CHOICES` labels from `src/lib/recall/calendar/types.ts`

### `finance_txns` — the actuals

`provider_txn_id` (unique per account), `account_id`, `date date`, `authorized_date date`,
`amount numeric`, `currency`, `merchant_raw`, `merchant_norm`, `category`, `pending boolean`,
`pending_txn_id text`, `removed_at timestamptz`, `raw jsonb`.

`removed_at` is a soft delete, set when a `TRANSACTIONS_REMOVED` webhook names the row.
Hard-deleting would lose the fact that a charge was once seen, which matters when the owner
is looking at an alert that cited it.

### `finance_alerts` — stored, deliberately

Updates in this repo are derived and never stored. Alerts are the exception, and the reason
is specific: an alert carries a human decision ("I checked, that's fine") that must outlive
the next reconciliation run. Without storage, every dismissed alert would come straight back.

`kind`, `fingerprint text` (stable identity — same finding, same fingerprint, so re-running
reconciliation updates instead of duplicating), `state`
(`'open' | 'acknowledged' | 'dismissed' | 'resolved'`), `severity` (`'info' | 'warn' | 'urgent'`),
`title`, `why text` (the evidence sentence), `amount numeric`, `currency`,
`bill_id`, `account_id`, `txn_ids text[]`, `noticed_at`, `decided_at`, `note text`.

Unique index on `(user_id, fingerprint)`.

### `finance_settings`

One row per user, holding everything §6 and §9 reference so no rule reads a hardcoded
constant:

| Column | Default | Used by |
|---|---|---|
| `lead_days int[]` | `{7,3,1}` | `card-due-soon`, the cron digest |
| `duplicate_min_amount numeric` | `1.00` | `duplicate-charge` |
| `duplicate_window_days smallint` | `3` | `duplicate-charge` |
| `multi_charge_payees text[]` | `{}` | The allowlist of payees where several same-amount charges in a day are normal — groceries, fuel, transit. Seeded empty and edited from the Alerts pane via a "charges here are often repeated" button on a dismissed alert, so the list grows from real decisions rather than guesswork |
| `email_kinds text[]` | `{duplicate-charge,missed-bill,card-due-soon}` | Which kinds email versus in-app only |
| `quiet_hours_start/​end smallint` | `22` / `7` | Suppresses in-app pop-ups; never delays an `urgent` email |
| `alert_email text` | null | Overrides `FINANCE_ALERT_EMAIL` |
| `week_starts_on smallint` | `1` (Monday) | The weekly spend window in §13 |
| `currency_display text` | null | Formatting only, and null means "show each account in its own currency". Amounts are stored and compared in their own currency and never converted — a US card and a UK account coexist without an FX rate anywhere in the reconciliation. Note that `money()` in `updates.ts` is dollar-only and must not be reused here; Finance needs its own `Intl.NumberFormat` formatter taking the row's currency |

**Note the PostgREST trap already paid for in this repo:** an upsert cannot use a *partial*
unique index (error 42P10 — it killed the Jarvis memory sync). `finance_alerts_fingerprint_idx`
must therefore be a plain unique index with no `where` clause.

## 5. Provider layer

`src/lib/finance/providers/`, one file per provider behind one interface.

```ts
export interface ProviderCapabilities {
  /** Can this provider tell us a card's due date and statement closing date? */
  cardStatements: boolean;
  sync: "webhook" | "poll";
  /** Days a consent lasts before re-authentication. Null = no fixed expiry. */
  consentDays: number | null;
  /** Hard ceiling on syncs per account per day. Null = no meaningful ceiling. */
  maxCallsPerDay: number | null;
  regions: string[];
}

export interface BankProvider {
  id: "plaid" | "gocardless" | "manual";
  label: string;
  capabilities: ProviderCapabilities;
  /** Null when the provider's keys are absent, with a reason to show the owner. */
  configured(): { ok: boolean; reason: string };
  startLink(opts: StartLinkOpts): Promise<LinkHandoff>;
  completeLink(payload: unknown): Promise<ConnectionSeed>;
  fetchAccounts(conn: Connection): Promise<ProviderAccount[]>;
  fetchTransactions(conn: Connection): Promise<TxnPage>;
  /** Only implemented where capabilities.cardStatements is true. */
  fetchCardTerms?(conn: Connection): Promise<ProviderCardTerms[]>;
}
```

### `plaid.ts` — Phase 1

- Link token → public token → `/item/public_token/exchange`.
- Transactions via `/transactions/sync` with a stored cursor. The cursor advances **only
  after** the page has been durably written, so a crash re-fetches rather than skips.
- Card terms via `/liabilities/get`, which returns exactly the fields this feature needs:
  `next_payment_due_date`, `last_statement_issue_date`, `last_statement_balance`,
  `minimum_payment_amount`, `is_overdue`, `last_payment_amount`, `last_payment_date`, APRs.
- Webhook at `src/app/api/finance/webhook/plaid/route.ts`. **The signature is verified
  before the body is trusted.** An unverified webhook endpoint lets anyone who finds the URL
  write into the owner's ledger — and the ledger is what the duplicate-charge alerts are
  computed from.
- Handles `SYNC_UPDATES_AVAILABLE`, `TRANSACTIONS_REMOVED`, `ITEM_LOGIN_REQUIRED`
  (→ `status='needs_reauth'`), `DEFAULT_UPDATE`.
- Capabilities: `{ cardStatements: true, sync: "webhook", consentDays: null, maxCallsPerDay: null, regions: ["US", "CA"] }`.
- Liabilities coverage is US-first with limited Canadian coverage, so `cardStatements` is a
  per-account truth, not just a per-provider one: an account that returns no liabilities
  record falls back to `dates_source='typed'` and says so.

### `gocardless.ts` — Phase 2

- Requisition flow: end-user agreement → requisition → bank redirect → accounts.
- `capabilities = { cardStatements: false, sync: "poll", consentDays: 90, maxCallsPerDay: 4, regions: ["GB", "EEA"] }`.
- Two constraints that drive real code, not just comments: access lasts **90 days** before
  re-authentication, and a bank may cap requests at **4 per account per day**. So syncs are
  scheduled and counted (`sync_count_today` / `sync_count_day`), never fired on page load,
  and a 429 backs off against the reset header rather than retrying.
- A re-consent banner appears 14 days before `consent_expires_at` and the connection flips to
  `needs_reauth` on expiry rather than silently going stale.

### `manual.ts` — Phase 2

CSV and OFX import into `finance_txns` with `provider='manual'`. Covers banks neither
provider reaches, and makes the whole reconciliation path exercisable with no keys at all.

### Capabilities are shown, never hidden

Where `cardStatements` is false, the card panel says so in the owner's terms — "your bank's
API doesn't publish statement dates, so these are the ones you typed, last confirmed
12 Sep" — and offers the inference described in §7. A missing capability degrades visibly.
It never renders a guess as a fact.

## 6. The reconciliation engine

`src/lib/finance/reconcile.ts`. Pure functions over plain data, no I/O, no React. Four
stages, in this order.

### Stage 1 — `fold(txns): Txn[]`

**This must run before anything else, and it is the single most important line of defence
against a false duplicate alert.**

Plaid does not mutate a pending charge into a posted one. It *removes* the pending
transaction, emits `TRANSACTIONS_REMOVED`, and adds a **new** posted transaction carrying
`pending_transaction_id` pointing at the one it replaced. A detector that does not know this
reads every ordinary card purchase as being charged twice. This is a well-documented failure
in other people's finance apps, not a hypothetical.

`fold` therefore:

1. drops rows with `removed_at` set;
2. builds the set of all non-null `pending_txn_id` values and drops any row whose
   `provider_txn_id` is in it;
3. leaves everything else untouched.

A pending row whose posted twin has not arrived yet survives, because it is real and the
owner should see it.

### Stage 2 — `occurrences(bill, window): Occurrence[]`

Expands a bill's cadence into concrete due dates inside a window.

Dates are plain `"YYYY-MM-DD"` strings throughout, matching the decision already documented
in `src/lib/recall/calendar/types.ts`: an ISO instant silently shifts the day for anyone west
of UTC, and this repo has paid for that bug twice (std-safe, then the calendar). Month-end is
explicit: `day_of_month = 31` resolves to the last day of a short month, and the 29th–31st in
February behaves the same way.

### Stage 3 — `match(occurrences, txns): Matched[]`

Greedy, best-first. A transaction matches an occurrence when all hold:

- `merchant_norm` matches one of the bill's `merchant_matchers` (normalized: lowercased,
  punctuation and trailing store/reference numbers stripped);
- the amount is inside `max(amount_tolerance, amount_expected * amount_tolerance_pct / 100)`;
- the date is inside `[due - 5 days, due + grace_days]`.

A transaction may match at most one occurrence. Leftovers on both sides are what Stage 4
reads.

### Stage 4 — `findings(matched, ctx): Finding[]`

| Kind | Rule | Severity |
|---|---|---|
| `duplicate-charge` | Two or more folded txns on the same account with equal amounts and the same `merchant_norm` within `duplicate_window_days`, where `merchant_norm` is not in `multi_charge_payees`, and the amount is ≥ `duplicate_min_amount` | `urgent` |
| `missed-bill` | An occurrence whose `due + grace_days` is past, with no match, and the bill is not paused | `warn` |
| `amount-changed` | A matched txn outside tolerance. Up = `warn`, down = `info` | `warn` / `info` |
| `unplanned-recurring` | Three or more folded txns from one `merchant_norm`, equal within 5%, evenly spaced within ±4 days of a consistent gap, no bill row matching | `info` |
| `card-due-soon` | A credit account's `next_due_date` inside the lead time, with no payment seen since the last statement closed | `urgent` if ≤ 2 days or `is_overdue`, else `warn` |
| `card-statement-closing` | A credit account's closing date inside the lead time | `info` |

Every finding carries a `fingerprint` (kind + account + the sorted txn ids, or kind + bill +
occurrence date) and a `why` sentence naming its evidence: *"£9.99 to Spotify on 12 Sep and
again on 13 Sep, both on Monzo ••4421"*. No finding ever reads "anomaly detected".

`persistFindings` then upserts on `fingerprint`: a new finding opens an alert, a finding the
owner already dismissed stays dismissed, and a finding that has stopped being true resolves
itself.

## 7. Credit-card dates

The owner's requirement is that a connected card needs no typing. What is actually available:

- **Payment due date** — published by Plaid as `next_payment_due_date`. Fetched, stored,
  `dates_source='bank'`. No typing. This is the whole promise, delivered, in the US.
- **Statement closing date (last)** — published as `last_statement_issue_date`. Also exact.
- **Statement closing date (next)** — published by nobody, by anyone. Derived as
  `statement_last_closed + cycle_days`, where `cycle_days` is the median gap across observed
  statement issue dates. Stored with `statement_next_closing_estimated = true` and labelled
  **estimated** in the UI until two consecutive cycles agree, at which point the flag clears.
- **Outside Plaid's liabilities coverage** — typed once in the form. The app then watches for
  a statement-shaped pattern and offers a one-click confirmation: *"your statement looks like
  it closes around the 4th — set it?"*. Accepting sets `dates_source='inferred'` and
  `dates_verified_at`. It is never set silently.

## 8. Calendar and reminders

Bills are **not** written into `recall-calendar` as events. That store is the one with
reminders and it is deliberately the single home for "anything added here"; copying bills in
would create a second copy of the same truth to keep in step, which is exactly the
double-calendar mistake Jarvis already fixed once.

Instead:

- `src/lib/finance/calendarLayer.ts` turns plan occurrences and card dates into read-only
  `CalEvent`-shaped rows with `app: "finance"`.
- The Calendar tab merges that layer, draws it distinctly, and makes it non-editable there —
  clicking a bill row jumps to the Finance folder.
- Reminders reuse the existing per-bill `reminders: number[]` offsets. The in-app engine
  (`useReminders`, `ReminderBanner`) fires them on whichever tab is open, unchanged.
- `.ics` export of the next 12 months of occurrences, reusing the existing export, so the
  owner's phone calendar rings without any Jarvis tab being open.

## 9. Alert delivery

The existing reminder engine is honest that it only fires while a tab is open. A missed
credit-card due date costs real money, so this feature does not rely on that alone.

- **`src/app/api/finance/cron/route.ts`** — sync (where the provider's ceiling allows),
  reconcile, persist findings, then email a digest. Registered in `vercel.ts` crons, daily,
  plus a second daily run for providers that poll.
- **Email** via Resend (`RESEND_API_KEY`, `FINANCE_ALERT_EMAIL`). Sent **only** when
  something is due inside the lead time or an alert is open. There is never a "nothing to
  report" email.
- **In-app** — a `finance` source added to `src/lib/jarvis/updates.ts` via
  `financeUpdates(alerts, dueOccurrences, now)`, reading live rows exactly like every other
  collector, so that file's derived-never-stored rule is untouched. New entries in
  `UpdateSource`, `UPDATE_SOURCES`, `UPDATE_LABEL`, `UPDATE_ABOUT`, `UPDATE_COLOR` (a green,
  distinct from the six existing hues) and `UPDATE_TAB`. The existing `spend` source is AI
  cost and is left alone; the names must not be conflated.
- **Settings** live in `finance_settings` (§4), so every threshold in §6 reads from a row the
  owner can change rather than from a constant in the code.

## 10. Security

- Behind the existing `appGate` / `src/middleware.ts` gate; the `jarvis` slug is already gated
  and already in `UNPREVIEWABLE`.
- **Read-only scopes only.** No payment initiation, no transfers, ever. This app tells the
  owner a bill is due; it cannot pay it. That line is in the design, not a setting.
- `access_token_enc` is AES-256-GCM at rest, decrypted only inside the node runtime. No API
  route returns a token, a token prefix, or anything derived from one.
- Plaid webhook signatures verified before the body is read.
- RLS is owner-only on every table. No world-readable path, not even aggregates — same
  reasoning as `jarvis_memories`.
- The Jarvis agent may *read* finance context to answer "what's due this week". Any action it
  proposes goes through the existing `ConfirmCard` first, like every other Jarvis action.
- With `PLAID_CLIENT_ID` / `PLAID_SECRET` absent the Connect panel says the keys are missing
  and the rest of the app works on the plan ledger alone. A missing key degrades visibly and
  never 500s.

### Env keys this adds

```
FINANCE_ENC_KEY        # 32 bytes, base64 — token encryption at rest
PLAID_CLIENT_ID
PLAID_SECRET
PLAID_ENV              # sandbox | production
PLAID_WEBHOOK_URL
RESEND_API_KEY
FINANCE_ALERT_EMAIL
FINANCE_MCP_TOKEN      # bearer token the local MCP server presents (§14)
GOCARDLESS_SECRET_ID   # Phase 2
GOCARDLESS_SECRET_KEY  # Phase 2
```

Plaid Sandbox is free indefinitely, and new US/Canada teams get a Trial plan with real
production data free up to 10 connected items — enough for the owner and family at no cost.

## 11. Testing

`*.test.ts` next to the code, run with `npx vitest run <path>`.

**`reconcile.test.ts`** — the file that matters most:

- `fold` collapses a pending/posted pair into one row, and the pair never produces a
  `duplicate-charge`;
- a pending row with no posted twin survives;
- two genuine same-merchant same-amount charges 1 day apart **do** alert;
- the same two charges at a grocery payee on the allowlist do **not**;
- two charges of equal amount at different merchants do not alert;
- `occurrences` across a month-end (31st in February), across a DST boundary, and for
  fortnightly, quarterly and annual cadences;
- amount tolerance at the exact boundary, absolute versus percentage, whichever is larger;
- `missed-bill` fires only after `grace_days`, and never for a paused bill;
- `unplanned-recurring` needs three evenly-spaced charges and ignores two;
- fingerprints are stable across runs and a dismissed alert does not reopen.

**`providers/plaid.test.ts`** — against recorded fixture payloads (Plaid sandbox responses
committed as JSON), no network: cursor advance only after a durable write, `TRANSACTIONS_REMOVED`
sets `removed_at`, a liabilities response with a missing credit record falls back to
`dates_source='typed'`, a bad webhook signature is rejected.

**`calendarLayer.test.ts`** — occurrences become read-only `CalEvent`s with correct local
dates, and the layer never writes to `recall-calendar`.

**`spend.test.ts`** — the exclusions are the whole feature, so they get the tests:

- a transaction matched to a bill is excluded;
- a credit-card payment from a current account is excluded by category **and**, with the
  category stripped, by pair detection — a card cleared mid-window must not double the figure;
- a transfer between the owner's own accounts is excluded in both directions;
- two genuinely separate equal charges to different payees on the same day are **not** read as
  a transfer pair;
- a refund reduces the window total and is reported in `refunds`;
- a depository account with `count_in_spend` false contributes nothing;
- the week window honours `week_starts_on`, and the previous-week comparison is elapsed-matched
  (a Tuesday compares against the previous week to Tuesday, never to its full total);
- the daily series uses local days, so a late-evening charge does not land on tomorrow.

**Failure states, photographed.** Per the owner's standing rule that a state nobody captured
is a state nobody reviewed, the implementation drives and screenshots: no keys set, Plaid
sandbox connected with zero transactions, a connection in `needs_reauth`, consent 10 days from
expiry, an open duplicate-charge alert with its evidence, a card whose dates are typed rather
than fetched, the cron email body, the Spend pane with no transactions yet, and the Dashboard
spend panel with no bank connected.

## 12. Ship order

**Phase 1 — the whole promise, US.**
Migration and RLS. Folder `role: "finance"` and the five-pane surface with the time rail
(`interactive-web-studio`). Bill
form and plan ledger. Plaid link, `/transactions/sync`, `/liabilities/get`, signature-verified
webhook. `fold` → `occurrences` → `match` → `findings`. Alerts pane. Calendar layer and
reminders. `finance` Updates source. Cron route and Resend digest. Settings. Spend engine,
Spend pane and the Dashboard spend panel (§13, `dataviz`). MCP server (§14) last, since it is
thin once the read routes exist.

**Phase 2 — everywhere else.**
GoCardless requisition flow with the 90-day re-consent banner and the ≤4-calls-per-day
scheduler. CSV/OFX import. Statement-date inference for cards whose bank publishes nothing.
Detected-bill suggestions from 24 months of history.

**Explicitly not in either phase:** budgeting, categories-as-reporting, net worth,
investments, bill paying, shared household views.

## 13. Daily and weekly spend

Card spending, excluding bills. The point is the number the owner actually has discretion
over: not "you spent £2,140 this month" when £1,900 of it was rent and the electricity.

### Why this is nearly free

"Excluding bills" is not a new rule. §6 Stage 3 already produces the set of transactions
matched to a plan occurrence; discretionary spend is the leftovers. The spend view is a read
over machinery Phase 1 builds anyway, which is the strongest argument for the two-ledger shape.

### Definition — `src/lib/finance/spend.ts`, pure

```ts
spend(txns, matched, accounts, settings, window): SpendReport
```

Starting from `fold(txns)` so no pending/posted pair is ever counted twice, a transaction
counts toward spend only if **all** hold:

1. its account has `count_in_spend`;
2. its id is not in `matched` — it did not pay a declared bill;
3. it is not a **transfer or a card payment**;
4. it is a debit, or a credit that is a refund (see below).

**Rule 3 is the one that decides whether these numbers are worth looking at.** Paying £400 off
a credit card from a current account is not spending £400 — the original purchases were already
counted. Counted naively it double-counts, and on a month where a card is cleared it roughly
doubles the figure. Two defences, both needed:

- **Category**, where the provider gives one: Plaid's `personal_finance_category.detailed` of
  `LOAN_PAYMENTS_CREDIT_CARD_PAYMENT`, or a `primary` of `TRANSFER_IN` / `TRANSFER_OUT`.
- **Pair detection**, because categories are missing or wrong often enough to matter: a debit
  from one of the owner's accounts and a credit to another, equal amounts, within 3 days, with
  no other candidate — both excluded, as an internal transfer. This also catches moving money
  between the owner's own current and savings accounts.

**Refunds net off rather than being dropped.** A £60 return makes the week's spend £60 lower,
because that is what happened. A refund landing in a later week than the purchase will make
that week look unusually low; the report carries a `refunds` figure so the UI can say so rather
than leaving a confusing dip unexplained.

### The two windows

- **Today** — total, charge count, and the share still `pending`.
- **This week** — from `week_starts_on`, with the previous week **at the same point in the
  week** for comparison. Comparing a Tuesday lunchtime against a complete previous week makes
  every week look cheap until Sunday; the comparison is elapsed-matched or it is noise.

Also in the report: a seven-day daily series, top merchants in the window, and the count of
excluded transfers so the exclusion is auditable rather than invisible.

**Pending amounts are provisional and the UI says so.** A fuel hold or a restaurant
pre-authorisation posts at a different amount later, so today's figure moves. It is labelled
as including pending charges, not presented as settled.

### Where it appears

Two places, deliberately:

- **A fifth pane, "Spend", in the Finance folder** — the full view: both windows, the daily
  series, top merchants, the transfer-exclusion audit, and a per-account `count_in_spend`
  toggle.
- **A compact panel on the Jarvis Dashboard tab** — today and this week with their comparisons,
  as another `card` in that tab's existing grid (`DashboardTab.tsx`), so the figure is on the
  surface the owner already opens. Clicking it opens the Spend pane.

Chart work uses the **`dataviz`** skill, per the standing rule that charts get it; the
surrounding surface stays **`interactive-web-studio`**, and the spend series is the same
rail mirrored backwards: spend behind the seam, obligations ahead of it, one grammar.

## 14. MCP server over the finance data

The surviving half of the ChatGPT idea (§15): the owner's own ledger, answerable from any
MCP-aware assistant.

`tools/finance-mcp/` — a local stdio MCP server, following this repo's convention that helpers
which are not the website live in `tools/`. It does **not** hold Supabase credentials or talk
to the database. It calls the app's own read-only routes with a bearer token, reusing the
token-auth bridge pattern already established by `tools/jarvis-bridge` and the Game Creator
builder routes (`FINANCE_MCP_TOKEN`).

Tools exposed, all read-only:

| Tool | Returns |
|---|---|
| `finance_due` | Plan occurrences and card dates in the next N days |
| `finance_cards` | Per card: due date, closing date, minimum, balance, and `dates_source` |
| `finance_spend` | The §13 report for a window |
| `finance_alerts` | Open alerts with their `why` evidence |
| `finance_search_txns` | Transactions by merchant, amount range or date range |

**There are no write tools, and that is a design line rather than an omission.** The app itself
cannot pay a bill (§10); an MCP server over it must not be able to edit the plan, dismiss an
alert or change a threshold either, because anything that reaches these tools reaches them
through a model's context, and a model's context is not an authenticated human. Jarvis's own
in-app actions stay behind `ConfirmCard`.

Every response is data, never instruction: merchant names and notes come from statements the
owner did not write, and an assistant reading them must treat them as values.

## 15. Rejected: connecting through ChatGPT

Asked during design, and worth recording because the answer is not obvious.

ChatGPT does connect to banks — OpenAI announced a Plaid partnership on 15 May 2026, giving
Pro (later Plus) subscribers a "Finances" tab covering 12,000+ US institutions, read-only,
with no ability to initiate transfers or payments. So the capability is real.

It cannot be this app's data source, for one structural reason: **OpenAI exposes no developer
API for a user's connected Finances accounts.** That connection lives inside the user's
ChatGPT session. Everything this feature does needs the data server-side — the cron that
emails before a due date, the reconciliation that folds pending charges and finds duplicates,
the calendar layer — and none of it can read out of someone else's chat session.

What the discovery does confirm: ChatGPT's bank rail *is* Plaid, the same provider chosen in
§5. It is another Plaid client, like Venmo or Robinhood, not a way around Plaid.

MCP does not avoid the API keys either. Plaid's two official MCP servers serve integration
diagnostics and sandbox/docs for building integrations, not live user transactions. Community
servers (`elcukro/bank-mcp`, `yuechen/plaid-mcp`) do serve real balances and transactions, but
require your own Plaid keys — the same account, over a different transport.

**The adjacent idea that survives, and was accepted:** once the Plaid layer exists, exposing
this app's finance data as an MCP server is cheap and lets any MCP-aware assistant answer
"what's due this week?" against the owner's own ledger, while Jarvis keeps owning the calendar,
alerts and email. Specified in §14, Phase 1.

For Phase 2's UK/EU provider, `bank-mcp` demonstrates **Enable Banking** and **Tink** as
working alternatives to GoCardless. Compare all three before building that adapter rather than
assuming GoCardless.
