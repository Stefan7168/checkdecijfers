// The envelope-key manifest: every field the response envelope carries, with
// the R8 treatment it actually receives — and a test that fails when a new
// field appears without one.
//
// WHY THIS EXISTS (architecture review 2026-07-25, Q3). R8's categorisation
// rule — what gets re-derived, what gets shape-checked, what is deliberately
// recorded-not-rederived — lives only in comments and ADR addenda. Roughly a
// dozen items sit on the right side of it today, verified by that review, but
// nothing STOPS a thirteenth from landing in the wrong one: add a field to
// ComposedResponse, write no reconstruct check, and CI stays green while the
// field silently joins the "ignored" pile. That is the project's cross-cutting
// pattern in one place — rules about NUMBERS are pinned by machinery, rules
// about the SYSTEM by prose.
//
// WHAT THIS TEST DOES. It reads the interface declarations out of the type
// source with a small STRICT line parser (see `declaredMembers` for why not the
// TypeScript compiler API), and diffs the key set against MANIFEST below. It
// reads declarations rather than a fixture on purpose: a fixture only shows the
// keys some canonical turn happens to carry, and present-only fields are absent
// from most of them. A new key with no manifest entry fails here, which forces
// the author to answer one question in review: what does R8 do with this?
//
// WHAT IT DELIBERATELY DOES NOT DO: check runtime objects. TypeScript's excess
// property checking already makes an undeclared key on these envelopes hard to
// build, and a DB-backed variant would trade this suite's millisecond runtime
// for a guarantee the type system mostly gives for free. Two cheap
// cross-checks against reconstruct.ts cover the direction that actually rots:
// a manifest entry that claims a check nobody wrote, and an `ignored` entry
// that quietly grew one.
//
// THE CATEGORIES are the review's three, plus one. The memo proposed
// `rederived` / `shape-checked` / `ignored:<reason>`; writing the manifest out
// showed `body` fits none of them honestly — it is neither re-derived nor
// merely shape-checked, it is re-run through the full R1/R3/R9/R10/R11
// validator against the stored result, which is the single strongest check in
// the file. It gets its own name rather than being flattened into a weaker one.
//
//   rederived    the stored value must re-compute BYTE-IDENTICALLY from other
//                stored state, through the same builder that produced it.
//   revalidated  the stored value is re-run through its validator against the
//                stored result (no byte equality — the validator's verdict is
//                the check).
//   shape-checked  reconstruct READS the field and asserts something about it
//                (a version pin, a presence/reason pairing, equality with a
//                promoted column) without re-deriving its content.
//   ignored      reconstruct does not read it. Every entry must say WHY — an
//                un-argued 'ignored' is what this test exists to prevent.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

type Category = 'rederived' | 'revalidated' | 'shape-checked' | 'ignored';

interface Entry {
  category: Category;
  /** Required for `ignored`; the argument a reviewer can disagree with. */
  why?: string;
  /** For a key whose treatment is not uniform across response kinds. */
  note?: string;
}

/** One map per envelope shape. Keys inherited from ResponseBase are listed on
 * the base and NOT repeated, except where a kind genuinely treats them
 * differently — `text` is the one that does. */
