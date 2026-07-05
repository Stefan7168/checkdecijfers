// Stage-2 rerank validator (the hard allowlist — the principle-(c) backstop)
// and the prompt serializer. No LLM: validateRerankOutput is exercised with
// crafted model-output strings, which is exactly what it must defend against.
import { describe, expect, it } from 'vitest';
import {
  RerankValidationError,
  RERANK_SCHEMA_VERSION,
  rerankJsonSchema,
  validateRerankOutput,
} from '../../src/catalog/rerank-schema.ts';
import { serializeShortlist, buildRerankSystemPrompt } from '../../src/catalog/rerank-prompt.ts';
import type { CatalogCandidate } from '../../src/catalog/types.ts';

const SHORTLIST = ['85773NED', '81884NED', '03759ned'];

function out(fields: Record<string, unknown>): string {
  return JSON.stringify({ version: RERANK_SCHEMA_VERSION, ...fields });
}

describe('validateRerankOutput', () => {
  it('accepts a well-formed pick and returns the validated result', () => {
    const r = validateRerankOutput(
      out({ tableId: '85773NED', confidence: 0.91, reading: 'Koopwoningprijzen.', alternativeIds: [] }),
      SHORTLIST,
    );
    expect(r).toEqual({
      tableId: '85773NED',
      confidence: 0.91,
      reading: 'Koopwoningprijzen.',
      alternativeIds: [],
    });
  });

  it('THROWS when the picked id is not in the shortlist (the hard allowlist)', () => {
    expect(() =>
      validateRerankOutput(
        out({ tableId: '00000INVENTED', confidence: 0.99, reading: 'x', alternativeIds: [] }),
        SHORTLIST,
      ),
    ).toThrow(RerankValidationError);
    expect(() =>
      validateRerankOutput(
        out({ tableId: '00000INVENTED', confidence: 0.99, reading: 'x', alternativeIds: [] }),
        SHORTLIST,
      ),
    ).toThrow(/NOT in the shortlist/);
  });

  it('is casing-strict on the picked id (85773ned != 85773NED)', () => {
    expect(() =>
      validateRerankOutput(
        out({ tableId: '85773ned', confidence: 0.9, reading: 'x', alternativeIds: [] }),
        SHORTLIST,
      ),
    ).toThrow(RerankValidationError);
  });

  it('throws on invalid JSON', () => {
    expect(() => validateRerankOutput('{not json', SHORTLIST)).toThrow(/not valid JSON/);
  });

  it('throws on a schema violation (wrong version, missing field, extra field)', () => {
    expect(() =>
      validateRerankOutput(
        JSON.stringify({ version: 2, tableId: '85773NED', confidence: 0.9, reading: 'x', alternativeIds: [] }),
        SHORTLIST,
      ),
    ).toThrow(/schema/);
    expect(() =>
      validateRerankOutput(out({ tableId: '85773NED', confidence: 0.9, reading: 'x' }), SHORTLIST),
    ).toThrow(/schema/);
    expect(() =>
      validateRerankOutput(
        out({ tableId: '85773NED', confidence: 0.9, reading: 'x', alternativeIds: [], extra: 1 }),
        SHORTLIST,
      ),
    ).toThrow(/schema/);
  });

  it('throws when confidence is outside 0..1', () => {
    for (const c of [1.5, -0.1]) {
      expect(() =>
        validateRerankOutput(out({ tableId: '85773NED', confidence: c, reading: 'x', alternativeIds: [] }), SHORTLIST),
      ).toThrow(/outside 0\.\.1/);
    }
  });

  it('sanitizes alternativeIds: drops invented ids, the pick itself, and duplicates; keeps order', () => {
    const r = validateRerankOutput(
      out({
        tableId: '85773NED',
        confidence: 0.4,
        reading: 'onzeker',
        alternativeIds: ['81884NED', 'INVENTED', '85773NED', '03759ned', '03759ned'],
      }),
      SHORTLIST,
    );
    expect(r.alternativeIds).toEqual(['81884NED', '03759ned']);
  });
});

describe('rerankJsonSchema', () => {
  it('is a strict object over the five output fields', () => {
    const schema = rerankJsonSchema() as {
      type: string;
      properties: Record<string, unknown>;
      required: string[];
      additionalProperties: boolean;
    };
    expect(schema.type).toBe('object');
    expect(Object.keys(schema.properties).sort()).toEqual(
      ['alternativeIds', 'confidence', 'reading', 'tableId', 'version'].sort(),
    );
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(expect.arrayContaining(['version', 'tableId', 'confidence', 'reading', 'alternativeIds']));
  });
});

describe('serializeShortlist', () => {
  const shortlist: CatalogCandidate[] = [
    { tableId: '85773NED', title: 'Bestaande koopwoningen; verkoopprijzen', summary: 'Prijsindex.', status: 'Regulier', datasetType: 'Numeric', rank: 0.5 },
    { tableId: '81884NED', title: 'Oude reeks', summary: 'x'.repeat(400), status: 'Gediscontinueerd', datasetType: 'Numeric', rank: 0.4 },
  ];

  it('lists every candidate id, title, status and type with the topic', () => {
    const payload = serializeShortlist('huizenprijzen', shortlist);
    expect(payload).toContain('Onderwerp van de gebruiker: "huizenprijzen"');
    expect(payload).toContain('id=85773NED');
    expect(payload).toContain('status=Regulier');
    expect(payload).toContain('type=Numeric');
    expect(payload).toContain('Bestaande koopwoningen; verkoopprijzen');
    expect(payload).toContain('id=81884NED');
    expect(payload).toContain('status=Gediscontinueerd');
  });

  it('truncates a long description with an ellipsis (token budget)', () => {
    const payload = serializeShortlist('x', shortlist);
    expect(payload).toContain('…');
    // no single omschrijving line longer than the budget + a little framing
    const longest = Math.max(...payload.split('\n').map((l) => l.length));
    expect(longest).toBeLessThan(300);
  });

  it('the system prompt forbids inventing ids and prefers current tables', () => {
    const sys = buildRerankSystemPrompt();
    expect(sys).toMatch(/Verzin nooit een id/);
    expect(sys).toMatch(/Regulier/);
  });
});
