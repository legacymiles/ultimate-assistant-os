// ---------------------------------------------------------------------------
// Which account this browser is currently signed in as, and the local-storage
// namespace that follows from it.
//
// The problem this solves: localStorage belongs to the ORIGIN, not to the
// person. Signing out clears the Supabase session cookie and nothing else, so
// on a shared browser the next person to sign in inherited the previous one's
// notes, scenarios, rankings and clips — and worse, appState's reconcile() saw
// a local blob with no matching remote row and uploaded it into the new
// account, moving the data across for good.
//
// The fix is to make the account part of the key. Every app blob now lives at
// `u:<uid>:<key>`, so one user's reads simply cannot land on another's bytes.
// Isolation therefore does not depend on a purge running, on the network, or
// on sign-out completing — an unreachable key is unreachable even if the data
// is still on disk. The purge below is hygiene on top of that, not the
// mechanism.
//
// Why a cookie and not supabase.auth.getUser(): the stores read localStorage
// synchronously during render, and getUser() is async. Waiting on it would
// either block first paint or let one frame render the previous account's
// data before the answer arrived. Middleware already resolves the user on
// every request, so it writes the id to a readable cookie and this module
// reads it with no await. The id is not a secret — the client can already ask
// Supabase for it — and the session token stays httpOnly.
//
// The REMOTE key is deliberately left unscoped: app_state rows are already
// keyed by (user_id, key), so scoping the key there too would orphan every
// row written before this change.
// ---------------------------------------------------------------------------

/** Written by middleware on every authenticated request. Not httpOnly. */
export const UID_COOKIE = "hub_uid";

/** Remembers who this browser last settled as, so a change can be noticed. */
const LAST_UID_KEY = "hub:last-uid";

/** Prefix marking a key as belonging to one account. */
const SCOPE_PREFIX = "u:";

/**
 * Every localStorage key an app in this hub owns.
 *
 * Only used to clear data left behind by the pre-namespacing versions — the
 * live read/write path derives its keys from scopedKey() and never consults
 * this list, so a key missing here is a stale file on disk, not a leak.
 */
export const LEGACY_APP_KEYS = [
  "moc:scenarios:v1",
  "dances:v1",
  "friends-night-out:v1",
  "recall:v1",
  "recall:vault:v1",
  "recall:migrated:websites:v1",
  "recall:lists:filter",
  "projects-timeline:v1",
  "projects-timeline:v1:seeded-slugs",
  "seedance-studio:v1",
  "skills-library:v1",
  "voice-studio.history",
  "voice-studio.voices",
  "ai-rankings:v2",
  "cookbook_genie_local_db_v1",
  "cookbook_genie_local_auth_v1",
];

/** Suffix appState uses to record when this device last wrote a key. */
const STAMP_SUFFIX = ":__synced_at";

/**
 * The signed-in account's id, read synchronously from the cookie middleware
 * sets. Null in local demo mode — no Supabase means no accounts to separate,
 * and keys stay unscoped so an offline install keeps its data.
 */
export function currentUid(): string | null {
  if (typeof document === "undefined") return null;
  for (const part of document.cookie.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name !== UID_COOKIE) continue;
    const value = decodeURIComponent(rest.join("="));
    return value || null;
  }
  return null;
}

/**
 * The key this account's copy of `key` lives under. Unscoped when nobody is
 * signed in, so demo mode behaves exactly as it did before.
 */
export function scopedKey(key: string): string {
  const uid = currentUid();
  return uid ? `${SCOPE_PREFIX}${uid}:${key}` : key;
}

/** Every localStorage key, or [] where storage is blocked. */
function allKeys(): string[] {
  try {
    return Object.keys(window.localStorage);
  } catch {
    return [];
  }
}

function remove(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* storage blocked — nothing to remove from */
  }
}

/**
 * Drop the unscoped blobs written before this module existed.
 *
 * Safe to do without asking: every store pushes to app_state on write, so a
 * signed-in user's data is already on the server and reconcile() pulls it back
 * under the scoped key on next load. Demo mode never reaches here, because a
 * user id is required to call it.
 */
function purgeLegacy(): void {
  for (const key of LEGACY_APP_KEYS) {
    remove(key);
    remove(key + STAMP_SUFFIX);
  }
}

/** Drop everything belonging to `uid`, stamps included. */
export function purgeUser(uid: string): void {
  if (typeof window === "undefined") return;
  const prefix = `${SCOPE_PREFIX}${uid}:`;
  for (const key of allKeys()) {
    if (key.startsWith(prefix)) remove(key);
  }
  void deleteBlobDb(uid);
}

