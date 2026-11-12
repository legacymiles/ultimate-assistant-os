import { fail, guardRateIp, hashEmail } from "@/lib/buildflip-2/api";
import { keys, serviceStore } from "@/lib/buildflip-2/db/store";
import { ownerUserId } from "@/lib/buildflip-2/db/owner";
import { withLogging } from "@/lib/buildflip-2/log";
import { leadInput, readJson } from "@/lib/buildflip-2/validate";

export const runtime = "nodejs";

/**
 * POST /api/leads — "get updates" capture from the landing page.
 * Keyed by a hash of the address, so signing up twice never creates a second
 * row (D5), and the raw address is only ever a value, never a key.
 */
export const POST = withLogging("lead", async (req: Request) => {
  const limited = await guardRateIp(req, "lead");
  if (limited) return limited;

  const parsed = await readJson(req, leadInput);
  if (!parsed.ok) return fail(400, parsed.error);

  const owner = await ownerUserId();
  if (!owner) {
    // Nothing to store it in — be honest rather than pretending it worked.
    return fail(
      503,
      "The mailing list isn't connected yet. Nothing was saved, so do try again later.",
    );
  }

  const hash = await hashEmail(parsed.data.email);
  const store = serviceStore(owner);
  const existing = await store.get<{ email: string; createdAt: string }>(
    keys.lead(hash),
  );
  await store.set(keys.lead(hash), {
    email: parsed.data.email,
    source: parsed.data.source ?? "landing",
    createdAt: existing?.createdAt ?? new Date().toISOString(),
  });

  return Response.json({
    ok: true,
    alreadyOn: Boolean(existing),
    message: existing
      ? "You're already on the list — we'll email you when there's something worth reading."
      : "You're on the list. We'll only email when there's something worth reading.",
  });
});
