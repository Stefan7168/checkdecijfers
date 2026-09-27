import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, it } from 'vitest';
import { ReplayLlmClient, stableStringify } from '../../src/answer/llm/client.ts';
import type { LlmClient, LlmResponse } from '../../src/answer/llm/client.ts';
import { respondToQuestion, respondToClarificationReply } from '../../src/answer/respond/index.ts';
import type { RawParse } from '../../src/answer/intent/types.ts';
import { createIngestedDb } from '../helpers/ingested-db.ts';
import { loadLabelledSet } from '../helpers/intent-expectations.ts';
import type { Db } from '../../src/db/types.ts';

const INTENT = fileURLToPath(new URL('../fixtures/llm/intent', import.meta.url));
const ANSWER = fileURLToPath(new URL('../fixtures/llm/answer', import.meta.url));
const set = loadLabelledSet();
let db: Db; let close: () => Promise<void>;
beforeAll(async () => { ({ db, close } = await createIngestedDb()); }, 300_000);
afterAll(async () => { await close(); });

class Canned implements LlmClient {
  constructor(private raw: unknown) {}
  async complete(): Promise<LlmResponse> {
    return { outputText: JSON.stringify(this.raw), model: 'stub', stopReason: 'end_turn', usage: { inputTokens: 0, outputTokens: 0 } };
  }
}
class Throwing implements LlmClient { async complete(): Promise<LlmResponse> { throw new Error('no llm'); } }
function raw(kind: string, cands: Record<string, unknown>[], unmatched: string | null = null, nearest: string[] = []): RawParse {
  return { version: 4, kind, candidates: cands.map((c) => ({ regionScope: null, ...c })), unmatchedMeasureTerm: unmatched, nearestCanonicalKeys: nearest, note: null } as never;
}
const c = (o: Record<string, unknown>) => ({ canonicalKey: 'population_on_1_january', regions: [{ name: 'Amsterdam', kind: 'gemeente' }], period: { kind: 'year', year: 2024 }, derivation: 'none', confidence: 0.95, reading: 'bevolking van Amsterdam in 2024', ...o });
const CANNED: Record<string, RawParse> = {
  utrecht: raw('data_query', [c({ regions: [{ name: 'Utrecht', kind: 'onbekend' }], reading: 'bevolking van Utrecht in 2024' })]),
  rule3: raw('data_query', [c({ confidence: 0.7 })]),
  rule4: raw('data_query', [c({}), c({ period: { kind: 'year', year: 2023 }, confidence: 0.6, reading: 'bevolking van Amsterdam in 2023' })]),
  rule4b: raw('data_query', [c({ regions: [{ name: 'Utrecht', kind: 'gemeente' }], reading: 'bevolking van de gemeente Utrecht in 2024' }), c({ reading: 'bevolking van Amsterdam in 2024', confidence: 0.9 })]),
  unmatched: raw('data_query', [], 'bijstand', ['unemployment_rate', 'population_on_1_january']),
  unmatchedNone: raw('data_query', [], 'bijstand', []),
  forecast: raw('forecast_request', []),
  causal: raw('causal_question', []),
  oos: raw('out_of_scope', []),
  compound: raw('compound', []),
  small: raw('smalltalk_or_other', []),
  noRegion: raw('data_query', [c({ regions: null, reading: 'bevolking in 2024, regio onbekend' })]),
  future: raw('data_query', [c({ period: { kind: 'year', year: 2099 } })]),
  ancient: raw('data_query', [c({ period: { kind: 'year', year: 1850 } })]),
  unknownRegion: raw('data_query', [c({ regions: [{ name: 'Atlantis', kind: 'gemeente' }] })]),
  natRegion: raw('data_query', [c({ canonicalKey: 'cpi_inflation_yoy', regions: [{ name: 'Amsterdam', kind: 'gemeente' }], period: { kind: 'year', year: 2024 } })]),
  badKey: raw('data_query', [c({ canonicalKey: 'nonexistent_key' })]),
  monthly: raw('data_query', [c({ canonicalKey: 'cpi_inflation_yoy', regions: null, period: { kind: 'month', year: 2030, month: 3 } })]),
  lowconf: raw('data_query', [c({ confidence: 0.3 })]),
};

