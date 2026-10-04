// WP-E (journey programme, 2026-09-12, phase 3 R4): the coverage disclosure
// — "which sources are built in" — a collapsed <details> (question-history.tsx
// precedent) that opens onto a plain grouped list: CBS today, one row per
// served table (title, MEASURED sync date, concepts, an optional
// click-to-fill example). Client component (the example click needs
// onPickExample), but the data itself is a plain serialisable prop built
// server-side by web/lib/coverage-disclosure.ts.
//
// ADR 048 D3 (2026-09-14, adversarial-review finding, owner decision): this
// used to have a second, static "Eurostat — coming" group, removed because
// principle (c) says never name/imply a source before it actually answers.
// Owner-signed 2026-10-04 (session 154, #357 sweep item 6): the rows are now
// GROUPED BY EACH ROW'S OWN source name (`sourceDisplayName`, resolved from
// the registry) instead of one hard-coded "CBS" heading over every row — so
// Eurostat appears here exactly when a Eurostat table is in the served
// coverage (which the coverage report gates on the reviewed-sibling set),
// never as a static announcement.
'use client';

import { useT } from '../lib/i18n/lang-provider.tsx';
import type { CoverageDisclosure, CoverageDisclosureTable } from '../lib/coverage-disclosure.ts';

const PILL = 'rounded-full border border-border px-3 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground';

/** Rows grouped by their own source name, in first-appearance order (the registry read is already stably ordered). */
function groupBySource(tables: CoverageDisclosureTable[]): { source: string; tables: CoverageDisclosureTable[] }[] {
  const groups: { source: string; tables: CoverageDisclosureTable[] }[] = [];
  for (const table of tables) {
    const group = groups.find((g) => g.source === table.sourceDisplayName);
    if (group) group.tables.push(table);
    else groups.push({ source: table.sourceDisplayName, tables: [table] });
  }
  return groups;
}

export function CoverageDisclosureView({
  coverage,
  onPickExample,
  defaultOpen = false,
}: {
  coverage: CoverageDisclosure | null | undefined;
  /** #353: the SEO landing page renders the list already open — a crawler
   * and a reader both get the full holdings without a click. Everywhere
   * else keeps the collapsed default (owner, session 87). */
  defaultOpen?: boolean;
  /** Present ⇒ the example renders as a click-to-fill button (chat composer,
   * #75 fill-don't-send convention). Absent ⇒ the example renders as plain
   * text (landing page — no composer to fill there). */
  onPickExample?: (question: string) => void;
}) {
  const t = useT();
  if (!coverage || coverage.tables.length === 0) return null;
  const groups = groupBySource(coverage.tables);

  return (
    <details className="text-xs text-muted-foreground" open={defaultOpen || undefined}>
      <summary className="cursor-pointer font-medium text-muted-foreground">{t('coverage.summary')}</summary>
      <div className="mt-2 flex flex-col gap-3">
        {groups.map((group) => (
          <div key={group.source}>
            <p className="font-medium text-foreground">{group.source}</p>
            <ul className="mt-1 flex flex-col gap-2">
              {group.tables.map((table) => {
                const concepts =
                  table.concepts.length > 6
                    ? `${table.concepts.slice(0, 6).join(', ')}…`
                    : table.concepts.join(', ');
                const example = table.example;
                return (
                  <li key={table.id}>
                    <p className="text-foreground">
                      {table.title}
                      {table.syncedOn !== null ? ` — ${t('coverage.syncedOn', { date: table.syncedOn })}` : ''}
                    </p>
                    {concepts.length > 0 ? <p>{concepts}</p> : null}
                    {example !== null ? (
                      onPickExample ? (
                        <button
                          type="button"
                          onClick={() => onPickExample(example)}
                          className={`${PILL} mt-1`}
                        >
                          {example}
                        </button>
                      ) : (
                        <p className="mt-1">{t('coverage.exampleLabel', { question: example })}</p>
                      )
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
        <p>{t('coverage.onRequestLine')}</p>
      </div>
    </details>
  );
}
