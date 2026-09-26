// R8's teeth: does a stored audit record RECONSTRUCT the response it claims
// to record? Everything here re-derives from the STORED record alone — no
// database, no live pipeline objects — because that is the record's whole
// purpose: benchmark scoring now, answer pages and the user-facing audit
// trail later (docs/04) must be able to trust the row without the process
// that wrote it.
//
// What "reconstructs" means (docs/05 R8, made mechanical):
//  1. Envelope integrity — the promoted columns match the stored envelope
//     (a divergent copy means the row lies about itself).
//  2. Answers — the stored body re-passes the full R3/R9/R10/R11 validator
//     against the stored result (every numeric token maps to stored result
//     IDs / derivations — R1's scan, run from the record); the attribution
//     line re-derives byte-identically from the stored attribution fields
//     (R4 positional, not pattern-based); the structural lines and the final
//     text re-assemble byte-identically; the chart spec re-derives from the
//     stored result via the same deterministic builder (R6 + R8: the chart
//     the user saw is exactly what the stored result produces).
//  3. Refusals/clarifications — envelope-consistency checks; their
//     no-unbacked-numbers guarantee is structural + belt-checked by the WP9
//     suites at produce time, and the benchmark scorer re-scans refusal texts
//     against run-time whitelists.
import { DERIVED_DATA_MARKING, isDerivedResult, RESULT_SCHEMA_VERSION } from '../../query/index.ts';
import type { ValidatedResult } from '../../query/index.ts';
import { buildChartSpec, chartSpecSchema } from '../../chart/index.ts';
import {
  buildAlternatesLine,
  buildAssumptionLine,
  buildAttributionLine,
  buildDefinitionLine,
  buildRegionSeriesLine,
  buildRegionSetLine,
} from '../compose/format.ts';
import { renderTemplateBody, renderRegionSeriesLegacyPreLineFormat } from '../compose/template.ts';
import { applyUnitExpansions } from '../compose/expand.ts';
import { findSuspectTokens } from '../compose/semantic-check.ts';
import { buildSlotContext, fillSlots, validateSlotBody } from '../compose/slots.ts';
import { validateAnswerBody } from '../compose/validate.ts';
import { stableStringify } from '../llm/client.ts';
import { ANSWER_SCHEMA_VERSION, SEMANTIC_CHECK_SCHEMA_VERSION, SLOT_PHRASING_SCHEMA_VERSION } from '../compose/types.ts';
import { RESPONSE_SCHEMA_VERSION } from '../respond/types.ts';
import type { AnswerResponse, RefusalReason } from '../respond/types.ts';
// ADR 058 (English answers, Task 7): the SAME functions translateAnswer
// itself calls — `checkEnglishReconstruction` below re-derives the
// deterministic half of an English rendering from the stored response alone
// (prepareTranslation), re-checks the stored model output against it
// (checkTranslation/isTranslationItemsShape), and re-fills/re-assembles it
// through the same deterministic steps (fillPlaceholders, buildEnglishLines,
// assembleEnglishText, translateStalenessWarning) — never a re-implementation.
import { checkTranslation } from '../translate/check.ts';
import {
  assembleEnglishText,
  buildEnglishLines,
  translateStalenessWarning,
} from '../translate/lines.ts';
import { fillPlaceholders } from '../translate/mask.ts';
import { isTranslationItemsShape, prepareTranslation } from '../translate/translate.ts';
import type { PreparedTranslation } from '../translate/translate.ts';
import type { AuditRecord } from './types.ts';
import { AUDIT_SCHEMA_VERSION } from './types.ts';
import { intentHash, resolvedIntent } from './write.ts';
// WP129+130 (ADR 032): the ⟨W3⟩ skip-list is shared with src/websearch/attach.ts
// (the pure leaf) so reconstruct check (d) can never drift from the owed-check.
import { WEBSEARCH_SKIP_REASONS } from '../../websearch/types.ts';

export interface ReconstructionReport {
  ok: boolean;
  problems: string[];
}