/** Drop every account's blobs except `keep`'s. */
function purgeOtherUsers(keep: string): void {
  const mine = `${SCOPE_PREFIX}${keep}:`;
  for (const key of allKeys()) {
    if (key.startsWith(SCOPE_PREFIX) && !key.startsWith(mine)) remove(key);
  }
}

// --- IndexedDB -------------------------------------------------------------
// Recall keeps uploaded file bytes in IndexedDB, which sign-out did not touch
// either. The database NAME carries the account for the same reason keys do.

const BLOB_DB_BASE = "recall-files";

/** The blob database for the signed-in account. */
export function blobDbName(): string {
  const uid = currentUid();
  return uid ? `${BLOB_DB_BASE}-${uid}` : BLOB_DB_BASE;
}

/**
 * Delete every account's blob database except `keep`'s.
 *
 * indexedDB.databases() is the only way to find databases nobody remembers —
 * a third account that used this browser months ago leaves no trace in
 * localStorage once its keys are gone. It is unsupported in Firefox, where the
 * caller's fallback (deleting the account it does remember) still covers the
 * case that actually happens: two people taking turns on one machine.
 */
async function purgeOtherBlobDbs(keep: string): Promise<void> {
  if (typeof indexedDB === "undefined" || typeof indexedDB.databases !== "function") return;
  let names: (string | undefined)[];
  try {
    names = (await indexedDB.databases()).map((d) => d.name);
  } catch {
    return;
  }
  const mine = `${BLOB_DB_BASE}-${keep}`;
  for (const name of names) {
    if (!name || name === mine) continue;
    // The bare, unscoped name is the pre-namespacing database. It is somebody's
    // only copy of their uploads and belongs to the migration, not here.
    if (!name.startsWith(`${BLOB_DB_BASE}-`)) continue;
    await deleteBlobDbNamed(name);
  }
}

function deleteBlobDbNamed(name: string): Promise<void> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") {
      resolve();
      return;
    }
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.deleteDatabase(name);
    } catch {
      resolve();
      return;
    }
    // Resolve on every outcome: a blocked delete (another tab holds the db
    // open) must not leave the caller hanging, and the data is unreachable
    // under the new account's name regardless.
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}

function deleteBlobDb(uid: string): Promise<void> {
  return deleteBlobDbNamed(`${BLOB_DB_BASE}-${uid}`);
}

// --- settling --------------------------------------------------------------

/**
 * Reconcile this browser's stored data with whoever is signed in now.
 *
 * Called once, as early as the app shell can manage. Returns the current
 * account id so a caller can key on it.
 */
export function settleIdentity(): string | null {
  if (typeof window === "undefined") return null;
  const uid = currentUid();

  let last: string | null = null;
  try {
    last = window.localStorage.getItem(LAST_UID_KEY);
  } catch {
    /* storage blocked — treat as a first run */
  }

  if (uid === last) return uid;

  if (uid) {
    // A different account (or the first since this change shipped): clear the
    // unscoped leftovers and any other account's blobs, then claim the browser.
    purgeLegacy();
    purgeOtherUsers(uid);
    // Uploaded file bytes live in IndexedDB, which the key namespace makes
    // unreachable but does not remove. Drop the account we know handed the
    // browser over, then sweep any older one the browser can still enumerate.
    //
    // The unscoped `recall-files` is pointedly NOT among them. File blobs are
    // the one thing here with no server copy, so the pre-namespacing database
    // is migrated into the current account by lib/recall/files.ts rather than
    // deleted; removing it here would destroy the owner's uploads and race
    // that migration.
    if (last) void deleteBlobDb(last);
    void purgeOtherBlobDbs(uid);
    try {
      window.localStorage.setItem(LAST_UID_KEY, uid);
    } catch {
      /* storage blocked — the scoped keys still keep accounts apart */
    }
  } else if (last) {
    // Signed out. The scoped keys are already unreachable; clearing them means
    // the bytes do not sit on a shared machine either.
    purgeUser(last);
    remove(LAST_UID_KEY);
  }

  return uid;
}

/**
 * Clear this account's local copy and forget it, for the sign-out button.
 * Everything removed here is already in app_state and comes back on next
 * sign-in; what does not come back is a readable copy on a shared machine.
 */
export function forgetCurrentUser(): void {
  if (typeof window === "undefined") return;
  const uid = currentUid();
  if (uid) purgeUser(uid);
  purgeLegacy();
  remove(LAST_UID_KEY);
}
