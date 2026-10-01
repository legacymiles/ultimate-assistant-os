import "server-only";

// ---------------------------------------------------------------------------
// Personal Finance — reading and writing the two ledgers.
//
// Every query runs on the signed-in user's client, so RLS filters by owner and
// no `user_id = ...` here is load-bearing for security. They are still written
// where the column is required on insert.
//
// Two things this file is careful about:
//
// 1. ALERTS ARE UPSERTED ON FINGERPRINT, and an open alert whose finding has
//    stopped being true is RESOLVED rather than deleted. A dismissal therefore
//    sticks across re-syncs, and the history of what Jarvis noticed survives.
//
// 2. THE ACCESS TOKEN IS DECRYPTED ONLY HERE, only to hand to the provider, and
//    is never selected into anything that leaves the node runtime.
// ---------------------------------------------------------------------------

import { decryptToken, encryptToken } from "../crypto";
import { toAccount, toBill, toSettings, toTxn } from "./rows";
import type { FinanceContext } from "./context";
import type { Account, Bill, Finding, FinanceSettings, Txn } from "../types";
import type { Connection, ProviderAccount, ProviderTxn } from "../providers/types";
import type { SyncStore } from "../providers/sync";

export interface Ledger {
  accounts: Account[];
  bills: Bill[];
  txns: Txn[];
  settings: FinanceSettings;
}

/** Everything the engines need, in one pass. */
export async function loadLedger(ctx: FinanceContext, sinceDay?: string): Promise<Ledger> {
  const [accounts, bills, txns, settings] = await Promise.all([
    ctx.db.from("finance_accounts").select("*").order("type"),
    ctx.db.from("finance_bills").select("*").order("first_due"),
    (sinceDay
      ? ctx.db.from("finance_txns").select("*").gte("date", sinceDay)
      : ctx.db.from("finance_txns").select("*")
    ).order("date", { ascending: false }),
    ctx.db.from("finance_settings").select("*").maybeSingle(),
  ]);

  return {
    accounts: (accounts.data ?? []).map(toAccount),
    bills: (bills.data ?? []).map(toBill),
    txns: (txns.data ?? []).map(toTxn),
    settings: toSettings(settings.data),
  };
}

export interface StoredAlert {
  id: string;
  kind: string;
  fingerprint: string;
  state: string;
  severity: string;
  title: string;
  why: string;
  amount: number | null;
  currency: string;
  noticedAt: string;
  note: string;
}

export async function loadAlerts(ctx: FinanceContext): Promise<StoredAlert[]> {
  const { data } = await ctx.db
    .from("finance_alerts")
    .select("*")
    .order("noticed_at", { ascending: false });
  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: String(r.id),
    kind: String(r.kind),
    fingerprint: String(r.fingerprint),
    state: String(r.state),
    severity: String(r.severity),
    title: String(r.title),
    why: String(r.why ?? ""),
    amount: r.amount === null || r.amount === undefined ? null : Number(r.amount),
    currency: String(r.currency ?? "USD"),
    noticedAt: String(r.noticed_at),
    note: String(r.note ?? ""),
  }));
}

/**
 * Write this run's findings.
 *
 * Upsert on (user_id, fingerprint) — which is why that index is deliberately
 * NOT partial; PostgREST cannot upsert onto a partial unique index (42P10, the
 * error that broke the Jarvis memory sync).
 *
 * A row the owner has already decided about keeps its state: re-running
 * reconciliation must not reopen something they dismissed. And an open alert
 * whose finding has stopped being true is marked resolved, not deleted, so
 * "Jarvis spotted this and it went away" remains legible.
 */
