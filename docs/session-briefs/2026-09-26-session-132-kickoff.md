# Session 132 kickoff (written 2026-09-26, end of session 131)

Read order: `CLAUDE.md` → `docs/STATUS.md` top block → this file. Verify every claim here against `git log`,
`gh run list --branch main -L 3`, `gh pr list` and prod (`curl https://checkdecijfers.vercel.app/`) before acting on it.

## Where things stand

- **`main` is live and green.** Last code CI run on `main`: 36131271620 (re-run on 2026-09-25 to deploy the publish
  flag; green incl. deploy). Everything after it on `main` is docs-only. Prod 200.
- **Own-data chart publishing is LIVE** (session 131): migration 036 applied, `OWN_DATA_PUBLISH_ENABLED=1` in Vercel
  Production. Still to do, owner signed in: publish a chart from an own file → open the link in a private window →
  unpublish → link dies (RUNBOOK "Own-data publishing (ADR 057) — switching it on", step 4).
- **Owner decisions taken session 131:** #271 fully translate answers for English readers, official CBS names too;
  #256 3D demo stays behind login; #260 colour-blind safety no longer a rule for the default palette, change nothing
  now; #314 incomplete-total note stays screen-only; #275 homepage looks row: try again later; #250(a) Eurostat Dutch
  wording approved.
- **Open Dependabot PRs #47 and #48** (opened 2026-09-26) — not looked at yet.

## The single next priority: finish English answers phase 1 (ADR 058, #271)

- Branch `english-answers-phase1` @ `d9b632f1` (pushed, NOT merged, no PR yet). Worktree kept at
  `.claude/worktrees/english-answers` with APFS-cloned `node_modules` (RUNBOOK multi-agent item 16). If the worktree
  is gone: `git worktree add .claude/worktrees/english-answers english-answers-phase1`, re-clone node_modules.
- Spec (binding; updated on the branch with C7/C8): `docs/superpowers/specs/2026-09-25-english-answers-design.md`.
  Plan: `docs/superpowers/plans/2026-09-25-english-answers-phase1.md`.
- Resume with `superpowers:subagent-driven-development` on that plan. Its ledger lives (git-ignored) at
  `.claude/worktrees/english-answers/.superpowers/sdd/2026-09-25-english-answers-phase1/progress.md`; a verbatim copy
  is at the end of this file — trust it and `git log` over memory. **Tasks 1–6 complete. Next: Task 7.**
- Carry into the Task 7 dispatch (binding rulings from the ledger): `prepareTranslation(response)` is the shared pure
  step (ruling 1); glossary lives in `src/answer/translate/glossary.ts` (ruling 3); digit-bearing names are ⟦G…⟧
  placeholders (ruling 9); the envelope-key manifest's `english` entry must move from `ignored` to shape-checked;
  `rawTranslation` on a malformed attempt is not a valid `TranslationItems` — reconstruction must not trust it.
- Three carried Task 6 minors to fix before any `translate:record`: system prompt rule 1 doesn't mention ⟦G…⟧ (decide
  a `TRANSLATE_PROMPT_VERSION` bump); `rawTranslation` type on malformed output; C5/C8 fail-closed deadlock when a
  digit-free name sits inside a G-masked name (detect on the masked Dutch text).
- Then Tasks 8 (web) and 9 (record/eval + docs), the final whole-branch review on the most capable tier, the full
  verify block (`scripts/verify-block.sh <dir> <log> --e2e`, solo), `/code-review` LOW, PR, green CI, owner GO.

## Standing constraints

- Principles (a)/(b)/(c). The English path must keep the Dutch path byte-identical (every existing test unmodified).
- No live DDL, real LLM spend or env-flag flips without the owner present. `translate:record` and
  `ENGLISH_ANSWERS_ENABLED` wait for the Anthropic API cap to lift (2026-10-01). Never `gh secret set`. Never
  `spawn_task`. The repo is PUBLIC.
