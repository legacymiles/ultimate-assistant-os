import { OWNER_EMAIL } from "../flags";
import { supabaseService } from "../supabase/service";

let cached: string | null | undefined;

/**
 * The owner's user id, resolved from OWNER_EMAIL at runtime so nothing is
 * hardcoded and no setup step is handed to the user (O6). Cached per instance.
 *
 * Used for two things: the owner-only admin page, and a home for rows that
 * belong to nobody in particular (email leads, the error ring), since
 * `app_state.user_id` has a foreign key to `auth.users`.
 */
export async function ownerUserId(): Promise<string | null> {
  if (cached !== undefined) return cached;
  const sb = supabaseService();
  if (!sb) {
    cached = null;
    return null;
  }
  try {
    // The admin list is paginated; the owner is an early signup, so two pages
    // is plenty, and we stop as soon as we find them.
    for (let page = 1; page <= 4; page++) {
      const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 200 });
      if (error) break;
      const hit = data.users.find(
        (u) => (u.email ?? "").toLowerCase() === OWNER_EMAIL,
      );
      if (hit) {
        cached = hit.id;
        return cached;
      }
      if (data.users.length < 200) break;
    }
  } catch {
    /* fall through */
  }
  cached = null;
  return null;
}

export function isOwnerEmail(email: string | null | undefined): boolean {
  return Boolean(email && email.toLowerCase() === OWNER_EMAIL);
}
