# English Answers Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A reader on the English interface gets a regular CBS answer (body, structural lines, staleness warning, follow-up chips) in English, with numbers made unrepresentable to the translating model, the Dutch path byte-identical, and the English text reconstructable under R8.

**Architecture:** A new `src/answer/translate/` sub-module runs after the Dutch answer is composed and validated and before the audit write (`src/answer/audit/respond-audited.ts`), mirroring how `attachWebAugmentation` is injected: absent client ⇒ zero translate machinery. It masks period labels, provisional markers and every numeric token to digit-free placeholders, sends one JSON request to the phrasing model, gates the output with deterministic checks, fills placeholders back in English notation, and builds hand-written English structural lines. The result rides the existing audit row as `response.english`; the web shows it when verified.

**Tech Stack:** TypeScript (Node 24, `node --experimental-strip-types` style `.ts` imports), vitest, Next.js App Router (web/), the existing `LlmClient` seam (`src/answer/llm/client.ts`).

**Spec:** [docs/superpowers/specs/2026-09-25-english-answers-design.md](../specs/2026-09-25-english-answers-design.md) · ADR [058](../../decisions/058-english-answers.md)

## Global Constraints

- **Dutch path byte-identical.** With `lang` absent/`'nl'` or no translate client, `answerQuestionAudited` / `answerClarificationReplyAudited` return the SAME response object and write the SAME audit row as today. No Dutch prompt, validator behaviour, fixture, benchmark task or `final_text` changes. Every existing test must pass unmodified.
- **Numbers never reach the model.** The masked text sent to the model contains no `\p{Nd}` character outside placeholders; placeholder ids use letters only (`⟦Na⟧`, `⟦Pb⟧`, `⟦Cc⟧`), never digits.
- **Fail closed to Dutch.** Any translate failure (model error, check failure after one retry, a digit surviving masking) yields `status: 'fallback'`; it never throws out of `attachEnglish` and never changes the Dutch answer.
- **No migration, no new secret, no price change.** English rides `audit_answers.response` jsonb as `response.english` (present only when translation was attempted — A1 envelope rule: absent key on every other row).
- **Flag:** web wires translation only when `process.env.ENGLISH_ANSWERS_ENABLED === '1'` AND `getLang() === 'en'`. The flag stays unset in Production until the owner-supervised go-live after 2026-10-01.
- **No live model spend in this build.** Tests use stub `LlmClient`s; `translate:record` exists but is only run owner-supervised after the cap lifts.
- **Module boundary:** new code lives in `src/answer/translate/` and `src/registry/english-names.ts` (ADR 001). English for code/comments. Product copy follows `web/lib/i18n/messages.ts` (`nl` + `en` entries).
- **Verification block before push:** `scripts/verify-block.sh <dir> <log> --e2e` solo on the 8 GB machine (check `sysctl vm.swapusage`), `/code-review` LOW, `npm run audit:verify` (validator-adjacent change), green CI. Autonomous session ⇒ branch + PR, merged on the owner's plain-English GO.

## File Structure

| File | Responsibility |
|---|---|
| `src/answer/translate/mask.ts` (create) | Pure: Dutch→English number token, masking to placeholders, filling back |
| `src/answer/translate/check.ts` (create) | Pure: checks C1–C6 over a model output |
| `src/answer/translate/lines.ts` (create) | Pure: English structural lines + staleness warning from the stored result / Dutch strings |
| `src/answer/translate/prompt.ts` (create) | English system prompt, JSON schema, request builder, `TRANSLATE_PROMPT_VERSION` |
| `src/answer/translate/translate.ts` (create) | Orchestrator `translateAnswer()` and `attachEnglish()` |
| `src/answer/translate/types.ts` (create) | `EnglishRendering` and item types |
| `src/answer/translate/index.ts` (create) | Public exports |
| `src/registry/english-names.ts` (create) | The official-name list + lookup functions (moved from `web/lib/i18n/cbs-words.ts`, extended) |
| `src/registry/english-names.data.ts` (create) | Generated + curated Dutch→English label maps |
| `scripts/english-names-fetch.ts` (create) | One-off: pull CBS ENG labels, prove key matches, write `english-names.data.ts` |
| `scripts/translate-eval.ts` (create) | `translate:record` / eval over the 14 answerable benchmark tasks |
| `src/answer/compose/validate.ts` (modify) | Additive exports of direction/comparative regexes only |
| `src/answer/respond/types.ts` (modify) | Optional `english?: EnglishRendering` on `AnswerResponse` |
| `src/answer/audit/types.ts` (modify) | `'translate'` role |
| `src/answer/audit/respond-audited.ts` (modify) | `lang` + `translateClient` options; call `attachEnglish` before persist |
| `src/answer/audit/reconstruct.ts` (modify) | English reconstruction leg |
| `web/lib/i18n/cbs-words.ts` (modify) | Re-export moved functions from `backend/registry/english-names.ts` |
| `web/app/actions.ts` (modify) | Pass `lang` + client under the flag |
| `web/components/chat.tsx`, `web/lib/replay-assemble.ts`, chat message model (modify) | Render English, fallback line, chip label/submit split |
| `web/lib/i18n/messages.ts` (modify) | Fallback line copy |
| `tests/answer/translate/*.test.ts` (create) | Unit tests per module |
| `tests/audit/english-reconstruct.test.ts` (create) | Reconstruction + tamper tests |

---

### Task 1: Number conversion and masking

**Files:**
- Create: `src/answer/translate/mask.ts`
- Test: `tests/answer/translate/mask.test.ts`

**Interfaces:**
- Consumes: `findNumericTokens`, `normalizeForScan`, `parseNlNumber` from `src/answer/compose/format.ts`.
- Produces:
  - `toEnglishNumberToken(token: string): string`
  - `parseEnNumber(token: string): number`
  - `interface MaskEntry { placeholder: string; kind: 'number' | 'period' | 'caveat'; dutch: string; english: string }`
  - `interface Masker { mask(text: string): string; entries: MaskEntry[] }`
  - `createMasker(opts: { periodLabels: { dutch: string; english: string }[]; caveats: { dutch: string; english: string }[] }): Masker` — one masker per answer so placeholder ids are unique across all items of that answer
  - `fillPlaceholders(text: string, entries: MaskEntry[]): string`
  - `PLACEHOLDER_RE: RegExp` (global, matches `⟦[NPC][a-z]+⟧`)
  - `hasDigitOutsidePlaceholders(text: string): boolean`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/answer/translate/mask.test.ts
import { describe, expect, it } from 'vitest';
import { parseNlNumber } from '../../../src/answer/compose/format.ts';
import {
  createMasker,
  fillPlaceholders,
  hasDigitOutsidePlaceholders,
  parseEnNumber,
  toEnglishNumberToken,
} from '../../../src/answer/translate/mask.ts';

describe('toEnglishNumberToken', () => {
  it.each([
    ['18.044.027', '18,044,027'],
    ['3,3', '3.3'],
    ['1.234,5', '1,234.5'],
    ['2024', '2024'],
    ['-24', '-24'],
    ['-1.234,56', '-1,234.56'],
    ['000', '000'],
  ])('%s -> %s', (nl, en) => {
    expect(toEnglishNumberToken(nl)).toBe(en);
  });

  it('keeps the value identical for every generated token (round trip)', () => {
    for (let i = 0; i < 2000; i++) {
      const value = (Math.random() - 0.3) * 10 ** Math.floor(Math.random() * 9);
      const decimals = Math.floor(Math.random() * 4);
      const fixed = Math.abs(value).toFixed(decimals);
      const [int, frac] = fixed.split('.');
      const nl = (value < 0 ? '-' : '') + int!.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + (frac ? `,${frac}` : '');
      expect(parseEnNumber(toEnglishNumberToken(nl))).toBe(parseNlNumber(nl));
    }
  });
});