function checkEnvelopeIntegrity(record: AuditRecord, problems: string[]): void {
  const response = record.response;
  // Version pinning: this reconstructor is built for exactly these schema
  // versions; records live forever and readers dispatch on the tag (ADR 007/
  // 016), so a mismatched tag must be a loud failure, never a silent
  // misinterpretation (adversarial-review finding, 2026-07-03).
  if (record.schemaVersion !== AUDIT_SCHEMA_VERSION) {
    problems.push(
      `record schema_version ${record.schemaVersion} is not the v${AUDIT_SCHEMA_VERSION} this reconstructor handles`,
    );
  }
  if (response.schemaVersion !== RESPONSE_SCHEMA_VERSION) {
    problems.push(
      `envelope schemaVersion ${response.schemaVersion} is not the v${RESPONSE_SCHEMA_VERSION} this reconstructor handles`,
    );
  }
  if (response.kind === 'answer' && response.answer.schemaVersion !== ANSWER_SCHEMA_VERSION) {
    problems.push(
      `answer schemaVersion ${response.answer.schemaVersion} is not the v${ANSWER_SCHEMA_VERSION} this reconstructor handles`,
    );
  }
  // The stored RESULT's own version pin, added with the #253 manifest rows
  // (tests/audit/envelope-key-manifest.test.ts now covers ValidatedResult):
  // every re-derivation below reads the stored result as a v1 shape, so a
  // future v2 result inside a v1 envelope must be a loud failure here rather
  // than a silent misreading further down — the same doctrine the three pins
  // above already apply. `schemaVersion` has been a required field of
  // ValidatedResult since the query layer's first commit (WP5), long before
  // any audit row existed, so no stored row can be missing it.
  if (response.kind === 'answer' && response.result.schemaVersion !== RESULT_SCHEMA_VERSION) {
    problems.push(
      `result schemaVersion ${response.result.schemaVersion} is not the v${RESULT_SCHEMA_VERSION} this reconstructor handles`,
    );
  }
  if (record.finalText !== response.text) {
    problems.push('final_text differs from response.text');
  }
  if (record.kind !== response.kind) {
    problems.push(`kind '${record.kind}' differs from response.kind '${response.kind}'`);
  }
  if (record.question !== response.question) {
    problems.push('question differs from response.question');
  }
  const intent = resolvedIntent(response);
  if (stableStringify(record.intent) !== stableStringify(intent)) {
    problems.push('stored intent differs from the envelope-resolved intent');
  }
  const expectedHash = intent === null ? null : intentHash(intent);
  if (record.intentHash !== expectedHash) {
    problems.push('intent_hash does not recompute from the stored intent');
  }
  const expectedReason = response.kind === 'refusal' ? response.reason : null;
  if (record.refusalReason !== expectedReason) {
    problems.push('refusal_reason differs from the envelope');
  }
  // WP16 sub-part 2 (ADR 026): the onboarding envelope field is present-only
  // on the 'onboarding_pending' reason — it carries the CBS table the fetch
  // was triggered for. A row whose reason says a fetch started but whose
  // envelope has no target (or vice versa) is internally inconsistent and
  // must not reconstruct. No FK / no data value, so this is a shape check
  // (like the reply_text/pending pairing above), not a numeric one. Only
  // refusal envelopes carry the field at all (the type system forbids it
  // elsewhere), so answers/clarifications need no check here.
  //
  // `?? null` (A1 discipline, found live 2026-07-12 re-running the owed
  // verification): rows stored before the compose-side `input.built.onboarding
  // ?? null` normalization existed (refusals.ts) never serialize the key at
  // all for non-onboarding_pending reasons — `undefined` at runtime, and
  // `undefined !== null` is `true` in JS, so the un-normalized read here
  // falsely reported "present" on ~73 real historical rows across nearly
  // every refusal reason. Confirmed empirically: the stored envelope's
  // top-level `onboarding` key is genuinely absent on those rows.
  if (response.kind === 'refusal') {
    const shouldHaveOnboarding = response.reason === 'onboarding_pending';
    const onboarding = response.onboarding ?? null;
    if (shouldHaveOnboarding !== (onboarding !== null)) {
      problems.push(
        `onboarding envelope field ${onboarding !== null ? 'present' : 'absent'} does not match reason '${response.reason}'`,
      );
    }
  }
  // #253 / row 13 (session 110, ADR 054 addendum): `QueryRefusal.refusal.
  // subReason` is the one machine-readable marker that turns an
  // `invalid_intent` (an internal fault by default, which PAGES THE OWNER
  // through src/answer/audit/alerts.ts) into one of two honest scope-limit
  // refusals: "this measure is published nationally only"
  // (region_scope_on_national_measure) and "several regions AND several
  // periods in one question" (multi_region_multi_period, row 13). Each
  // served `reason` is a pure function of its own sub-reason value
  // (refusals.ts buildQueryRefusal), so every pair must agree on a stored row
  // in BOTH directions: a row carrying a sub-reason with any other reason
  // (including the OTHER sub-reasoned one — the sibling case), or one of
  // these two reasons without its own sub-reason, records a refusal its own
  // inputs cannot produce.
  //
  // Same shape check (not a numeric one) and the same `?? null` discipline as
  // the onboarding pairing above: every refusal stored before #253 — and every
  // other refusal since — serializes no `subReason` key at all, and
  // `undefined !== null` would flag all of them.
  if (response.kind === 'refusal') {
    const subReason = response.queryRefusal?.refusal.subReason ?? null;
    // Every subReason value maps to EXACTLY the RefusalReason it must be
    // paired with — additive: a future third sub-reason only needs an entry
    // here, never a rewrite of the check itself.
    const subReasonToReason: Record<string, RefusalReason> = {
      region_scope_on_national_measure: 'region_scope_on_national_measure',
      multi_region_multi_period: 'multi_region_multi_period',
    };
    const pairedReasons = new Set(Object.values(subReasonToReason));
    const mismatch = pairedReasons.has(response.reason)
      ? subReasonToReason[subReason ?? ''] !== response.reason
      : subReason !== null;
    if (mismatch) {
      problems.push(
        `queryRefusal subReason ${subReason === null ? 'absent' : `'${subReason}'`} does not match reason '${response.reason}'`,
      );
    }
  }
  const expectedResultIds =
    response.kind === 'answer' ? response.result.cells.map((c) => c.resultId) : [];
  if (stableStringify(record.resultIds) !== stableStringify(expectedResultIds)) {
    problems.push('result_ids differ from the stored result cells');
  }
  const expectedSource = response.kind === 'answer' ? response.answer.source : null;
  if (record.answerSource !== expectedSource) {
    problems.push('answer_source differs from the envelope');
  }
  const expectedChart = response.kind === 'answer' && response.chart !== null;
  if (record.chartEmitted !== expectedChart) {
    problems.push('chart_emitted differs from the envelope');
  }
  if (response.kind === 'answer') {
    const a = response.result.attribution;
    const expectedTables = [{ tableId: a.tableId, tableVersion: a.tableVersion, syncedAt: a.syncedAt }];
    if (stableStringify(record.tables) !== stableStringify(expectedTables)) {
      problems.push('tables differ from the stored attribution');
    }
    if (stableStringify(record.tableIds) !== stableStringify([a.tableId])) {
      problems.push('table_ids differ from the stored attribution');
    }
  } else if (record.tables.length > 0 || record.tableIds.length > 0) {
    problems.push('non-answer row carries table references');
  }
  // WP129+130 (#129/#130, ADR 032): the source-selection state and the
  // unverified-web section ride the envelope as additive structural fields,
  // stored VERBATIM (R8) with `?? null` reads (A1 — pre-WP rows serialize
  // neither key). Reconstruction REPLAYS the stored bytes; it never re-derives
  // the section (the web is non-deterministic). Four shape checks — no numeric
  // check (the web section is deliberately outside R1–R11's scope):
  const sourceSelection = response.sourceSelection ?? null;
  const webSection = response.webSection ?? null;
  // (a) a section can exist only when the web channel was actually selected.
  if (webSection !== null && sourceSelection?.web !== true) {
    problems.push('webSection is present but sourceSelection.web is not true');
  }
  // (b) clarification turns never carry a web section (the call is skipped).
  if (response.kind === 'clarification' && webSection !== null) {
    problems.push('webSection must be null on clarification rows');
  }
  // (c) an ok section carries 1..4 findings, each with >= 1 citation.
  if (webSection !== null && webSection.status === 'ok') {
    if (webSection.findings.length < 1 || webSection.findings.length > 4) {
      problems.push(
        `webSection ok must carry 1..4 findings, found ${webSection.findings.length}`,
      );
    }
    if (webSection.findings.some((f) => f.citations.length === 0)) {
      problems.push('webSection ok finding carries no citation');
    }
  }
  // (d) ⟨W6⟩ owed-but-unrecorded is a tamper: a web-selected non-clarification
  // turn that is not a skip-list refusal MUST carry a section (attach records
  // even the no-client case as `not_configured`, so a null here is a lie).
  // NB the ⟨W1⟩ audit-fail strip produces a SHOWN refusal with null webSection
  // but NO stored row at all — nothing for reconstruct to check, so no conflict.
  const owed =
    sourceSelection?.web === true &&
    response.kind !== 'clarification' &&
    !(
      response.kind === 'refusal' &&
      (WEBSEARCH_SKIP_REASONS as readonly string[]).includes(response.reason)
    );
  if (owed && webSection === null) {
    problems.push('a web attempt was owed (sourceSelection.web) but no webSection is recorded');
  }
  if ((record.replyText === null) !== (record.pendingClarification === null)) {
    problems.push('reply_text and pending_clarification must be set together');
  }
  // WP15 (ADR 021): a context is offered only on question turns — a reply
  // merge never also takes one (one merge candidate per parse).
  if (record.conversationContext !== null && record.replyText !== null) {
    problems.push('conversation_context must be null on clarification-reply rows');
  }
}

