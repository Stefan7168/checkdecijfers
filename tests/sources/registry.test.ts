// WP30a (ADR 030 D3 + A1/A2/A6): the source registry — golden-string pins
// proving the consolidation is byte-identical to the pre-WP30a literals, for
// the 'cbs' key AND for an absent source (every pre-WP30a stored row).
import { describe, expect, it } from 'vitest';
import {
  CBS_SOURCE_KEY,
  EUROSTAT_SOURCE_KEY,
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

describe('WP30c/E1 (ADR 048 D6/D7, Amendment B1): the eurostat registry entry', () => {
  it('resolveSource returns the registered eurostat entry, not the cbs fallback', () => {
    const eurostat = resolveSource(EUROSTAT_SOURCE_KEY);
    expect(eurostat).toBe(SOURCES[EUROSTAT_SOURCE_KEY]);
    expect(eurostat).not.toBe(SOURCES[CBS_SOURCE_KEY]);
    expect(eurostat.displayName).toBe('Eurostat');
    expect(eurostat.attributionLabel).toBe('Eurostat');
    expect(eurostat.license).toBe('CC BY 4.0');
  });

  it('sourceKeyForTableId/resolveSourceForTable route an eurostat: id to the eurostat entry', () => {
    expect(sourceKeyForTableId('eurostat:demo_test')).toBe(EUROSTAT_SOURCE_KEY);
    expect(resolveSourceForTable('eurostat:demo_test')).toBe(SOURCES[EUROSTAT_SOURCE_KEY]);
  });

  it('deep link strips the eurostat: prefix down to the bare native id', () => {
    const eurostat = resolveSource(EUROSTAT_SOURCE_KEY);
    expect(eurostat.deepLink!('eurostat:demo_test')).toBe(
      'https://ec.europa.eu/eurostat/databrowser/view/demo_test/default/table',
    );
  });

  it('deep link is generic over the first colon only — a multi-colon native id keeps its remaining colons', () => {
    const eurostat = resolveSource(EUROSTAT_SOURCE_KEY);
    expect(eurostat.deepLink!('eurostat:demo:test')).toBe(
      'https://ec.europa.eu/eurostat/databrowser/view/demo:test/default/table',
    );
  });

  it('Amendment B1: empty definitiveStatuses makes isProvisionalStatus return true unconditionally', () => {
    const eurostat = resolveSource(EUROSTAT_SOURCE_KEY);
    expect(eurostat.definitiveStatuses).toEqual([]);
    // Every status string — flagged, unflagged, empty, or unrecognized —
    // must come back provisional. This is the safe-direction behavior the
    // empty list exists to guarantee, since pipeline.ts has no per-cell
    // status path for Eurostat's per-cell flags (only a per-period one).
    for (const status of ['', 'p', 'e', 's', 'f', 'b', 'c', 'd', 'u', 'n', 'anything-unrecognized']) {
      expect(isProvisionalStatus(eurostat, status)).toBe(true);
    }
  });

  it('D6 null-reason labels are registered for the : / c / z flags', () => {
    const eurostat = resolveSource(EUROSTAT_SOURCE_KEY);
    expect(eurostat.nullReasonLabels[':']).toBeTruthy();
    expect(eurostat.nullReasonLabels['c']).toBeTruthy();
    expect(eurostat.nullReasonLabels['z']).toBeTruthy();
  });

  it('Constraint 0: currentCatalogStatuses ships empty, pending a live catalog capture', () => {
    expect(resolveSource(EUROSTAT_SOURCE_KEY).currentCatalogStatuses).toEqual([]);
  });

  // Integration fix (found in this brief's own whole-branch pass, not by
  // either adversarial review round): chatSelectable is the ONLY thing
  // keeping this registered-but-dormant source out of the live chat chip
  // UI (web/components/chat.tsx) and out of the server's untrusted-payload
  // validator (web/app/actions.ts's validateSelection) — see chatSelectable's
  // own doc comment on SourceInfo for why it is load-bearing, not decorative.
  it('D3(b)/(c): chatSelectable is false — CBS stays the only chat-selectable source in E1', () => {
    expect(resolveSource(EUROSTAT_SOURCE_KEY).chatSelectable).toBe(false);
    expect(resolveSource(CBS_SOURCE_KEY).chatSelectable).toBe(true);
  });
});

describe('WP30c/E1 Task 6 (ADR 048 D7(a)): buildAttributionLine for a eurostat-sourced row', () => {
  function eurostatResult(doi: string | undefined): ReturnType<typeof makeResult> {
    const cell = makeCell({
      table: 'eurostat:tps00001', measure: 'M1', measureTitle: 'Testmaat',
      region: null, periodCode: '2024JJ00', periodLabel: '2024', value: 4.2, unit: '%', decimals: 1,
    });
    const result = makeResult({ shape: 'single', cells: [cell] });
    result.attribution.source = EUROSTAT_SOURCE_KEY;
    if (doi !== undefined) result.attribution.doi = doi;
    return result;
  }

  it('a eurostat row WITH a doi renders the D7(a) dataset/DOI sentence verbatim', () => {
    const line = buildAttributionLine(eurostatResult('10.2908/TPS00001'));
    expect(line).toBe(
      'Bron: Eurostat, dataset tps00001 — Testtabel; kerncijfers (DOI 10.2908/TPS00001). ' +
        'Gegevens gesynchroniseerd op 2026-07-02. Licentie: CC BY 4.0.',
    );
  });

  it('a eurostat row WITHOUT a doi still renders the Eurostat sentence, minus the (DOI ...) clause — never throws', () => {
    const line = buildAttributionLine(eurostatResult(undefined));
    expect(line).toBe(
      'Bron: Eurostat, dataset tps00001 — Testtabel; kerncijfers. ' +
        'Gegevens gesynchroniseerd op 2026-07-02. Licentie: CC BY 4.0.',
    );
    expect(line).not.toContain('DOI');
  });

  it('a non-eurostat (cbs) row ignores a stray doi value and renders the ordinary CBS-shaped sentence, byte-identical', () => {
    const cell = makeCell({
      table: '82235NED', measure: 'D002936', measureTitle: 'Beginstand voorraad',
      region: null, periodCode: '2024JJ00', periodLabel: '2024', value: 8204, unit: 'x 1 000',
    });
    const result = makeResult({ shape: 'single', cells: [cell] });
    result.attribution.source = 'cbs';
    // A doi should never exist on a real CBS row (migration 032: NULL for
    // every CBS row forever) — this proves the source check, not the doi
    // check, gates which sentence renders, in case a stray value ever got
    // written by mistake.
    result.attribution.doi = '10.0000/should-be-ignored';
    expect(buildAttributionLine(result)).toBe(
      'Bron: CBS StatLine, tabel 82235NED — Testtabel; kerncijfers. ' +
        'Gegevens gesynchroniseerd op 2026-07-02. Periode: 2024. Licentie: CC BY 4.0.',
    );
  });
});
