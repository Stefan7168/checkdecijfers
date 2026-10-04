// Eurostat live probe (session 154): does the LIVE table lane answer real Dutch
// Eurostat questions with the RIGHT number? One end-to-end pass per question,
// READ-ONLY against production:
//
//   (a) FIND the table exactly as production does (web/app/actions.ts): the
//       curated intent parse (parseQuestion), then the same finders —
//       tableFinder (term search) and questionFinder (recall 'any' over the whole
//       question, QUESTION_FINDER_CONFIG, Dutch + English search words) — built by
//       buildOnboardingFinder over the LIVE catalogue, with EUROSTAT_FINDER_ENABLED=1.
//       The production connection is opened with default_transaction_read_only=on
//       and the script proves a write is refused before it does anything else.
//   (b) PLAN + ANSWER through the table lane (runTableLaneJob — the code the
//       /api/table-lane-job route runs) against a LOCAL PGlite database (all
//       migrations) that stores what the lane stores, using the REAL live
//       Eurostat adapter (structure mode, decimals 'observed' — exactly
//       web/lib/table-lane-job-deps.ts) and the REAL table reader (tableParse).
//       The compose step is the deterministic template (no compose model): the
//       numbers, members and refusals are what is measured, not prose.
//   (c) Independently reads Eurostat's own value through the public API for the
//       same dataset / geo / period / the exact members the lane chose, with its
//       own tiny JSON-stat reader (nothing from src/eurostat-adapter).
//   (d) One line per question + benchmark/eurostat-live-probe-report.json.
//
// Real AI calls are made (cheap tier for intent / rerank / search words, the
// configured mid tier for the table reader). A file cache keyed by the request
// hash (--cache <dir>) lets a re-run reuse identical calls for free.
//
//   EUROSTAT_PROBE_LIVE_OK=1 node --env-file=<repo .env> scripts/eurostat-live-probe.ts \
//       [--only 1,3] [--cache <dir>] [--no-lane]
//
// Writes only benchmark/eurostat-live-probe-report.json (+ the cache dir).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

// The Eurostat finder is off by default; the probe measures the switched-on route.
process.env.EUROSTAT_FINDER_ENABLED = '1';

const { connectFromEnv } = await import('../src/db/client.ts');
const { AnthropicLlmClient, requestHash } = await import('../src/answer/llm/client.ts');
type LlmClient = import('../src/answer/llm/client.ts').LlmClient;
type LlmRequest = import('../src/answer/llm/client.ts').LlmRequest;
type LlmResponse = import('../src/answer/llm/client.ts').LlmResponse;
const { parseQuestion } = await import('../src/answer/intent/index.ts');
const { buildOnboardingFinder } = await import('../src/ingestion/onboarding-finder.ts');
const { loadOnboardedVocabulary } = await import('../src/ingestion/onboarding-vocab.ts');
const { QUESTION_FINDER_CONFIG } = await import('../src/catalog/types.ts');
const { StatisticsApiSource } = await import('../src/eurostat-adapter/statistics-api.ts');
const { runTableLaneJob } = await import('../src/ingestion/table-lane-job.ts');
const { createTableLaneRequest, readTableLaneRequest } = await import('../src/ingestion/table-lane-store.ts');
const { applyPricingDefaults } = await import('../src/billing/pricing-apply.ts');
const { loadAuditRecord } = await import('../src/answer/audit/index.ts');
const { createTestDb } = await import('../tests/helpers/pglite-db.ts');

const REPORT_PATH = fileURLToPath(new URL('../benchmark/eurostat-live-probe-report.json', import.meta.url));
/** A fixed, never-real user id for the finder's per-user "already pending" lookup (read-only). */
const MEASUREMENT_USER = '00000000-0000-4000-8000-000000000154';
const EUROSTAT_API = 'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data';

const QUESTIONS: string[] = [
  'Hoe hoog was de werkloosheid in Duitsland in 2024?',
  'Hoeveel inwoners had België in 2024?',
  'Hoeveel groeide de economie van Spanje in 2023?',
  'Hoeveel verkeersdoden waren er in Italië in 2022?',
  'Wat was de jeugdwerkloosheid in Spanje in 2023?',
  'Hoeveel asielaanvragen kreeg Duitsland in 2023?',
  'Hoe hoog was de staatsschuld van Griekenland in 2023?',
  'Hoeveel kilo huishoudelijk afval per inwoner werd er in 2022 in Denemarken ingezameld?',
  'Hoeveel mensen kwamen in 2023 om bij verkeersongevallen in Polen?',
];

