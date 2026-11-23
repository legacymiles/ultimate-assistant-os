import { errorResponse, HttpError, requireUser } from "@/lib/dtf/server/access";
import { placeOrder, type CheckoutInput } from "@/lib/dtf/server/orders";
import { InvalidProject } from "@/lib/dtf/server/validate";
import { customerView } from "@/lib/dtf/server/orders";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Turn the bag into an order. Card checkout when Stripe is connected; otherwise an order the shop confirms payment for. */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    if (!user.email && !user.local) throw new HttpError(400, "Your account has no email address, so we couldn't send order updates.");
    const text = await req.text();
    if (text.length > 6_000_000) throw new HttpError(413, "That order is too large. Split it into two.");
    let input: CheckoutInput;
    try {
      input = JSON.parse(text);
    } catch {
      throw new HttpError(400, "That order couldn't be read.");
    }
    const origin = new URL(req.url).origin.replace(/^http:\/\/(?!localhost|127\.)/, "https://");
    const fwdHost = req.headers.get("x-forwarded-host");
    const base = fwdHost ? `${req.headers.get("x-forwarded-proto") ?? "https"}://${fwdHost}` : origin;
    try {
      const { order, checkoutUrl } = await placeOrder({ id: user.id, email: user.email }, input, base);
      return Response.json({ order: customerView(order), checkoutUrl });
    } catch (e) {
      if (e instanceof InvalidProject) throw new HttpError(400, e.message);
      throw e;
    }
  } catch (e) {
    return errorResponse(e);
  }
}