describe('createMasker', () => {
  const masker = () =>
    createMasker({
      periodLabels: [
        { dutch: '2023 1e kwartaal', english: '2023 Q1' },
        { dutch: '2023', english: '2023' },
      ],
      caveats: [
        { dutch: ' (nader voorlopig cijfer)', english: ' (revised provisional figure)' },
        { dutch: ' (voorlopig cijfer)', english: ' (provisional figure)' },
      ],
    });

  it('masks periods (longest first), caveats and numbers; leaves no digit', () => {
    const m = masker();
    const out = m.mask('In 2023 1e kwartaal had Utrecht 1.234,5 x 1 000 inwoners (voorlopig cijfer), in 2023 3,5%.');
    expect(hasDigitOutsidePlaceholders(out)).toBe(false);
    expect(out).not.toMatch(/\d/);
    expect(m.entries.filter((e) => e.kind === 'period').map((e) => e.dutch)).toEqual(['2023 1e kwartaal', '2023']);
    expect(m.entries.filter((e) => e.kind === 'caveat')).toHaveLength(1);
    expect(m.entries.filter((e) => e.kind === 'number').map((e) => e.dutch)).toEqual(['1.234,5', '1', '000', '3,5']);
  });

  it('gives unique placeholders across calls on the same masker', () => {
    const m = masker();
    const a = m.mask('3,5');
    const b = m.mask('3,5');
    expect(a).not.toBe(b);
  });

  it('fills back in English notation', () => {
    const m = masker();
    const masked = m.mask('Utrecht had 1.234,5 inwoners (voorlopig cijfer) in 2023.');
    expect(fillPlaceholders(masked, m.entries)).toBe('Utrecht had 1,234.5 inwoners (provisional figure) in 2023.');
  });

  it('treats a fullwidth digit as a digit', () => {
    expect(hasDigitOutsidePlaceholders('abc ９')).toBe(true);
    expect(hasDigitOutsidePlaceholders('⟦Na⟧ ⟦Pb⟧')).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/answer/translate/mask.test.ts`
Expected: FAIL — cannot find module `src/answer/translate/mask.ts`.

- [ ] **Step 3: Implement**

```ts
// src/answer/translate/mask.ts
// ADR 058 §2: numbers are made UNREPRESENTABLE to the translating model. Every
// period label, provisional marker and numeric token of a validated Dutch text
// becomes a digit-free placeholder before the model call; deterministic code
// puts them back in English notation afterwards. Placeholder ids are letters
// only, so a placeholder can never itself look like a number to the scanner.
import { findNumericTokens, normalizeForScan } from '../compose/format.ts';

export interface MaskEntry {
  placeholder: string;
  kind: 'number' | 'period' | 'caveat';
  dutch: string;
  english: string;
}

export interface Masker {
  mask(text: string): string;
  readonly entries: MaskEntry[];
}

export const PLACEHOLDER_RE = /⟦[NPC][a-z]+⟧/g;

/** Dutch notation → English notation by swapping the two separators only:
 * '.' (thousands) ↔ ',' (decimal). The digits never change, so the value is
 * provably the same number (round-trip tested). */
export function toEnglishNumberToken(token: string): string {
  return token.replace(/[.,]/g, (c) => (c === '.' ? ',' : '.'));
}

export function parseEnNumber(token: string): number {
  return Number.parseFloat(token.replaceAll(',', ''));
}

function letters(n: number): string {
  let s = '';
  let k = n;
  do {
    s = String.fromCharCode(97 + (k % 26)) + s;
    k = Math.floor(k / 26) - 1;
  } while (k >= 0);
  return s;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function hasDigitOutsidePlaceholders(text: string): boolean {
  return /\p{Nd}/u.test(text.replace(PLACEHOLDER_RE, ''));
}

export function createMasker(opts: {
  periodLabels: { dutch: string; english: string }[];
  caveats: { dutch: string; english: string }[];
}): Masker {
  const entries: MaskEntry[] = [];
  let counter = 0;
  const next = (kind: MaskEntry['kind'], dutch: string, english: string): string => {
    const placeholder = `⟦${kind === 'number' ? 'N' : kind === 'period' ? 'P' : 'C'}${letters(counter++)}⟧`;
    entries.push({ placeholder, kind, dutch, english });
    return placeholder;
  };
  const byLength = <T extends { dutch: string }>(xs: T[]) =>
    [...xs].filter((x) => x.dutch.length > 0).sort((a, b) => b.dutch.length - a.dutch.length);
  const periods = byLength(opts.periodLabels);
  const caveats = byLength(opts.caveats);
  return {
    entries,
    mask(input: string): string {
      let text = normalizeForScan(input);
      // Caveats first: they are fixed registry strings that may contain no digits
      // but sit right after a number, and must travel as one unit.
      for (const c of caveats) {
        text = text.replace(new RegExp(escapeRegExp(c.dutch), 'g'), () => next('caveat', c.dutch, c.english));
      }
      // Period labels before numbers: '2023 1e kwartaal' must not become '⟦N⟧ ⟦N⟧e kwartaal'.
      // Word-boundary guarded so '2023' never matches inside '12023'.
      for (const p of periods) {
        const re = new RegExp(`(?<![\\p{Nd}\\p{L}])${escapeRegExp(p.dutch)}(?![\\p{Nd}\\p{L}])`, 'gu');
        text = text.replace(re, () => next('period', p.dutch, p.english));
      }
      // Remaining numeric tokens, right to left so indices stay valid. Tokens
      // inside placeholders cannot exist (placeholders carry no digits).
      const tokens = findNumericTokens(text);
      const replacements = tokens.map((t) => ({ t, ph: '' }));
      // Assign ids left to right for readable output, splice right to left.
      for (const r of replacements) r.ph = next('number', r.t.token, toEnglishNumberToken(r.t.token));
      for (let i = replacements.length - 1; i >= 0; i--) {
        const { t, ph } = replacements[i]!;
        text = text.slice(0, t.index) + ph + text.slice(t.index + t.token.length);
      }
      return text;
    },
  };
}

export function fillPlaceholders(text: string, entries: MaskEntry[]): string {
  const map = new Map(entries.map((e) => [e.placeholder, e.english]));
  return text.replace(PLACEHOLDER_RE, (ph) => {
    const english = map.get(ph);
    if (english === undefined) throw new Error(`unknown placeholder ${ph}`);
    return english;
  });
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/answer/translate/mask.test.ts`
Expected: PASS (all). If the period regex rejects `2023` preceded by a placeholder `⟧`, that is correct behaviour.

- [ ] **Step 5: Commit**

```bash
git add src/answer/translate/mask.ts tests/answer/translate/mask.test.ts
git commit -m "feat(answer): English-answers mask — digit-free placeholders + English number notation (ADR 058)"
```

---

### Task 2: The official-name list (move + extend)

**Files:**
- Create: `src/registry/english-names.ts`, `src/registry/english-names.data.ts`
- Modify: `web/lib/i18n/cbs-words.ts` (becomes a re-export of the moved functions; keep `translateAttributionLine` there or move it too — move it, re-export)
- Test: `tests/registry/english-names.test.ts`; existing `web/lib/i18n/cbs-words.test.ts` must pass unmodified

**Interfaces:**
- Consumes: `baseRegionLabel` from `src/answer/compose/format.ts`; `ValidatedResult` from `src/query/index.ts`.
- Produces (all return the INPUT unchanged when no entry exists — never guess):
  - `translateUnit(unit: string): string`, `translateRegion(label: string): string`, `translateMeasureTitle(title: string): string`, `translatePeriodLabel(label: string): string`, `translateAttributionLine(line: string): string` (moved verbatim from `web/lib/i18n/cbs-words.ts`)
  - `translateTableTitle(title: string): string`
  - `translateDimLabel(label: string): string`
  - `hasEnglishName(kind: 'measure' | 'region' | 'table' | 'dim', dutch: string): boolean`
  - `interface GlossaryEntry { dutch: string; english: string; kind: 'measure' | 'region' | 'table' | 'dim'; translated: boolean }`
  - `glossaryForResult(result: ValidatedResult): GlossaryEntry[]` — every distinct measure title, base region label, table title and dim label in the result; `translated: false` (english === dutch) when the list has no entry
  - `periodLabelPairs(result: ValidatedResult): { dutch: string; english: string }[]` — distinct `periodLabel`s → `translatePeriodLabel`

- [ ] **Step 1: Move the code.** Copy `web/lib/i18n/cbs-words.ts`'s body into `src/registry/english-names.ts` unchanged (tables, regexes, functions, comments). Move the hand-written `MEASURE_TITLE_TABLE`, `REGION_TABLE` and `UNIT_TABLE` literals into `src/registry/english-names.data.ts` as exported consts `MEASURE_TITLES`, `REGIONS`, `UNITS`, plus new empty-to-start `TABLE_TITLES: Record<string, string> = {}` and `DIM_LABELS: Record<string, string> = {}` (Task 3 fills them). Replace `web/lib/i18n/cbs-words.ts` with:

```ts
// The name list moved to the backend (ADR 058) so the chart (web) and the
// English answer (src/answer/translate) share ONE list. This file stays as the
// web's import point.
export {
  translateAttributionLine,
  translateMeasureTitle,
  translatePeriodLabel,
  translateRegion,
  translateUnit,
} from '../../backend/registry/english-names.ts';
```

Check the existing web import style for `backend/` paths (`grep -rn "backend/" web/lib | head`) and match it exactly.

- [ ] **Step 2: Write the failing tests for the new functions**

```ts
// tests/registry/english-names.test.ts
import { describe, expect, it } from 'vitest';
import {
  glossaryForResult,
  periodLabelPairs,
  translateTableTitle,
} from '../../src/registry/english-names.ts';
import type { ValidatedResult } from '../../src/query/index.ts';

const cell = (over: Record<string, unknown>) => ({
  resultId: 'r', tableId: '37296ned', measure: 'm', measureTitle: 'Werkloosheidspercentage',
  regionCode: 'PV27', regionLabel: 'Noord-Holland (PV)', periodCode: '2023KW01', periodLabel: '2023 1e kwartaal',
  grain: 'KW', dims: {}, dimLabels: {}, value: 1, unit: '%', decimals: 1, status: 'Definitief',
  provisional: false, valueAttribute: 'None', batchId: 1, ...over,
});

const result = {
  cells: [cell({}), cell({ regionLabel: 'Utrecht (PV)', periodLabel: '2023 2e kwartaal', periodCode: '2023KW02' })],
  attribution: { tableTitle: 'Onbekende tabel' },
} as unknown as ValidatedResult;

describe('english-names', () => {
  it('returns the input for an unknown table title', () => {
    expect(translateTableTitle('Onbekende tabel')).toBe('Onbekende tabel');
  });

  it('builds a glossary with translated flags', () => {
    const g = glossaryForResult(result);
    expect(g).toContainEqual({ dutch: 'Werkloosheidspercentage', english: 'Unemployment rate', kind: 'measure', translated: true });
    expect(g).toContainEqual({ dutch: 'Noord-Holland', english: 'North Holland', kind: 'region', translated: true });
    expect(g).toContainEqual({ dutch: 'Utrecht', english: 'Utrecht', kind: 'region', translated: false });
    expect(g).toContainEqual({ dutch: 'Onbekende tabel', english: 'Onbekende tabel', kind: 'table', translated: false });
  });

  it('pairs period labels', () => {
    expect(periodLabelPairs(result)).toEqual([
      { dutch: '2023 1e kwartaal', english: '2023 Q1' },
      { dutch: '2023 2e kwartaal', english: '2023 Q2' },
    ]);
  });
});
```

Note: `Utrecht` is `translated: false` because it reads the same — the glossary still carries it so C5 can require it verbatim.

- [ ] **Step 3: Run to verify failure** — `npx vitest run tests/registry/english-names.test.ts` → FAIL (missing exports).

- [ ] **Step 4: Implement** the new functions in `src/registry/english-names.ts`:

```ts
import type { ValidatedResult } from '../query/index.ts';
import { baseRegionLabel } from '../answer/compose/format.ts';
import { DIM_LABELS, MEASURE_TITLES, REGIONS, TABLE_TITLES, UNITS } from './english-names.data.ts';

export function translateTableTitle(title: string): string {
  return TABLE_TITLES[title] ?? title;
}
export function translateDimLabel(label: string): string {
  return DIM_LABELS[label] ?? label;
}

export interface GlossaryEntry {
  dutch: string;
  english: string;
  kind: 'measure' | 'region' | 'table' | 'dim';
  translated: boolean;
}

export function glossaryForResult(result: ValidatedResult): GlossaryEntry[] {
  const out = new Map<string, GlossaryEntry>();
  const add = (kind: GlossaryEntry['kind'], dutch: string | null | undefined, english: string) => {
    if (!dutch) return;
    const key = `${kind}:${dutch}`;
    if (!out.has(key)) out.set(key, { dutch, english, kind, translated: english !== dutch });
  };
  for (const c of result.cells) {
    add('measure', c.measureTitle, translateMeasureTitle(c.measureTitle));
    if (c.regionLabel) {
      const base = baseRegionLabel(c.regionLabel);
      add('region', base, translateRegion(base));
    }
    for (const label of Object.values(c.dimLabels)) add('dim', label, translateDimLabel(label));
  }
  add('table', result.attribution.tableTitle, translateTableTitle(result.attribution.tableTitle));
  return [...out.values()];
}

export function periodLabelPairs(result: ValidatedResult): { dutch: string; english: string }[] {
  const seen = new Set<string>();
  const out: { dutch: string; english: string }[] = [];
  for (const c of result.cells) {
    if (seen.has(c.periodLabel)) continue;
    seen.add(c.periodLabel);
    out.push({ dutch: c.periodLabel, english: translatePeriodLabel(c.periodLabel) });
  }
  return out;
}
```

(`translateUnit`, `translateRegion`, `translateMeasureTitle` now read `UNITS`, `REGIONS`, `MEASURE_TITLES` from the data file.) If importing `baseRegionLabel` from `answer/compose/format.ts` into `registry/` creates an import cycle, copy the 6-line function locally with a comment naming its source instead.

- [ ] **Step 5: Run** `npx vitest run tests/registry/english-names.test.ts` → PASS; then `cd web && npx vitest run lib/i18n/cbs-words.test.ts` → PASS unmodified; `npm run typecheck` and `cd web && npx tsc --noEmit` clean.

- [ ] **Step 6: Commit**

```bash
git add src/registry/english-names.ts src/registry/english-names.data.ts web/lib/i18n/cbs-words.ts tests/registry/english-names.test.ts
git commit -m "refactor(registry): one English name list shared by charts and answers (ADR 058)"
```

---

### Task 3: Fill the name list from CBS's own English tables

**Files:**
- Create: `scripts/english-names-fetch.ts`
- Modify: `src/registry/english-names.data.ts`, `package.json` (script `english-names:fetch`)
- Test: `tests/registry/english-names-data.test.ts`

**Interfaces:**
- Consumes: the registered table ids (`TABLE_REGISTRY_DEFAULTS`, `CANONICAL_MEASURES` in `src/registry/defaults.ts`), the ingested Dutch labels in fixtures under `tests/fixtures/cbs/*/`.
- Produces: populated `MEASURE_TITLES`, `TABLE_TITLES`, `DIM_LABELS`, `REGIONS` maps, plus `CURATED: ReadonlySet<string>` — the Dutch labels whose English form was written by a session, not taken from CBS.

**Rules (principle c — never guess):**
1. For each registered CBS table `<id>` (drop the `NED`/`ned` suffix to get the number), fetch the English sibling's metadata from the CBS v3 API: `https://opendata.cbs.nl/ODataApi/odata/<number>ENG/TableInfos` (title), `/DataProperties` (measures: `Key`, `Title`, `Position`, `Unit`, `Decimals`, `Type`), and each dimension's code list (`/<DimensionKey>` → `Key`, `Title`). Fetch the Dutch table's same endpoints (`<number>NED`) for the pairing. Timeout 25 s per request; a table whose ENG sibling 404s or times out is listed as "no CBS English sibling" in the script's output.
2. Pair **dimension members by `Key`** (region/period codes are language-neutral). Pair **measures** by `Position` only when `Type`, `Unit` and `Decimals` are also equal on both sides; otherwise leave that measure unpaired. Pair the table title directly.
3. Emit Dutch label → English label. If one Dutch label would map to two different English labels across tables, emit neither and list the conflict.
4. Only labels the product can show are needed: measure titles of registered measures, dimension labels present in the result cells, provinces/landsdelen (municipalities read the same — skip `GM` codes), and table titles.
5. For the tables without an ENG sibling (probed 2026-09-25: 03759, 82235, 83932, 85224; 80590 timed out) and every unpaired label the product shows, write the English by hand into the data file, reading the Dutch table's own definition text first, and add the Dutch label to `CURATED`.
6. Write the result as a sorted TypeScript literal into `english-names.data.ts`, keeping the existing hand-written entries (the existing `MEASURE_TITLES` entries win over fetched ones only if identical; if a fetched CBS label differs from an existing hand-written one, prefer CBS's own label and note it in the commit message).

- [ ] **Step 1: Write the failing test**

```ts
// tests/registry/english-names-data.test.ts
import { describe, expect, it } from 'vitest';
import { CANONICAL_MEASURES } from '../../src/registry/defaults.ts';
import { CURATED, MEASURE_TITLES, TABLE_TITLES } from '../../src/registry/english-names.data.ts';

describe('english-names data', () => {
  it('has an English title for every registered canonical measure', () => {
    const missing = CANONICAL_MEASURES.map((m) => m.measureTitle).filter((t) => t && !(t in MEASURE_TITLES));
    expect(missing).toEqual([]);
  });
  it('never maps to an empty string or a digit-changed string', () => {
    for (const [nl, en] of Object.entries({ ...MEASURE_TITLES, ...TABLE_TITLES })) {
      expect(en.trim().length).toBeGreaterThan(0);
      expect((en.match(/\d+/g) ?? []).join()).toBe((nl.match(/\d+/g) ?? []).join());
    }
  });
  it('marks curated entries only for labels that exist in the maps', () => {
    for (const nl of CURATED) expect(nl in MEASURE_TITLES || nl in TABLE_TITLES).toBe(true);
  });
});
```

Before writing it, check the real field name for a canonical measure's title in `src/registry/types.ts` (`measureTitle` or similar) and adjust the first test to that field.

- [ ] **Step 2: Run** → FAIL (missing titles / `CURATED`).
- [ ] **Step 3: Write `scripts/english-names-fetch.ts`** implementing rules 1–6 (use `fetch` with `AbortSignal.timeout(25_000)`; print a per-table report: paired, unpaired, conflicts, no-sibling). Add `"english-names:fetch": "node scripts/english-names-fetch.ts"` to `package.json`.
- [ ] **Step 4: Run it** (`npm run english-names:fetch`) — it only reads the public CBS API (no database, no model, no secrets). Review the report; hand-write curated entries for everything unpaired that the product shows. Keep the report output in the commit message body (trimmed).
- [ ] **Step 5: Run** the test → PASS; `npm run typecheck` clean.
- [ ] **Step 6: Commit**

```bash
git add scripts/english-names-fetch.ts src/registry/english-names.data.ts tests/registry/english-names-data.test.ts package.json
git commit -m "feat(registry): English names from CBS's own ENG tables, curated where CBS has none (ADR 058)"
```

---

### Task 4: The deterministic checks C1–C6

**Files:**
- Modify: `src/answer/compose/validate.ts` (additive `export` on `UP_WORDS`, `DOWN_WORDS`, `FLAT_WORDS` — no other change)
- Create: `src/answer/translate/check.ts`
- Test: `tests/answer/translate/check.test.ts`

**Interfaces:**
- Consumes: `PLACEHOLDER_RE`, `hasDigitOutsidePlaceholders` (Task 1); `GlossaryEntry` (Task 2); `mentions` from `validate.ts`.
- Produces:
  - `interface TranslationItems { body: string; chips: string[]; definition: string | null; alternates: string[] }`
  - `type Direction = 'up' | 'down' | 'flat' | 'more' | 'less'`
  - `dutchDirections(text: string): Set<Direction>`, `englishDirections(text: string): Set<Direction>`
  - `checkTranslation(input: { maskedDutch: TranslationItems; dutch: TranslationItems; english: TranslationItems; glossary: GlossaryEntry[] }): string[]` — empty array = pass; each problem is an English sentence naming the check (`C1: …`)

**Checks** (spec §3.4; C4 is now a backstop because caveat markers are masked in Task 1):
- **C6 shape** first: `chips.length`, `alternates.length` equal; `definition` null iff input null; every string non-empty after trim.
- **C1** per item: sorted list of placeholders in the output equals the sorted list in the masked input.
- **C2** per item: `hasDigitOutsidePlaceholders` is false.
- **C3** body only: `dutchDirections(dutch.body)` equals `englishDirections(english.body)` (set equality).
- **C4** body only, over the MASKED Dutch body (inline registry markers are already placeholders): for each pair `['nader voorlopig','revised provisional']`, `['voorlopig','provisional']`, `['schatting','estimate']`, `['prognose','forecast']` — if the Dutch body (with longer pairs' matches removed first) contains the Dutch word case-insensitively, the English body must contain the English word.
- **C5** per item: for each glossary entry whose `dutch` is `mentions()`-ed in the Dutch item, the English item must `mentions()` its `english`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/answer/translate/check.test.ts
import { describe, expect, it } from 'vitest';
import { checkTranslation, dutchDirections, englishDirections } from '../../../src/answer/translate/check.ts';

const items = (body: string, chips: string[] = []) => ({ body, chips, definition: null, alternates: [] });
const glossary = [{ dutch: 'Noord-Holland', english: 'North Holland', kind: 'region' as const, translated: true }];

const ok = {
  maskedDutch: items('Noord-Holland telde ⟦Na⟧ inwoners in ⟦Pb⟧, een stijging.', ['Hoe was het in ⟦Pc⟧?']),
  dutch: items('Noord-Holland telde 1.234 inwoners in 2023, een stijging.', ['Hoe was het in 2022?']),
  english: items('North Holland had ⟦Na⟧ inhabitants in ⟦Pb⟧, an increase.', ['What about ⟦Pc⟧?']),
  glossary,
};

describe('checkTranslation', () => {
  it('passes a faithful translation', () => {
    expect(checkTranslation(ok)).toEqual([]);
  });
  it('C1: a dropped placeholder', () => {
    expect(checkTranslation({ ...ok, english: items('North Holland had inhabitants in ⟦Pb⟧, an increase.', ['What about ⟦Pc⟧?']) }).join())
      .toMatch(/^C1/);
  });
  it('C1: an invented placeholder', () => {
    expect(checkTranslation({ ...ok, english: items('North Holland had ⟦Na⟧ ⟦Nz⟧ inhabitants in ⟦Pb⟧, an increase.', ['What about ⟦Pc⟧?']) }).join())
      .toMatch(/C1/);
  });
  it('C2: a digit written by the model', () => {
    expect(checkTranslation({ ...ok, english: items('North Holland had ⟦Na⟧ inhabitants in ⟦Pb⟧, an increase of 5.', ['What about ⟦Pc⟧?']) }).join())
      .toMatch(/C2/);
  });
  it('C3: a direction flip', () => {
    expect(checkTranslation({ ...ok, english: items('North Holland had ⟦Na⟧ inhabitants in ⟦Pb⟧, a decrease.', ['What about ⟦Pc⟧?']) }).join())
      .toMatch(/C3/);
  });
  it('C4: a dropped provisional word', () => {
    const d = items('Het cijfer is voorlopig: ⟦Na⟧.');
    expect(
      checkTranslation({ maskedDutch: d, dutch: items('Het cijfer is voorlopig: 3.'), english: items('The figure is ⟦Na⟧.'), glossary: [] }).join(),
    ).toMatch(/C4/);
  });
  it('C5: an improvised name', () => {
    expect(checkTranslation({ ...ok, english: items('North-Holland had ⟦Na⟧ inhabitants in ⟦Pb⟧, an increase.', ['What about ⟦Pc⟧?']) }).join())
      .toMatch(/C5/);
  });
  it('C6: a lost chip', () => {
    expect(checkTranslation({ ...ok, english: items('North Holland had ⟦Na⟧ inhabitants in ⟦Pb⟧, an increase.', []) }).join())
      .toMatch(/C6/);
  });
});

describe('directions', () => {
  it.each([
    ['De werkloosheid daalde.', 'Unemployment fell.', 'down'],
    ['Het aantal nam toe.', 'The number increased.', 'up'],
    ['Het bleef stabiel.', 'It remained stable.', 'flat'],
    ['Utrecht had meer inwoners dan Zeeland.', 'Utrecht had more inhabitants than Zeeland.', 'more'],
    ['Zeeland had minder inwoners dan Utrecht.', 'Zeeland had fewer inhabitants than Utrecht.', 'less'],
  ])('%s ~ %s', (nl, en, dir) => {
    expect([...dutchDirections(nl)]).toEqual([dir]);
    expect([...englishDirections(en)]).toEqual([dir]);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run tests/answer/translate/check.test.ts` → FAIL.
- [ ] **Step 3: Implement.** In `validate.ts` change `const UP_WORDS` / `const DOWN_WORDS` / `const FLAT_WORDS` to `export const` (nothing else). Then:

```ts
// src/answer/translate/check.ts
// ADR 058 §3.4: deterministic gates on the model's English output. Run BEFORE
// filling placeholders. An empty problem list is the only pass.
import { DOWN_WORDS, FLAT_WORDS, mentions, UP_WORDS } from '../compose/validate.ts';
import type { GlossaryEntry } from '../../registry/english-names.ts';
import { hasDigitOutsidePlaceholders, PLACEHOLDER_RE } from './mask.ts';

export interface TranslationItems {
  body: string;
  chips: string[];
  definition: string | null;
  alternates: string[];
}

export type Direction = 'up' | 'down' | 'flat' | 'more' | 'less';

const NL_MORE = /\b(meer|hoger|groter)\b[^.!?]{0,60}?\bdan\b/i;
const NL_LESS = /\b(minder|lager|kleiner)\b[^.!?]{0,60}?\bdan\b/i;
const EN_UP = /\b(rise|rises|rose|risen|rising|increas\w*|grew|grow|grows|growing|grown|growth|climb\w*|went up|gone up)\b/i;
const EN_DOWN = /\b(fall|falls|fell|fallen|falling|decreas\w*|declin\w*|drop\w*|shr[aiu]nk\w*|went down|gone down)\b/i;
const EN_FLAT = /\b(unchanged|stable|flat|constant|remained the same|stayed the same|virtually the same|about the same)\b/i;
const EN_MORE = /\b(more|higher|larger|greater|bigger)\b[^.!?]{0,60}?\bthan\b/i;
const EN_LESS = /\b(less|fewer|lower|smaller)\b[^.!?]{0,60}?\bthan\b/i;

function classes(text: string, table: [Direction, RegExp][]): Set<Direction> {
  return new Set(table.filter(([, re]) => re.test(text)).map(([d]) => d));
}

export function dutchDirections(text: string): Set<Direction> {
  return classes(text, [['up', UP_WORDS], ['down', DOWN_WORDS], ['flat', FLAT_WORDS], ['more', NL_MORE], ['less', NL_LESS]]);
}

export function englishDirections(text: string): Set<Direction> {
  return classes(text, [['up', EN_UP], ['down', EN_DOWN], ['flat', EN_FLAT], ['more', EN_MORE], ['less', EN_LESS]]);
}

const CAVEAT_WORDS: [string, string][] = [
  ['nader voorlopig', 'revised provisional'],
  ['voorlopig', 'provisional'],
  ['schatting', 'estimate'],
  ['prognose', 'forecast'],
];

function placeholders(text: string): string[] {
  return (text.match(PLACEHOLDER_RE) ?? []).sort();
}

function pairs(t: TranslationItems): [string, string][] {
  return [
    ['body', t.body],
    ...t.chips.map((c, i): [string, string] => [`chip ${i + 1}`, c]),
    ...(t.definition === null ? [] : [['definition', t.definition] as [string, string]]),
    ...t.alternates.map((a, i): [string, string] => [`alternate ${i + 1}`, a]),
  ];
}

export function checkTranslation(input: {
  maskedDutch: TranslationItems;
  dutch: TranslationItems;
  english: TranslationItems;
  glossary: GlossaryEntry[];
}): string[] {
  const { maskedDutch, dutch, english, glossary } = input;
  const problems: string[] = [];
  // C6 — shape first; later checks index items by position.
  if (english.chips.length !== maskedDutch.chips.length) problems.push(`C6: expected ${maskedDutch.chips.length} chips, got ${english.chips.length}`);
  if (english.alternates.length !== maskedDutch.alternates.length) problems.push('C6: alternate count differs');
  if ((english.definition === null) !== (maskedDutch.definition === null)) problems.push('C6: definition presence differs');
  for (const [name, text] of pairs(english)) if (text.trim().length === 0) problems.push(`C6: ${name} is empty`);
  if (problems.length > 0) return problems;

  const masked = pairs(maskedDutch);
  const dutchPairs = pairs(dutch);
  const out = pairs(english);
  out.forEach(([name, text], i) => {
    const want = placeholders(masked[i]![1]).join(' ');
    const got = placeholders(text).join(' ');
    if (want !== got) problems.push(`C1: ${name} placeholders differ (expected [${want}], got [${got}])`);
    if (hasDigitOutsidePlaceholders(text)) problems.push(`C2: ${name} contains a digit outside placeholders`);
    for (const g of glossary) {
      if (mentions(dutchPairs[i]![1], g.dutch) && !mentions(text, g.english)) {
        problems.push(`C5: ${name} must name '${g.english}' (for '${g.dutch}')`);
      }
    }
  });

  const nlDir = [...dutchDirections(dutch.body)].sort().join(',');
  const enDir = [...englishDirections(english.body)].sort().join(',');
  if (nlDir !== enDir) problems.push(`C3: direction claims differ (Dutch [${nlDir}], English [${enDir}])`);

  // C4 reads the MASKED Dutch body: the registry's inline provisional markers are
  // already caveat placeholders there (Task 1), so only free-prose caveat words remain.
  let nlBody = maskedDutch.body.toLowerCase();
  let enBody = english.body.toLowerCase();
  for (const [nl, en] of CAVEAT_WORDS) {
    const nlHas = nlBody.includes(nl);
    if (nlHas && !enBody.includes(en)) problems.push(`C4: the Dutch body says '${nl}', the English body lacks '${en}'`);
    nlBody = nlBody.replaceAll(nl, '');
    enBody = enBody.replaceAll(en, '');
  }
  return problems;
}
```

- [ ] **Step 4: Run** the test → PASS. Run `npx vitest run tests/answer` → all existing answer tests still PASS (the `export` keyword change is inert).
- [ ] **Step 5: Commit**

```bash
git add src/answer/compose/validate.ts src/answer/translate/check.ts tests/answer/translate/check.test.ts
git commit -m "feat(answer): English-answer checks C1-C6 (ADR 058)"
```

---

### Task 5: English structural lines and staleness warning

**Files:**
- Create: `src/answer/translate/lines.ts`
- Test: `tests/answer/translate/lines.test.ts`

**Interfaces:**
- Consumes: `ValidatedResult`, `isDerivedResult`, `DERIVED_DATA_MARKING` (`src/query/index.ts`); `resolveSource`, `EUROSTAT_SOURCE_KEY` (`src/sources/registry.ts`); `baseRegionLabel`, `displayAlternateLabel`, `buildDefinitionLine` (`src/answer/compose/format.ts`); `toEnglishNumberToken` (Task 1); `translateTableTitle`, `translatePeriodLabel`, `translateRegion`, `translateMeasureTitle` (Task 2).
- Produces:
  - `interface EnglishLines { assumptionLine: string | null; regionSetLine: string | null; regionSeriesLine: string | null; definitionLine: string | null; alternatesLine: string | null; markingLine: string | null; attributionLine: string }`
  - `dutchDefinitionContent(result: ValidatedResult): string | null` — the text after `'Definitie: '` in `buildDefinitionLine(result)` with its terminal period removed, or null
  - `dutchAlternateLabels(result: ValidatedResult): string[]` — the labels `buildAlternatesLine` would join (same filter)
  - `buildEnglishLines(result: ValidatedResult, translated: { definition: string | null; alternates: string[] }): EnglishLines`
  - `assembleEnglishText(body: string, lines: EnglishLines, stalenessWarning: string | null): string` — same order as `compose.ts assemble()`, then `\n\n` + warning when present
  - `translateStalenessWarning(dutch: string): string | null` — null when the Dutch warning does not match the two known shapes in `src/answer/respond/staleness.ts`

**English templates** (each mirrors the Dutch builder in `src/answer/compose/format.ts` exactly in structure, null-ness and ordering; digits appear only from counts/codes and use `String(n)` since they are small integers):

| Dutch builder | English |
|---|---|
| `buildAssumptionLine` region part | `This is the national figure for the Netherlands as a whole. Name a municipality or province in your question if you want a specific region.` |
| period part (until) | `This is the development over recent years, up to ${translatePeriodLabel(until)}.` / null-until: `This is the recent development.` then `Feel free to ask for only the latest figure or for a different period.` |
| `buildRegionSetLine` | nouns: provincie/provincies→province/provinces, landsdeel/landsdelen→region/regions (CBS "landsdeel"), gemeente/gemeenten→municipality/municipalities. `Coverage: all ${n} ${noun} in this table have a figure.` / `Coverage: ${a} of the ${n} ${noun} have a figure.`; `${n} ${noun} did not exist in this period according to CBS${named}.` (singular: `did not exist`, same); `CBS publishes no value for ${n} ${noun}${named}.`; `We have no figure in our database for ${n} ${noun}${named}.`; `That is why this answer gives no ranking.` Named members: `translateRegion(baseRegionLabel(label))` or the code, same limit 5. |
| `buildRegionSeriesLine` | grain nouns year/years, quarter/quarters, month/months. `For ${name} a figure is missing in ${missing} of the ${requested} requested ${noun}; that is why this answer gives no development for that region.` and `This answer says nothing about ${names}: our database lacks figures for one or more of the requested ${noun}.` |
| `buildDefinitionLine` | `Definition: ${translated.definition}.` when `translated.definition` non-null (add the period only if the translated text has no terminal punctuation) |
| `buildAlternatesLine` | 1 label: `Another reading is also available: ${l}.` ; more: `Other readings are also available: ${ls.join('; ')}.` |
| marking | `— adaptation of CBS data by checkdecijfers.nl` when `isDerivedResult(result)` |
| `buildAttributionLine` (CBS) | `Source: ${attributionLabel}, table ${tableId} — ${translateTableTitle(tableTitle)}. Data synced on ${date}. Period: ${from}[ to ${to}]. License: ${license}.` with `from`/`to` through `translatePeriodLabel` |
| `buildAttributionLine` (Eurostat) | `Source: Eurostat, dataset ${code} — ${tableTitle}${doi ? ` (DOI ${doi})` : ''}. Data synced on ${date}. License: ${license}.` |
| staleness (plain) | `Note: CBS normally updates this table ${cadenceEn}, but our last sync was on ${date} — more recent figures may now be available.` |
| staleness (retained) | `Note: CBS normally updates this table ${cadenceEn}, but part of these figures has not been reconfirmed by CBS since ${date} — more recent figures may now be available.` |

For `cadenceEn`, read `cadenceWordsNl` in `src/answer/respond/staleness.ts` and write an inverse exact-match table (e.g. `'maandelijks' → 'monthly'`); an unknown cadence phrase ⇒ `translateStalenessWarning` returns null.

- [ ] **Step 1: Write the failing tests.** Build `ValidatedResult` fixtures from the existing benchmark answer fixtures (`grep -rln "regionSet" tests/answer | head` and `tests/fixtures/` — reuse a helper that already constructs results, e.g. in `tests/answer/compose*.test.ts`). For each builder: one case where the Dutch builder returns null ⇒ English null; one populated case asserting the exact English string; a digit-invariance assertion that every digit run in the English line also appears in the Dutch line (`(s.match(/\d+/g) ?? []).sort()`), except the date which is identical anyway. Staleness: both shapes + an unknown shape → null.
- [ ] **Step 2: Run** `npx vitest run tests/answer/translate/lines.test.ts` → FAIL.
- [ ] **Step 3: Implement** `lines.ts` with the templates above. Every function is pure over its arguments.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit**

```bash
git add src/answer/translate/lines.ts tests/answer/translate/lines.test.ts
git commit -m "feat(answer): hand-written English structural lines + staleness warning (ADR 058)"
```

---

### Task 6: Prompt, orchestrator and `attachEnglish`

**Files:**
- Create: `src/answer/translate/types.ts`, `src/answer/translate/prompt.ts`, `src/answer/translate/translate.ts`, `src/answer/translate/index.ts`
- Modify: `src/answer/respond/types.ts` (optional field), `src/answer/audit/types.ts` (role)
- Test: `tests/answer/translate/translate.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 2, 4, 5; `LlmClient`, `LlmRequest` (`src/answer/llm/client.ts`); `PHRASING_MODEL` (`src/answer/compose/prompt.ts`); `resolveSourceForTable` / every source's `provisionalDisplay` (`src/sources/registry.ts`); `AnswerResponse`, `ComposedResponse` (`src/answer/respond/types.ts`).
- Produces:
  - `types.ts`:

```ts
import type { MaskEntry } from './mask.ts';
import type { TranslationItems } from './check.ts';
import type { EnglishLines } from './lines.ts';

export const ENGLISH_RENDERING_SCHEMA_VERSION = 1 as const;

export interface EnglishAttempt { ok: boolean; problems: string[]; error: string | null }

export interface EnglishRendering {
  schemaVersion: typeof ENGLISH_RENDERING_SCHEMA_VERSION;
  status: 'verified' | 'fallback';
  promptVersion: number;
  model: string | null;
  maskedDutch: TranslationItems;
  maskTable: MaskEntry[];
  /** The accepted model output (pre-fill) when verified; the last attempt's output when fallback; null on a model error before any output. */
  rawTranslation: TranslationItems | null;
  attempts: EnglishAttempt[];
  body: string | null;
  lines: EnglishLines | null;
  stalenessWarning: string | null;
  text: string | null;
  chips: { label: string; submit: string }[];
  untranslatedNames: string[];
}
```

  - `prompt.ts`: `TRANSLATE_PROMPT_VERSION = 1`; `TRANSLATE_JSON_SCHEMA` (object with required `body: string`, `chips: string[]`, `definition: string | null`, `alternates: string[]`, `additionalProperties: false`); `buildTranslateRequest(items: TranslationItems, glossary: GlossaryEntry[], opts?: { model?: string; retryProblems?: string[] }): LlmRequest` with `temperature: 0`, `maxTokens: 1200`, `model: opts.model ?? PHRASING_MODEL`, `question: JSON.stringify({ items, glossary: glossary.map(g => ({ dutch: g.dutch, english: g.english })) })`.
  - System prompt text (English, verbatim):

```
You translate short Dutch statistical texts from checkdecijfers.nl into clear, natural British English for a general reader.
Input: JSON with "items" (body, chips, definition, alternates) and "glossary" (Dutch name -> required English name).
Rules:
1. Keep every placeholder of the form ⟦Na⟧, ⟦Pb⟧, ⟦Cc⟧ exactly as written, each exactly as many times as in the input. Never add, drop, merge or alter a placeholder. They stand for numbers, periods and status notes that are filled in later.
2. Never write any digit. All numbers are already placeholders.
3. Translate meaning faithfully: keep every direction (rose, fell, unchanged, higher than, lower than) and every caveat (provisional, estimate, forecast) exactly as the Dutch states it. Add no claim, explanation or opinion.
4. When a glossary name occurs, use its English form exactly as given, including capitalisation.
5. "chips" are follow-up questions a reader can click: translate each as a natural English question, same order, same count.
6. Return "definition": null when the input definition is null.
7. Output only the JSON object.
```

  - `translate.ts`:
    - `translateAnswer(response: AnswerResponse, client: LlmClient, opts?: { model?: string }): Promise<EnglishRendering>`
    - `attachEnglish(response: ComposedResponse, opts: { lang?: 'nl' | 'en'; client?: LlmClient }): Promise<ComposedResponse>` — returns the SAME object when `opts.lang !== 'en'`, `!opts.client`, or `response.kind !== 'answer'`; otherwise `{ ...response, english }`. Never throws (a thrown `translateAnswer` becomes a fallback rendering with the error message).
- Modify `AnswerResponse` in `src/answer/respond/types.ts`: add `english?: EnglishRendering;` with a doc comment (A1: present only when translation was attempted).
- Modify `LlmCallRecord['role']` in `src/answer/audit/types.ts`: add `| 'translate'`.

**`translateAnswer` algorithm:**
1. `glossary = glossaryForResult(response.result)`; `untranslatedNames = glossary.filter(g => !g.translated && g.kind !== 'region').map(g => g.dutch)` (regions that read the same are not "untranslated").
2. `caveats` = every distinct `provisionalDisplay` value of the sources the result's cells use, paired with its English form from a fixed table in `translate.ts`: `' (voorlopig cijfer)' → ' (provisional figure)'`, `' (nader voorlopig cijfer)' → ' (revised provisional figure)'`, `' (schatting)' → ' (estimate)'`, `' (schatting door Eurostat)' → ' (estimate by Eurostat)'`, `' (prognose)' → ' (forecast)'`, `' (methodebreuk)' → ' (break in series)'`, `' (vertrouwelijk)' → ' (confidential)'`, `' (afwijkende definitie)' → ' (different definition)'`, `' (lage betrouwbaarheid)' → ' (low reliability)'`, `' (niet significant)' → ' (not significant)'`. A registry value missing from this table ⇒ fallback with problem `unknown caveat marker` (a test pins that every registry `provisionalDisplay` value has an entry).
3. `masker = createMasker({ periodLabels: periodLabelPairs(result), caveats })`.
4. Dutch items: `body = response.answer.body`; `chips = response.suggestions`; `definition = dutchDefinitionContent(result)`; `alternates = dutchAlternateLabels(result)`. `maskedDutch` = each masked in that order (body, chips…, definition, alternates…).
5. If any masked item `hasDigitOutsidePlaceholders` ⇒ fallback, problem `C2: digit survived masking`, no model call.
6. Up to 2 attempts: `client.complete(buildTranslateRequest(maskedDutch, glossary, { retryProblems }))`; parse JSON (parse failure ⇒ attempt problem `unparseable output`); `checkTranslation(...)`; on pass stop.
7. Verified: fill every item via `fillPlaceholders`; `lines = buildEnglishLines(result, { definition: filled.definition, alternates: filled.alternates })`; `stalenessWarning = response.stalenessWarning === null ? null : translateStalenessWarning(response.stalenessWarning)`; if the Dutch warning exists and translation returns null ⇒ fallback (problem `staleness warning shape unknown`); `text = assembleEnglishText(filledBody, lines, stalenessWarning)`; `chips = filled.chips.map((label, i) => ({ label, submit: response.suggestions[i]! }))`.
8. Fallback: `body/lines/text: null`, `chips: []`, `stalenessWarning: null`.

- [ ] **Step 1: Write the failing tests** with a stub client:

```ts
// tests/answer/translate/translate.test.ts (sketch of the stub; build `answer` from an existing benchmark answer fixture helper)
import type { LlmClient, LlmRequest } from '../../../src/answer/llm/client.ts';
function stub(outputs: string[]): LlmClient & { requests: LlmRequest[] } {
  const requests: LlmRequest[] = [];
  return {
    requests,
    async complete(req) {
      requests.push(req);
      const outputText = outputs.shift() ?? '{}';
      return { outputText, model: req.model, stopReason: 'end_turn', usage: { inputTokens: 1, outputTokens: 1 } };
    },
  };
}
```

Cases (each asserts on the returned `EnglishRendering`):
  1. A faithful stub output (build it by taking `maskedDutch` from a first dry run and writing an English sentence reusing its placeholders) ⇒ `status: 'verified'`, `text` contains the English-notation numbers (e.g. `17,942,942`), no Dutch digits notation, `chips[i].submit` equals the Dutch chip.
  2. **No request carries a digit:** for every captured request, `JSON.parse(req.question).items` has no `\p{Nd}` outside placeholders, and `req.system` contains no digit other than the rule numbers `1.`–`7.` (assert `req.question`, not `system`).
  3. First output fails C3, second passes ⇒ verified, `attempts.length === 2`, the second request's `system` mentions the problems.
  4. Both outputs fail ⇒ `status: 'fallback'`, `text: null`.
  5. Client throws ⇒ fallback with `attempts[0].error` set.
  6. `attachEnglish` returns the identical object (`toBe`) for `lang: 'nl'`, for no client, and for a refusal response.
  7. Every `provisionalDisplay` value in every registered source has a caveat entry.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS; `npm run typecheck` clean.
- [ ] **Step 5: Commit**

```bash
git add src/answer/translate src/answer/respond/types.ts src/answer/audit/types.ts tests/answer/translate/translate.test.ts
git commit -m "feat(answer): translateAnswer + attachEnglish — masked, checked, fail-closed-to-Dutch (ADR 058)"
```

---

### Task 7: Audit wiring and R8 reconstruction

**Files:**
- Modify: `src/answer/audit/respond-audited.ts`, `src/answer/audit/reconstruct.ts`
- Test: `tests/audit/english-reconstruct.test.ts`; `tests/invariants/` byte-identity case

**Interfaces:**
- Consumes: `attachEnglish`, `EnglishRendering` and every pure function from Tasks 1–6.
- Produces: `AuditedRespondOptions.lang?: 'nl' | 'en'` and `AuditedRespondOptions.translateClient?: LlmClient`; `reconstructionReport` checks `response.english` when present.

- [ ] **Step 1: Write the failing tests.**
  - **Byte-identity:** for every benchmark task the existing hermetic benchmark path already runs (reuse its harness from `tests/benchmark/` or `tests/invariants/`), call `answerQuestionAudited` twice — once as today, once with `lang: 'nl'`, and once with `lang: 'en'` but no `translateClient` — and assert the three stored rows and responses are deep-equal (ignore only latency/timestamp fields the harness already ignores).
  - **English row:** `lang: 'en'` + a stub translate client that returns a faithful translation ⇒ the stored `response.english.status === 'verified'`, `llm_calls` contains a `'translate'` role entry, and `reconstructionReport` returns no problems.
  - **Tamper tests** (each must produce ≥1 reconstruction problem): change one digit in `english.body`; swap two placeholders in `rawTranslation.body`; change `english.lines.attributionLine`; change one `maskTable[i].english`; set `status: 'verified'` on a row whose `rawTranslation` fails C3; change `english.text`; change a chip's `submit`.
  - **Fallback row:** stub client fails twice ⇒ `status: 'fallback'`, reconstruction passes, the Dutch `final_text` unchanged.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
  - `respond-audited.ts`: add the two options with doc comments (mirror the `webClient` comment: injected ONLY by `web/app/actions.ts` when the flag is on and the reader is on English; absent everywhere else ⇒ zero translate machinery). In BOTH `answerQuestionAudited` and `answerClarificationReplyAudited`, after `attachWebAugmentation` and before `persistOrFailClosed`:

```ts
  // ADR 058: the English rendering rides the SAME row (R8), attached before
  // the write so latency and llm_calls stay honest. No lang/client (the
  // benchmark, tests, CLI, every Dutch reader) ⇒ the same object back.
  const withEnglish = await attachEnglish(augmented, {
    lang: options.lang,
    client: options.translateClient ? tracker.wrap('translate', options.translateClient) : undefined,
  });
  const audited = await persistOrFailClosed(db, withEnglish, wrap);
```

  - `reconstruct.ts`: a new `checkEnglishReconstruction(record, problems)` called from the answer branch when `response.english !== undefined`:
    1. Re-derive glossary, caveats, masker, Dutch items and `maskedDutch` from the stored response exactly as `translateAnswer` does (export a pure `prepareTranslation(response: AnswerResponse)` from `translate.ts` in Task 6's module if not already — refactor so `translateAnswer` and reconstruction call the SAME function); compare to stored `maskedDutch` and `maskTable` (deep-equal).
    2. If `status === 'verified'`: `rawTranslation` non-null and `checkTranslation(...)` returns `[]`; re-fill ⇒ equals stored `body` and chip labels; `chips[i].submit === response.suggestions[i]`; re-build lines ⇒ deep-equal stored `lines`; re-translate staleness ⇒ equals stored; re-assemble ⇒ equals stored `text`.
    3. If `status === 'fallback'`: `body`, `lines`, `text` null and `chips` empty; at least one attempt with `ok: false`.
    4. Each mismatch pushes a problem prefixed `english: `.
- [ ] **Step 4: Run** `npx vitest run tests/audit tests/invariants tests/benchmark` → PASS (all pre-existing tests unmodified). Run `npm run audit:verify` if it works against fixtures locally (see RUNBOOK); otherwise note it for CI.
- [ ] **Step 5: Commit**

```bash
git add src/answer/audit src/answer/translate tests/audit/english-reconstruct.test.ts tests/invariants
git commit -m "feat(audit): English rendering on the audit row + R8 reconstruction leg with tamper tests (ADR 058)"
```

---

### Task 8: Web — pass the language, render English, split chip label from submit

**Files:**
- Modify: `web/app/actions.ts`, `web/components/chat.tsx`, the chat-message model file (`grep -rn "suggestions:" web/lib/chat-message.ts web/components/*.ts* | head` to locate), `web/lib/replay-assemble.ts`, `web/lib/i18n/messages.ts`
- Test: the matching `*.test.ts(x)` beside each file (`web/app/actions.test.ts`, `web/components/chat.test.tsx`, `web/lib/replay-assemble` tests)

**Interfaces:**
- Consumes: `AnswerResponse.english` (Task 6), `AuditedRespondOptions.lang/translateClient` (Task 7), `getLang()` (`web/lib/i18n/server.ts`).
- Produces: `englishAnswerOptions(lang: Lang): { lang?: 'en'; translateClient?: LlmClient }` exported from `web/app/actions.ts` (or a small `web/lib/english-answers.ts` if actions.ts has no pure-helper precedent).

**Behaviour:**
1. `englishAnswerOptions(lang)` returns `{ lang: 'en', translateClient: new AnthropicLlmClient() }` iff `process.env.ENGLISH_ANSWERS_ENABLED === '1' && lang === 'en'`, else `{}`. Spread it into both `answerQuestionAudited(...)` and `answerClarificationReplyAudited(...)` option bags; call `getLang()` once per action.
2. The chat message built from an answer response carries `english: response.english ?? null`.
3. Rendering an answer message: if `english?.status === 'verified'` show `english.text` where `response.text` is shown today, and use `english.chips` for the chips; if `english?.status === 'fallback'` show the Dutch text headed by the new message `chat.englishFallback` (`en`: "We couldn't produce a verified English version of this answer, so here is the original Dutch." / `nl`: "We konden geen gecontroleerde Engelse versie van dit antwoord maken; hieronder staat het Nederlandse origineel."); otherwise today's rendering. Refusals/clarifications unchanged.
4. **Chip split:** an English chip shows `label` and, on click, fills the input with `label` (the #75 fill-don't-send behaviour stays). `chipRef` records `{ label: submit, shown: label, ...carrier }`. On send, if the input text equals `chipRef.shown`, the request sends `chipRef.label` (the Dutch text, so the server's deterministic chip rung resolves exactly as today) while the user bubble shows the English `shown` text. An edited input sends what was typed (today's rule for edited chips).
5. `replay-assemble.ts`: a reloaded thread re-renders from the stored response, so it carries `english` the same way (a reloaded English answer is the same English answer).

- [ ] **Step 1: Write the failing tests:** `englishAnswerOptions` truth table (flag off/on × nl/en); chat renders `english.text` for verified, fallback line + Dutch for fallback, Dutch when `english` absent; clicking an English chip then sending posts the Dutch `submit` text and the bubble shows English; replay carries `english`.
- [ ] **Step 2: Run** `cd web && npx vitest run <the files>` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS; `cd web && npx tsc --noEmit` clean. `grep -rn "Suggested follow-up" web/e2e/` — e2e must not depend on a changed string (nothing user-visible changes with the flag off).
- [ ] **Step 5: Commit**

```bash
git add web
git commit -m "feat(web): English answers behind ENGLISH_ANSWERS_ENABLED — render, fallback line, chip label/submit split (ADR 058)"
```

---

### Task 9: Record/eval script, runbook and docs

**Files:**
- Create: `scripts/translate-eval.ts`
- Modify: `package.json` (`translate:record`, `translate:eval`), `docs/RUNBOOK.md`, `docs/decisions/058-english-answers.md` (as-built), `docs/decisions/016-audit-records.md` (as-built note), `docs/05-data-rules.md` (R8 row: one sentence), `docs/04-architecture.md` (capability row), `docs/open-questions.md` (#271), `web/README.md` if env vars are listed there

**Behaviour of `scripts/translate-eval.ts`:**
- `--record`: for each of the 14 answerable benchmark tasks (`benchmark/tasks.json`), run `answerQuestionAudited` against the replayed Dutch fixtures (same harness `scripts/answer-eval.ts` uses) with `lang: 'en'` and `translateClient: new RecordingLlmClient(<tests/fixtures/llm/translate>, new AnthropicLlmClient())` — check `RecordingLlmClient`'s real constructor in `src/answer/llm/client.ts:240` and match it. Print per task: status, attempts, problems, untranslated names.
- default (eval): same with `ReplayLlmClient(tests/fixtures/llm/translate)`; exit non-zero if any task's rendering fails reconstruction or any C1/C2 problem appears on a verified rendering.
- `package.json`: `"translate:record": "node --env-file-if-exists=.env scripts/translate-eval.ts --record"`, `"translate:eval": "node scripts/translate-eval.ts"`.

**RUNBOOK section "English answers (ADR 058) — switching it on"** (owner-supervised, after 2026-10-01): 1) `npm run translate:record` (real, small spend: 14 short calls); 2) read the printout — every task verified or an explained fallback; commit the fixtures; 3) `npm run translate:eval` green; 4) `ENGLISH_ANSWERS_ENABLED=1` in Vercel Production (plain text, not a secret) + redeploy via `gh run rerun <latest main run>`; 5) live check: switch the site to English, ask a benchmark question, confirm English numbers in English notation, the source line in English, chips in English, a chip click answers; 6) rollback: unset the flag + redeploy.

- [ ] **Step 1:** Write the script; run `npm run translate:eval` — with no recorded fixtures yet it must fail loudly with a clear "no fixture — run translate:record after the API cap lifts" message (not a crash). Add a vitest case asserting that message path if `scripts/answer-eval.ts` has test precedent; otherwise skip.
- [ ] **Step 2:** Docs as listed; `grep -rn "stay Dutch\|remain Dutch\|answers are Dutch" docs web/README.md README.md` and fix stale framing.
- [ ] **Step 3: Commit**

```bash
git add scripts/translate-eval.ts package.json docs web/README.md
git commit -m "docs+scripts: English answers — translate:record/eval, RUNBOOK switch-on, ADR 058 as-built (ADR 058)"
```

---

## Final verification (after Task 9, before the PR)

1. `nohup scripts/verify-block.sh "$PWD" /tmp/eng-verify.log --e2e >/dev/null 2>&1 & disown` on a quiet machine; read every `Test Files N passed (N)` line and the benchmark gate (14/14 + 6/6 + 0 fabricated).
2. `/code-review` LOW over the branch diff; fix or dispatch every confirmed finding.
3. Whole-branch review against docs/05 (R1, R3, R8, R9, R11) and the Global Constraints.
4. Push branch, open PR, wait for green CI; merge on the owner's GO (autonomous session rule, CLAUDE.md #118(b)).