// ---------------------------------------------------------------------------
// args
// ---------------------------------------------------------------------------
function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const onlyArg = argValue('--only');
const only = onlyArg ? new Set(onlyArg.split(',').map((s) => Number(s.trim()))) : null;
const cacheDir = argValue('--cache') ?? null;
const skipLane = process.argv.includes('--no-lane');
if (process.env.EUROSTAT_PROBE_LIVE_OK !== '1') {
  console.error('This probe calls the AI (a full run is roughly $0.3). Set EUROSTAT_PROBE_LIVE_OK=1 to confirm.');
  process.exit(1);
}
if (cacheDir) mkdirSync(cacheDir, { recursive: true });

// ---------------------------------------------------------------------------
// LLM client: real Anthropic, optional file cache by request hash, token + cost tally
// ---------------------------------------------------------------------------
// Estimated list prices, USD per million tokens (input / output). ESTIMATE: Haiku 4.5 $1/$5,
// Sonnet 5 $3/$15 (list, after the 2026-08-31 introductory pricing).
function priceFor(model: string): { in: number; out: number } {
  if (/haiku/i.test(model)) return { in: 1, out: 5 };
  if (/opus/i.test(model)) return { in: 5, out: 25 };
  return { in: 3, out: 15 };
}
interface Tally {
  calls: number;
  cacheHits: number;
  inputTokens: number;
  outputTokens: number;
  cost: number;
}
const tallies = new Map<string, Tally>();
function tallyOf(model: string): Tally {
  let t = tallies.get(model);
  if (!t) tallies.set(model, (t = { calls: 0, cacheHits: 0, inputTokens: 0, outputTokens: 0, cost: 0 }));
  return t;
}

class ProbeClient implements LlmClient {
  private readonly inner = new AnthropicLlmClient();
  async complete(request: LlmRequest): Promise<LlmResponse> {
    const file = cacheDir ? join(cacheDir, `${requestHash(request)}.json`) : null;
    if (file && existsSync(file)) {
      const cached = JSON.parse(readFileSync(file, 'utf8')) as LlmResponse;
      tallyOf(cached.model).cacheHits += 1;
      return cached;
    }
    const response = await this.inner.complete(request);
    const t = tallyOf(response.model);
    const p = priceFor(response.model);
    t.calls += 1;
    t.inputTokens += response.usage.inputTokens;
    t.outputTokens += response.usage.outputTokens;
    t.cost += (response.usage.inputTokens * p.in + response.usage.outputTokens * p.out) / 1e6;
    if (file) writeFileSync(file, JSON.stringify(response));
    return response;
  }
}

/** The compose / semantic-check stand-in: always fails, so the answer text is the deterministic template. */
class TemplateOnlyClient implements LlmClient {
  async complete(): Promise<LlmResponse> {
    throw new Error('eurostat-live-probe: no compose model — deterministic template');
  }
}

// ---------------------------------------------------------------------------
// independent Eurostat reader (own JSON-stat handling; nothing from src/eurostat-adapter)
// ---------------------------------------------------------------------------
/** CBS-style period code (2024JJ00 / 2024KW01 / 2024MM03) -> Eurostat's time code (2024 / 2024-Q1 / 2024-03). */
function eurostatTime(periodCode: string): string | null {
  let m = /^(\d{4})JJ00$/.exec(periodCode);
  if (m) return m[1]!;
  m = /^(\d{4})KW0([1-4])$/.exec(periodCode);
  if (m) return `${m[1]}-Q${m[2]}`;
  m = /^(\d{4})MM(\d{2})$/.exec(periodCode);
  if (m) return `${m[1]}-${m[2]}`;
  return null;
}

interface EurostatRead {
  url: string;
  value: number | null;
  flag: string | null;
  note: string | null;
}

