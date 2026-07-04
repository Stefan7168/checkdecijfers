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
