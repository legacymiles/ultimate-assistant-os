import { errorResponse, requireUser } from "@/lib/dtf/server/access";
import { customerView } from "@/lib/dtf/server/orders";
import { listOrders } from "@/lib/dtf/server/store";

export const dynamic = "force-dynamic";

/** The signed-in customer's orders. Never anyone else's, owner or not. */
export async function GET() {
  try {
    const user = await requireUser();
    const orders = await listOrders({ userId: user.id, limit: 100 });
    return Response.json({ orders: orders.map(customerView) });
  } catch (e) {
    return errorResponse(e);
  }
}