async function readEurostat(
  nativeCode: string,
  params: Record<string, string>,
): Promise<EurostatRead> {
  const qs = new URLSearchParams({ format: 'JSON', lang: 'EN' });
  for (const [k, v] of Object.entries(params)) qs.append(k, v);
  const url = `${EUROSTAT_API}/${encodeURIComponent(nativeCode)}?${qs.toString()}`;
  let lastError = '';
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
      if (!res.ok) {
        lastError = `HTTP ${res.status}`;
        continue;
      }
      const j = (await res.json()) as {
        id: string[];
        size: number[];
        value?: Record<string, number | null> | (number | null)[];
        status?: Record<string, string>;
      };
      const total = j.size.reduce((a, b) => a * b, 1);
      if (total !== 1) return { url, value: null, flag: null, note: `not a single cell (${j.id.map((d, i) => `${d}=${j.size[i]}`).join(', ')})` };
      const raw = Array.isArray(j.value) ? j.value[0] : j.value?.['0'];
      const flag = j.status?.['0'] ?? null;
      return { url, value: raw === undefined ? null : raw, flag, note: raw === undefined ? 'no value (not published)' : null };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  return { url, value: null, flag: null, note: `request failed: ${lastError}` };
}

// ---------------------------------------------------------------------------
// the probe
// ---------------------------------------------------------------------------
interface CellView {
  measure: string;
  measureTitle: string;
  regionCode: string | null;
  regionLabel: string | null;
  periodCode: string;
  dims: Record<string, string>;
  dimLabels: Record<string, string>;
  value: number | null;
  unit: string;
  decimals: number;
}

interface Row {
  n: number;
  question: string;
  find: {
    kind: string;
    detail: string | null;
    tableId: string | null;
    confidence: number | null;
    viaOutOfScope: boolean | null;
  };
  lane: {
    kind: string;
    reason: string | null;
    text: string | null;
    tableTitle: string | null;
    selection: unknown;
    members: string | null;
    cells: CellView[];
    askedDimension: string | null;
    /** A clarification's button options (CBS/Eurostat titles), and how many members the dimension has. */
    questionOptions: string[] | null;
    questionTotalOptions: number | null;
    parse: unknown;
    /** The audited ValidatedResult of an answer (cells, attribution) — for offline re-checks. */
    result: unknown;
  } | null;
  eurostat: { reads: (EurostatRead & { cell: string })[] } | null;
  verdict: 'MATCH' | 'MISMATCH' | 'n.a.';
  line: string;
  error?: string;
}

/** `|` in a cell would break the one-line table; keep it flat. */
const flat = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').replace(/\|/g, '/').trim();

