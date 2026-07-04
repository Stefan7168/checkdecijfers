// Validation-pass runner — drives the 38 owner-authored validation questions
// (docs/validation-questions.md, 2026-07-04) through the AUDITED pipeline
// against the LIVE database + real Anthropic calls, exactly the WP11 live-
// benchmark pattern (scripts/run-benchmark.ts --live) minus the frozen key:
// this pass has no expected answers to score against — its deliverable is the
// architecture-decision memo (docs/validation-results-*.md), written from the
// dump this script produces.
//
//   npm run validation:run     live only. Spends real tokens (~38 flows, in
//                              the order of the WP11 run's ~€0.19 for 24) and
//                              writes REAL audit_answers rows (kept — the R8
//                              trail, same policy as ADR 017 decision 3).
//
// Deliberate differences from the benchmark runner, all cost/scope-driven:
//  - No reply rounds: a clarification is recorded AS the outcome ("clarify"),
//    never answered. The one-round reply merge was already measured live 7/7
//    with zero flips in WP9; re-measuring it here would double spend for no
//    new architectural signal.
//  - Reference date is TODAY (Europe/Amsterdam), mirroring the deployed app
//    (web/app/actions.ts) — this pass validates real-world behaviour, not a
//    frozen key, so the production clock is the honest choice.
//  - An audit-write failure is recorded and the run continues: unlike the
//    benchmark (where a lost row invalidates scoring), here every remaining
//    question still yields signal, and a mid-run abort would waste the spend
//    already made.
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { answerQuestionAudited } from '../src/answer/audit/index.ts';
import type { AuditedResponse } from '../src/answer/audit/index.ts';
import { AnthropicLlmClient } from '../src/answer/llm/client.ts';
import { connectFromEnv } from '../src/db/client.ts';

const DUMP_PATH = fileURLToPath(new URL('../benchmark/validation-run.json', import.meta.url));

/** Mirrors web/app/actions.ts — the deployed app's clock. */
function referenceDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Amsterdam',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

interface ValidationQuestion {
  /** V01–V38; docNumber is the question's number in docs/validation-questions.md. */
  id: string;
  docNumber: number;
  category: string;
  question: string;
  /** The doc's predicted outcome, verbatim-ish — so the dump self-documents
   * confirm/contradict per question. */
  predicted: string;
}

const CATEGORIES = {
  c1: '1 Basisvragen',
  c2: '2 Regio/tijd',
  c3: '3 Thema',
  c4: '4 Vergelijking',
  c5: '5 Edge cases',
  c6: '6 UX/performance',
  c7: '7 Documentvragen',
  c8: '8 Chat-context',
  c9: '9 Interpretatie',
  c10: '10 Meta/betrouwbaarheid',
} as const;

