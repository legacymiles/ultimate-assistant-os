// GET/POST /api/search/news — news search.
//
// Same contract as /api/search, routed to the news category so results carry
// publication dates. `freshness` defaults to any here; pass `week` or `day` to
// narrow it.
import { handleSearch } from "@/lib/search/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handleSearch(request, "news");
}

export async function POST(request: Request) {
  return handleSearch(request, "news");
}