// ADR 055 pass-4 rows 12+13 (2026-09-17): `renderRegionSeries` (template.ts)
// changed `region_series` bodies' BYTES — full CBS-qualified labels, one "– "
// line per region — hours after the shape itself first shipped (commit
// f923f31, ~13:50 UTC same day, ADR 055's own go-live). A row stored in that
// narrow live window has a stored `body`/`final_text` in the OLD shape,
// exactly what the user actually saw (R8's own promise), while
// `renderTemplateBody` today produces the NEW shape — the ordinary
// "row stored under an older, less-safe/less-readable rule" scenario
// known-divergences.ts's module header already documents for two OTHER
// rows (id 76, id 227).
//
// This is deliberately NOT a third entry in that file's `KNOWN_DIVERGENCES`
// array: that register is per-ROW-ID by its own stated discipline ("one
// entry per row, never a range or a pattern"), and no real audit_answers id
// can be named from this hermetic worktree — there is no database
// connection here (same unresolved gap ADR 055's own "Verified" section
// already flags: `npm run audit:verify` against the live DB was not run in
// any hermetic worktree task for this ADR). Inventing a placeholder id would
// violate that register's own anti-pattern rule and silently swallow a real,
// different problem on whatever row happens to get that id later.
//
// Instead this is the file's OTHER documented mechanism: a small, NAMED,
// narrowly-scoped tolerance living directly in the reconstruction check
// itself (known-divergences.ts's header names two examples — the
// `attribution.source` A1 fallback and the `trendHeadline` optional-v1-field
// exception) — except keyed on `createdAt` rather than on one field's
// presence, because what changed here is an entire rendering FORMAT for one
// shape, not one optional field. A row's body is judged against
// `renderRegionSeriesLegacyPreLineFormat` (byte-identical to how
// `renderRegionSeries` shipped at f923f31) when `createdAt` predates this
// cutoff, and against TODAY's `renderTemplateBody` otherwise — so a
// genuinely pre-change row reconstructs TRUE, not merely "known-divergent".
//
// The cutoff is this change's own authoring timestamp (verified against
// `date -u`, not recalled) — a deliberately conservative bound, since no
// commit can be deployed before it is made. The tiny window between this
// commit and its actual deploy could in principle hold one more
// old-format row; open-questions tracks a follow-up for a session with live
// DB access to run `npm run audit:verify` across the f923f31→deploy window
// once and confirm, or register a specific known-divergences.ts id entry
// (following its own id-76/id-227 examples) for any row this tolerance does
// not cover.
const REGION_SERIES_LINE_FORMAT_CUTOFF = Date.parse('2026-09-17T15:30:00.000Z');

