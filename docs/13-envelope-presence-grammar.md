# The envelope presence grammar

> **What this is.** One page saying what it MEANS when a field is missing from a stored response envelope.
> Recommendation 6 of the [2026-07-25 architecture review](session-briefs/2026-07-25-wp26-architecture-review-memo.md),
> written because the rule existed only as per-field comments — and a convention that lives in field comments
> forks. It already had: `suggestions` is present-only on one response kind and required on two others, and
> nobody decided that, it just happened.
>
> **Scope:** `ComposedResponse` ([src/answer/respond/types.ts](../src/answer/respond/types.ts)),
> `ComposedAnswer` ([src/answer/compose/types.ts](../src/answer/compose/types.ts)),
> `PendingClarification`, and the two WP26 flags on `ValidatedResult`.
> **The mechanical half** is [tests/audit/envelope-key-manifest.test.ts](../tests/audit/envelope-key-manifest.test.ts),
> which fails when a new envelope key lands without a decision about its R8 treatment. This doc is the part a
> test cannot state: *why* the shapes differ.

## Why absence is load-bearing here

Audit rows live forever and are re-read by code written long after them ([R8](05-data-rules.md)). An envelope
stored in July 2026 will be reconstructed by a reader shipped in 2027. So "the key is not there" is not a
detail of serialization — it is the only signal that a row predates a feature, or was served while a flag was
off. Getting it wrong has already cost real time twice:

- **The WP16 `onboarding` lesson (found live, 2026-07-12).** Reconstruction read `response.onboarding !== null`
  to decide whether an onboarding envelope was present. On ~73 historical refusal rows the key was genuinely
  absent — and `undefined !== null` is `true` in JavaScript — so the check reported "present" on nearly every
  refusal reason. The fix is the `?? null` normalisation now written into every reader.
- **The WP26 disclosure flags, avoided by applying that lesson (session 56).** `regionDefaulted` and
  `periodDefaulted` are present-only booleans, so `buildAssumptionLine` reads them as `?? false`: without it,
  `undefined !== false` would have rendered a defaulted-axis disclosure on ~every historical row — a sentence
  claiming an assumption the answer never made. The comment in
  [format.ts](../src/answer/compose/format.ts) names the WP16 field as the reason it was written that way.

## The four shapes

| Shape | Declaration | Absent means | How a reader must handle it |
|---|---|---|---|
| **Always present** | `x: T` | — (a missing key is corruption) | Read directly; a missing key is a loud failure. |
| **Required-nullable** | `x: T \| null` | — (the key is always written) | `null` is a *decision*: "there was none here". Distinguish it from absence, which should not occur. |
| **Present-only** | `x?: T` | the feature was off, or the row predates it | `?? <empty>` — never `hasOwnProperty` as a feature probe. |
| **Present-only nullable** | `x?: T \| null` | same as present-only | `?? null`, and treat `undefined` and `null` as **the same thing**. This is the shape the WP16 bug was hiding in. |

**The rule for new fields.** Default to **present-only** for anything additive. It keeps every previously
stored envelope byte-identical, which means no migration and no reconstruction change for history. Choose
required-nullable only when `null` carries information a reader must act on differently from "not applicable"
— `RefusalResponse.freshness` is the model: a freshness refusal has a payload, every other refusal has `null`,
and that difference is checked.

## The current inventory

**Present-only** (absent = off/pre-feature):
`ResponseBase.sourceSelection`, `ResponseBase.webSection` (both also nullable),
`ComposedAnswer.assumptionLine` (nullable), `ComposedAnswer.alternatesLine` (nullable, #39),
`ComposedAnswer.semanticCheck`,
`ComposedAnswer.slotPhrasing` (#162, flag `SLOT_PHRASING_ENABLED` — absent on every flag-off,
pre-#162 and template envelope),
`ClarificationResponse.suggestions`, `RefusalResponse.pending`, `AnswerResponse.pending` (#197 step 3 — the
comparison chips' carrier; absent when `CLARIFY_CLICK_ENABLED` is off or nothing survived the dry-run),
`PendingClarification.clickOptions`, `PendingClarification.rescueOnly`,
`PendingClarification.conversationContext` (nullable),
and on the query side `ValidatedResult.regionDefaulted` / `.periodDefaulted` and
`Attribution.alternates` (#39 — absent on explicit targets, on canonical measures without
registry-recorded alternates, and on every row stored before #39).

**Required-nullable:** `AnswerResponse.chart`, `AnswerResponse.stalenessWarning`,
`ComposedAnswer.definitionLine`, `ComposedAnswer.markingLine`, `ComposedAnswer.model`,
`RefusalResponse.offer` / `.guidance` / `.freshness` / `.parse` / `.queryRefusal` / `.internalNote` /
`.onboarding`.

Everything else is always present.

## The `suggestions` fork — deliberate, and worth keeping

Three response kinds carry a `suggestions` field and they are **not** the same shape:

| Kind | Declaration | Empty state |
|---|---|---|
| `AnswerResponse` | `suggestions: string[]` | `[]` |
| `RefusalResponse` | `suggestions: string[]` | `[]` |
| `ClarificationResponse` | `suggestions?: string[]` | **key absent** |

The asymmetry is not an oversight, and the review's finding was that nothing recorded *why*. Here it is: the
answer- and refusal-side chip fields (WP29 #73, #134a) were introduced as unconditional structural fields, so
`[]` is their honest empty state and every row since carries the key. The clarification-side field arrived
with WP26 mechanism A behind `CLARIFY_CLICK_ENABLED`, and a flag that is off must leave the envelope
**byte-identical** to the pre-WP26 one — a serialized `[]` would not be. So it is present-only.

The rule this generalises to: **a field introduced behind a flag is present-only; a field introduced
unconditionally uses its natural empty value.** If `CLARIFY_CLICK_ENABLED` is ever retired as permanently-on,
converting the clarification field to the unconditional shape is a deliberate migration, not a tidy-up — every
stored clarification row from the flag-off era would then have a key its readers must still tolerate missing.

## What this does NOT govern

Nothing here changes what R8 *checks*. A present-only field is not thereby exempt from reconstruction, and a
required field is not thereby checked — those are separate decisions, and they are the ones the
[envelope-key manifest test](../tests/audit/envelope-key-manifest.test.ts) records per field. Presence grammar
answers "what does absence mean"; the manifest answers "what does the auditor do with it".
