// WP135 chat workspace (ADR 033 D3): deterministic replay of a thread's stored
// envelopes + conversation-context rebuild. ZERO LLM — every function here is
// existing deterministic code over the stored audit rows (⟨A3⟩ src-side layer).
//
// LAYERING (⟨A3⟩, mandatory): `web/backend -> ../src` means src code cannot
// import web/lib/*. So replay is split: THIS file produces STRUCTURAL replay
// PARTS (message texts, the #115 zero-loss answerView, chart/suggestions/
// webSection, provisional, creditsCharged, the raw envelope), and the full
// ChatMessage assembly (buildCitation / buildAnswerCsv / statCardData, the
// kind-reclassification) lives web-side over the raw envelope each part carries.
// This file writes NO new context logic and imports NO web module.
import type { Db } from '../db/types.ts';
import { REDACTED_QUESTION_TEXT } from '../answer/audit/retention.ts';
import { buildConversationContext } from '../answer/context/build.ts';
import type { ConversationContext } from '../answer/context/types.ts';
import type { AnswerResponse, ComposedResponse, RefusalResponse } from '../answer/respond/types.ts';
import type { ChartSpec } from '../chart/index.ts';
import type { WebSection } from '../websearch/types.ts';
import type { ThreadRow } from './index.ts';

/** The #115 zero-loss structural view of an answer — exactly the fields
 * compose.ts assembled `text` from (src/billing/history.ts's answerParts
 * precedent). The web side augments this with tableId/source from the envelope. */
export interface ReplayAnswerView {
  body: string;
  /** WP26 mechanism B (ADR 024): the defaulted-axis disclosure the user was
   * shown. Replayed from the STORED envelope, never re-decided — a reopened
   * thread must state the same assumption the answer originally carried. Null
   * on every pre-WP26 row and every non-defaulted answer. */
  assumptionLine: string | null;
  definitionLine: string | null;
  /** #39: the alternate-reading disclosure the user was shown. Replayed from
   * the STORED envelope, never re-decided. Null on every pre-#39 row and every
   * answer without registry-recorded alternates. */
  alternatesLine: string | null;
  markingLine: string | null;
  attributionLine: string;
  stalenessWarning: string | null;
}

/** Exactly one user-turn per row (⟨A4⟩): the reply text on a reply row, else
 * the question. */
export interface ReplayUserPart {
  role: 'user';
  text: string;
  auditId: number;
}

/** The assistant turn: `finalText` (R8: byte-equal to the stored final_text),
 * the zero-loss answerView (null ⇒ web renders the finalText blob), the
 * structural visual/suggestion/web fields, provisional, per-row cost, and the
 * raw envelope for the web-side assembly (⟨A3⟩). */
export interface ReplayAssistantPart {
  role: 'assistant';
  kind: ComposedResponse['kind'];
  auditId: number;
  finalText: string;
  answerView: ReplayAnswerView | null;
  chart: ChartSpec | null;
  suggestions: string[];
  webSection: WebSection | null;
  provisional: boolean;
  creditsCharged: number | null;
  /** The stored envelope, verbatim — the web side runs the SAME live-path
   * builders (citation/csv/card + kind-reclassification) over it. */
  response: ComposedResponse;
}

/** ⟨A7⟩ A redacted row replays as ONE placeholder (the chat-side equivalent of
 * the dashboard's isDeleted posture), never a user+assistant sentinel pair. The
 * web side owns the "Deze vraag is verwijderd." copy. */
export interface ReplayRedactedPart {
  role: 'redacted';
  auditId: number;
}

export type ReplayPart = ReplayUserPart | ReplayAssistantPart | ReplayRedactedPart;

/** #115 zero-loss rule: a structured answer view only when BOTH `body` and
 * `attributionLine` are present (the R4 attribution sentence may never be
 * dropped); otherwise null and the web side falls back to the finalText blob.
 * Reads a stored envelope defensively — an old/minimal row may lack the fields. */
function extractAnswerView(response: ComposedResponse): ReplayAnswerView | null {
  if (response.kind !== 'answer') return null;
  const answer = (response as AnswerResponse).answer as AnswerResponse['answer'] | undefined;
  const body = answer?.body;
  const attributionLine = answer?.attributionLine;
  if (typeof body !== 'string' || typeof attributionLine !== 'string') return null;
  return {
    body,
    assumptionLine: answer?.assumptionLine ?? null,
    definitionLine: answer?.definitionLine ?? null,
    alternatesLine: answer?.alternatesLine ?? null,
    markingLine: answer?.markingLine ?? null,
    attributionLine,
    stalenessWarning: (response as AnswerResponse).stalenessWarning ?? null,
  };
}

/** R11 provisional flag — true when ANY quoted cell is provisional (the amber
 * pill), matching web/lib/citation.ts's own check verbatim. Defensive over the
 * stored envelope shape. */
function computeProvisional(response: ComposedResponse): boolean {
  if (response.kind !== 'answer') return false;
  const cells = (response as AnswerResponse).result?.cells;
  if (!Array.isArray(cells)) return false;
  return cells.some((cell) => (cell as { provisional?: unknown }).provisional === true);
}

