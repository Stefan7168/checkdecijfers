// WP30a (ADR 030 D3 + A1/A2/A6): the source registry — golden-string pins
// proving the consolidation is byte-identical to the pre-WP30a literals, for
// the 'cbs' key AND for an absent source (every pre-WP30a stored row).
import { describe, expect, it } from 'vitest';
import {
  CBS_SOURCE_KEY,
  isProvisionalStatus,
  resolveSource,
  resolveSourceForTable,
  SOURCES,
  sourceKeyForTableId,
} from '../../src/sources/registry.ts';
import { fakeSourceInfo } from '../helpers/fake-source-info.ts';
import { nullReasonText, renderTemplateBody } from '../../src/answer/compose/index.ts';
import { buildAttributionLine } from '../../src/answer/compose/format.ts';
import { buildChartSpec } from '../../src/chart/index.ts';
import { makeCell, makeResult } from '../helpers/synthetic-results.ts';

describe('resolveSource (A1 — the load-bearing lookup)', () => {
  it('cbs resolves to the registry entry', () => {
    expect(resolveSource('cbs')).toBe(SOURCES[CBS_SOURCE_KEY]);
  });

  it('ABSENT source (pre-WP30a stored rows) resolves to cbs', () => {
    expect(resolveSource(undefined)).toBe(SOURCES[CBS_SOURCE_KEY]);
  });

  it('an unknown key falls back to cbs — display paths must never throw', () => {
    expect(resolveSource('nonexistent')).toBe(SOURCES[CBS_SOURCE_KEY]);
  });
});

describe('the cbs entry pins the exact pre-WP30a literals', () => {
  const cbs = resolveSource(undefined);

  it('labels', () => {
    expect(cbs.displayName).toBe('CBS');
    expect(cbs.attributionLabel).toBe('CBS StatLine');
    expect(cbs.license).toBe('CC BY 4.0');
  });

  it('deep link (casing verbatim — quirk #1)', () => {
    expect(cbs.deepLink!('03759ned')).toBe('https://opendata.cbs.nl/statline/#/CBS/nl/dataset/03759ned/table');
  });

  it('A2: the two-tier provisional wording', () => {
    expect(cbs.provisionalDisplay['Voorlopig']).toBe(' (voorlopig cijfer)');
    expect(cbs.provisionalDisplay['NaderVoorlopig']).toBe(' (nader voorlopig cijfer)');
  });

  it('R11 null reasons — the owner-approved Dutch, verbatim', () => {
    expect(nullReasonText('Impossible')).toBe('deze waarde kan volgens CBS niet voorkomen');
    expect(nullReasonText('Confidential')).toBe('door CBS niet gepubliceerd (vertrouwelijk)');
    expect(nullReasonText('NotAvailable')).toBe('door CBS (nog) niet beschikbaar gesteld');
    expect(nullReasonText('Onbekend')).toBe("door CBS gemarkeerd als 'Onbekend'");
  });

  it('A6: the catalog-lifecycle current set (field only in WP30a)', () => {
    expect(cbs.currentCatalogStatuses).toEqual(['Regulier']);
  });

  it('WP30b: the definitive statuses — exactly the old run.ts literal', () => {
    expect(cbs.definitiveStatuses).toEqual(['Definitief']);
  });
});

describe('WP30b: sourceKeyForTableId (the D4 rule as code)', () => {
  it('bare legacy ids belong to cbs', () => {
    expect(sourceKeyForTableId('37789ksz')).toBe('cbs');
    expect(sourceKeyForTableId('85773NED')).toBe('cbs');
  });

  it("'<key>:<native-id>' derives the key (prefix before the FIRST colon)", () => {
    expect(sourceKeyForTableId('politie:47022NED')).toBe('politie');
    expect(sourceKeyForTableId('a:b:c')).toBe('a');
  });

  it('a leading colon derives the EMPTY key (malformed — matches the SQL derivation)', () => {
    expect(sourceKeyForTableId(':oops')).toBe('');
  });

  it('resolveSourceForTable: bare → the cbs entry; unknown prefix → cbs fallback (A1 display direction)', () => {
    expect(resolveSourceForTable('82235NED')).toBe(SOURCES[CBS_SOURCE_KEY]);
    expect(resolveSourceForTable('nonexistent:x')).toBe(SOURCES[CBS_SOURCE_KEY]);
  });
});

