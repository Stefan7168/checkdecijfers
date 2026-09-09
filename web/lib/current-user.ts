// Shared auth check (WP13, ADR 020) — used by every Server Action that needs
// the current user's id, not only web/app/actions.ts. getClaims() validates
// the JWT rather than trusting an unverified session cookie; proxy.ts's own
// redirect is an optimistic check, not the authorization boundary, so this
// runs again inside every Server Action that needs identity.
import { createClient } from './supabase-server.ts';

export async function currentUserId(): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const sub = data?.claims?.sub;
  return typeof sub === 'string' ? sub : null;
}

/** Same JWT-verified claims read as `currentUserId`, but the `email` claim —
 * used by `lookupBrand` (WP218 phase 3) to derive a brand-lookup domain from
 * the account's own signup email when no explicit website was given. Null
 * for an unauthenticated caller or a claims set with no (or a non-string)
 * `email`, same degrade-to-null contract as `currentUserId`. */
export async function currentUserEmail(): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const email = data?.claims?.email;
  return typeof email === 'string' ? email : null;
}