async function main(): Promise<void> {
  const { db: prodDb, pool } = connectFromEnv();
  // Production is read-only for this process: every connection is set read-only before any query,
  // and the script proves a write is refused before it does anything else.
  pool.on('connect', (client) => {
    void client.query('set default_transaction_read_only = on');
  });
  const { db: local, close: closeLocal } = await createTestDb();
  const rows: Row[] = [];
  try {
    const ro = await prodDb.query('show default_transaction_read_only');
    let writeRefused = false;
    try {
      await prodDb.query('update cbs_tables set id = id where false');
    } catch (error) {
      writeRefused = /read-only/i.test(error instanceof Error ? error.message : String(error));
    }
    console.log(`production connection: default_transaction_read_only=${String(ro.rows[0]?.default_transaction_read_only)}; write attempt refused: ${writeRefused}`);
    if (!writeRefused) throw new Error('the production connection accepted a write attempt — aborting');

    const client = new ProbeClient();
    const extraCanonicalMeasures = await loadOnboardedVocabulary(prodDb);
    const termFinder = buildOnboardingFinder({ db: prodDb, userId: MEASUREMENT_USER, rerankClient: client });
    const anyFinder = buildOnboardingFinder({
      db: prodDb,
      userId: MEASUREMENT_USER,
      rerankClient: client,
      recall: { mode: 'any' },
      findConfig: QUESTION_FINDER_CONFIG,
      searchTermsClient: client,
      englishSearchTermsClient: client,
    });

    // The lane's local store: a throwaway PGlite database, pricing defaults, one funded user.
    await applyPricingDefaults(local);
    const userId = randomUUID();
    await local.query(
      `insert into credit_transactions (user_id, delta, reason, note) values ($1, $2, 'signup_grant', 'eurostat live probe seed')`,
      [userId, 100_000],
    );
    const eurostat = new StatisticsApiSource(fetch, { structureLayout: { decimals: 'observed' } });
    const referenceDate = new Date().toISOString().slice(0, 10);
    const templateOnly = new TemplateOnlyClient();

    for (let i = 0; i < QUESTIONS.length; i++) {
      const n = i + 1;
      if (only && !only.has(n)) continue;
      const question = QUESTIONS[i]!;
      const row: Row = {
        n,
        question,
        find: { kind: 'error', detail: null, tableId: null, confidence: null, viaOutOfScope: null },
        lane: null,
        eurostat: null,
        verdict: 'n.a.',
        line: '',
      };
      try {
        // (a) find the table exactly as production does
        const outcome = await parseQuestion(prodDb, question, {
          client,
          referenceDate,
          extraCanonicalMeasures,
          tableFinder: termFinder,
          questionFinder: anyFinder,
        });
        if (outcome.kind === 'onboarding') {
          row.find = {
            kind: 'onboarding',
            detail: `topicTerm=${flat(outcome.topicTerm)}`,
            tableId: outcome.tableId,
            confidence: outcome.confidence,
            viaOutOfScope: outcome.topicTerm === question,
          };
        } else {
          row.find = {
            kind: outcome.kind === 'refusal' ? `refusal:${outcome.refusalKind}` : outcome.kind,
            detail: `raw=${outcome.raw.kind}`,
            tableId: null,
            confidence: null,
            viaOutOfScope: null,
          };
        }

        // (b) the table lane over the picked table, against the local store
        if (row.find.tableId !== null && !skipLane) {
          const tableId = row.find.tableId;
          const created = await createTableLaneRequest(local, {
            userId,
            requestId: randomUUID(),
            threadId: null,
            lang: 'nl',
            question,
            tableId,
            finderConfidence: row.find.confidence ?? 0.9,
            previousQuestion: null,
          });
          if (created.kind !== 'created') throw new Error(`could not queue the lane row (${created.kind})`);
          const summary = await runTableLaneJob({
            db: local,
            source: eurostat,
            sourceFor: () => eurostat,
            parseClient: client,
            referenceDate,
            respondOptions: () => ({ intentClient: templateOnly, answerClient: templateOnly, referenceDate, sourceTag: 'benchmark' }),
          });
          const done = await readTableLaneRequest(local, created.row.id, userId);
          if (done === null || done.auditId === null) throw new Error(`lane row finished without an audit row (${JSON.stringify(summary)}; ${done?.failureSummary ?? ''})`);
          const record = await loadAuditRecord(local, done.auditId);
          if (record === null) throw new Error('audit row not found');
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const response = record.response as any;
          const laneEnv = response.tableLane ?? null;
          const cells: CellView[] = (response.result?.cells ?? []).map((c: CellView) => ({
            measure: c.measure,
            measureTitle: c.measureTitle,
            regionCode: c.regionCode,
            regionLabel: c.regionLabel,
            periodCode: c.periodCode,
            dims: c.dims,
            dimLabels: c.dimLabels,
            value: c.value,
            unit: c.unit,
            decimals: c.decimals,
          }));
          const first = cells[0];
          const dimText = first
            ? Object.entries(first.dimLabels ?? {}).map(([d, l]) => `${d}=${flat(l)}`).join('; ')
            : '';
          const members = first
            ? [`measure=${flat(first.measureTitle)} [${first.measure}]`, dimText, `geo=${flat(first.regionLabel)} [${first.regionCode ?? '-'}]`, `period=${first.periodCode}`]
                .filter((s) => s.length > 0)
                .join('; ')
            : null;
          row.lane = {
            kind: record.kind,
            reason: record.kind === 'refusal' ? (response.reason ?? null) : null,
            text: flat(response.text ?? response.message ?? null),
            tableTitle: response.result?.attribution?.tableTitle ?? null,
            selection: laneEnv?.selection ?? null,
            members,
            cells,
            askedDimension: laneEnv?.question?.dimension ?? null,
            questionOptions: laneEnv?.question?.options ? laneEnv.question.options.map((o: { title: string }) => o.title) : null,
            questionTotalOptions: laneEnv?.question?.totalOptions ?? null,
            parse: laneEnv?.parse ?? null,
            result: record.kind === 'answer' ? (response.result ?? null) : null,
          };

          // (c) Eurostat's own value for the exact members the lane chose
          if (record.kind === 'answer' && cells.length > 0) {
            const nativeCode = tableId.replace(/^[^:]*:/, '');
            const reads: (EurostatRead & { cell: string })[] = [];
            for (const c of cells) {
              const time = eurostatTime(c.periodCode);
              const unit = c.measure.includes('|') ? c.measure.slice(c.measure.indexOf('|') + 1) : null;
              if (time === null || c.regionCode === null || unit === null) {
                reads.push({ url: '', value: null, flag: null, note: `cannot map cell to Eurostat coordinates (${c.periodCode} / ${c.regionCode} / ${c.measure})`, cell: c.periodCode });
                continue;
              }
              const params: Record<string, string> = { geo: c.regionCode, time, unit, ...c.dims };
              reads.push({ ...(await readEurostat(nativeCode, params)), cell: `${c.regionCode} ${c.periodCode}` });
            }
            row.eurostat = { reads };
            const verdicts = reads.map((r, k) => {
              const cell = cells[k]!;
              if (r.value === null || cell.value === null) return 'n.a.' as const;
              return Math.abs(r.value - cell.value) <= 1e-9 * Math.max(1, Math.abs(r.value)) ? ('MATCH' as const) : ('MISMATCH' as const);
            });
            row.verdict = verdicts.includes('MISMATCH') ? 'MISMATCH' : verdicts.every((v) => v === 'MATCH') ? 'MATCH' : 'n.a.';
          }
        }
      } catch (error) {
        row.error = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      }

      const laneNumber = row.lane?.cells.length
        ? row.lane.cells.map((c) => `${c.value === null ? 'null' : c.value} ${flat(c.unit)}`).join(' / ')
        : '-';
      const eurostatNumber = row.eurostat
        ? row.eurostat.reads.map((r) => (r.value === null ? `n.a. (${r.note ?? 'null'})` : `${r.value}${r.flag ? ` [${r.flag}]` : ''}`)).join(' / ')
        : '-';
      const outcomeText = row.error
        ? `ERROR ${flat(row.error).slice(0, 160)}`
        : row.lane
          ? `${row.lane.kind}${row.lane.reason ? `:${row.lane.reason}` : ''}${row.lane.askedDimension ? ` (asks ${row.lane.askedDimension})` : ''}`
          : row.find.kind;
      row.line = [
        `Q${n} ${question}`,
        outcomeText,
        row.find.tableId ?? '-',
        row.lane?.members ?? '-',
        laneNumber,
        eurostatNumber,
        row.verdict,
      ].join(' | ');
      console.log(row.line);
      rows.push(row);
    }
  } finally {
    await closeLocal();
    await pool.end();
  }

  // cost
  let totalCost = 0;
  const costByModel: Record<string, Tally> = {};
  for (const [model, t] of tallies) {
    costByModel[model] = t;
    totalCost += t.cost;
  }
  console.log('\nAI usage (estimated list prices; cache hits are free):');
  for (const [model, t] of Object.entries(costByModel)) {
    console.log(`  ${model}: ${t.calls} calls (+${t.cacheHits} cache hits), ${t.inputTokens} in / ${t.outputTokens} out tokens, ~$${t.cost.toFixed(4)}`);
  }
  console.log(`  total ~$${totalCost.toFixed(4)}`);
  // A cache directory keeps a ledger of what each run really spent (cache hits cost nothing), so the
  // cumulative real spend of a probe + its re-runs stays on record.
  let cumulativeUsd: number | null = null;
  if (cacheDir) {
    const ledgerPath = join(cacheDir, 'spend-ledger.json');
    const ledger: { at: string; usd: number }[] = existsSync(ledgerPath) ? JSON.parse(readFileSync(ledgerPath, 'utf8')) : [];
    ledger.push({ at: new Date().toISOString(), usd: Number(totalCost.toFixed(4)) });
    writeFileSync(ledgerPath, JSON.stringify(ledger, null, 1));
    cumulativeUsd = Number(ledger.reduce((a, l) => a + l.usd, 0).toFixed(4));
    console.log(`  cumulative real spend across the runs recorded in ${ledgerPath}: ~$${cumulativeUsd.toFixed(4)} (${ledger.length} run(s))`);
  }

  const report = {
    generatedAt: new Date().toISOString(),
    referenceDate: new Date().toISOString().slice(0, 10),
    note:
      'Read-only against production (default_transaction_read_only=on); the lane ran against a local PGlite store with the live Eurostat adapter and the real table reader; compose = deterministic template. Cost = estimated list prices.',
    cost: { thisRunUsd: Number(totalCost.toFixed(4)), cumulativeRealUsd: cumulativeUsd, byModel: costByModel },
    summary: {
      questions: rows.length,
      answered: rows.filter((r) => r.lane?.kind === 'answer').length,
      match: rows.filter((r) => r.verdict === 'MATCH').length,
      mismatch: rows.filter((r) => r.verdict === 'MISMATCH').length,
      notApplicable: rows.filter((r) => r.verdict === 'n.a.').length,
    },
    rows,
  };
  writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 1)}\n`);
  console.log(`\nreport: ${REPORT_PATH}`);
}

await main();