it('dump', async () => {
  const out: Record<string, string> = {};
  const put = (k: string, r: unknown) => {
    out[k] = stableStringify(r);
    const en = r as { english?: unknown };
    out[`${k}#hasEnglish`] = String('english' in (en as object));
  };
  const strip = (r: unknown) => { const { english: _e, ...rest } = r as Record<string, unknown>; return rest; };
  for (const cs of set.cases) {
    for (const click of [false, true]) {
      const base = { intentClient: new ReplayLlmClient(INTENT), answerClient: new ReplayLlmClient(ANSWER), referenceDate: set.referenceDate, clickOptionsEnabled: click };
      const r = await respondToQuestion(db, cs.question, base);
      if (r.kind === 'answer') continue;
      put(`L:${cs.id}:${click}:none`, r);
      const rn = await respondToQuestion(db, cs.question, { ...base, lang: 'nl' } as never);
      put(`L:${cs.id}:${click}:nl`, rn);
      const re = await respondToQuestion(db, cs.question, { ...base, lang: 'en' } as never);
      out[`L:${cs.id}:${click}:enStripped`] = stableStringify(strip(re));
      out[`L:${cs.id}:${click}:enRaw`] = stableStringify(re);
    }
  }
  for (const [name, rp] of Object.entries(CANNED)) {
    for (const click of [false, true]) {
      for (const q of ['Hoeveel inwoners had Utrecht in 2024?', 'Wat is de meest recente bevolking?']) {
        const base = { intentClient: new Canned(rp), answerClient: new Throwing(), referenceDate: '2026-08-15', clickOptionsEnabled: click };
        const r = await respondToQuestion(db, q, base);
        if (r.kind === 'answer') { out[`C:${name}:${click}:${q}:kind`] = 'answer'; continue; }
        put(`C:${name}:${click}:${q}:none`, r);
        const re = await respondToQuestion(db, q, { ...base, lang: 'en' } as never);
        out[`C:${name}:${click}:${q}:enStripped`] = stableStringify(strip(re));
        out[`C:${name}:${click}:${q}:enRaw`] = stableStringify(re);
        // reply paths
        if (r.kind === 'clarification') {
          const replies: [string, LlmClient][] = [
            ['take0', new Throwing()],
            ['againClar', new Canned(CANNED.utrecht)],
            ['noRegion', new Canned(CANNED.noRegion)],
            ['forecast', new Canned(CANNED.forecast)],
            ['small', new Canned(CANNED.small)],
            ['future', new Canned(CANNED.future)],
            ['throw', new Throwing()],
          ];
          for (const [rn, cli] of replies) {
            const reply = rn === 'take0' ? (r.pending.clickOptions?.[0]?.label ?? r.options[0] ?? 'x') : 'iets anders';
            const ropts = { intentClient: cli, answerClient: new Throwing(), referenceDate: '2026-08-15', clickOptionsEnabled: click };
            const rr = await respondToClarificationReply(db, r.pending, reply, ropts);
            if (rr.kind !== 'answer') put(`R:${name}:${click}:${q}:${rn}:none`, rr); else out[`R:${name}:${click}:${q}:${rn}:kind`] = 'answer';
            const rre = await respondToClarificationReply(db, r.pending, reply, { ...ropts, lang: 'en' } as never);
            if (rre.kind !== 'answer') { out[`R:${name}:${click}:${q}:${rn}:enStripped`] = stableStringify(strip(rre)); out[`R:${name}:${click}:${q}:${rn}:enRaw`] = stableStringify(rre); }
          }
        }
        if (r.kind === 'refusal' && (r as { pending?: { clickOptions?: { label: string }[] } }).pending) {
          const p = (r as never as { pending: never }).pending as { clickOptions: { label: string }[] };
          const ropts = { intentClient: new Throwing(), answerClient: new Throwing(), referenceDate: '2026-08-15', clickOptionsEnabled: click };
          const rr = await respondToClarificationReply(db, p as never, p.clickOptions[0]!.label, ropts);
          out[`RESCUE:${name}:${click}:${q}`] = stableStringify(rr);
        }
      }
    }
  }
  writeFileSync(process.env.SCRATCH_OUT!, JSON.stringify(out, null, 1));
}, 600_000);