const MANIFEST: Record<string, Record<string, Entry>> = {
  ResponseBase: {
    schemaVersion: { category: 'shape-checked' }, // version pin, loud on mismatch
    question: { category: 'shape-checked' }, // must equal the promoted column
    text: {
      category: 'shape-checked',
      note: 'the treatment is NOT uniform by kind: on every kind it must equal the promoted record.finalText, and on an ANSWER it is additionally re-derived byte-identically from answer.text + stalenessWarning. Listed here once because the key is declared once, on ResponseBase.',
    },
    sourceSelection: { category: 'shape-checked' }, // ⟨W6⟩ owed-check + the webSection pairing
    webSection: { category: 'shape-checked' }, // replayed verbatim (the web is non-deterministic); 4 shape checks
  },
  AnswerResponse: {
    kind: { category: 'shape-checked' },
    answer: { category: 'shape-checked' }, // a container: its own keys are manifested under ComposedAnswer
    chart: { category: 'rederived' }, // buildChartSpec over the stored result + schema re-validation
    stalenessWarning: { category: 'shape-checked' }, // participates in the text re-assembly; its own wording is not re-derived
    parse: {
      category: 'ignored',
      why: 'an answer takes its intent from result.intent, so the parse outcome is not read here; the LLM parse has no deterministic ground truth to re-derive against (same policy as llm_calls)',
    },
    result: { category: 'shape-checked' }, // the substrate everything above re-derives FROM; itself checked via resultIds/tables/intentHash
    suggestions: {
      category: 'ignored',
      why: 'servability-gated at PRODUCE time by a dry-run against live data; re-running that dry-run at audit time would check the database of today against a chip offered months ago. Assembled after the audited text, so it cannot alter it.',
    },
  },
  ClarificationResponse: {
    kind: { category: 'shape-checked' },
    axes: {
      category: 'ignored',
      why: 'the no-unbacked-numbers guarantee for clarifications is structural (the builders never see cell values) and belt-checked by the WP9 suites at produce time; reconstruct checks the envelope, not the wording',
    },
    options: { category: 'ignored', why: 'same as axes — produce-time guarantee, deterministic templates' },
    suggestions: { category: 'ignored', why: 'labels only, mirroring pending.clickOptions; same produce-time gate as the answer-side chips' },
    pending: {
      category: 'ignored',
      why: 'reconstruct reads record.pendingClarification (the REPLY turn\'s copy, checked against reply_text), not this turn\'s offered pending',
    },
    parse: { category: 'ignored', why: 'no intent to promote on a clarification row; the LLM parse is recorded, not re-derived' },
  },
  RefusalResponse: {
    kind: { category: 'shape-checked' },
    reason: { category: 'shape-checked' }, // must equal the promoted refusal_reason column
    offer: { category: 'ignored', why: 'deterministic template text, value-free by construction; the benchmark scorer re-scans refusal texts against run-time whitelists' },
    guidance: { category: 'ignored', why: 'same as offer' },
    freshness: { category: 'ignored', why: 'period + status only, never a value (open-questions #37); produce-time structural guarantee' },
    parse: { category: 'shape-checked' }, // read by resolvedIntent when there is no queryRefusal
    queryRefusal: { category: 'shape-checked' }, // read by resolvedIntent — the intent the hash must recompute from
    internalNote: { category: 'ignored', why: 'an owner-readable diagnostic, never rendered to the user and never part of the answer surface' },
    onboarding: { category: 'shape-checked' }, // presence must match reason === 'onboarding_pending'
    pending: { category: 'ignored', why: 'WP26c rescue state; like the clarification-side pending, the reply turn\'s copy is what reconstruct checks' },
    suggestions: { category: 'ignored', why: 'same produce-time dry-run gate as the answer-side chips; assembled after the audited refusal text' },
  },
  ComposedAnswer: {
    schemaVersion: { category: 'shape-checked' }, // version pin
    source: { category: 'shape-checked' }, // must equal the promoted answer_source column
    body: { category: 'revalidated' }, // R1/R3/R9/R10/R11 re-run against the stored result
    assumptionLine: { category: 'rederived' }, // buildAssumptionLine, byte-identical, `?? null` (A1)
    definitionLine: { category: 'rederived' }, // buildDefinitionLine, byte-identical
    alternatesLine: { category: 'rederived' }, // #39 buildAlternatesLine, byte-identical, `?? null` (A1)
    markingLine: { category: 'rederived' }, // from result.derivations
    attributionLine: { category: 'rederived' }, // buildAttributionLine, byte-identical (R4 positional)
    text: { category: 'rederived' }, // re-assembles from body + the structural lines, in order
    model: { category: 'ignored', why: 'telemetry: which model wrote the body. Recorded, never re-derived — there is no deterministic ground truth for it inside the record.' },
    promptVersion: { category: 'ignored', why: 'telemetry, same argument as model' },
    usage: { category: 'ignored', why: 'token counts — telemetry, not reconstruction material' },
    attempts: { category: 'ignored', why: 'the failed-attempt log; a record of what happened, with nothing to re-derive it from' },
    validation: { category: 'shape-checked' }, // read by the #121 known-at-serve-time labelling
    semanticCheck: { category: 'shape-checked' }, // verdict recorded; its SCOPE (the suspect list) IS re-derived and its status cross-checked
  },
};

/** Interfaces whose own members the manifest must cover, in the file that
 * declares them. */
