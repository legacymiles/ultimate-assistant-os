// ---------------------------------------------------------------------------
// Personal Finance — Plaid, assembled.
//
// Thin on purpose: everything here is orchestration, and everything that could
// be a pure function lives in ./map (payload shapes) or ./webhook (signature
// checking), where it is tested offline against fixtures.
//
// One rule this file enforces and the caller must honour: `fetchTransactions`
// returns ONE page plus the new cursor, and the caller advances the stored
// cursor only after that page has been durably written. Advancing first means a
// crash loses transactions silently, and a ledger with a hole in it produces
// false "missed bill" alerts and a wrong spend figure.
// ---------------------------------------------------------------------------

import { configured, plaidFetch } from "./client";
import { mapAccounts, mapLiabilities, mapSync } from "./map";
import type { PlaidAccount, PlaidSyncResponse } from "./map";
import type {
  BankProvider,
  Connection,
  ProviderAccount,
  ProviderCapabilities,
  ProviderCardTerms,
  TxnPage,
} from "../types";

/**
 * What Plaid can actually do, stated honestly.
 *
 * `cardStatements: true` is a ceiling, not a promise about every account:
 * liabilities coverage is US-first with limited Canada, so an individual card
 * may still come back without terms. That case is handled in the mapper, which
 * leaves `datesSource` as "typed" rather than inventing a date.
 */
export const PLAID_CAPABILITIES: ProviderCapabilities = {
  cardStatements: true,
  sync: "webhook",
  consentDays: null,
  maxCallsPerDay: null,
  regions: ["US", "CA"],
};

/** Create a Link token — the handoff that opens Plaid's own bank picker. */
export async function createLinkToken(userId: string, webhookUrl?: string): Promise<string> {
  const res = await plaidFetch("/link/token/create", {
    user: { client_user_id: userId },
    client_name: "Jarvis — Personal Finance",
    // Read-only aggregation. There is no payment-initiation product here, and
    // that is a design line rather than an oversight: this app can tell you a
    // bill is due, it cannot pay it.
    products: ["transactions"],
    optional_products: ["liabilities"],
    country_codes: ["US", "CA", "GB"],
    language: "en",
    ...(webhookUrl ? { webhook: webhookUrl } : {}),
  });
  return String(res.link_token ?? "");
}

/** Swap the public token Link hands back for the long-lived access token. */
export async function exchangePublicToken(
  publicToken: string,
): Promise<{ accessToken: string; itemId: string }> {
  const res = await plaidFetch("/item/public_token/exchange", { public_token: publicToken });
  return {
    accessToken: String(res.access_token ?? ""),
    itemId: String(res.item_id ?? ""),
  };
}

export async function fetchAccounts(conn: Connection): Promise<ProviderAccount[]> {
  const res = await plaidFetch("/accounts/get", { access_token: conn.accessToken });
  return mapAccounts((res.accounts ?? []) as PlaidAccount[]);
}

export async function fetchTransactions(conn: Connection): Promise<TxnPage> {
  const res = await plaidFetch("/transactions/sync", {
    access_token: conn.accessToken,
    ...(conn.cursor ? { cursor: conn.cursor } : {}),
    count: 500,
  });
  return mapSync(res as PlaidSyncResponse);
}

/**
 * Card terms, where this item has them.
 *
 * An item outside liabilities coverage answers with PRODUCT_NOT_READY or
 * PRODUCTS_NOT_SUPPORTED. That is an ordinary outcome for a UK card, not a
 * failure, so it returns an empty list and the cards keep their typed dates.
 */
export async function fetchCardTerms(conn: Connection): Promise<ProviderCardTerms[]> {
  try {
    const res = await plaidFetch("/liabilities/get", { access_token: conn.accessToken });
    return mapLiabilities(res as { liabilities?: { credit?: never } });
  } catch (e) {
    const code = (e as { code?: string }).code ?? "";
    if (code === "PRODUCTS_NOT_SUPPORTED" || code === "PRODUCT_NOT_READY") return [];
    throw e;
  }
}

export const plaidProvider: BankProvider = {
  id: "plaid",
  label: "Plaid",
  capabilities: PLAID_CAPABILITIES,
  configured: () => configured(),
  fetchAccounts,
  fetchTransactions,
  fetchCardTerms,
};
