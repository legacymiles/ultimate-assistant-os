// GET/POST /api/search — general web search. The endpoint every app calls.
//
//   GET  /api/search?q=hello&limit=5
//   POST /api/search  { "query": "hello", "extract": 3, "app": "cookbook" }
//
// Auth: `Authorization: Bearer jsk_…` for an agent, or the owner's session for
// a hub page. Documented in docs/search-api.md.
import { handleSearch } from "@/lib/search/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handleSearch(request, "web");
}

export async function POST(request: Request) {
  return handleSearch(request, "web");
}
