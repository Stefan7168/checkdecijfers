// The DatasetTurnEnvelope key manifest — the "eigen data" tier's own analog
// of tests/audit/envelope-key-manifest.test.ts (open-questions #209). Same
// purpose, same mechanism, adapted to this tier's own structural difference:
// DatasetTurnEnvelope is a discriminated UNION of three inline object
// literals (chart/clarification/refusal), not a set of `extends`-linked
// interfaces, so the declaration parser below is a variant-scanning sibling
// of the CBS-side file's `declaredMembers`, not a reuse of it.
//
// WHY THIS EXISTS. src/attachments/reconstruct.ts is this tier's R8 analog:
// does a stored dataset_turns row reconstruct the response it claims to
// record? Nothing stopped a new envelope field from landing without anyone
// deciding what reconstruction should do with it — exactly the CBS-side gap
// the sibling file's own header describes, and true here until this file
// existed. Building this manifest immediately surfaced one real instance of
// it: `envelope.schemaVersion` was declared, bumped-on-shape-change by
// convention (see its doc comment in types.ts), and never actually checked
// by checkEnvelopeIntegrity — unlike the CBS side's reconstruct.ts, which
// has always pinned schemaVersion this way. Fixed alongside this file (see
// reconstruct.ts's checkEnvelopeIntegrity and its own regression test in
// reconstruct.test.ts), not left as a documented gap, since the fix is a
// one-line, zero-behavior-change addition today (DATASET_TURN_ENVELOPE_VERSION
// has never been bumped past 1) that only starts mattering on this tier's
// first real schema bump — exactly the moment a check like this needs to
// already exist.
//
// THE CATEGORIES are the same four the CBS side's manifest uses:
//   rederived    the stored value must re-compute BYTE-IDENTICALLY from other
//                stored state, through the same builder that produced it.
//   shape-checked  reconstruct reads the field and asserts something about it
//                (equality with a promoted column, a presence rule, or — for
//                a per-`reason` field like this tier's `text`/`options` — a
//                mix, noted explicitly rather than forced into one bucket).
//   ignored      reconstruct does not read it. Every entry must say WHY.
// `revalidated` (the CBS side's third category, for a value re-run through a
// validator rather than compared byte-for-byte) has no analog here yet —
// nothing in this tier is re-validated post-hoc rather than rebuilt outright.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

type Category = 'rederived' | 'shape-checked' | 'ignored';

interface Entry {
  category: Category;
  /** Required for `ignored`; the argument a reviewer can disagree with. */
  why?: string;
  /** For a field whose treatment differs by `reason`/`kind`, or is split
   * across sub-checks. */
  note?: string;
}