// Questions verbatim from docs/validation-questions.md (owner's Dutch).
const QUESTIONS: ValidationQuestion[] = [
  { id: 'V01', docNumber: 1, category: CATEGORIES.c1, question: 'Hoe ontwikkelt de werkloosheid zich in Nederland sinds 2015?', predicted: 'answer (series -> line chart)' },
  { id: 'V02', docNumber: 2, category: CATEGORIES.c1, question: 'Wat is de huidige inflatie in Nederland vergeleken met vijf jaar geleden?', predicted: 'answer (comparison)' },
  { id: 'V03', docNumber: 3, category: CATEGORIES.c1, question: 'Hoeveel inwoners telt Nederland op dit moment?', predicted: 'answer (single value, B1-like)' },
  { id: 'V04', docNumber: 4, category: CATEGORIES.c1, question: 'Wat is het gemiddelde inkomen per huishouden in Nederland?', predicted: 'answer (single value; measure-match watch item)' },
  { id: 'V05', docNumber: 5, category: CATEGORIES.c2, question: 'Hoe is de bevolking van Amsterdam veranderd tussen 2010 en 2020?', predicted: 'should answer — regional-coverage unknown' },
  { id: 'V06', docNumber: 6, category: CATEGORIES.c2, question: 'Wat is de werkloosheid in Noord-Brabant per jaar sinds 2015?', predicted: 'should answer — regional-coverage unknown' },
  { id: 'V07', docNumber: 7, category: CATEGORIES.c2, question: 'Hoeveel bijstandsontvangers zijn er in Rotterdam in 2023?', predicted: 'refuse (bijstand not loaded)' },
  { id: 'V08', docNumber: 8, category: CATEGORIES.c2, question: 'Hoe verschilt de woningvoorraad tussen Utrecht, Groningen en Limburg in 2022?', predicted: 'should answer (3-region comparison -> bar) — regional-coverage unknown' },
  { id: 'V09', docNumber: 9, category: CATEGORIES.c3, question: 'Wat is de impact van migratie op de woningmarkt in Nederland?', predicted: 'refuse (causal + migration not loaded)' },
  { id: 'V10', docNumber: 10, category: CATEGORIES.c3, question: 'Hoeveel mensen met migratieachtergrond ontvangen bijstand per jaar?', predicted: 'refuse (not loaded)' },
  { id: 'V11', docNumber: 11, category: CATEGORIES.c3, question: 'Wat zijn de cijfers over veiligheid en criminaliteit naar herkomstgroepering?', predicted: 'refuse (not loaded)' },
  { id: 'V12', docNumber: 12, category: CATEGORIES.c3, question: 'Hoe ontwikkelen de uitgaven aan onderwijs zich in de Rijksbegroting?', predicted: 'refuse (not a CBS source)' },
  { id: 'V13', docNumber: 13, category: CATEGORIES.c4, question: 'Vergelijk de jeugdwerkloosheid in Amsterdam en Den Haag in de afgelopen vijf jaar.', predicted: 'refuse or clarify (exceeds one-varying-axis; jeugd dimension unknown)' },
  { id: 'V14', docNumber: 14, category: CATEGORIES.c4, question: 'Welke provincie heeft de hoogste gemiddelde woningprijs, en hoe is dat veranderd sinds 2010?', predicted: 'refuse compound or partial answer' },
  { id: 'V15', docNumber: 15, category: CATEGORIES.c4, question: 'Zijn de bijstandscijfers hoger in de Randstad dan in de rest van Nederland?', predicted: 'refuse (bijstand not loaded; composite region)' },
  { id: 'V16', docNumber: 16, category: CATEGORIES.c4, question: 'Vergelijk de bevolkingsgroei van Nederland met een andere EU-lidstaat.', predicted: 'refuse (CBS NL only)' },
  { id: 'V17', docNumber: 17, category: CATEGORIES.c5, question: 'Laat me alle CBS-data zien over alles in Nederland.', predicted: 'refuse/clarify (too broad)' },
  { id: 'V18', docNumber: 18, category: CATEGORIES.c5, question: "Geef mij alle cijfers over 'geluk'.", predicted: 'refuse (scope — no geluk indicator)' },
  { id: 'V19', docNumber: 19, category: CATEGORIES.c5, question: "Toon migratiecijfers voor de gemeente 'Gotham City' in 2022.", predicted: 'refuse (unknown region — watch for silent wrong match)' },
  { id: 'V20', docNumber: 20, category: CATEGORIES.c5, question: 'Hoeveel inwoners heeft Nederland in 2050 volgens CBS?', predicted: 'refuse (forecast, B18-like)' },
  { id: 'V21', docNumber: 21, category: CATEGORIES.c5, question: 'Wat is de werkloosheid per dag in 2023?', predicted: 'refuse (frequency — CBS publishes no daily figures)' },
  { id: 'V22', docNumber: 22, category: CATEGORIES.c6, question: 'Geef een overzicht van alle gemeenten in Nederland met hun bevolking per jaar sinds 1970.', predicted: 'refuse gracefully (cell limit / outside slice), NOT an error' },
  { id: 'V23', docNumber: 23, category: CATEGORIES.c6, question: 'Toon de volledige tijdreeks van inflatie vanaf 1960 tot nu, met maandcijfers.', predicted: 'refuse (outside slice) or answer from available range' },
  { id: 'V24', docNumber: 24, category: CATEGORIES.c6, question: "Laat alle regio's zien met het aantal bijstandontvangers én het gemiddelde inkomen én de woningvoorraad in één grafiek.", predicted: 'refuse (multi-measure; bijstand not loaded)' },
  { id: 'V25', docNumber: 25, category: CATEGORIES.c7, question: 'Is er een beleidsdocument dat uitlegt waarom de bijstandscijfers zijn veranderd in de afgelopen jaren?', predicted: 'refuse (no document layer)' },
  { id: 'V26', docNumber: 26, category: CATEGORIES.c7, question: 'Welke stukken van de Rijksoverheid gaan over het beperken van migratie?', predicted: 'refuse (no document layer)' },
  { id: 'V27', docNumber: 27, category: CATEGORIES.c7, question: 'Kun je het CBS uitleggen hoe zij hun cijfers berekenen en controleren?', predicted: 'refuse/meta (no methodology hallucination)' },
  { id: 'V28', docNumber: 28, category: CATEGORIES.c8, question: 'Wat is de werkloosheid in Nederland sinds 2010?', predicted: 'answer' },
  { id: 'V29', docNumber: 29, category: CATEGORIES.c8, question: 'En hoe zit dat voor jongeren?', predicted: 'refuse/clarify (no conversation memory — no referent)' },
  { id: 'V30', docNumber: 30, category: CATEGORIES.c8, question: 'En alleen in de Randstad?', predicted: 'refuse/clarify (no referent; composite region)' },
  { id: 'V31', docNumber: 31, category: CATEGORIES.c8, question: 'Kun je dit in een grafiek zetten en een korte uitleg geven?', predicted: 'refuse/clarify (no referent)' },
  { id: 'V32', docNumber: 32, category: CATEGORIES.c9, question: 'Is de situatie op de woningmarkt verbeterd of verslechterd in de afgelopen tien jaar?', predicted: 'refuse to interpret OR descriptive answer (opinion guard)' },
  { id: 'V33', docNumber: 33, category: CATEGORIES.c9, question: 'Wat zijn de belangrijkste trends als je kijkt naar migratie en veiligheid?', predicted: 'refuse (not loaded)' },
  { id: 'V34', docNumber: 34, category: CATEGORIES.c9, question: 'Kun je mij een kort verhaal geven bij deze grafiek over bijstand naar herkomstgroepering?', predicted: 'refuse (not loaded; no referent)' },
  { id: 'V35', docNumber: 35, category: CATEGORIES.c10, question: 'Uit welke CBS-tabel komt deze grafiek precies?', predicted: 'refuse/smalltalk (no referent — attribution is inline per answer)' },
  { id: 'V36', docNumber: 36, category: CATEGORIES.c10, question: 'Wanneer zijn deze cijfers voor het laatst bijgewerkt?', predicted: 'refuse/smalltalk (no referent)' },
  { id: 'V37', docNumber: 37, category: CATEGORIES.c10, question: 'Hoe ga je om met ontbrekende waarden of geschorste cijfers?', predicted: 'refuse/meta (explains product behaviour or refuses)' },
  { id: 'V38', docNumber: 38, category: CATEGORIES.c10, question: 'Welke bronnen gebruik je naast CBS voor deze vraag?', predicted: 'refuse (honest: only CBS in Phase 0)' },
];

