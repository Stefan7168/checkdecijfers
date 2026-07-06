// WP7 template + assembly tests: the fail-closed template must pass the
// validator BY CONSTRUCTION for every result shape (a template that fails its
// own validator would leave the pipeline with no safe floor), and the
// structural lines (R4 attribution, R5 marking, definition transparency) must
// render exactly when required.
import { describe, expect, it } from 'vitest';
import type { ValidatedResult } from '../../src/query/index.ts';
import { DERIVED_DATA_MARKING } from '../../src/query/index.ts';
import {
  composeAnswer,
  renderTemplateBody,
  validateAnswerBody,
} from '../../src/answer/compose/index.ts';
import { displayValueUnit } from '../../src/answer/compose/template.ts';
import { buildDefinitionLine } from '../../src/answer/compose/format.ts';
import type { LlmClient, LlmRequest, LlmResponse } from '../../src/answer/llm/client.ts';
import {
  cpiSeries,
  g4Max,
  housingSingle,
  incomeSingle,
  inflationDrop,
  nullCellSingle,
  populationComparison,
  populationDifference,
  populationSingle,
  solarSingle,
  unemploymentSingle,
} from '../helpers/synthetic-results.ts';

const SHAPES: [string, ValidatedResult][] = [
  ['single population', populationSingle],
  ['single percent', unemploymentSingle],
  ['single factor unit', housingSingle],
  ['single provisional', solarSingle],
  ['single 1000-euro unit', incomeSingle],
  ['null cell', nullCellSingle],
  ['series', cpiSeries()],
  ['comparison', populationComparison()],
  ['difference', populationDifference()],
  ['percent difference (negative)', inflationDrop()],
  ['max', g4Max()],
];

/** A client that always fabricates — drives composeAnswer down the full
 * fail-closed ladder. This fakes OUR failure path, not model accuracy
 * (ADR 012's record/replay covers real model behavior; docs/05 R3 explicitly
 * calls for seeded-mismatch unit tests of the guard mechanics). */
class FabricatingClient implements LlmClient {
  calls: LlmRequest[] = [];
  async complete(request: LlmRequest): Promise<LlmResponse> {
    this.calls.push(request);
    return {
      outputText: 'Nederland telde vorig jaar ongeveer 99 miljoen inwoners.',
      model: 'fake',
      stopReason: 'end_turn',
      usage: { inputTokens: 10, outputTokens: 10 },
    };
  }
}

class ThrowingClient implements LlmClient {
  calls = 0;
  async complete(): Promise<LlmResponse> {
    this.calls += 1;
    throw new Error('api unreachable');
  }
}

describe('template renders a validator-clean body for every shape (the safe floor)', () => {
  for (const [name, result] of SHAPES) {
    it(`${name}`, () => {
      const body = renderTemplateBody(result);
      const report = validateAnswerBody(body, result);
      expect(report.problems, `template body: ${body}\n${report.problems.join('\n')}`).toEqual([]);
    });
  }
});

describe('template content', () => {
  it('states the null reason instead of a bare gap (R11)', () => {
    const body = renderTemplateBody(nullCellSingle);
    expect(body).toContain('geen waarde');
    expect(body).toContain('kan volgens CBS niet voorkomen');
  });

  it('marks provisional values (R11)', () => {
    expect(renderTemplateBody(solarSingle)).toContain('voorlopig cijfer');
  });

  it('names the ranking winner and full ranking for max (R9)', () => {
    const body = renderTemplateBody(g4Max());
    expect(body).toContain('Amsterdam');
    expect(body).toContain('934.526');
    expect(body).toContain("'s-Gravenhage");
  });

  it('uses procentpunt for a difference over %-levels (R10)', () => {
    const body = renderTemplateBody(inflationDrop());
    expect(body).toContain('procentpunt');
    expect(body).toContain('afname');
  });
});