export async function persistFindings(
  ctx: FinanceContext,
  findings: Finding[],
): Promise<{ opened: number; resolved: number }> {
  const existing = await loadAlerts(ctx);
  const decided = new Map(existing.map((a) => [a.fingerprint, a.state]));
  const live = new Set(findings.map((f) => f.fingerprint));

  const rows = findings.map((f) => ({
    user_id: ctx.userId,
    kind: f.kind,
    fingerprint: f.fingerprint,
    // Keep whatever the owner decided; only a brand-new finding opens.
    state: decided.get(f.fingerprint) ?? "open",
    severity: f.severity,
    title: f.title,
    why: f.why,
    amount: f.amount,
    currency: f.currency,
    bill_id: f.billId,
    account_id: f.accountId,
    txn_ids: f.txnIds,
    updated_at: new Date().toISOString(),
  }));

  if (rows.length > 0) {
    await ctx.db.from("finance_alerts").upsert(rows, { onConflict: "user_id,fingerprint" });
  }

  // Anything open that this run no longer finds has gone away.
  const stale = existing
    .filter((a) => (a.state === "open" || a.state === "acknowledged") && !live.has(a.fingerprint))
    .map((a) => a.id);
  if (stale.length > 0) {
    await ctx.db
      .from("finance_alerts")
      .update({ state: "resolved", decided_at: new Date().toISOString() })
      .in("id", stale);
  }

  const opened = findings.filter((f) => !decided.has(f.fingerprint)).length;
  return { opened, resolved: stale.length };
}

export async function setAlertState(
  ctx: FinanceContext,
  id: string,
  state: "open" | "acknowledged" | "dismissed" | "resolved",
  note?: string,
): Promise<void> {
  await ctx.db
    .from("finance_alerts")
    .update({ state, decided_at: new Date().toISOString(), ...(note ? { note } : {}) })
    .eq("id", id);
}

// ----- connections ---------------------------------------------------------

export interface StoredConnection {
  id: string;
  provider: string;
  institutionName: string;
  status: string;
  statusDetail: string;
  itemId: string | null;
  lastSyncedAt: string | null;
  consentExpiresAt: string | null;
}

/** Never selects the token column. Nothing a route returns can contain one. */
export async function listConnections(ctx: FinanceContext): Promise<StoredConnection[]> {
  const { data } = await ctx.db
    .from("finance_connections")
    .select("id, provider, institution_name, status, status_detail, item_id, last_synced_at, consent_expires_at")
    .order("created_at");
  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: String(r.id),
    provider: String(r.provider),
    institutionName: String(r.institution_name ?? ""),
    status: String(r.status),
    statusDetail: String(r.status_detail ?? ""),
    itemId: r.item_id ? String(r.item_id) : null,
    lastSyncedAt: r.last_synced_at ? String(r.last_synced_at) : null,
    consentExpiresAt: r.consent_expires_at ? String(r.consent_expires_at) : null,
  }));
}

