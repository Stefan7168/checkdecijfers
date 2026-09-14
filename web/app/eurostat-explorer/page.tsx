// WP30c/E1 Task 7 (ADR 048): the internal Eurostat explorer. INTERNAL TOOL,
// never linked from the public product — an owner/dev surface for looking at
// whatever Eurostat data has actually been registered, through the REAL
// answer pipeline (D5: zero new query/chart code; D5c: zero LLM calls).
//
// Flag mechanism named explicitly (Amendment B3, this route's whole reason
// to exist): the SAME `redirect()`-on-flag-unset shape
// web/app/geschiedenis/page.tsx already uses, copied verbatim rather than
// invented fresh. That page's own header names the exact regression this
// guards against (#135/`/login`, session 55): a route whose flag-gate is
// checked only via prerendered output, not per request, ships permanently
// open (or permanently closed) the moment the flag is flipped in
// production. The fix, mirrored here too: `dynamic = 'force-dynamic'` opts
// this page OUT of static prerendering so `process.env.EUROSTAT_EXPLORER_ENABLED`
// is read fresh on every request — the flag-OFF test below pins this
// mechanism directly (`expect(dynamic).toBe('force-dynamic')`), the same
// pin login/page.test.tsx already carries for its own flag.
//
// D3(a): noindex regardless of flag state — this route names a future,
// unannounced data source (Eurostat) in its own copy, so it must never be
// indexable even while the flag happens to be on. `export const metadata`
// is evaluated independently of the redirect below (both can coexist in one
// Server Component file), matching web/app/systeemoverzicht/page.tsx's own
// "belt-and-suspenders" precedent (the whole site is already blanket-
// noindexed pre-launch; this page stays noindexed even after that lifts,
// since it is never meant to be a public page at all).
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getDb } from '../../lib/db.ts';
import {
  listMeasuresForTable,
  listRegisteredEurostatTables,
  runExplorerQuery,
} from '../../lib/eurostat-explorer.ts';
import { buildAnswerCsv } from '../../lib/csv.ts';
import { buildAnswerProof, batchIdsForProof, fetchRequestUrlsByBatch } from '../../lib/answer-proof.ts';
import { AnswerProof } from '../../components/answer-proof.tsx';
import { ChartView } from '../../components/chart.tsx';
import { displayValueUnit, provisionalSuffix } from '../../backend/answer/compose/template.ts';

export const metadata: Metadata = {
  title: 'Eurostat explorer (internal)',
  robots: { index: false, follow: false },
};

interface SearchParams {
  tableId?: string;
  measure?: string;
  from?: string;
  to?: string;
}

/** Plain data: URI download, no client JS: base64 keeps the CSV's own BOM +
 * CRLF bytes intact through the URI (a raw encodeURIComponent of a
 * semicolon/CRLF-heavy Dutch-locale file is needlessly fragile). Node
 * runtime only (export const runtime = 'nodejs' above) — Buffer is not
 * available on the edge runtime. */
function csvDataUri(content: string): string {
  return `data:text/csv;charset=utf-8;base64,${Buffer.from(content, 'utf-8').toString('base64')}`;
}

export default async function EurostatExplorerPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  if (process.env.EUROSTAT_EXPLORER_ENABLED !== '1') {
    redirect('/');
  }

  const db = getDb();
  const { tableId, measure, from, to } = await searchParams;

  const tables = await listRegisteredEurostatTables(db);

  return (
    <div style={{ maxWidth: 860, margin: '0 auto', padding: '2rem 1rem', fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontSize: '1.25rem' }}>Eurostat explorer (internal)</h1>
      <p style={{ color: '#666' }}>
        Internal, flag-gated tool (EUROSTAT_EXPLORER_ENABLED) — not part of the public product. Picks a
        REGISTERED Eurostat table and runs it through the real answer pipeline (runQuery → composeAnswer →
        buildChartSpec), zero LLM calls.
      </p>

      {tables.length === 0 ? (
        <p data-testid="empty-state" style={{ marginTop: '1.5rem' }}>
          No Eurostat tables are registered yet. E1 (this build phase) ships the adapter, the registry entry
          and this explorer, but registers zero real Eurostat tables (Constraint 0 — no live Eurostat API
          calls this session). Once the owner runs the fixture-capture + onboarding follow-up, registered
          tables will appear here.
        </p>
      ) : (
        <>
          <form method="GET" style={{ marginTop: '1.5rem' }}>
            <label htmlFor="tableId">Table</label>
            <br />
            <select id="tableId" name="tableId" defaultValue={tableId ?? ''}>
              <option value="" disabled>
                Choose a table…
              </option>
              {tables.map((table) => (
                <option key={table.id} value={table.id}>
                  {table.id} — {table.title}
                </option>
              ))}
            </select>{' '}
            <button type="submit">Choose table</button>
          </form>

          {tableId ? <MeasureAndFilterForm db={db} tableId={tableId} measure={measure} from={from} to={to} /> : null}

          {tableId && measure && from && to ? (
            <Results db={db} tableId={tableId} measure={measure} fromYear={from} toYear={to} />
          ) : null}
        </>
      )}
    </div>
  );
}