interface QuestionRun {
  id: string;
  docNumber: number;
  category: string;
  question: string;
  predicted: string;
  auditId: number | null;
  kind: string;
  refusalReason: string | null;
  latencyMs: number;
  /** The full envelope, verbatim — all analysis reads from here. */
  response: AuditedResponse['response'];
}

async function main(): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY || !process.env.DATABASE_URL) {
    throw new Error(
      'ANTHROPIC_API_KEY and DATABASE_URL must be set — this pass is live-only. Run via: npm run validation:run',
    );
  }
  const refDate = referenceDate();
  const client = new AnthropicLlmClient();
  const { db, pool } = connectFromEnv();
  const runs: QuestionRun[] = [];

  console.log(`validation pass: ${QUESTIONS.length} questions, referenceDate ${refDate} (Europe/Amsterdam, live clock)`);
  try {
    for (const q of QUESTIONS) {
      const startedAt = performance.now();
      const outcome = await answerQuestionAudited(db, q.question, {
        referenceDate: refDate,
        intentClient: client,
        answerClient: client,
        // WP13, open-questions #44: this runner IS the owner's manual
        // validation pass, never a scripted benchmark or real user traffic.
        sourceTag: 'validation',
      });
      // Wall-clock around the WHOLE audited call, so it INCLUDES the audit-
      // row insert. The audit row's own latency_ms (R8) is measured inside,
      // BEFORE the insert — the two are deliberately different layers; when
      // reporting, name which one you cite (review finding, 2026-07-05).
      const latencyMs = Math.round(performance.now() - startedAt);
      if (outcome.auditId === null) {
        console.warn(`  ${q.id}: AUDIT WRITE FAILED — recorded in dump, continuing`);
      }
      const { response } = outcome;
      const refusalReason = response.kind === 'refusal' ? response.reason : null;
      runs.push({
        ...q,
        auditId: outcome.auditId,
        kind: response.kind,
        refusalReason,
        latencyMs,
        response,
      });
      console.log(
        `  ${q.id} [${q.category}] ${response.kind}${refusalReason ? `/${refusalReason}` : ''} (${latencyMs} ms, audit ${outcome.auditId ?? 'FAILED'})`,
      );
    }
  } finally {
    try {
      await pool.end();
    } catch (closeError) {
      console.error('warning: closing the database connection failed:', closeError);
    }
  }

  const byKind: Record<string, number> = {};
  for (const run of runs) {
    const key = run.refusalReason ? `${run.kind}/${run.refusalReason}` : run.kind;
    byKind[key] = (byKind[key] ?? 0) + 1;
  }
  const dump = {
    mode: 'live-validation-pass',
    generatedAt: new Date().toISOString(),
    referenceDate: refDate,
    questionCount: runs.length,
    byKind,
    auditIds: runs.map((r) => r.auditId),
    runs,
  };
  writeFileSync(DUMP_PATH, `${JSON.stringify(dump, null, 1)}\n`);
  console.log(`\noutcomes:`, byKind);
  console.log(`dump written to benchmark/validation-run.json — analysis/memo: docs/validation-results-*.md`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
