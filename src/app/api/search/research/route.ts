// GET/POST /api/search/research — the deep query.
//
// More results, several pages of them, and Tavily's advanced depth when Tavily
// is the one serving. Pair it with `extract` and an agent gets the pages' text
// rather than snippets:
//
//   POST /api/search/research  { "query": "…", "extract": 5, "app": "jarvis-agent" }
import { handleSearch } from "@/lib/search/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handleSearch(request, "research");
}

export async function POST(request: Request) {
  return handleSearch(request, "research");
}
