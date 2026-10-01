// ---------------------------------------------------------------------------
// Personal Finance — the only file that knows a Plaid URL.
//
// Deliberately thin and dependency-free. Plaid's REST API is plain JSON POST
// with the client id and secret in the BODY (not a header, which is their
// convention and surprises people), so the `plaid` npm package buys nothing
// here but a dependency.
//
// `configured()` is what keeps the repo's no-keys rule: with no credentials the
// Connect panel says which variable is missing and the rest of the app carries
// on from the declared-bills ledger. Nothing here throws on a missing key.
// ---------------------------------------------------------------------------

const ENVS = {
  sandbox: "https://sandbox.plaid.com",
  production: "https://production.plaid.com",
} as const;

export type PlaidEnv = keyof typeof ENVS;

export interface PlaidConfig {
  clientId: string;
  secret: string;
  env: PlaidEnv;
  baseUrl: string;
}

export function plaidEnv(raw = process.env.PLAID_ENV): PlaidEnv {
  return raw === "production" ? "production" : "sandbox";
}

/** Null when Plaid is not set up, with a reason the owner can act on. */
export function plaidConfig(env = process.env): PlaidConfig | null {
  const clientId = env.PLAID_CLIENT_ID;
  const secret = env.PLAID_SECRET;
  if (!clientId || !secret) return null;
  const chosen = plaidEnv(env.PLAID_ENV);
  return { clientId, secret, env: chosen, baseUrl: ENVS[chosen] };
}

export function configured(env = process.env): { ok: boolean; reason: string } {
  if (!env.PLAID_CLIENT_ID) return { ok: false, reason: "PLAID_CLIENT_ID is not set." };
  if (!env.PLAID_SECRET) return { ok: false, reason: "PLAID_SECRET is not set." };
  if (!env.FINANCE_ENC_KEY) {
    // Refusing here is the point: without it the access token would have to be
    // stored in the clear.
    return { ok: false, reason: "FINANCE_ENC_KEY is not set, so a bank token cannot be stored." };
  }
  return { ok: true, reason: "" };
}

/** An error carrying the parts of a Plaid failure worth showing someone. */
export class PlaidError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
    readonly requestId: string | null,
  ) {
    super(message);
    this.name = "PlaidError";
  }
}

export async function plaidFetch(
  path: string,
  body: Record<string, unknown>,
  config = plaidConfig(),
): Promise<Record<string, unknown>> {
  if (!config) throw new PlaidError("Plaid is not configured.", "NOT_CONFIGURED", 0, null);

  const res = await fetch(`${config.baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...body, client_id: config.clientId, secret: config.secret }),
  });

  const text = await res.text();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    throw new PlaidError(`Plaid returned unreadable JSON from ${path}.`, "BAD_JSON", res.status, null);
  }

  if (!res.ok) {
    // display_message is Plaid's own owner-facing wording where it exists.
    const message =
      (typeof parsed.display_message === "string" && parsed.display_message) ||
      (typeof parsed.error_message === "string" && parsed.error_message) ||
      `Plaid refused ${path}.`;
    throw new PlaidError(
      message,
      typeof parsed.error_code === "string" ? parsed.error_code : "UNKNOWN",
      res.status,
      typeof parsed.request_id === "string" ? parsed.request_id : null,
    );
  }

  return parsed;
}
