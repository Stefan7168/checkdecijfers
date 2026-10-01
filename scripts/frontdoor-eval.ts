// The front-door measurement (session 153, ADR 062 "the front door"): does a
// realistic Dutch question about a NON-curated CBS table reach a table that
// can answer it? Reads benchmark/frontdoor-labelled-set.json.
//
//   npm run frontdoor:eval              — free: recall only (the live
//                                         catalogue, read-only), 'any' mode
//                                         over the whole question; reports
//                                         whether an expected table is on the
//                                         shortlist the rerank would see.
//   FRONTDOOR_LIVE_OK=1 npm run frontdoor:eval -- --live
//                                       — real AI: the intent parse (cheap
//                                         tier) then the finder exactly as
//                                         askQuestion wires it (unmatched →
//                                         the term finder; out_of_scope → the
//                                         'any' finder), with the real rerank.
//                                         Reports BEFORE (only the old
//                                         unmatched path counts) and AFTER
//                                         (the out_of_scope path counts too).
//                                         Measured ~$0.6 per run.
//
// Read-only against the live database (catalogue + the finder's own lookups);
// writes only benchmark/frontdoor-report.json.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { connectFromEnv } from '../src/db/client.ts';
import { recallCandidates } from '../src/catalog/recall.ts';
import { AnthropicLlmClient } from '../src/answer/llm/client.ts';
import { parseQuestion } from '../src/answer/intent/index.ts';
import { buildOnboardingFinder } from '../src/ingestion/onboarding-finder.ts';
import { loadOnboardedVocabulary } from '../src/ingestion/onboarding-vocab.ts';
import { QUESTION_FINDER_CONFIG } from '../src/catalog/types.ts';

const SET_PATH = fileURLToPath(new URL('../benchmark/frontdoor-labelled-set.json', import.meta.url));
const REPORT_PATH = fileURLToPath(new URL('../benchmark/frontdoor-report.json', import.meta.url));
/** A fixed, never-real user id for the finder's per-user "already pending" lookup (read-only). */
const MEASUREMENT_USER = '00000000-0000-4000-8000-000000000153';

interface FrontdoorCase {
  id: string;
  question: string;
  expectTables: string[];
}

const live = process.argv.includes('--live');
if (live && process.env.FRONTDOOR_LIVE_OK !== '1') {
  console.error('--live calls the AI (~$0.6). Set FRONTDOOR_LIVE_OK=1 to confirm.');
  process.exit(1);
}

const cases = (JSON.parse(readFileSync(SET_PATH, 'utf8')) as { cases: FrontdoorCase[] }).cases;
const { db, pool } = connectFromEnv();
const rows: Record<string, unknown>[] = [];
let recallHits = 0;
let positives = 0;
let before = 0;
let after = 0;
let negativesRouted = 0;

try {
  const client = live ? new AnthropicLlmClient() : null;
  const extraCanonicalMeasures = live ? await loadOnboardedVocabulary(db) : [];
  const termFinder = live ? buildOnboardingFinder({ db, userId: MEASUREMENT_USER, rerankClient: client! }) : null;
  const anyFinder = live
    ? buildOnboardingFinder({
        db,
        userId: MEASUREMENT_USER,
        rerankClient: client!,
        recall: { mode: 'any' },
        findConfig: QUESTION_FINDER_CONFIG,
        searchTermsClient: client!,
      })
    : null;

  for (const c of cases) {
    const positive = c.expectTables.length > 0;
    if (positive) positives++;
    const shortlist = await recallCandidates(db, c.question, { mode: 'any' });
    const rank = shortlist.findIndex((s) => c.expectTables.includes(s.tableId));
    if (positive && rank >= 0) recallHits++;
    const row: Record<string, unknown> = { id: c.id, positive, recallRank: rank, shortlist: shortlist.length };

    if (live) {
      const outcome = await parseQuestion(db, c.question, {
        client: client!,
        referenceDate: new Date().toISOString().slice(0, 10),
        extraCanonicalMeasures,
        tableFinder: termFinder!,
        questionFinder: anyFinder!,
      });
      const kind = outcome.kind === 'refusal' ? `refusal:${outcome.refusalKind}` : outcome.kind;
      const picked = outcome.kind === 'onboarding' ? outcome.tableId : null;
      // The whole-question finder (out_of_scope, or the unmatched fallback)
      // is called with the question as its term; the old term finder never is.
      const viaOutOfScope = outcome.kind === 'onboarding' && outcome.topicTerm === c.question;
      const hit = picked !== null && c.expectTables.includes(picked);
      if (positive && hit) {
        after++;
        if (!viaOutOfScope) before++;
      }
      if (!positive && picked !== null) negativesRouted++;
      Object.assign(row, { parseKind: outcome.raw.kind, outcome: kind, picked, viaOutOfScope, hit });
    }
    rows.push(row);
    console.log(JSON.stringify(row));
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    live,
    cases: cases.length,
    positives,
    recallOnShortlist: `${recallHits}/${positives}`,
    ...(live
      ? {
          beforeReachesRightTable: `${before}/${positives}`,
          afterReachesRightTable: `${after}/${positives}`,
          negativesRoutedToATable: `${negativesRouted}/${cases.length - positives}`,
        }
      : {}),
  };
  console.log('\n' + JSON.stringify(summary, null, 2));
  writeFileSync(REPORT_PATH, JSON.stringify({ summary, rows }, null, 2) + '\n');
} finally {
  await pool.end();
}