export async function saveConnection(
  ctx: FinanceContext,
  input: { provider: string; accessToken: string; itemId: string; institutionName?: string },
): Promise<string> {
  const { data, error } = await ctx.db
    .from("finance_connections")
    .insert({
      user_id: ctx.userId,
      provider: input.provider,
      item_id: input.itemId,
      institution_name: input.institutionName ?? "",
      access_token_enc: encryptToken(input.accessToken),
      status: "active",
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return String(data.id);
}

/** The decrypted connection, for handing straight to a provider. */
export async function openConnection(
  ctx: FinanceContext,
  connectionId: string,
): Promise<Connection | null> {
  const { data } = await ctx.db
    .from("finance_connections")
    .select("id, access_token_enc, sync_cursor")
    .eq("id", connectionId)
    .maybeSingle();
  if (!data?.access_token_enc) return null;
  return {
    id: String(data.id),
    accessToken: decryptToken(String(data.access_token_enc)),
    cursor: data.sync_cursor ? String(data.sync_cursor) : null,
  };
}

/** Find a connection by the provider's item id, for webhook routing. */
export async function connectionByItemId(
  ctx: FinanceContext,
  itemId: string,
): Promise<string | null> {
  const { data } = await ctx.db
    .from("finance_connections")
    .select("id")
    .eq("item_id", itemId)
    .maybeSingle();
  return data?.id ? String(data.id) : null;
}

// ----- the SyncStore the provider loop drives ------------------------------

export function supabaseSyncStore(ctx: FinanceContext): SyncStore {
  return {
    async upsertAccounts(connectionId: string, accounts: ProviderAccount[]) {
      const rows = accounts.map((a) => ({
        user_id: ctx.userId,
        connection_id: connectionId,
        provider_account_id: a.providerAccountId,
        name: a.name,
        mask: a.mask,
        type: a.type,
        currency: a.currency,
        balance_current: a.balanceCurrent,
        count_in_spend: a.countInSpend,
        credit_limit: a.creditLimit ?? null,
        last_statement_balance: a.lastStatementBalance ?? null,
        statement_last_closed: a.statementLastClosed ?? null,
        statement_next_closing: a.statementNextClosing ?? null,
        statement_next_closing_estimated: a.statementNextClosingEstimated ?? false,
        next_due_date: a.nextDueDate ?? null,
        minimum_payment: a.minimumPayment ?? null,
        is_overdue: a.isOverdue ?? false,
        cycle_days: a.cycleDays ?? null,
        dates_source: a.datesSource ?? "typed",
        dates_verified_at: a.datesSource === "bank" ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      }));
      if (rows.length > 0) {
        const { error } = await ctx.db
          .from("finance_accounts")
          .upsert(rows, { onConflict: "connection_id,provider_account_id" });
        if (error) throw new Error(`accounts: ${error.message}`);
      }
      const { data } = await ctx.db
        .from("finance_accounts")
        .select("id, provider_account_id")
        .eq("connection_id", connectionId);
      return new Map(
        (data ?? []).map((r: Record<string, unknown>) => [
          String(r.provider_account_id),
          String(r.id),
        ]),
      );
    },

    async upsertTxns(_connectionId: string, txns: ProviderTxn[], accountIds: Map<string, string>) {
      const rows = txns
        .map((t) => {
          const accountId = accountIds.get(t.providerAccountId);
          // A transaction on an account we do not model (a loan, an investment)
          // has nowhere to go. Dropping it is correct; failing is not.
          if (!accountId) return null;
          return {
            user_id: ctx.userId,
            account_id: accountId,
            provider_txn_id: t.providerTxnId,
            date: t.date,
            amount: t.amount,
            currency: t.currency,
            merchant_raw: t.merchantRaw,
            merchant_norm: t.merchantNorm,
            category: t.category,
            pending: t.pending,
            pending_txn_id: t.pendingTxnId,
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null);
      if (rows.length === 0) return;
      const { error } = await ctx.db
        .from("finance_txns")
        .upsert(rows, { onConflict: "account_id,provider_txn_id" });
      if (error) throw new Error(`transactions: ${error.message}`);
    },

    async markRemoved(_connectionId: string, providerTxnIds: string[]) {
      if (providerTxnIds.length === 0) return;
      // Soft, always: an open alert may cite this row as its evidence.
      const { error } = await ctx.db
        .from("finance_txns")
        .update({ removed_at: new Date().toISOString() })
        .in("provider_txn_id", providerTxnIds);
      if (error) throw new Error(`removals: ${error.message}`);
    },

    async saveCursor(connectionId: string, cursor: string | null) {
      const { error } = await ctx.db
        .from("finance_connections")
        .update({ sync_cursor: cursor, last_synced_at: new Date().toISOString() })
        .eq("id", connectionId);
      if (error) throw new Error(`cursor: ${error.message}`);
    },

    async previousStatementClosed(providerAccountId: string) {
      const { data } = await ctx.db
        .from("finance_accounts")
        .select("statement_last_closed")
        .eq("provider_account_id", providerAccountId)
        .maybeSingle();
      return data?.statement_last_closed ? String(data.statement_last_closed) : null;
    },

    async setStatus(connectionId: string, status: string, detail: string) {
      await ctx.db
        .from("finance_connections")
        .update({ status, status_detail: detail, updated_at: new Date().toISOString() })
        .eq("id", connectionId);
    },
  };
}
