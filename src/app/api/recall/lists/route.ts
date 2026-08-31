import { withCaller } from "@/lib/recall/lists/api";
import { getBoard } from "@/lib/recall/lists/store";

// GET /api/recall/lists → the whole board from the caller's point of view.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return withCaller(async (caller) => ({ board: await getBoard(caller) }));
}