/** One map per DatasetTurnEnvelope variant, keyed by its `kind` literal. */
const MANIFEST: Record<'chart' | 'clarification' | 'refusal', Record<string, Entry>> = {
  chart: {
    schemaVersion: { category: 'shape-checked' }, // version pin, loud on mismatch (checkEnvelopeIntegrity)
    kind: { category: 'shape-checked' }, // must equal record.kind; also the discriminant reconstructDatasetTurn switches on
    question: { category: 'shape-checked' }, // must equal record.question
    text: {
      category: 'shape-checked',
      note: 'must equal record.finalText (checkEnvelopeIntegrity). Not further re-derived for this kind: the question flow\'s chartReplyText() is a fixed literal ("Here\'s your chart.") and the co-pilot flow\'s copilotReplyText(applied, refused) is one of four fixed, digit-free sentences chosen by the COUNTS in `copilot` below — neither carries data, and neither has anything else to check it against — unlike clarification/refusal, where text IS re-derived per `reason` (see those variants).',
    },
    instruction: { category: 'shape-checked' }, // must equal the promoted `instruction` column (checkChartReconstruction)
    chart: { category: 'rederived' }, // buildUserChartSpec(dataset, envelope.instruction), byte-identical (H1/H2's guarantee made mechanical)
    copilot: {
      category: 'ignored',
      why: "the chart it produced is reconstructed from `instruction` like every chart envelope; the recipe is the reader's own edit record, never re-derived. Optional (session 113, co-pilot phase 2): a chart turn from the question flow, and every chart turn written before phase 2, has no such key at all. Its `feedback` field is additionally the ONE part of a stored envelope this tier ever mutates after the fact (store.ts's setDatasetTurnCopilotFeedback, a surgical jsonb_set of that single path) — a re-derivation check on it would be checking a vote against nothing.",
    },
    state: {
      category: 'shape-checked',
      note: '`state.datasetId` is shape-checked (must equal the current dataset row\'s id); `state.lastInstruction` IS rederived — must equal toClientInstruction(envelope.instruction) exactly, the one narrowing path a server-only field (reading/confidence/unsupported.detail) could otherwise leak through.',
    },
  },
  clarification: {
    schemaVersion: { category: 'shape-checked' },
    kind: { category: 'shape-checked' },
    question: { category: 'shape-checked' },
    text: {
      category: 'rederived',
      note: "per envelope.reason: 'low_confidence' → lowConfidenceClarificationText(), 'validation' → validationClarificationText(), 'zero_rows' → zeroRowsClarificationText(), all byte-identical. 'ambiguous_format' is not yet produced by respondToDatasetQuestion (D5's disambiguation lives in the ingest Server Action, not this turn flow) — no template call exists to check it against yet.",
    },
    options: {
      category: 'rederived',
      note: "per envelope.reason: 'low_confidence'/'validation' → must equal suggestionOptions(dataset.profile) exactly; 'zero_rows' → shape-checked to be empty (respond.ts always passes []); 'ambiguous_format' → not yet produced, nothing to check.",
    },
    instruction: { category: 'shape-checked' }, // must equal the promoted `instruction` column, same check as the chart variant
    reason: {
      category: 'shape-checked',
      note: 'the discriminant selecting which of the branches above runs. This tier has no promoted `reason` column to cross-check it against (unlike RefusalResponse.reason on the CBS side, checked against audit_answers.refusal_reason) — a wrong value here simply routes reconstruction to the wrong branch, which is itself likely (not guaranteed) to surface as a text/options mismatch there.',
    },
  },
  refusal: {
    schemaVersion: { category: 'shape-checked' },
    kind: { category: 'shape-checked' },
    question: { category: 'shape-checked' },
    text: { category: 'rederived' }, // must equal refusalText(envelope.reason) exactly, every reason mapping to one static sentence
    reason: {
      category: 'shape-checked',
      note: 'the input to refusalText() above; like the clarification variant, not cross-checked against a separate promoted column (this tier has none).',
    },
    guidance: {
      category: 'ignored',
      why: "reconstructDatasetTurn never reads it. For 'compare_with_cbs' it is a fixed template sentence; for an LLM-flagged unsupported instruction it is instruction.unsupported.detail — LLM-authored explanatory prose. H1 guarantees no ChartInstruction field can ever hold a display VALUE, so this cannot fabricate a number (principle c's concern), but it is unverified prose reaching the user with no reconstruction check of its own — a disclosed trade-off, not an oversight.",
    },
  },
};

/** The file declaring the union, and the discriminant field that names each
 * variant — generalised for one caller, not because a second is expected. */
const SOURCE_FILE = fileURLToPath(new URL('../../src/attachments/types.ts', import.meta.url));
const TYPE_NAME = 'DatasetTurnEnvelope';

/**
 * Parses `export type DatasetTurnEnvelope = | {...} | {...} | {...};` into
 * one member-list per variant, keyed by that variant's own `kind: '...'`
 * literal. A sibling of tests/audit/envelope-key-manifest.test.ts's
 * `declaredMembers`, not a reuse of it — that function parses `interface`
 * bodies; this one parses a union of inline object-literal types, which is a
 * different grammar (variant boundaries, a discriminant to key by, and one
 * field here — `reason` on the refusal variant — whose own union-of-string-
 * literals type genuinely spans multiple lines).
 *
 * STRICT MEANS STRICT, same philosophy as the sibling file: any line shape
 * this function does not recognise throws, naming the line, rather than
 * being silently skipped. A change to DatasetTurnEnvelope's formatting that
 * this parser cannot follow is exactly the kind of silent miss a "declared
 * shape vs. manifested shape" test exists to prevent from compounding with a
 * second, harder-to-notice miss inside its own machinery.
 */
