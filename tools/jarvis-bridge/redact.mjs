// ---------------------------------------------------------------------------
// What must not leave this machine in a page read.
//
// The agent reads pages with the owner's real logins attached, and whatever it
// reads is sent to a model over the internet. A bank statement, an order
// confirmation and a benefits portal all put numbers on screen that have no
// business in a prompt, and the owner never explicitly hands them over — the
// agent simply looked at the page they were on.
//
// So the text is scrubbed HERE, at the bridge, before it is returned. Not in
// the page (a site can see that), and not in the browser tab that receives it
// (by then it has already crossed a process boundary for no reason).
//
// This is a filter, not a guarantee, and it is written to be honest about that:
// it catches the shapes that are recognisable out of context. A balance is
// just a number and cannot be caught this way. The capture path exists because
// of that limit — it moves a value from this process to the Record without a
// model ever being shown it.
// ---------------------------------------------------------------------------

/** A credit or debit card: 13–19 digits, in the usual groupings, Luhn-valid. */
function luhnOk(digits) {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let n = digits.charCodeAt(i) - 48;
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

const RULES = [
  {
    // Card numbers. Luhn-checked so a 16-digit order id is not mangled.
    name: "card",
    re: /\b\d(?:[ -]?\d){12,18}\b/g,
    keep: (m) => {
      const digits = m.replace(/\D/g, "");
      if (digits.length < 13 || digits.length > 19) return m;
      return luhnOk(digits) ? `[card ending ${digits.slice(-4)}]` : m;
    },
  },
  {
    // US SSN and the UK NI number, both unmistakable in shape.
    name: "national-id",
    re: /\b\d{3}-\d{2}-\d{4}\b|\b[A-CEGHJ-PR-TW-Z]{2}\s?\d{2}\s?\d{2}\s?\d{2}\s?[A-D]\b/g,
    keep: () => "[national id]",
  },
  {
    // IBAN.
    name: "iban",
    re: /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){3,7}(?:[ ]?[A-Z0-9]{1,3})?\b/g,
    keep: (m) => `[account ending ${m.replace(/\s/g, "").slice(-4)}]`,
  },
  {
    // A UK sort code with an account number beside it.
    name: "sort-account",
    re: /\b\d{2}-\d{2}-\d{2}\b(?:\s*\d{8}\b)?/g,
    keep: () => "[bank details]",
  },
  {
    // Anything that calls itself a secret and shows its value.
    name: "labelled-secret",
    re: /\b(password|passcode|pin|api[_ -]?key|secret|token|cvv|cvc|security code)\b\s*[:=]\s*\S+/gi,
    keep: (m) => `${m.split(/[:=]/)[0].trim()}: [hidden]`,
  },
  {
    // Long unbroken alphanumeric runs: keys, session tokens, bearer strings.
    name: "long-token",
    re: /\b[A-Za-z0-9_-]{32,}\b/g,
    keep: (m) => (/^\d+$/.test(m) ? m : `[${m.length}-character token]`),
  },
];

/**
 * Scrub a block of page text.
 *
 * Returns the text and what was removed, because a silent redaction is a lie
 * of a different kind: the model needs to know a value was there and was
 * withheld, or it will report the page as not containing one.
 */
export function redactText(text) {
  let out = String(text ?? "");
  const found = [];
  for (const rule of RULES) {
    out = out.replace(rule.re, (m) => {
      const replaced = rule.keep(m);
      if (replaced !== m && !found.includes(rule.name)) found.push(rule.name);
      return replaced;
    });
  }
  return { text: out, redacted: found };
}

/** Field names whose VALUE never travels, whatever it looks like. */
const SECRET_FIELD = /pass|pwd|secret|token|cvv|cvc|pin\b|ssn|social|account\s*number|card|iban|sort\s*code|security/i;

/** True when a control's value must never be reported, only its presence. */
export function fieldIsSecret({ name = "", type = "", label = "" } = {}) {
  if (type === "password") return true;
  return SECRET_FIELD.test(`${name} ${label}`);
}

/**
 * A value's shape, never its content.
 *
 * The last four characters are shown by default because that is how an owner
 * tells one account from another — but never for a secret, where a tail is the
 * giveaway rather than the label. "hunter2" masked as "•••ter2" hands over
 * most of a short password.
 */
export function mask(value, { tail = true } = {}) {
  const v = String(value ?? "");
  if (!v) return "";
  if (!tail) return "•".repeat(Math.min(10, Math.max(4, v.length)));
  if (v.length <= 4) return "•".repeat(v.length);
  return `${"•".repeat(Math.min(8, v.length - 4))}${v.slice(-4)}`;
}

/** A secret whose last characters must not be shown either. */
const NO_TAIL = /pass|pwd|secret|token|cvv|cvc|pin|security/i;

export function hideCompletely({ name = "", type = "", label = "" } = {}) {
  if (type === "password") return true;
  return NO_TAIL.test(`${name} ${label}`);
}

export const __test = { luhnOk };