describe('fail-closed composition (R3 ladder)', () => {
  it('falls back to the template after exactly one regeneration on persistent fabrication', async () => {
    const client = new FabricatingClient();
    const answer = await composeAnswer(populationSingle, { client });
    expect(client.calls).toHaveLength(2);
    expect(answer.source).toBe('template');
    expect(answer.attempts).toHaveLength(2);
    expect(answer.attempts.every((a) => !a.ok)).toBe(true);
    expect(answer.validation.ok).toBe(true);
    expect(answer.body).toContain('18.044.027');
    // The retry prompt is the stricter variant, not a repeat of the first.
    expect(client.calls[1]!.system).not.toBe(client.calls[0]!.system);
    expect(client.calls[1]!.system).toContain('STRENGER');
  });

  it('falls back to the template when the LLM path errors (refusal, network)', async () => {
    const client = new ThrowingClient();
    const answer = await composeAnswer(populationSingle, { client });
    expect(answer.source).toBe('template');
    expect(answer.attempts.map((a) => a.error)).toEqual(['api unreachable', 'api unreachable']);
    expect(answer.validation.ok).toBe(true);
  });

  it('never calls the LLM for results with null cells — the reason is stated deterministically', async () => {
    const client = new FabricatingClient();
    const answer = await composeAnswer(nullCellSingle, { client });
    expect(client.calls).toHaveLength(0);
    expect(answer.source).toBe('template');
    expect(answer.body).toContain('kan volgens CBS niet voorkomen');
  });
});

describe('structural lines (assembled, never LLM-written)', () => {
  it('R4: attribution with table ID, title, sync date, covered period, license — on every answer', async () => {
    for (const [, result] of SHAPES) {
      const answer = await composeAnswer(result, { client: new ThrowingClient() });
      expect(answer.attributionLine).toContain(result.attribution.tableId);
      expect(answer.attributionLine).toContain(result.attribution.tableTitle);
      expect(answer.attributionLine).toContain(result.attribution.syncedAt.slice(0, 10));
      expect(answer.attributionLine).toContain('Licentie: CC BY 4.0');
      expect(answer.text).toContain(answer.attributionLine);
    }
  });

  it('R5: the CC BY derived-data marking renders exactly when the result carries derivation records', async () => {
    const withDerivations = [cpiSeries(), populationComparison(), populationDifference(), g4Max()];
    for (const result of withDerivations) {
      const answer = await composeAnswer(result, { client: new ThrowingClient() });
      expect(answer.markingLine).toContain(DERIVED_DATA_MARKING);
      expect(answer.text).toContain(DERIVED_DATA_MARKING);
    }
    const answer = await composeAnswer(populationSingle, { client: new ThrowingClient() });
    expect(answer.markingLine).toBeNull();
    expect(answer.text).not.toContain(DERIVED_DATA_MARKING);
  });

  it('states the chosen canonical definition transparently (docs/05 canonical defaults)', async () => {
    const answer = await composeAnswer(unemploymentSingle, { client: new ThrowingClient() });
    expect(answer.definitionLine).toBe('Definitie: werkloosheidspercentage, seizoengecorrigeerd.');
    expect(answer.text).toContain('werkloosheidspercentage, seizoengecorrigeerd');
  });

  it('suppresses a CIRCULAR definition line — onboarded case, definitionLabel === the measure title (#115)', async () => {
    // On-demand onboarded measures store the CBS measure title AS the
    // definitionLabel (src/ingestion/onboarding-vocab.ts) — rendering it as a
    // "Definitie:" just repeats the name and reads as broken. The title is
    // already in the source line, so the circular line must be dropped.
    const circular: ValidatedResult = {
      ...populationSingle,
      attribution: {
        ...populationSingle.attribution,
        definitionLabel: populationSingle.cells[0]!.measureTitle,
      },
    };
    const answer = await composeAnswer(circular, { client: new ThrowingClient() });
    expect(answer.definitionLine).toBeNull();
    expect(answer.text).not.toContain('Definitie:');
  });

  it('KEEPS a seed definition that differs from its title only in CASE (case-sensitivity is load-bearing)', async () => {
    // populationSingle: definitionLabel 'bevolking op 1 januari' vs measureTitle
    // 'Bevolking op 1 januari' — a case-INsensitive circular test would wrongly
    // drop this real seed line. The suppression must compare case-sensitively.
    const answer = await composeAnswer(populationSingle, { client: new ThrowingClient() });
    expect(answer.definitionLine).toBe('Definitie: bevolking op 1 januari.');
  });

  it('renders the REAL CBS definition (attribution.definitionText) as the Definitie line — onboarded quality (#115 lever b)', async () => {
    const def =
      'Het consumentenvertrouwen is een indicator van het vertrouwen van consumenten. ' +
      'De indicator kan een waarde aannemen van -100 tot +100.';
    const onboarded: ValidatedResult = {
      ...populationSingle,
      attribution: { ...populationSingle.attribution, definitionText: def },
    };
    const answer = await composeAnswer(onboarded, { client: new ThrowingClient() });
    expect(answer.definitionLine).toBe(`Definitie: ${def}`);
    // the scale — the exact context that was missing — is now in the answer.
    expect(answer.text).toContain('-100 tot +100');
  });

  it('the real definition WINS over a circular definitionLabel (definitionText priority, #115 b beats a)', async () => {
    const onboarded: ValidatedResult = {
      ...populationSingle,
      attribution: {
        ...populationSingle.attribution,
        definitionLabel: populationSingle.cells[0]!.measureTitle, // would be circular
        definitionText: 'Aantal inwoners op 1 januari van het jaar.',
      },
    };
    const answer = await composeAnswer(onboarded, { client: new ThrowingClient() });
    expect(answer.definitionLine).toBe('Definitie: Aantal inwoners op 1 januari van het jaar.');
  });

  it('appends a terminal period to a definition blurb that lacks one (never alters CBS words)', async () => {
    const onboarded: ValidatedResult = {
      ...populationSingle,
      attribution: { ...populationSingle.attribution, definitionText: 'Aantal inwoners op 1 januari' },
    };
    const answer = await composeAnswer(onboarded, { client: new ThrowingClient() });
    expect(answer.definitionLine).toBe('Definitie: Aantal inwoners op 1 januari.');
  });
});