describe('WP30b: isProvisionalStatus (the ONE provisional rule, registry-driven)', () => {
  const cbs = resolveSource(undefined);

  it('byte-identical to the old status !== \'Definitief\' for every CBS status', () => {
    expect(isProvisionalStatus(cbs, 'Definitief')).toBe(false);
    expect(isProvisionalStatus(cbs, 'Voorlopig')).toBe(true);
    expect(isProvisionalStatus(cbs, 'NaderVoorlopig')).toBe(true);
  });

  it('fail-safe direction: an unknown status is MARKED provisional, never silently definitive', () => {
    expect(isProvisionalStatus(cbs, 'Onbekend')).toBe(true);
    expect(isProvisionalStatus(cbs, '')).toBe(true);
  });

  it('is genuinely registry-driven: a source with definitiveStatuses [\'Final\'] marks \'Definitief\' provisional', () => {
    const fake = fakeSourceInfo({ definitiveStatuses: ['Final'] });
    expect(isProvisionalStatus(fake, 'Final')).toBe(false);
    expect(isProvisionalStatus(fake, 'Definitief')).toBe(true);
  });
});

describe('display builders are byte-identical for cbs vs absent source (A1)', () => {
  function results(): { withSource: ReturnType<typeof makeResult>; withoutSource: ReturnType<typeof makeResult> } {
    const cell = () =>
      makeCell({
        table: '82235NED', measure: 'D002936', measureTitle: 'Beginstand voorraad',
        region: null, periodCode: '2024JJ00', periodLabel: '2024', value: 8204, unit: 'x 1 000',
        status: 'NaderVoorlopig',
      });
    const withSource = makeResult({ shape: 'single', definitionLabel: 'woningvoorraad per 1 januari', cells: [cell()] });
    withSource.attribution.source = 'cbs';
    const withoutSource = makeResult({ shape: 'single', definitionLabel: 'woningvoorraad per 1 januari', cells: [cell()] });
    delete withoutSource.attribution.source;
    return { withSource, withoutSource };
  }

  it('attribution line: identical bytes, exactly the pre-WP30a form', () => {
    const { withSource, withoutSource } = results();
    const line = buildAttributionLine(withoutSource);
    expect(line).toBe(buildAttributionLine(withSource));
    expect(line).toBe(
      'Bron: CBS StatLine, tabel 82235NED — Testtabel; kerncijfers. ' +
        'Gegevens gesynchroniseerd op 2026-07-02. Periode: 2024. Licentie: CC BY 4.0.',
    );
  });

  it('template body (two-tier provisional suffix from the registry): identical bytes', () => {
    const { withSource, withoutSource } = results();
    const body = renderTemplateBody(withoutSource);
    expect(body).toBe(renderTemplateBody(withSource));
    expect(body).toContain('(x 1 000) (nader voorlopig cijfer)');
  });

  it('chart null-note: identical bytes, the exact pre-WP30a "(CBS)" form', () => {
    const series = (source: string | undefined) => {
      const cells = [
        makeCell({ periodCode: '2023JJ00', periodLabel: '2023', value: 5, unit: 'aantal' }),
        makeCell({ periodCode: '2024JJ00', periodLabel: '2024', value: null, unit: 'aantal', valueAttribute: 'Confidential' }),
      ];
      const result = makeResult({ shape: 'series', cells });
      if (source === undefined) delete result.attribution.source;
      else result.attribution.source = source;
      return buildChartSpec(result)!;
    };
    expect(series(undefined).nullNotes).toEqual(['Geen waarde voor 2024: Confidential (CBS).']);
    expect(series('cbs').nullNotes).toEqual(series(undefined).nullNotes);
  });
});
