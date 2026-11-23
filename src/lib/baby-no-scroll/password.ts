// ---------------------------------------------------------------------------
// The parent's password — the second way out of a locked screen.
//
// The drag lock asks a gesture question a baby cannot answer. The password asks
// a knowledge question a baby cannot answer, and it also stops the four-year-old
// who has watched a parent do the drag twice. It is digits only, on purpose:
// typed on a keypad the app draws itself, so the phone's own keyboard — with its
// emoji, its voice button and its route back to every other app — never opens
// on a locked screen.
//
// Only a salted hash is kept, never the digits. The threat is a sibling, not a
// cryptographer, so SHA-256 is plenty; it simply means the password never sits
// in storage (or in the synced copy of the settings) as itself.
// ---------------------------------------------------------------------------

export const PIN_MIN = 4;
export const PIN_MAX = 8;

/** Wrong guesses allowed before the keypad makes you wait. */
export const FREE_TRIES = 3;

/** Why a candidate password cannot be used, or null when it can. */
export function pinProblem(pin: string): string | null {
  if (!/^\d*$/.test(pin)) return "Numbers only — the locked screen shows a number pad, not a keyboard.";
  if (pin.length < PIN_MIN) return `At least ${PIN_MIN} numbers.`;
  if (pin.length > PIN_MAX) return `At most ${PIN_MAX} numbers.`;
  // The passwords a small hand finds by mashing one key or sliding along a row.
  if (/^(\d)\1+$/.test(pin)) return "Not one number repeated — that is the first thing a mashing hand types.";
  if ("0123456789".includes(pin) || "9876543210".includes(pin)) {
    return "Not a straight run — a finger sliding along the pad types that.";
  }
  return null;
}

export function newSalt(): string {
  const bytes = new Uint8Array(12);
  const c = globalThis.crypto;
  if (c?.getRandomValues) c.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return toHex(bytes);
}

/**
 * The stored form of a password. SHA-256 where SubtleCrypto exists (every
 * https page and localhost); a plain FNV mix where it does not (a phone testing
 * the app over a LAN address), tagged so the two can never be confused.
 */
export async function hashPin(pin: string, salt: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  const input = `${salt}:${pin}`;
  if (subtle) {
    const digest = await subtle.digest("SHA-256", new TextEncoder().encode(input));
    return `s256:${toHex(new Uint8Array(digest))}`;
  }
  return `fnv:${fnv(input)}`;
}

/** Does this entry match the stored password? */
export async function checkPin(pin: string, salt: string, stored: string): Promise<boolean> {
  if (!stored || !salt) return false;
  if (stored.startsWith("fnv:")) return `fnv:${fnv(`${salt}:${pin}`)}` === stored;
  return (await hashPin(pin, salt)) === stored;
}

/**
 * How long the keypad refuses input after `fails` wrong guesses in a row:
 * nothing for the first three (a parent fumbling in the dark), then 30 s,
 * doubling, capped at five minutes. A baby slapping the pad hits the wait long
 * before it could ever hit the password.
 */
export function lockoutMs(fails: number): number {
  if (fails < FREE_TRIES) return 0;
  return Math.min(5 * 60_000, 30_000 * Math.pow(2, fails - FREE_TRIES));
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function fnv(s: string): string {
  // Two 32-bit FNV-1a lanes with different offsets, concatenated, run over the
  // input a few times. Not cryptography — a fallback that is not the digits.
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ 0x5bd1e995;
  for (let round = 0; round < 64; round++) {
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      a = Math.imul(a ^ c, 0x01000193) >>> 0;
      b = Math.imul(b ^ (c + round), 0x01000193) >>> 0;
    }
  }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}