describe('buildDefinitionLine — single source of truth shared by compose + audit-reconstruct (#115 review)', () => {
  // compose.ts BUILDS the "Definitie:" line and audit/reconstruct.ts RE-DERIVES
  // it for R8 verification, both via THIS function — so they cannot drift (the
  // review caught reconstruct using the old, definitionText-blind logic).
  it('prefers a real CBS definition (definitionText), with a terminal period ensured', () => {
    const r: ValidatedResult = {
      ...populationSingle,
      attribution: { ...populationSingle.attribution, definitionText: 'Aantal inwoners op 1 januari' },
    };
    expect(buildDefinitionLine(r)).toBe('Definitie: Aantal inwoners op 1 januari.');
  });
  it('falls back to the seed definitionLabel when there is no definitionText', () => {
    expect(buildDefinitionLine(unemploymentSingle)).toBe('Definitie: werkloosheidspercentage, seizoengecorrigeerd.');
  });
  it('suppresses a circular label (== the measure title) and yields null', () => {
    const r: ValidatedResult = {
      ...populationSingle,
      attribution: { ...populationSingle.attribution, definitionLabel: populationSingle.cells[0]!.measureTitle },
    };
    expect(buildDefinitionLine(r)).toBeNull();
  });
});

describe('displayValueUnit — #115 lever c: long descriptive units set off in parentheses', () => {
  it('parenthesizes a 3+-word descriptive unit phrase (the onboarded run-on)', () => {
    expect(displayValueUnit(-24, 0, 'gemiddelde saldo van de deelvragen')).toBe(
      '-24 (gemiddelde saldo van de deelvragen)',
    );
  });

  it('leaves short units bare — no Phase-0/seed regression', () => {
    expect(displayValueUnit(3.3, 1, '%')).toBe('3,3%');
    expect(displayValueUnit(1000, 0, 'aantal')).toBe('1.000');
    expect(displayValueUnit(450, 0, 'euro')).toBe('450 euro');
    expect(displayValueUnit(120, 0, 'mln kWh')).toBe('120 mln kWh'); // 2 words → bare
  });

  it('keeps factor units (with digits) in the existing factor-paren form, not the descriptive branch', () => {
    expect(displayValueUnit(8204, 0, 'x 1 000')).toBe('8.204 (x 1 000)');
    expect(displayValueUnit(57, 0, '1 000 euro')).toBe('57 (× 1 000 euro)');
  });
});