const SOURCES: { file: string; interfaces: string[] }[] = [
  {
    file: fileURLToPath(new URL('../../src/answer/respond/types.ts', import.meta.url)),
    interfaces: ['ResponseBase', 'AnswerResponse', 'ClarificationResponse', 'RefusalResponse'],
  },
  {
    file: fileURLToPath(new URL('../../src/answer/compose/types.ts', import.meta.url)),
    interfaces: ['ComposedAnswer'],
  },
];

/** Declared property names of the named interfaces, read from the source.
 *
 * WHY NOT THE TYPESCRIPT COMPILER API. It was the first version of this and it
 * does not survive the installed TypeScript: 7.x maps the package's `"."`
 * export to `lib/version.cjs`, so `ts.createSourceFile` is simply not there,
 * and the AST now lives behind `typescript/unstable/ast` — an entry point whose
 * name says what it promises about stability. A conformance test that a routine
 * dependabot bump can break is worse than no conformance test, so this reads
 * the declarations directly.
 *
 * STRICT MEANS STRICT: it THROWS on any depth-1 line it cannot classify.
 *
 * The first version merely skipped what it did not recognise, and a review of
 * this file showed why that was worthless: `readonly foo: string`,
 * `method(): void`, `'quoted-key': string`, an index signature, and a member
 * preceded by an inline `/** … *\/` doc were all silently dropped. A field
 * added as `readonly foo: string` — not exotic TypeScript — would have landed
 * unmanifested with every test green, which is exactly the silent addition this
 * file exists to prevent. Worse, the member-count assertions that were supposed
 * to be the backstop are computed from THIS function's own output, so they
 * would have moved with the miss. A circular backstop is not a backstop.
 *
 * So: unknown shape ⇒ loud failure, naming the line. A multi-line member type
 * would trip it too — deliberately. Teaching this parser a new shape should be
 * a decision someone makes on purpose, not something it papers over. */
function declaredMembers(file: string, wanted: string[]): Map<string, string[]> {
  const found = new Map<string, string[]>();
  const lines = readFileSync(file, 'utf8').split('\n');
  let current: string | null = null;
  let depth = 0;
  let inBlockComment = false;

  for (const raw of lines) {
    const line = raw.trim();
    if (inBlockComment) {
      if (line.includes('*/')) inBlockComment = false;
      continue;
    }
    if (line.startsWith('/*')) {
      if (!line.includes('*/')) inBlockComment = true;
      continue;
    }
    if (line.startsWith('//') || line.startsWith('*')) continue;

    if (current === null) {
      // `export interface Name … {` or `interface Name extends Base {`
      const open = /^(?:export\s+)?interface\s+([A-Za-z0-9_]+)\b/.exec(line);
      if (open !== null && wanted.includes(open[1]!)) {
        current = open[1]!;
        found.set(current, []);
        depth = (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length;
      }
      continue;
    }

    const opens = (line.match(/\{/g) ?? []).length;
    const closes = (line.match(/\}/g) ?? []).length;
    if (depth === 1) {
      // `readonly` and quoted keys are accepted because they are ordinary and
      // meaningful; everything else unrecognised throws below.
      const member = /^(?:readonly\s+)?(?:([A-Za-z_][A-Za-z0-9_]*)|'([^']+)'|"([^"]+)")\??\s*[:?]/.exec(
        line,
      );
      if (member !== null) {
        found.get(current)!.push((member[1] ?? member[2] ?? member[3])!);
      } else if (line !== '' && line !== '}' && !line.startsWith('}')) {
        throw new Error(
          `envelope-key-manifest: unrecognised declaration in ${current} — ${JSON.stringify(line)}. ` +
            'Teach declaredMembers this shape deliberately; do not let it be skipped.',
        );
      }
    }
    depth += opens - closes;
    if (depth <= 0) current = null;
  }
  return found;
}

const declared = new Map<string, string[]>();
for (const { file, interfaces } of SOURCES) {
  for (const [name, members] of declaredMembers(file, interfaces)) declared.set(name, members);
}