function checkAnswerReconstruction(record: AuditRecord, problems: string[]): void {
  const response = record.response as AnswerResponse;
  const result = response.result as ValidatedResult;
  const answer = response.answer;

  // R1/R3/R9/R10/R11 from the record: the stored body against the stored
  // result. The validator is deterministic, so a body that passed at compose
  // time passes again — unless the stored result no longer backs it.
  const validation = validateAnswerBody(answer.body, result);
  if (!validation.ok) {
    // #121 (owner decision 2026-07-24, option A — serve + alert): a template
    // body its own validator rejected is SERVED with the verdict recorded, so
    // a stored ok:false on a template answer marks the failure as KNOWN at
    // serve time (a validator blind spot, made loud by the admin alert) —
    // triage it apart from silent corruption. Once the validator blind spot
    // is fixed, this re-validation passes and the row heals (the PR-15
    // pattern); until then the distinct label keeps audit:verify honest.
    const knownAtServe = answer.source === 'template' && answer.validation?.ok === false;
    const label = knownAtServe
      ? 'stored template body was KNOWN-failing at serve time (#121 serve+alert)'
      : 'stored body fails re-validation against stored result';
    problems.push(...validation.problems.map((p) => `${label}: ${p}`));
  }

  // R4, positional: the attribution line must re-derive byte-identically from
  // the stored attribution fields.
  const attribution = buildAttributionLine(result);
  if (answer.attributionLine !== attribution) {
    problems.push('attribution line does not re-derive from the stored attribution');
  }

  // Structural lines re-derive from stored fields via the SAME shared builder
  // compose.ts uses (buildDefinitionLine) — so a real onboarded definition
  // (definitionText, #115 b) and the circular-title suppression (#115 a) both
  // re-derive byte-identically instead of drifting from the composer.
  const definitionLine = buildDefinitionLine(result);
  if (answer.definitionLine !== definitionLine) {
    problems.push('definition line does not re-derive from the stored attribution');
  }

  // #39: the alternate-reading disclosure re-derives from the stored
  // attribution's own alternates through the SAME builder compose.ts used.
  // `?? null` (A1, docs/13): pre-#39 rows and answers without alternates
  // serialize no key at all.
  const alternatesLine = buildAlternatesLine(result);
  if ((answer.alternatesLine ?? null) !== alternatesLine) {
    problems.push('alternate-reading line does not re-derive from the stored attribution');
  }

  // WP26 mechanism B (ADR 024): the defaulted-axis disclosure re-derives from
  // the stored result's own flags (`regionDefaulted` / `periodDefaulted`,
  // read inside buildAssumptionLine) through the SAME builder compose.ts used —
  // R8's point being that the assumption the user was shown must be a function
  // of the recorded state, not a policy this reader re-decides. `?? null` (A1):
  // pre-WP26 rows serialize no key, and `undefined !== null` would flag every
  // one of them.
  const assumptionLine = buildAssumptionLine(result);
  if ((answer.assumptionLine ?? null) !== assumptionLine) {
    problems.push('assumption line does not re-derive from the stored result');
  }

  // #253: the region-class coverage disclosure re-derives from the stored
  // COVERAGE RECORD (`result.regionSet`) through the SAME builder compose.ts
  // used. This is where a tampered coverage record fails: `complete`, and the
  // notApplicable/withheld/missing partition, are exactly what the sentence
  // states — and `complete` is also what suppresses the ranking derivation
  // (RS1), so a row whose coverage was edited after the fact no longer
  // reconstructs the line the user actually read. `?? null` (A1): every
  // non-region-class answer, and every row stored before #253, serializes no
  // key at all.
  const regionSetLine = buildRegionSetLine(result);
  if ((answer.regionSetLine ?? null) !== regionSetLine) {
    problems.push('region-set coverage line does not re-derive from the stored result');
  }

  // ADR 055 / MS1: the multi-region-series coverage disclosure re-derives from
  // the stored per-region COVERAGE RECORD (`result.regionSeries`) through the
  // SAME builder compose.ts used — the sibling of the region-set check above,
  // and the same argument: the coverage record has no independent ground truth
  // at audit time, but the sentence the user actually read is a pure function
  // of it. It is where a tampered coverage record fails: `complete` decides
  // whether there is a disclosure at all, the partial/excluded partition
  // decides which sentence names a region and whether it is named by its
  // verbatim CBS label or its bare code, and the digits ("N van de M gevraagde
  // jaren") come from the SERVED CELLS — so a roster edited after the fact
  // disagrees loudly with the cells stored beside it. It is also the ledger of
  // MS1: a region in either bucket has no derivation record, hence no clause in
  // the body. `?? null` (A1): every answer that is not a multi-region series,
  // every COMPLETE one (nothing to disclose), and every row stored before ADR
  // 055 serializes no key at all.
  const regionSeriesLine = buildRegionSeriesLine(result);
  if ((answer.regionSeriesLine ?? null) !== regionSeriesLine) {
    problems.push('region-series coverage line does not re-derive from the stored result');
  }

  // #253: unlike every other answer body, a region-class body has a
  // DETERMINISTIC ground truth — composeAnswer is template-only BY SHAPE for
  // `region_set` (never an LLM call, so never LLM prose), and
  // renderTemplateBody is a pure function of the stored result. So this one
  // shape's body is re-derived byte-identically rather than only re-validated:
  // the validator accepts any body whose digits are backed by stored cells,
  // which would let a dropped or reordered claim through on the shape where
  // RS1 makes the claim-set itself the honesty question. Scoped to
  // `region_set` on purpose — for an LLM-written body there is nothing to
  // re-derive against, which is why `body` stays `revalidated` everywhere
  // else (see tests/audit/envelope-key-manifest.test.ts).
  //
  // ADR 055 adds the SECOND such shape, on the same two grounds: a
  // `region_series` answer is template-only by shape too (compose.ts and
  // respond.ts both, Task 4), and MS1 makes its claim-SET the honesty question
  // exactly as RS1 does for the region class — which regions the body spoke
  // about, and with which direction word, must be a function of the stored
  // per-region derivations, not of what the validator happens to tolerate.
  if (result.shape === 'region_set' || result.shape === 'region_series') {
    if (answer.source !== 'template') {
      problems.push(`a ${result.shape} answer must be template-composed, stored source is '${answer.source}'`);
    }
    // The SPLICED body is what compose stores (assemble → applyUnitExpansions),
    // so the re-derivation applies the same splice. ADR 055 pass-4 rows
    // 12+13: a `region_series` row stored before this change's cutoff
    // re-derives against the LEGACY renderer instead (see
    // REGION_SERIES_LINE_FORMAT_CUTOFF's own comment above) — every other
    // case (region_set, or a region_series row from today's format onward)
    // re-derives through today's renderTemplateBody exactly as before.
    const templateBody =
      result.shape === 'region_series' && Date.parse(record.createdAt) < REGION_SERIES_LINE_FORMAT_CUTOFF
        ? renderRegionSeriesLegacyPreLineFormat(result)
        : renderTemplateBody(result);
    const rederivedBody = applyUnitExpansions(templateBody, result);
    if (answer.body !== rederivedBody) {
      const label = result.shape === 'region_set' ? 'region-set' : 'region-series';
      problems.push(`${label} body does not re-derive from the stored result`);
    }
  }
  const markingLine = isDerivedResult(result) ? `— ${DERIVED_DATA_MARKING}` : null;
  if (answer.markingLine !== markingLine) {
    problems.push('derived-data marking line does not re-derive from the stored derivations');
  }

  // The rendered text re-assembles byte-identically from its stored parts —
  // in the SAME order compose.ts assembles them (assumption → region-set
  // coverage → region-series coverage → definition → alternates → marking →
  // attribution). The two coverage lines can never co-occur in practice (a
  // region CLASS over several periods is still refused), but the order is
  // fixed here and in compose.ts either way.
  const text = [
    answer.body,
    '',
    ...(assumptionLine ? [assumptionLine] : []),
    ...(regionSetLine ? [regionSetLine] : []),
    ...(regionSeriesLine ? [regionSeriesLine] : []),
    ...(definitionLine ? [definitionLine] : []),
    ...(alternatesLine ? [alternatesLine] : []),
    ...(markingLine ? [markingLine] : []),
    attribution,
  ].join('\n');
  if (answer.text !== text) {
    problems.push('answer text does not re-assemble from its stored parts');
  }
  const finalText =
    response.stalenessWarning === null ? answer.text : `${answer.text}\n\n${response.stalenessWarning}`;
  if (response.text !== finalText) {
    problems.push('response text does not re-assemble from answer text + staleness warning');
  }

  // #144 (ADR 034): the semantic-check verdict is RECORDED, never re-derived
  // — an LLM judgment has no deterministic ground truth inside the record
  // (the same policy that keeps llm_calls out of reconstruction). What IS
  // deterministic is its SCOPE: the suspect list is a pure function of the
  // stored body + result, so a verdict claiming a different scope, a status
  // inconsistent with that scope, or a fabricated=true verdict riding a
  // SERVED body all fail loudly. Absent key (`?? null`, A1) = feature off /
  // pre-#144 row — nothing to check.
  const semanticCheck = answer.semanticCheck ?? null;
  if (semanticCheck !== null) {
    if (answer.source === 'template') {
      problems.push('semanticCheck present on a template body — the checker never runs on templates');
    }
    if (semanticCheck.schemaVersion !== SEMANTIC_CHECK_SCHEMA_VERSION) {
      problems.push(
        `semanticCheck schemaVersion ${semanticCheck.schemaVersion} is not the v${SEMANTIC_CHECK_SCHEMA_VERSION} this reconstructor handles`,
      );
    } else {
      const expectedSuspects = findSuspectTokens(answer.body, result);
      if (stableStringify(semanticCheck.suspects) !== stableStringify(expectedSuspects)) {
        problems.push('semanticCheck suspects do not re-derive from the stored body and result');
      }
      if (semanticCheck.status === 'skipped_no_suspects') {
        if (expectedSuspects.length !== 0) {
          problems.push('semanticCheck says skipped_no_suspects but the stored body has residual-prone tokens');
        }
        if (semanticCheck.verdicts !== null || semanticCheck.model !== null || semanticCheck.error !== null) {
          problems.push('semanticCheck skipped_no_suspects must carry no verdicts, model or error');
        }
      } else if (semanticCheck.status === 'ok') {
        if (expectedSuspects.length === 0) {
          problems.push('semanticCheck says the checker ran (ok) but the stored body has no residual-prone tokens');
        }
        if (semanticCheck.model === null) {
          problems.push("semanticCheck 'ok' without the model that judged");
        }
        if (semanticCheck.verdicts === null) {
          problems.push("semanticCheck 'ok' without recorded verdicts");
        } else {
          const ids = [...semanticCheck.verdicts.map((v) => v.id)].sort((a, b) => a - b);
          if (ids.length !== expectedSuspects.length || ids.some((id, i) => id !== i)) {
            problems.push('semanticCheck verdicts do not cover the suspects exactly once');
          }
          if (semanticCheck.verdicts.some((v) => v.fabricated)) {
            problems.push('a served body carries a fabricated=true semantic verdict — rejected bodies are never served');
          }
        }
      } else if (semanticCheck.status === 'error') {
        // A served body with a checker error can only exist under fail_open;
        // fail_closed drops such a body down the ladder before assemble.
        if (semanticCheck.mode !== 'fail_open') {
          problems.push("semanticCheck status 'error' on a served body requires fail_open mode");
        }
        if (semanticCheck.verdicts !== null || semanticCheck.model !== null) {
          problems.push("semanticCheck 'error' must carry no verdicts or model");
        }
        if (semanticCheck.error === null) {
          problems.push("semanticCheck 'error' without the error message");
        }
      } else {
        problems.push(`unknown semanticCheck status '${String((semanticCheck as { status: unknown }).status)}'`);
      }
    }
  }

  // #162 (ADR-DRAFT slot-filling, hermetic half): when the slot rung wrote
  // the body, the record stores the raw placeholder body + the slot map —
  // and BOTH re-derive. The slot menu/map is a pure function of the stored
  // result (buildSlotContext), so a forged binding fails byte-comparison; the
  // stored body must re-derive BYTE-IDENTICALLY by re-filling the stored raw
  // body through the same deterministic filler (+ the same unit-expansion
  // splice assemble() applies) — the ADR-draft's §1 R1/R8 rule, the same
  // re-derivation pattern the attribution line uses, now covering every
  // number in the body. Absent key (`?? null`, A1) = flag off / pre-#162 row.
  const slotPhrasing = answer.slotPhrasing ?? null;
  if (slotPhrasing !== null) {
    if (answer.source === 'template') {
      problems.push('slotPhrasing present on a template body — the slot rung never serves templates');
    }
    if (slotPhrasing.schemaVersion !== SLOT_PHRASING_SCHEMA_VERSION) {
      problems.push(
        `slotPhrasing schemaVersion ${slotPhrasing.schemaVersion} is not the v${SLOT_PHRASING_SCHEMA_VERSION} this reconstructor handles`,
      );
    } else {
      const context = buildSlotContext(result);
      if (stableStringify(slotPhrasing.slots) !== stableStringify(context.bindings)) {
        problems.push('slotPhrasing slot map does not re-derive from the stored result');
      }
      const slotValidation = validateSlotBody(slotPhrasing.rawBody, context);
      if (!slotValidation.ok) {
        problems.push(
          ...slotValidation.problems.map((p) => `stored raw placeholder body fails slot re-validation: ${p}`),
        );
      }
      const refilled = applyUnitExpansions(fillSlots(slotPhrasing.rawBody, context), result);
      if (refilled !== answer.body) {
        problems.push('stored body does not re-derive from the stored raw placeholder body via the slot filler');
      }
    }
  }

  // R6+R8: the chart the user saw is exactly what the stored result produces
  // through the same deterministic builder — and it still validates.
  const rederived = buildChartSpec(result);
  // ADR 014 optional-v1-field tolerance, narrowly scoped to `trendHeadline`
  // only (#197 whole-branch review, C2): a row stored BEFORE this field
  // existed has no `trendHeadline` key in its stored attribution, but
  // rebuilding from the very same (unchanged) result now DOES produce one —
  // so a raw byte comparison would falsely flag every historical row with a
  // `direction` derivation as "not re-deriving". When the STORED spec has no
  // `trendHeadline` key, strip the key from the REBUILT spec before
  // comparing. When the stored spec DOES carry the key, it is compared
  // verbatim below — so a genuinely wrong/corrupted stored value still fails
  // loudly. This is not a general "tolerate any additive field" mechanism;
  // it names exactly the fields this exception covers — two today:
  //
  //  - `attribution.trendHeadline` (#197, above);
  //  - `regionScope` (chart co-pilot phase 5b, the verified whole): the
  //    region-class provenance `buildChartSpec` now emits on EVERY spec
  //    (a real scope for a region_set answer, an explicit `null` for every
  //    other chart). Every spec stored before this field existed — not only
  //    region-set rows, every chart-bearing row — carries no `regionScope`
  //    key at all, while the rebuilt spec always carries one, so the same
  //    strip-if-absent rule applies: stored key absent → strip it from the
  //    rebuilt side; stored key present (null or a scope) → compared verbatim
  //    below, so a tampered or wrong stored scope still fails loudly.
  let comparableRederived = rederived;
  if (
    response.chart !== null &&
    rederived !== null &&
    !('trendHeadline' in response.chart.attribution)
  ) {
    const attribution = { ...rederived.attribution };
    delete attribution.trendHeadline;
    comparableRederived = { ...rederived, attribution };
  }
  if (response.chart !== null && comparableRederived !== null && !('regionScope' in response.chart)) {
    const stripped = { ...comparableRederived };
    delete stripped.regionScope;
    comparableRederived = stripped;
  }
  if (stableStringify(response.chart) !== stableStringify(comparableRederived)) {
    problems.push('chart spec does not re-derive from the stored result');
  }
  if (response.chart !== null) {
    const parsed = chartSpecSchema.safeParse(response.chart);
    if (!parsed.success) {
      problems.push(`stored chart spec fails schema validation: ${parsed.error.message}`);
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ADR 058 (English answers, Task 7): R8 for the English rendering
// (AnswerResponse.english, present only when translation was attempted —
// A1). What "reconstructs" means here mirrors the rest of this file:
//
//  - The DETERMINISTIC half (glossary, caveats, maskedDutch, maskTable) is a
//    pure function of the stored response — re-derived through
//    `prepareTranslation`, the SAME function `translateAnswer` itself calls
//    — and compared byte-identically against what was stored.
//  - The MODEL-TRANSLATED half (`rawTranslation`) has no ground truth of its
//    own (like `answer.body`'s LLM half) — but EVERYTHING around it
//    re-derives: it must still pass `checkTranslation` against the
//    re-derived maskedDutch/glossary, and re-filling it through the
//    RE-DERIVED maskTable (never the possibly-tampered stored one — the same
//    doctrine the #162 slot-phrasing check applies) must reproduce the
//    stored `body`/chip labels byte-identically. The chip `submit` values
//    are checked against `response.suggestions` directly — they carry no
//    translated text, only the Dutch chip's take-intent labels.
//  - The structural lines and the final text re-assemble byte-identically
//    from that re-filled prose, through the same builders `translateAnswer`
//    uses (buildEnglishLines, assembleEnglishText, translateStalenessWarning).
//  - A `fallback` rendering carries no body/lines/text/chips and at least one
//    failed attempt — the shape `translateAnswer` guarantees on that status.
//
// `rawTranslation` is stored jsonb: `translateAnswer` never stores a
// shape-invalid value there, but reconstruction treats every stored field as
// untrusted and shape-checks it (isTranslationItemsShape) before ever calling
// checkTranslation/fillPlaceholders on it — a malformed value pushes a
// problem, never throws.
/** Final-review fold-in 1: the stored `english` jsonb is untrusted — a
 * minimal shape guard over every field reconstruction reads, so a malformed
 * value (null, non-array attempts/chips, missing fields) becomes ONE
 * `english:` problem instead of a TypeError that aborts a whole
 * audit:verify run. */
function englishShapeProblem(english: unknown): string | null {
  if (typeof english !== 'object' || english === null || Array.isArray(english)) return 'stored english is not an object';
  const e = english as Record<string, unknown>;
  const isObj = (v: unknown) => typeof v === 'object' && v !== null && !Array.isArray(v);
  const strOrNull = (v: unknown) => v === null || typeof v === 'string';
  if (typeof e.status !== 'string') return 'stored english.status is not a string';
  if (!Array.isArray(e.attempts) || !e.attempts.every((a) => isObj(a) && typeof (a as { ok: unknown }).ok === 'boolean')) {
    return 'stored english.attempts is not an array of attempts';
  }
  if (!Array.isArray(e.chips) || !e.chips.every((c) => isObj(c) && typeof (c as { label: unknown }).label === 'string' && typeof (c as { submit: unknown }).submit === 'string')) {
    return 'stored english.chips is not an array of {label, submit}';
  }
  if (!Array.isArray(e.maskTable)) return 'stored english.maskTable is not an array';
  if (!('maskedDutch' in e) || !('rawTranslation' in e)) return 'stored english lacks maskedDutch/rawTranslation';
  if (!strOrNull(e.body) || !strOrNull(e.text) || !strOrNull(e.stalenessWarning)) return 'stored english.body/text/stalenessWarning is not a string or null';
  if (!(e.lines === null || isObj(e.lines))) return 'stored english.lines is not an object or null';
  return null;
}

function checkEnglishReconstruction(record: AuditRecord, problems: string[]): void {
  const shapeProblem = englishShapeProblem((record.response as AnswerResponse).english);
  if (shapeProblem !== null) {
    problems.push(`english: ${shapeProblem}`);
    return;
  }
  try {
    checkEnglishReconstructionUnguarded(record, problems);
  } catch (error) {
    // Belt and braces: anything the guard above did not anticipate is still
    // a reconstruction problem on THIS row, never a thrown run.
    problems.push(`english: reconstruction threw (${errorMessage(error)})`);
  }
}

function checkEnglishReconstructionUnguarded(record: AuditRecord, problems: string[]): void {
  const response = record.response as AnswerResponse;
  const english = response.english;
  if (english === undefined) return;

  let prep: PreparedTranslation | null = null;
  try {
    prep = prepareTranslation(response);
  } catch (error) {
    // `translateAnswer` itself falls back to Dutch when prepareTranslation
    // throws (e.g. an unmapped provisional-marker caveat) — a stored row can
    // therefore legitimately be `fallback` with nothing further to re-derive
    // the deterministic half against. Anything OTHER than `fallback` here is
    // a contradiction: the record claims a translation attempt succeeded
    // past a step that cannot even be re-run against the stored response.
    if (english.status !== 'fallback') {
      problems.push(
        `english: prepareTranslation cannot re-derive from the stored response (${errorMessage(error)}), but status is '${english.status}'`,
      );
    }
  }

  if (prep !== null) {
    if (stableStringify(prep.maskedDutch) !== stableStringify(english.maskedDutch)) {
      problems.push('english: maskedDutch does not re-derive from the stored response');
    }
    if (stableStringify(prep.maskTable) !== stableStringify(english.maskTable)) {
      problems.push('english: maskTable does not re-derive from the stored response');
    }
  }

  if (english.status === 'fallback') {
    if (english.body !== null || english.lines !== null || english.text !== null || english.chips.length > 0) {
      problems.push('english: fallback status must carry null body/lines/text and no chips');
    }
    if (!english.attempts.some((a) => !a.ok)) {
      problems.push('english: fallback status but no attempt is recorded as failed');
    }
    return;
  }

  if (english.status !== 'verified') {
    problems.push(`english: unknown status '${String((english as { status: unknown }).status)}'`);
    return;
  }

  // From here the record claims `verified` — everything below needs `prep`
  // (already pushed as a contradiction above when it is null).
  if (prep === null) return;

  if (english.rawTranslation === null) {
    problems.push('english: verified status but rawTranslation is null');
    return;
  }
  if (!isTranslationItemsShape(english.rawTranslation)) {
    problems.push('english: stored rawTranslation is not shape-valid TranslationItems');
    return;
  }
  const rawTranslation = english.rawTranslation;
  const checkProblems = checkTranslation({ maskedDutch: prep.maskedDutch, english: rawTranslation, glossary: prep.glossary });
  if (checkProblems.length > 0) {
    problems.push(`english: stored verified rawTranslation fails re-check (${checkProblems.join('; ')})`);
    return;
  }

  let filledBody: string;
  let filledChips: string[];
  let filledDefinition: string | null;
  let filledAlternates: string[];
  try {
    filledBody = fillPlaceholders(rawTranslation.body, prep.maskTable);
    filledChips = rawTranslation.chips.map((chip) => fillPlaceholders(chip, prep.maskTable));
    filledDefinition = rawTranslation.definition === null ? null : fillPlaceholders(rawTranslation.definition, prep.maskTable);
    filledAlternates = rawTranslation.alternates.map((alt) => fillPlaceholders(alt, prep.maskTable));
  } catch (error) {
    problems.push(`english: re-filling the stored rawTranslation failed (${errorMessage(error)})`);
    return;
  }

  if (filledBody !== english.body) {
    problems.push('english: body does not re-derive from rawTranslation + maskTable');
  }
  if (filledChips.length !== english.chips.length) {
    problems.push('english: chip count does not re-derive from rawTranslation');
  } else {
    filledChips.forEach((label, i) => {
      if (english.chips[i]!.label !== label) {
        problems.push(`english: chip ${i + 1} label does not re-derive from rawTranslation + maskTable`);
      }
      if (english.chips[i]!.submit !== response.suggestions[i]) {
        problems.push(`english: chip ${i + 1} submit does not equal response.suggestions[${i}]`);
      }
    });
  }

  const lines = buildEnglishLines(response.result, { definition: filledDefinition, alternates: filledAlternates });
  if (stableStringify(lines) !== stableStringify(english.lines)) {
    problems.push('english: lines do not re-derive from the stored result and re-filled prose');
  }

  const stalenessWarning = response.stalenessWarning === null ? null : translateStalenessWarning(response.stalenessWarning);
  if (stalenessWarning !== english.stalenessWarning) {
    problems.push('english: stalenessWarning does not re-derive from response.stalenessWarning');
  }

  const text = assembleEnglishText(filledBody, lines, stalenessWarning);
  if (text !== english.text) {
    problems.push('english: text does not re-assemble from the re-filled body, lines and staleness warning');
  }
}

/** Verifies that the record reconstructs its response, from the stored row
 * alone. Empty problems = R8 holds for this record. */
export function reconstructionReport(record: AuditRecord): ReconstructionReport {
  const problems: string[] = [];
  checkEnvelopeIntegrity(record, problems);
  if (record.response.kind === 'answer') {
    checkAnswerReconstruction(record, problems);
    if (record.response.english !== undefined) {
      checkEnglishReconstruction(record, problems);
    }
  }
  return { ok: problems.length === 0, problems };
}