- Owner present: standing push authorization (CLAUDE.md #118). Autonomous: branch + PR, merged on the owner's
  plain-English GO. The owner does not read code.
- **Put everything the owner must see INSIDE an AskUserQuestion question/preview or a sent file** — text written just
  above the dialog does not reach them (session 131 lesson 1).
- 8 GB machine; session 131 saw load averages up to 28 and 7 GB swap. Check `uptime` + `sysctl vm.swapusage`; one
  vitest at a time; resume a stalled subagent with SendMessage, never a new Agent.

## After the Anthropic API cap lifts (2026-10-01)

Eurostat E2a owner steps 0/5/6 (#313); the `:record` scripts; the live benchmark; `translate:record` + eval + the
English flag flip (owner-supervised).

## SDD ledger copy (verbatim, 2026-09-26)

# SDD ledger — plan: docs/superpowers/plans/2026-09-25-english-answers-phase1.md
Spec: docs/superpowers/specs/2026-09-25-english-answers-design.md (binding). Branch english-answers-phase1 @ 5ad8a8f3, worktree .claude/worktrees/english-answers (node_modules = APFS clones).

## Pre-flight scan
| Pair / task | Produces → consumes | Finding |
|---|---|---|
| T1→T4 | PLACEHOLDER_RE, hasDigitOutsidePlaceholders | consistent |
| T1→T6 | createMasker, fillPlaceholders, MaskEntry | consistent |
| T2→T4 | GlossaryEntry | consistent |
| T2→T5 | translateTableTitle/PeriodLabel/Region/MeasureTitle | consistent |
| T2→T6 | glossaryForResult, periodLabelPairs | consistent |
| T2↔T3 | english-names.data.ts maps | T3 may replace hand-written MEASURE_TITLES values with CBS's own label → T2's test literal 'Unemployment rate' may need updating (see ruling 2) |
| T4→T6 | TranslationItems, checkTranslation | consistent |
| T5→T6 | EnglishLines, dutchDefinitionContent, dutchAlternateLabels, buildEnglishLines, assembleEnglishText, translateStalenessWarning | consistent |
| T6→T7 | prepareTranslation | T7 says "export … if not already" — T6 text doesn't mandate it (ruling 1) |
| T6→T8 | AnswerResponse.english | consistent |
| T7→T8 | lang/translateClient options | consistent |
| T1 self | tests vs code | token order 1.234,5 / 1 / 000 / 3,5 matches scanner; placeholders digit-free → consistent |
| T2 self | move + re-export | web import path style must be checked by implementer (plan says so) |
| T3 self | test field name | plan flags measureTitle field name to verify |
| T4 self | C4 over masked body | fixed pre-commit in plan (5ad8a8f3); tests consistent |
| T5 self | prose templates | tests specified in prose; implementer derives fixtures |
| T6 self | fallback on unknown caveat; staleness null ⇒ fallback | consistent |
| T7 self | byte-identity harness location unspecified | implementer locates the existing hermetic benchmark harness |
| T8 self | chip split | consistent with #75 fill-don't-send |
| T9 self | RecordingLlmClient ctor | plan says check the real ctor |

Ruling 1: T6 exports a pure `prepareTranslation(response: AnswerResponse)` returning { glossary, caveats, masker entries, dutch items, maskedDutch, untranslatedNames } that translateAnswer uses, so T7 reconstruction calls the same function — spec §3.8 requires deterministic re-derivation; costs a small refactor if wrong.
Ruling 2: If T3 replaces a hand-written English label with CBS's own label, T3 updates any test literal that pinned the old label (T2 test, web cbs-words tests) — CBS's own words outrank ours (spec §3.5); cost: a changed chart label on the English site.
Task 1: minor (deferred): report line count wrong (179 vs 103); nested ternary for kind→letter could be a Record
Task 1: ⚠️ resolved — fillPlaceholders throws on unknown placeholder; T6's attachEnglish must catch (carried into T6 dispatch)
Task 1: complete (commits 5ad8a8f3..80704ebb, review clean) — implementer haiku, reviewer sonnet
Ruling 3: glossaryForResult, periodLabelPairs and GlossaryEntry live in src/answer/translate/glossary.ts (test tests/answer/translate/glossary.test.ts), NOT in src/registry/english-names.ts — english-names.ts is imported by the client chart bundle via web/lib/i18n/cbs-words.ts and must stay a pure, import-free table module (no answer/compose import, no copied baseRegionLabel). Later tasks import these three names from ../translate/glossary.ts / ./glossary.ts — cost if wrong: one moved import path.
Task 2: complete (commits 80704ebb..1eba3c36, review clean) — implementer sonnet, reviewer sonnet
Task 3: review (opus) — Needs fixes: I1 composite registry measure titles never match runtime measureTitle (80590 M004210 'Seizoengecorrigeerd', 85828 'Ongecorrigeerd'); I2 rule-3 conflict 'Prijsindex verkoopprijzen' emitted (alternates not in conflict scan); I3 rule 6 (script writes data) not built
Ruling 4: 'Ongecorrigeerd' → 'Uncorrected' (CBS's own word from 85828ENG minus its table-specific noun), CURATED — cost: slightly generic label on one table if wrong
Ruling 5: rule 6 implemented as script-written `src/registry/english-names.cbs.generated.ts` (CBS-sourced only) composed with hand/curated entries in english-names.data.ts; a test forbids a key present in both with different values — keeps regeneration possible without clobbering curated entries; cost: one extra file
Task 3: minor (deferred): DIM_LABELS hand entries not in CURATED + CURATED test excludes DIM_LABELS (plan-test conflict); digit test skips DIM_LABELS; NED TableInfos failure misreported as "no sibling"; fetchCodes drops failure reason; 'Invoerprijzen'→'Consumption of foreign products' reads oddly (CBS's own); comment "all three tables" lists two
Task 3: fix round 1/5 (3 addressed, 0 open; commits c26b1891..c1e04a8b) — OVERRIDDEN_BY_HAND allow-list (Kalendergecorrigeerd, Ongecorrigeerd, Nederland) accepted by re-review
Task 3: minor (deferred): unused DIM_LABELS import in tests/registry/english-names-data.test.ts:33; 'Prijsindex verkoopprijzen' now CONFLICTED → stays Dutch (needs open-questions row; real fix = key by table+measure)
Task 3: complete (commits 1eba3c36..c1e04a8b, review clean after 1 fix round) — implementer sonnet, reviewer opus, re-reviewer sonnet
Task 4: review (sonnet) — Approved, 0 Critical/Important; Minor: negation-blind direction check (fails safe); C1 is set-based so a positional SWAP of two number placeholders passes (plan-mandated algorithm)
Ruling 6: the swap gap is load-bearing (spec §2: a number bound to the wrong region/period is a fabricated claim), so it enters the fix loop despite the Minor label: add C7 (number placeholders keep their relative order per item) and C8 (per Dutch sentence, each number placeholder's companion period placeholders and region glossary names appear in the English sentence holding that placeholder). Both fail toward Dutch fallback; cost if wrong: extra fallbacks on legitimately reordered translations (measured after 10-01 via translate:eval).
Task 3/4: 'eurostat timeouts' in task-4 test run attributed to machine load (~18) — reviewer found no coupling; the final verify block re-checks.
Task 4: re-review of fix round 1 (a7e2388e) INTERRUPTED by owner — must be re-dispatched before Task 4 is marked complete
Owner steer 2026-09-26: (1) 'Prijsindex verkoopprijzen' — "just pick one"; (2) "15 tot 75 jaar" vs CBS "15 to 74 years" — "doesn't sound right, dive in"
Finding: Dutch "tot" is EXCLUSIVE — 80590NED Leeftijd 53050 '15 tot 25 jaar', 53310 '25 tot 45 jaar' (no overlap) ↔ 80590ENG '15 to 24 years', '25 to 44 years'. CBS's English is the same range; our digit-invariance test raised a false alarm.
Ruling 7: use CBS's own English for all 4 80590 Leeftijd codes; the digit-invariance tests get an explicit, tested exception for the exact CBS shape 'X tot Y jaar' ↔ 'X to Y-1 years' (nothing else) — cost if wrong: none found (verified against CBS both languages).
Ruling 8: 'Prijsindex verkoopprijzen' → 'Price index purchase prices' — both tables' own CBS English titles say "purchase prices" (85773ENG 'Existing own homes; purchase prices, price indices 2020=100', 85792ENG '…; purchase prices, price index 2020=100, region'); moved out of CONFLICTED into an explicit, commented hand pick — cost if wrong: 85773's measure reads "purchase" where its measure row said "selling" (same concept).
Task 3: owner-driven fix round 2 dispatched (resume a0f505c21e7680401)
Task 3: fix round 2/5 owner-driven (2 addressed, 0 open; commits a7e2388e..b10b3f83)
Task 3: complete (commits 1eba3c36..b10b3f83, review clean after 2 fix rounds)
Task 4: fix round 1/5 (1 addressed, 0 open; commits d694f3c9..a7e2388e)
Task 4: minor (deferred): C8 region companions read from the independently split UNMASKED body — could misalign if sentence counts ever differ (fails as false negative); simpler to read regions from the masked sentence (regions are never masked)
Task 4: complete (commits c1e04a8b..a7e2388e, review clean after 1 fix round) — implementer haiku, reviewers sonnet
Task 5: minor (deferred): attribution from===to decided on translated labels (safe unless translatePeriodLabel collapses two Dutch labels); >5-excluded suffix suppression and until===null assumption branch untested (mirror untested Dutch edges)
Task 5: complete (commits b10b3f83..2c07bec3, review clean) — implementer sonnet, reviewer sonnet
Task 6: review (opus) — Needs fixes: CRIT digit-bearing glossary names ('Bevolking op 1 januari', '…vanaf 1921', '15 tot 75 jaar') sent to the model AND C5 vs C2 deadlock → population answers can never verify; IMP retry suffix carries digits; IMP wrong-shape JSON throws inside translateAnswer (safety net catches but loses record, no retry)
Ruling 9: digit-bearing glossary entries (Dutch or English contains \p{Nd}) are MASKED as a new placeholder kind 'name' (⟦G…⟧, exact case-sensitive match, longest first, BEFORE caveats/periods/numbers) filled with the English name; they are removed from the glossary sent to the model and from C5 (C1 enforces them structurally). PLACEHOLDER_RE widens to [NPCG]. Pre-call gate checks the WHOLE serialized request (question + system) for digits outside placeholders — cost if wrong: a lowercase/inflected digit-bearing name falls through to number masking and gets model-translated words around a masked digit.
Ruling 10: retry suffix = fixed digit-free English description per failed check kind (deduped), never quoting item indices, counts or names — cost: less targeted retries.
Ruling 11: shape-validate parsed output (malformed ⇒ failed attempt, retry runs); also fold in reviewer minors 4-7 (retry after a client error like the Dutch ladder; staleness-shape check before any model call; rawTranslation reset per attempt; tests for every fallback path) — same function, cheap; cost: one extra call on transient API errors.
Task 6: minor (deferred): retry wording should be pinned in ADR 058 as-built (Task 9 docs)
Task 6: ⚠️ translate token usage — resolved by Task 7 (tracker.wrap('translate', client) records LlmCallRecord); manifest 'ignored' entry must become shape-checked in Task 7
Task 6: fix round 1/5 (3 addressed, 0 open; commits 55615f16..d9b632f1) — re-reviewer opus
Task 6: minor (CARRY — fix before translate:record): TRANSLATE_SYSTEM_PROMPT rule 1 doesn't mention ⟦G…⟧ name placeholders (needs a ruling + TRANSLATE_PROMPT_VERSION decision); malformed branch stores non-TranslationItems in rawTranslation (type should be unknown or null — Task 7 reconstruction must not trust it); C5/C8 can deadlock (fail-closed) when a digit-free name sits inside a G-masked name — detect regions/C5 on the masked Dutch text instead
Task 6: complete (commits 2c07bec3..d9b632f1, review clean after 1 fix round) — implementer sonnet, reviewers opus
SESSION 131 STOPPED HERE on the owner's wrap-up signal (2026-09-26). Next: Task 7 (audit wiring + R8 reconstruction). Tasks 7, 8, 9 + final whole-branch review remain. Worktree kept in place.
