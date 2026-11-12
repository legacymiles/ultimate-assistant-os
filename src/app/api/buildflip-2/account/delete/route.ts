import { fail, guardRate, requireUser } from "@/lib/buildflip-2/api";
import { userStore, NS } from "@/lib/buildflip-2/db/store";
import { withLogging, log } from "@/lib/buildflip-2/log";
import { supabaseService } from "@/lib/buildflip-2/supabase/service";
import { STORAGE_BUCKET } from "@/lib/buildflip-2/flags";
import { stripe } from "@/lib/buildflip-2/billing/stripe";
import { readJson } from "@/lib/buildflip-2/validate";
import { z } from "zod";

export const runtime = "nodejs";

/**
 * DELETE /api/account/delete — genuinely removes their data (D4).
 *
 * Deletes, in order: their reference photos from storage, every `bf:*` row they
 * own, their Stripe customer (which cancels any subscription), and finally the
 * auth user itself. Nothing is hidden-but-kept. Requires the user to type
 * DELETE, because this cannot be undone (S7).
 */
export const DELETE = withLogging("account_delete", async (req: Request) => {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const parsed = await readJson(
    req,
    z.object({ confirm: z.string().max(20) }),
  );
  if (!parsed.ok) return fail(400, parsed.error);
  if (parsed.data.confirm !== "DELETE") {
    return fail(400, "Type DELETE to confirm. This can't be undone.");
  }

  const limited = await guardRate(auth.ctx.user.id, "write");
  if (limited) return limited;

  const userId = auth.ctx.user.id;
  const removed = { photos: 0, rows: 0, stripe: false, authUser: false };
  const sb = supabaseService();

  /**
   * Delete the AUTH USER FIRST.
   *
   * If the rows are purged first and the auth deletion then fails, the caller
   * still holds a valid session against a live user with no account row — and
   * the next read creates a fresh one with plansGenerated: 0. "Delete my
   * account" would be a way to reset the free-plan allowance. Killing the
   * sign-in first makes a partial failure safe: at worst some rows are
   * orphaned, and nobody can reach them.
   */
  if (sb) {
    try {
      const { error } = await sb.auth.admin.deleteUser(userId);
      if (error) throw new Error(error.message);
      removed.authUser = true;
    } catch (err) {
      await log({
        level: "error",
        event: "delete_auth_failed",
        userId,
        message: (err as Error)?.message,
      });
      return fail(
        500,
        "We couldn't close your account just now, so nothing was deleted. Try again in a moment, or email us and we'll do it by hand.",
      );
    }
  }

  // 1. Reference photos.
  if (sb) {
    try {
      const { data } = await sb.storage.from(STORAGE_BUCKET).list(userId, { limit: 1000 });
      const paths = (data ?? []).map((f) => `${userId}/${f.name}`);
      if (paths.length) {
        await sb.storage.from(STORAGE_BUCKET).remove(paths);
        removed.photos = paths.length;
      }
    } catch (err) {
      await log({ level: "warn", event: "delete_photos_failed", userId, message: (err as Error)?.message });
    }
  }

  // 2. Every BuildFlip row.
  try {
    const store = await userStore(userId);
    if (store) removed.rows = await store.purge();
  } catch (err) {
    await log({ level: "error", event: "delete_rows_failed", userId, message: (err as Error)?.message });
    return fail(500, "We couldn't finish deleting your data. Nothing was half-deleted — try again, or email us and we'll do it by hand.");
  }

  // 3. Stripe customer (cancels any live subscription).
  const s = stripe();
  if (s && auth.ctx.account.stripeCustomerId) {
    try {
      await s.customers.del(auth.ctx.account.stripeCustomerId);
      removed.stripe = true;
    } catch (err) {
      await log({ level: "warn", event: "delete_stripe_failed", userId, message: (err as Error)?.message });
    }
  }

  // 4. The auth user.
  if (sb) {
    try {
      const { error } = await sb.auth.admin.deleteUser(userId);
      removed.authUser = !error;
    } catch (err) {
      await log({ level: "warn", event: "delete_auth_failed", userId, message: (err as Error)?.message });
    }
  }

  await log({ level: "info", event: "account_deleted", userId, meta: removed });
  return Response.json({ deleted: true, removed });
});