async function MeasureAndFilterForm({
  db,
  tableId,
  measure,
  from,
  to,
}: {
  db: ReturnType<typeof getDb>;
  tableId: string;
  measure?: string;
  from?: string;
  to?: string;
}) {
  const measures = await listMeasuresForTable(db, tableId);
  if (measures.length === 0) {
    return (
      <p style={{ marginTop: '1rem' }}>
        Table {tableId} is registered but has no recorded measures (cbs_tables.units is empty) — nothing to
        query yet.
      </p>
    );
  }
  const currentYear = new Date().getFullYear();
  return (
    <form method="GET" style={{ marginTop: '1rem', borderTop: '1px solid #ddd', paddingTop: '1rem' }}>
      <input type="hidden" name="tableId" value={tableId} />
      <label htmlFor="measure">Measure</label>
      <br />
      <select id="measure" name="measure" defaultValue={measure ?? ''}>
        <option value="" disabled>
          Choose a measure…
        </option>
        {measures.map((m) => (
          <option key={m.code} value={m.code}>
            {m.code} — {m.title}
          </option>
        ))}
      </select>
      <br />
      <br />
      <label htmlFor="from">From year</label>{' '}
      <input id="from" name="from" type="number" defaultValue={from ?? String(currentYear - 5)} style={{ width: '6em' }} />
      {'  '}
      <label htmlFor="to">To year</label>{' '}
      <input id="to" name="to" type="number" defaultValue={to ?? String(currentYear)} style={{ width: '6em' }} />
      <br />
      <br />
      <button type="submit">Run query</button>
    </form>
  );
}

async function Results({
  db,
  tableId,
  measure,
  fromYear,
  toYear,
}: {
  db: ReturnType<typeof getDb>;
  tableId: string;
  measure: string;
  fromYear: string;
  toYear: string;
}) {
  const response = await runExplorerQuery(db, { tableId, measure, fromYear, toYear });

  if (response.kind !== 'answer') {
    // 'clarification' or 'refusal' — render the honest message plainly,
    // never crash (principle c: a missing/ambiguous answer states so).
    return (
      <div data-testid="non-answer" style={{ marginTop: '1.5rem' }}>
        <p>
          <strong>{response.kind === 'clarification' ? 'Needs clarification:' : 'Refused:'}</strong>{' '}
          {response.text}
        </p>
      </div>
    );
  }

  const csv = buildAnswerCsv(response);
  const proof = buildAnswerProof(response);
  const requestUrls = proof ? await fetchRequestUrlsByBatch(db, batchIdsForProof(proof)) : null;

  return (
    <div data-testid="answer" style={{ marginTop: '1.5rem' }}>
      <p>{response.text}</p>

      {response.result.cells.length > 0 ? (
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.85rem' }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>Region</th>
              <th style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>Period</th>
              <th style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>Value</th>
            </tr>
          </thead>
          <tbody>
            {response.result.cells.map((cell) => (
              <tr key={cell.resultId}>
                <td>{cell.regionLabel ?? '—'}</td>
                <td>{cell.periodLabel}</td>
                <td>
                  {cell.value === null
                    ? '—'
                    : `${displayValueUnit(cell.value, cell.decimals, cell.unit)}${provisionalSuffix(cell)}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      {response.chart ? (
        <div style={{ marginTop: '1rem' }}>
          <ChartView spec={response.chart} />
        </div>
      ) : null}

      <p style={{ marginTop: '1rem' }}>
        <a href={csvDataUri(csv.content)} download={csv.filename}>
          Download CSV
        </a>
      </p>

      {proof ? (
        <div style={{ marginTop: '1rem' }}>
          <AnswerProof proof={proof} requestUrlsByBatch={requestUrls} />
        </div>
      ) : null}
    </div>
  );
}
