// How the OpenNext adapter turns `next build` output into a Cloudflare Worker.
//
// Deliberately bare. The adapter's optional overrides are all about caching
// between viewers — an R2 incremental cache, a KV tag cache — and this site
// renders per-viewer behind a sign-in, so there is nothing shared to cache.
// Cross-device state lives in Supabase either way (src/lib/sync/appState.ts).
//
// If a genuinely public, static page is ever added, add the R2 incremental
// cache here and the matching binding in wrangler.jsonc:
//   https://opennext.js.org/cloudflare/caching
import { defineCloudflareConfig } from "@opennextjs/cloudflare";

export default defineCloudflareConfig();