function declaredEnvelopeVariants(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  const lines = readFileSync(SOURCE_FILE, 'utf8').split('\n');

  type State = 'searching' | 'after-equals' | 'in-variant' | 'awaiting-terminator' | 'after-variant-close' | 'done';
  let state: State = 'searching';
  let depth = 0;
  let members: string[] = [];
  let kind: string | null = null;
  let pendingMember: string | null = null;

  const typeOpenRe = new RegExp(`^(?:export\\s+)?type\\s+${TYPE_NAME}\\s*=\\s*$`);
  const memberRe = /^(?:readonly\s+)?(?:([A-Za-z_][A-Za-z0-9_]*)|'([^']+)'|"([^"]+)")\??\s*[:?]/;
  const kindLiteralRe = /^kind\s*:\s*'([^']+)'/;
  const unionArmRe = /^\|\s*'[^']*'\s*;?\s*$/;

  for (const raw of lines) {
    const line = raw.trim();
    if (state === 'done') break;
    if (line === '' || line.startsWith('//')) continue;

    if (state === 'searching') {
      if (typeOpenRe.test(line)) state = 'after-equals';
      continue;
    }

    if (state === 'after-equals') {
      if (line !== '| {') {
        throw new Error(`envelope-key-manifest: expected a '| {' variant opener after '${TYPE_NAME} =', got ${JSON.stringify(line)}`);
      }
      state = 'in-variant';
      depth = 1;
      members = [];
      kind = null;
      continue;
    }

    if (state === 'after-variant-close') {
      if (line !== '| {') {
        throw new Error(`envelope-key-manifest: expected the next '| {' variant opener, got ${JSON.stringify(line)}`);
      }
      state = 'in-variant';
      depth = 1;
      members = [];
      kind = null;
      continue;
    }

    if (state === 'awaiting-terminator') {
      if (!unionArmRe.test(line)) {
        throw new Error(
          `envelope-key-manifest: unrecognised continuation line for member '${pendingMember}' — ${JSON.stringify(line)}. ` +
            'Teach declaredEnvelopeVariants this shape deliberately.',
        );
      }
      if (line.endsWith(';')) {
        state = 'in-variant';
        pendingMember = null;
      }
      continue;
    }

    // state === 'in-variant'
    if (line.startsWith('/*') || line.startsWith('*')) continue; // single-line block doc comments only, same as the sibling parser

    if (line === '}') {
      if (kind === null) throw new Error(`envelope-key-manifest: a variant closed with no 'kind' literal found inside it`);
      found.set(kind, members);
      state = 'after-variant-close';
      continue;
    }
    if (line === '};') {
      if (kind === null) throw new Error(`envelope-key-manifest: the final variant closed with no 'kind' literal found inside it`);
      found.set(kind, members);
      state = 'done';
      continue;
    }

    const member = memberRe.exec(line);
    if (member === null) {
      throw new Error(`envelope-key-manifest: unrecognised declaration inside a variant — ${JSON.stringify(line)}`);
    }
    const name = (member[1] ?? member[2] ?? member[3])!;
    members.push(name);
    if (name === 'kind') {
      const literal = kindLiteralRe.exec(line);
      if (literal === null) {
        throw new Error(`envelope-key-manifest: 'kind' member did not carry a single-quoted literal — ${JSON.stringify(line)}`);
      }
      kind = literal[1]!;
    }

    const opens = (line.match(/\{/g) ?? []).length;
    const closes = (line.match(/\}/g) ?? []).length;
    depth += opens - closes;
    if (depth < 1) {
      throw new Error(`envelope-key-manifest: brace depth went below the variant body while reading '${name}' — ${JSON.stringify(line)}`);
    }
    if (!line.includes(';')) {
      // This member's type continues on the next line(s) — only the
      // refusal variant's multi-line `reason` union does this today.
      state = 'awaiting-terminator';
      pendingMember = name;
    }
  }

  if (state !== 'done') {
    throw new Error(`envelope-key-manifest: reached end of file while still in state '${state}' — ${TYPE_NAME} was not fully parsed`);
  }
  return found;
}

