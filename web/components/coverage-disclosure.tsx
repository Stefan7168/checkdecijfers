// WP-E (journey programme, 2026-09-12, phase 3 R4): the coverage disclosure
// — "which sources are built in" — a collapsed <details> (question-history.tsx
// precedent) that opens onto a plain grouped list: CBS today, one row per
// served table (title, MEASURED sync date, concepts, an optional
// click-to-fill example). Client component (the example click needs
// onPickExample), but the data itself is a plain serialisable prop built
// server-side by web/lib/coverage-disclosure.ts.
//
// ADR 048 D3 (2026-09-14, adversarial-review finding, owner decision): this
// used to have a second, static "Eurostat — coming" group. Principle (c) says
// never name/imply a source before it actually answers — that group itself
// was already such a naming, shipped before D3's "never announced" rule
// existed. Removed rather than reworded: the owner chose silence over a
// narrowed disclosure. Do not re-add a source name here before that source
// has actually served a real answer.
'use client';

import { useT } from '../lib/i18n/lang-provider.tsx';
import type { CoverageDisclosure } from '../lib/coverage-disclosure.ts';

const PILL = 'rounded-full border border-border px-3 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground';

export function CoverageDisclosureView({
  coverage,
  onPickExample,
}: {
  coverage: CoverageDisclosure | null | undefined;
  /** Present ⇒ the example renders as a click-to-fill button (chat composer,
   * #75 fill-don't-send convention). Absent ⇒ the example renders as plain
   * text (landing page — no composer to fill there). */
  onPickExample?: (question: string) => void;
}) {
  const t = useT();
  if (!coverage || coverage.tables.length === 0) return null;

  return (
    <details className="text-xs text-muted-foreground">
      <summary className="cursor-pointer font-medium text-muted-foreground">{t('coverage.summary')}</summary>
      <div className="mt-2 flex flex-col gap-3">
        <div>
          <p className="font-medium text-foreground">{t('coverage.cbsHeading')}</p>
          <ul className="mt-1 flex flex-col gap-2">
            {coverage.tables.map((table) => {
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
          <p className="mt-2">{t('coverage.onRequestLine')}</p>
        </div>
      </div>
    </details>
  );
}
