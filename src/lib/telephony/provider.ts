import "server-only";

// ---------------------------------------------------------------------------
// The seam between Jarvis and a phone network.
//
// Same shape as src/lib/jarvis/server/connectors/types.ts, deliberately: an id,
// whether it is `available`, and a `reason` in words the owner can act on. The
// hub's rule is that a missing key degrades visibly and never 500s, and a
// telephony provider is the most expensive key in the building — it is the one
// that costs per minute — so it ships configured by nobody.
//
// Three adapters, none of which needs the others. Retell is what the walkthrough
// the owner watched uses; Vapi and Twilio are here because the shape is the same
// and the choice should not be a rewrite.
// ---------------------------------------------------------------------------

export type ProviderId = "retell" | "vapi" | "twilio";

export interface PlacedCall {
  /** The provider's id for this call, for matching the webhook up later. */
  id: string;
  status: "queued" | "ringing" | "answered" | "ended" | "failed";
  /** What the provider said, when it said anything useful. */
  detail?: string;
}

export interface CallRequest {
  /** E.164, e.g. +447700900123. */
  to: string;
  /** The one thing this call is about. */
  subject: string;
  /** What Jarvis should say and may do, built by script.ts. */
  brief: string;
  /** Echoed back on the webhook so a result can be matched to its trigger. */
  reference: string;
}

export interface Telephony {
  id: ProviderId;
  name: string;
  /** False when this provider has no key configured. */
  available: boolean;
  /** Why it is unavailable, in words the owner can act on. Empty when it is. */
  reason: string;
  /** The number calls come FROM, when the provider says. */
  from?: string;
  place(request: CallRequest): Promise<PlacedCall>;
}

/** A provider that is configured but cannot be used. Never throws on construction. */
function dormant(id: ProviderId, name: string, reason: string): Telephony {
  return {
    id,
    name,
    available: false,
    reason,
    async place() {
      // Reaching here means something called past the availability check. Say
      // what is missing rather than failing with a network error about a key
      // that was never set.
      throw new Error(reason);
    },
  };
}

// --- Retell ----------------------------------------------------------------

