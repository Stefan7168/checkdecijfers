// WP129+130 (ADR 032): the attach seam — decides whether a turn OWES a web
// attempt, runs it fail-soft, and returns a NEW envelope with BOTH structural
// fields explicitly set (A1: every new row serializes sourceSelection AND
// webSection). Billing is NEVER imported here: web/app/actions.ts injects a
// reserve() closure, so this module has zero billing/db dependency and stays
// hermetically testable with a fake client.
//
// The web section text is NEVER concatenated into response.text (pinned by
// test) — the separation IS the honesty model (ADR 032).
import type { ComposedResponse } from '../answer/respond/types.ts';
import type { WebSearchClient } from './client.ts';
import type { SourceSelection, WebSection } from './types.ts';
import { WEBSEARCH_SKIP_REASONS } from './types.ts';

/** Injected closure (web/app/actions.ts): reserves the +10 web debit right
 * before the search (debit-before-spend). true = debited; false = insufficient
 * balance at reserve time (a race the upfront affordability check tolerates). */
export interface WebBilling {
  reserve(): Promise<boolean>;
}

export interface AttachWebAugmentationOptions {
  selection?: SourceSelection;
  client?: WebSearchClient;
  billing?: WebBilling;
}

/** A turn OWES a web attempt when the "Internet" chip was on AND the outcome is
 * not a clarification (searching an ambiguous question is spend without value)
 * AND — for refusals — the reason is not in the ⟨W3⟩ skip-list. */
function owesWebAttempt(response: ComposedResponse, selection: SourceSelection | undefined): boolean {
  if (selection?.web !== true) return false;
  if (response.kind === 'clarification') return false;
  if (
    response.kind === 'refusal' &&
    (WEBSEARCH_SKIP_REASONS as readonly string[]).includes(response.reason)
  ) {
    return false;
  }
  return true;
}

async function runWebSection(
  question: string,
  client: WebSearchClient | undefined,
  billing: WebBilling | undefined,
): Promise<WebSection> {
  // ⟨W6⟩ owed but not wired ⇒ record the skip as not_configured, never a
  // silent null — "owed but none recorded" is impossible BY CONSTRUCTION, so
  // reconstruct check (d) is exact rather than heuristic.
  if (client === undefined || billing === undefined) {
    return { status: 'failed', code: 'not_configured' };
  }
  // Debit-before-spend: reserve FIRST; a false reserve never calls search.
  const reserved = await billing.reserve();
  if (!reserved) {
    return { status: 'failed', code: 'insufficient_balance' };
  }
  return client.search(question);
}

export async function attachWebAugmentation(
  response: ComposedResponse,
  opts: AttachWebAugmentationOptions,
): Promise<ComposedResponse> {
  let webSection: WebSection | null = null;
  if (owesWebAttempt(response, opts.selection)) {
    try {
      webSection = await runWebSection(response.question, opts.client, opts.billing);
    } catch {
      // Fail-soft everywhere on the web path — the CBS response is NEVER
      // blocked (ADR 032). A throw from an injected closure becomes api_error.
      webSection = { status: 'failed', code: 'api_error' };
    }
  }
  // BOTH keys ALWAYS set (A1). The web text is never merged into response.text.
  return { ...response, sourceSelection: opts.selection ?? null, webSection };
}