/** The chips a resumed turn may show. Question-shaped chips (the WP29
 * generators, the #134 retry) replay verbatim: a click fills the input and the
 * text goes through the ordinary parse, exactly as live. A chip whose click
 * resolves through a chip-carrier pending — WP26c's rescue chip, the #197
 * step-3 comparison chips (`pending.rescueOnly`) — needs that pending on the
 * client, and a resumed thread deliberately restores NO pending (ADR 033 ⟨A6⟩:
 * exactly like a page reload). Replayed as a plain chip, "Vergelijk met
 * Nederland" would be sent through a fresh LLM parse it was never written for
 * — a paid, likely-refused turn — so carrier-bound labels are dropped on
 * resume. Defensive over the stored envelope shape, like every reader here. */
function replayableSuggestions(response: ComposedResponse): string[] {
  if (response.kind !== 'answer' && response.kind !== 'refusal') return [];
  const envelope = response as AnswerResponse | RefusalResponse;
  const all = Array.isArray(envelope.suggestions) ? envelope.suggestions : [];
  const pending = envelope.pending;
  if (!pending || pending.rescueOnly !== true || !Array.isArray(pending.options)) return all;
  const carried = new Set(pending.options);
  return all.filter((label) => !carried.has(label));
}

function buildAssistantPart(row: ThreadRow): ReplayAssistantPart {
  const response = row.response;
  return {
    role: 'assistant',
    kind: row.kind,
    auditId: row.id,
    // R8: the exact stored text the user saw — never re-derived.
    finalText: row.finalText,
    answerView: extractAnswerView(response),
    chart: response.kind === 'answer' ? ((response as AnswerResponse).chart ?? null) : null,
    // WP29 + #134(a): answers AND period-coverage refusals carry the structural
    // `suggestions` field — a resumed thread must replay both, mirroring the
    // live read in chat.tsx (dropping the refusal retry chip on resume was a
    // parity gap the #134(a) adversarial review caught: this second read site
    // was missed when chat.tsx was widened). `?? []` = A1 absent-key discipline.
    suggestions: replayableSuggestions(response),
    // Additive envelope fields (A1 absent-key discipline): `?? null` reads.
    webSection: response.webSection ?? null,
    provisional: computeProvisional(response),
    creditsCharged: row.creditsCharged,
    response,
  };
}

/** Structural replay of a thread's rows (⟨A4⟩ turn rules, ⟨A7⟩ redaction): per
 * NON-redacted row, exactly one user-turn (reply_text overriding question — a
 * reply row's `question` column echoes the ORIGINAL question, per the
 * respond-audited.ts convention history.ts documents) followed by its assistant
 * turn; a redacted row emits ONE placeholder. A resumed clarification round
 * therefore replays as exactly [question, clarification, reply, outcome] — the
 * original question is never duplicated. */
export function replayParts(rows: ThreadRow[]): ReplayPart[] {
  const parts: ReplayPart[] = [];
  for (const row of rows) {
    if (row.question === REDACTED_QUESTION_TEXT) {
      parts.push({ role: 'redacted', auditId: row.id });
      continue;
    }
    parts.push({
      role: 'user',
      text: row.replyText !== null ? row.replyText : row.question,
      auditId: row.id,
    });
    parts.push(buildAssistantPart(row));
  }
  return parts;
}

/** Rebuild the ConversationContext a resumed thread hands its NEXT question
 * (ADR 033 D3): run the existing deterministic buildConversationContext over
 * the LAST envelope that yields a non-null context, walking backwards — exactly
 * the live "keep whatever context you already held" semantics (web/app/
 * actions.ts outcomeContext), where a clarification/parse-refusal turn yields
 * null and the effective referent stays the most recent answerable turn's.
 *
 * ⟨A7⟩ Redacted rows are SKIPPED BEFORE the call: a redacted 'answer' envelope
 * keeps kind='answer' but has no `result`, so resolvedIntent would THROW (the
 * same guard scripts/verify-audit-rows.ts applies). A per-row try/catch is the
 * defense-in-depth belt (mirroring outcomeContext's fail-open): any parse
 * failure on a row yields no referent from that row and the walk continues; the
 * whole rebuild returns null when no row yields a context.
 *
 * NO validateConversationContext here — that runs web-side at load time against
 * the LIVE registry (a stale topic/region then degrades honestly per ADR 021).
 * No new context logic is written; only buildConversationContext is called. */
export async function rebuildContext(db: Db, rows: ThreadRow[]): Promise<ConversationContext | null> {
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i]!;
    if (row.question === REDACTED_QUESTION_TEXT) continue;
    try {
      const context = await buildConversationContext(db, row.response);
      if (context !== null) return context;
    } catch {
      // A malformed/stale envelope must degrade honestly, never crash the
      // rebuild — keep walking back (the live outcomeContext fail-open posture).
    }
  }
  return null;
}
