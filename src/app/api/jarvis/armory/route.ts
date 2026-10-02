import { NextResponse } from "next/server";
import { allKeyNames } from "@/lib/armory/catalog";

// ---------------------------------------------------------------------------
// Which keys are set.
//
// NEVER a value. The response is `Record<name, boolean>` and nothing else, and
// the names are read from the catalog rather than from `process.env` — walking
// the environment and returning what is found there is how a deploy's private
// keys end up in a browser, because the next person adds a secret and nobody
// remembers this route exists.
//
// A name on this list is already public: every one of them is written down in
// .env.example.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const keys: Record<string, boolean> = {};
  // Only names the catalog asks about. A key nobody declared is not reported,
  // set or otherwise.
  for (const name of allKeyNames()) {
    keys[name] = Boolean((process.env[name] ?? "").trim());
  }
  return NextResponse.json({ keys });
}