const declared = declaredEnvelopeVariants();

describe('the DatasetTurnEnvelope key manifest covers the declared variants', () => {
  it('found exactly the three variants it claims to manifest', () => {
    // Guards the guard: a renamed/added `kind` literal must not silently
    // make this suite vacuous.
    expect([...declared.keys()].sort()).toEqual(Object.keys(MANIFEST).sort());
    // Exact counts — a cheap belt (not a backstop; declaredEnvelopeVariants
    // throwing on anything it cannot classify is the real guard) that
    // catches a variant silently losing a member to an edit.
    const expectedCounts: Record<string, number> = {
      chart: 8,
      clarification: 7,
      refusal: 6,
    };
    for (const [name, count] of Object.entries(expectedCounts)) {
      expect(declared.get(name)?.length, `${name} parsed an unexpected member count`).toBe(count);
    }
  });

  for (const variant of Object.keys(MANIFEST) as (keyof typeof MANIFEST)[]) {
    it(`${variant}: every declared key has a manifest entry, and vice versa`, () => {
      const members = declared.get(variant);
      if (members === undefined) throw new Error(`variant '${variant}' was not found`);
      const manifested = Object.keys(MANIFEST[variant]).sort();
      expect(
        [...members].sort(),
        `DatasetTurnEnvelope's '${variant}' variant and its manifest entries have diverged. ` +
          'A new envelope field needs a decision about its R8-analog treatment — ' +
          'add it to MANIFEST with its category (and, for `ignored`, why).',
      ).toEqual(manifested);
    });
  }

  it('every ignored key carries an argument', () => {
    for (const [variant, entries] of Object.entries(MANIFEST)) {
      for (const [key, entry] of Object.entries(entries)) {
        if (entry.category !== 'ignored') continue;
        expect(entry.why ?? '', `${variant}.${key} is ignored without a stated reason`).not.toBe('');
      }
    }
  });

  it('the categories that claim a reconstruct check are actually named in reconstruct.ts', () => {
    // A cheap, deliberately loose cross-check, same as the sibling file's
    // own version: catches a manifest entry that claims a check nobody
    // wrote. Cannot prove a claimed check is CORRECT — reconstruct.test.ts
    // covers that.
    const reconstruct = readFileSync(
      fileURLToPath(new URL('../../src/attachments/reconstruct.ts', import.meta.url)),
      'utf8',
    );
    const missing: string[] = [];
    for (const [variant, entries] of Object.entries(MANIFEST)) {
      for (const [key, entry] of Object.entries(entries)) {
        if (entry.category === 'ignored') continue;
        if (!new RegExp(`\\b${key}\\b`).test(reconstruct)) missing.push(`${variant}.${key}`);
      }
    }
    expect(missing, 'manifest claims a reconstruct.ts check that the file never mentions').toEqual([]);
  });

  it('no ignored key is quietly read by reconstruct.ts after all', () => {
    // The more useful direction: if someone adds a check for a field the
    // manifest still calls ignored, the manifest is now the stale half.
    const reconstruct = readFileSync(
      fileURLToPath(new URL('../../src/attachments/reconstruct.ts', import.meta.url)),
      'utf8',
    );
    const nowRead: string[] = [];
    for (const [variant, entries] of Object.entries(MANIFEST)) {
      for (const [key, entry] of Object.entries(entries)) {
        if (entry.category !== 'ignored') continue;
        if (new RegExp(`\\b${key}\\b`).test(reconstruct)) nowRead.push(`${variant}.${key}`);
      }
    }
    expect(nowRead, 'reconstruct.ts now reads a field the manifest still calls ignored').toEqual([]);
  });
});