function retell(): Telephony {
  const key = process.env.RETELL_API_KEY ?? "";
  const agentId = process.env.RETELL_AGENT_ID ?? "";
  const from = process.env.RETELL_FROM_NUMBER ?? "";

  if (!key) return dormant("retell", "Retell AI", "RETELL_API_KEY is not set.");
  if (!agentId) return dormant("retell", "Retell AI", "RETELL_API_KEY is set but RETELL_AGENT_ID is not.");
  if (!from) return dormant("retell", "Retell AI", "RETELL_API_KEY is set but RETELL_FROM_NUMBER is not.");

  return {
    id: "retell",
    name: "Retell AI",
    available: true,
    reason: "",
    from,
    async place({ to, subject, brief, reference }) {
      const res = await fetch("https://api.retellai.com/v2/create-phone-call", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from_number: from,
          to_number: to,
          override_agent_id: agentId,
          // Retell substitutes these into the agent's own prompt, which is how
          // one standing agent can be briefed differently on every call.
          retell_llm_dynamic_variables: { subject, brief, reference },
          metadata: { reference, subject },
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { call_id?: string; message?: string };
      if (!res.ok) throw new Error(data.message ?? `Retell refused the call (${res.status}).`);
      return { id: data.call_id ?? reference, status: "queued" };
    },
  };
}

// --- Vapi ------------------------------------------------------------------

function vapi(): Telephony {
  const key = process.env.VAPI_API_KEY ?? "";
  const assistantId = process.env.VAPI_ASSISTANT_ID ?? "";
  const phoneNumberId = process.env.VAPI_PHONE_NUMBER_ID ?? "";

  if (!key) return dormant("vapi", "Vapi", "VAPI_API_KEY is not set.");
  if (!assistantId) return dormant("vapi", "Vapi", "VAPI_API_KEY is set but VAPI_ASSISTANT_ID is not.");
  if (!phoneNumberId) return dormant("vapi", "Vapi", "VAPI_API_KEY is set but VAPI_PHONE_NUMBER_ID is not.");

  return {
    id: "vapi",
    name: "Vapi",
    available: true,
    reason: "",
    async place({ to, subject, brief, reference }) {
      const res = await fetch("https://api.vapi.ai/call", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          phoneNumberId,
          customer: { number: to },
          assistantId,
          assistantOverrides: { variableValues: { subject, brief, reference } },
          metadata: { reference, subject },
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
      if (!res.ok) throw new Error(data.message ?? `Vapi refused the call (${res.status}).`);
      return { id: data.id ?? reference, status: "queued" };
    },
  };
}

// --- Twilio ----------------------------------------------------------------

function twilio(): Telephony {
  const sid = process.env.TWILIO_ACCOUNT_SID ?? "";
  const token = process.env.TWILIO_AUTH_TOKEN ?? "";
  const from = process.env.TWILIO_FROM_NUMBER ?? "";
  const voiceUrl = process.env.TWILIO_VOICE_URL ?? "";

  if (!sid || !token) return dormant("twilio", "Twilio", "TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN are not set.");
  if (!from) return dormant("twilio", "Twilio", "Twilio is configured but TWILIO_FROM_NUMBER is not set.");
  if (!voiceUrl) {
    return dormant(
      "twilio",
      "Twilio",
      // Worth saying plainly: Twilio alone will not hold a conversation, and
      // discovering that after buying a number is a bad afternoon.
      "Twilio is configured but TWILIO_VOICE_URL is not. Twilio dials and plays audio; it does not talk — point this at a voice agent, or use Retell or Vapi instead.",
    );
  }

  return {
    id: "twilio",
    name: "Twilio",
    available: true,
    reason: "",
    from,
    async place({ to, reference }) {
      const body = new URLSearchParams({
        To: to,
        From: from,
        Url: `${voiceUrl}${voiceUrl.includes("?") ? "&" : "?"}reference=${encodeURIComponent(reference)}`,
      });
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Calls.json`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
      });
      const data = (await res.json().catch(() => ({}))) as { sid?: string; message?: string };
      if (!res.ok) throw new Error(data.message ?? `Twilio refused the call (${res.status}).`);
      return { id: data.sid ?? reference, status: "queued" };
    },
  };
}

const BUILDERS: Record<ProviderId, () => Telephony> = { retell, vapi, twilio };

/** Every provider, each saying whether it is ready and why not. */
export function allProviders(): Telephony[] {
  return (Object.keys(BUILDERS) as ProviderId[]).map((id) => BUILDERS[id]());
}

/**
 * The provider to use.
 *
 * `JARVIS_CALL_PROVIDER` picks one explicitly; otherwise the first that is
 * actually ready wins. Returns a dormant Retell when none is — so callers always
 * get an object with a `reason` rather than a null to forget to check.
 */
export function telephony(): Telephony {
  const wanted = (process.env.JARVIS_CALL_PROVIDER ?? "").trim().toLowerCase() as ProviderId;
  const all = allProviders();
  if (wanted && BUILDERS[wanted]) return all.find((p) => p.id === wanted) ?? dormant(wanted, wanted, "Unknown provider.");
  return all.find((p) => p.available) ?? all[0];
}

/** The number Jarvis rings. Separate from the provider: it is the owner's, not theirs. */
export function ownerNumber(): string {
  return (process.env.JARVIS_CALL_TO_NUMBER ?? "").trim();
}

export interface TelephonyStatus {
  ready: boolean;
  reason: string;
  provider: ProviderId;
  providerName: string;
  from?: string;
  /** Masked — the last four only, so the panel can confirm it without putting a number on screen. */
  toHint: string;
  options: { id: ProviderId; name: string; available: boolean; reason: string }[];
}

export function telephonyStatus(): TelephonyStatus {
  const provider = telephony();
  const to = ownerNumber();
  const reason = !provider.available
    ? provider.reason
    : !to
      ? "No number to ring — set JARVIS_CALL_TO_NUMBER to your mobile, in +44… form."
      : "";

  return {
    ready: provider.available && Boolean(to),
    reason,
    provider: provider.id,
    providerName: provider.name,
    from: provider.from,
    toHint: to ? `••• ${to.slice(-4)}` : "",
    options: allProviders().map((p) => ({ id: p.id, name: p.name, available: p.available, reason: p.reason })),
  };
}