describe('the envelope-key manifest covers the declared types', () => {
  it('found every interface it claims to manifest', () => {
    // Guards the guard: a renamed interface must not silently make this suite
    // vacuous (it would otherwise pass with zero keys compared).
    expect([...declared.keys()].sort()).toEqual(Object.keys(MANIFEST).sort());
    // Exact counts. NOT a backstop against the parser missing something — they
    // come from the parser, so they would move with it (the review that caught
    // this called it a circular claim, correctly). `declaredMembers` throwing on
    // anything it cannot classify is the real guard; these are a cheap belt that
    // catches an interface silently losing a member to an edit.
    const expectedCounts: Record<string, number> = {
      ResponseBase: 5,
      AnswerResponse: 7,
      ClarificationResponse: 6,
      RefusalResponse: 11,
      ComposedAnswer: 15,
    };
    for (const [name, count] of Object.entries(expectedCounts)) {
      expect(declared.get(name)?.length, `${name} parsed an unexpected member count`).toBe(count);
    }
  });

  for (const name of Object.keys(MANIFEST)) {
    it(`${name}: every declared key has a manifest entry, and vice versa`, () => {
      const members = declared.get(name);
      if (members === undefined) throw new Error(`interface ${name} was not found`);
      const manifested = Object.keys(MANIFEST[name]!).sort();
      expect(
        [...members].sort(),
        `${name}'s declared keys and its manifest entries have diverged. ` +
          'A new envelope field needs a decision about its R8 treatment — ' +
          'add the field to MANIFEST with its category (and, for `ignored`, why).',
      ).toEqual(manifested);
    });
  }

  it('every ignored key carries an argument', () => {
    for (const [name, entries] of Object.entries(MANIFEST)) {
      for (const [key, entry] of Object.entries(entries)) {
        if (entry.category !== 'ignored') continue;
        expect(entry.why ?? '', `${name}.${key} is ignored without a stated reason`).not.toBe('');
      }
    }
  });

  it('the categories that claim a reconstruct check are actually named in the R8 reader', () => {
    // A cheap, deliberately loose cross-check: the manifest claims which fields
    // R8 reads. It cannot prove the check is CORRECT — that is what the
    // reconstruction suites do — but it does catch a manifest entry that claims
    // a check nobody wrote.
    //
    // The reader is TWO files, not one: `resolvedIntent` lives in write.ts and
    // is what actually reads `queryRefusal`/`parse` off a refusal envelope to
    // recompute the intent hash. Scanning reconstruct.ts alone reported that
    // claim as unfounded, which is how this comment came to exist.
    const reconstruct =
      readFileSync(fileURLToPath(new URL('../../src/answer/audit/reconstruct.ts', import.meta.url)), 'utf8') +
      readFileSync(fileURLToPath(new URL('../../src/answer/audit/write.ts', import.meta.url)), 'utf8');
    // `kind` and `schemaVersion` are read through several spellings
    // (record.kind, response.kind, a destructured tag), and `text` through
    // finalText — matching on the bare identifier is enough for all of them.
    const missing: string[] = [];
    for (const [name, entries] of Object.entries(MANIFEST)) {
      for (const [key, entry] of Object.entries(entries)) {
        if (entry.category === 'ignored') continue;
        if (!new RegExp(`\\b${key}\\b`).test(reconstruct)) missing.push(`${name}.${key}`);
      }
    }
    expect(missing, 'manifest claims an R8 check that reconstruct.ts never mentions').toEqual([]);
  });

  it('no ignored key is quietly read by reconstruct after all', () => {
    // The inverse, and the more useful direction: if someone ADDS a check for a
    // field the manifest still calls ignored, the manifest is now the stale
    // half. Scanned against reconstruct.ts ONLY (write.ts touches nearly every
    // field while BUILDING the row, which is not the same as reconstructing it
    // and would false-positive constantly).
    //
    // Exempt: names that appear on several shapes with different treatments, or
    // that occur as a sub-field of something else. `model` is here because
    // reconstruct genuinely reads `semanticCheck.model` — a bare-identifier
    // match cannot tell that from `answer.model`, which really is ignored.
    const reconstruct = readFileSync(
      fileURLToPath(new URL('../../src/answer/audit/reconstruct.ts', import.meta.url)),
      'utf8',
    );
    const ambiguous = new Set([
      'parse',
      'pending',
      'suggestions',
      'text',
      'kind',
      'options',
      'model',
    ]);
    const nowRead: string[] = [];
    for (const [name, entries] of Object.entries(MANIFEST)) {
      for (const [key, entry] of Object.entries(entries)) {
        if (entry.category !== 'ignored' || ambiguous.has(key)) continue;
        if (new RegExp(`\\b${key}\\b`).test(reconstruct)) nowRead.push(`${name}.${key}`);
      }
    }
    expect(nowRead, 'reconstruct.ts now reads a field the manifest still calls ignored').toEqual([]);
  });
});
