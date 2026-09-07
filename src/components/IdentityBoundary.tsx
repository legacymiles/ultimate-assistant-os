"use client";

// ---------------------------------------------------------------------------
// Runs once per page load, at the root of the tree, to reconcile whatever this
// browser has stored with whoever is signed in now.
//
// It is worth being clear about what this does and does not do. Account
// isolation comes from the KEYS, not from here: every app blob lives under
// `u:<uid>:<key>`, so one account's reads cannot reach another's bytes whether
// or not this component ever mounts. What this adds is cleanup — the unscoped
// blobs written before the change, and any other account's leftovers on a
// shared machine. Data on disk that nothing can read is a smaller problem than
// data being served to the wrong person, so an effect is soon enough.
// ---------------------------------------------------------------------------

import { useEffect } from "react";
import { settleIdentity } from "@/lib/sync/identity";

export function IdentityBoundary() {
  useEffect(() => {
    settleIdentity();
  }, []);
  return null;
}
