# Kickoff — session 59 (after the two parallel overnight runs of 2026-07-25)

Reading order: `CLAUDE.md` → [`docs/STATUS.md`](../STATUS.md) (the ▶ block is leading) → this file.
The chat is gone; the repo is the source.

---

## Read this first: two sessions ran the same brief

The owner started **two** autonomous sessions on `2026-07-26-overnight-queue-2.md`. They detected each other,
split the queue over a cross-session channel, and both shipped. Nothing was lost, but it cost a re-run and a
lot of wall clock (with both running suites the backend suite went ~500 s → 1447 s). If you ever find another
session running in your cwd: **move to a worktree immediately, then negotiate** — do not try to share a tree.
Check `list_sessions` at startup; it is one call.

Session 58b's own record is on its branch at `docs/session-briefs/2026-07-25-session-58b-independent-review.md`,
and its worktree was at `/Users/amity/cdc-s58` (it said it would remove it — verify with `git worktree list`
and prune if it is stale).

## The state — ✅ ALL FOUR MERGED AND LIVE (updated at merge time; this section was written before it happened)

**Both WP26 flags are still OFF — that go-live is still the owner's own supervised step.** Production verified
healthy after every deploy. The owner was present in-chat and delegated the merge call (*"jij bent de expert"*);
the four went in **serially**, one deploy at a time with gate+deploy green and a canary between, per
[#173](../open-questions.md).

| Order | PR | Squash | What |
|---|---|---|---|
| 1 | [#64](https://github.com/Stefan7168/checkdecijfers/pull/64) | `58c814b` | Server Action arguments were type-checked only by `.length` — a content-block array with `.length === 1` drove a ~1 MB prompt at a flat credit price, on the **paid** path too. |
| 2 | [#67](https://github.com/Stefan7168/checkdecijfers/pull/67) | `b05a1d3` | 58b's trial hardening (non-UUID requestId reaching the LLM and failing only at the R8 insert; the landing asserting an unverified "pot is leeg"; `x-forwarded-for`/HMAC-secret defaults; the purge's bare `catch`; the cap clamp) **plus [#177](../open-questions.md)**. Rebased onto #64; guard order is `typeof question → length → trialConfigured → requestId shape`. |
| 3 | [#65](https://github.com/Stefan7168/checkdecijfers/pull/65) | `ed5f240` | The double-default test, single-sourced `NL01`, the envelope-key manifest, the query-count pin. Disjoint — floated. |
| 4 | [#66](https://github.com/Stefan7168/checkdecijfers/pull/66) | this branch | This close-out. Conflicted with #67 in `open-questions.md`, `lessons-learned.md` and the RUNBOOK — resolved by **taking both sides** (rows #179-#186 from 58b, #187-#190 from 58; both session sections kept). |

The canary between merges, for the next time: `curl -s -o /dev/null -w '%{http_code}' https://checkdecijfers.vercel.app/llms.txt` → 200.

⚠ **One trap worth carrying forward:** waiting on "the latest run on `main`" after a merge can match the
*previous* merge's already-completed run and report green for a build that has not started. Key the wait on the
merge commit's own SHA. It happened here and was caught only by comparing the run's `headSha` to `HEAD`.

## The single next priority

**The owner-supervised WP26 go-live.** Everything the last three sessions built was in service of it and it is
still not done. RUNBOOK section "WP26 answer-first + clickable options". Binding constraints:

- **One flag at a time**, and the rollback order is `CLARIFY_CLICK_ENABLED` **off first**, wait a day, then
  `ANSWER_FIRST_ENABLED`. "Both together" is NOT a safe shortcut. (Corrected in PR #62; it was backwards.)
- **NOT during a deploy burst** (#173).
- **The anonymous trial receives neither flag** ([#175](../open-questions.md)) — so a logged-out smoke test
  proves nothing, and the flip does not change the surface whose measured misfires motivated WP26c. That is a
  product decision the owner has not made yet.
- #65 pins the exact branch the flip activates (the double default) and what it costs in queries. Merging it
  first is worth it for that reason alone.

## Then, in order

- **~30/7 BBP+PPI syncs.** `85880NED` **MUST** use the chunked escape hatch (RUNBOOK step 5).
- **Re-ask [#132](../open-questions.md) route B** — the owner said "nog niet, later beslissen"; `forks_count`
  was 0 at last measurement, so the T-0 condition still held.
- **[#187](../open-questions.md) needs ONE live measurement from the owner:** does a forged `x-forwarded-for`
  change the trial's IP bucket on production? An autonomous session may not probe abuse limits. Until it is
  answered, assume the per-IP backstop bounds nothing against scripted traffic. One request settles it; record
  the answer in the RUNBOOK so the next session inherits a fact instead of a code comment.
- **[#189](../open-questions.md) — a decision, not a task:** does `gdpr:purge` become a Vercel cron, or stay a
  monthly manual step? Nothing schedules it today. First trial rows become purgeable ~2026-10-15.
- Then the owner menu: WP30c choice / #162 / #170 rest (3)+(4).

## Tracked but not the focus

[#174](../open-questions.md) (the client-held `impliedRecency` bit — the obvious fix is worse than the bug),
#176, #178, and the trial rows #179-#190. [#188](../open-questions.md) and the memo's
`connectionTimeoutMillis` adjudication want the **same supervised window** — they trade the same axis
(bounded waits vs. money-path failure semantics), so decide them together rather than one at a time.

## Rules that still bind

- **Git workflow ([#118](../open-questions.md)(b)):** owner-present ⇒ push/merge directly, no per-change
  approval. Autonomous ⇒ branch + PR + owner review. Both keep the **full verification block** (typecheck root
  + web, backend suite, web suite, benchmark 14/14 + 6/6 + 0 fabricated, real `next build`) and a
  `/code-review`-equivalent pass over the diff before every code push. That review pass has now found a real
  defect in **five consecutive** code PRs — budget it as a required step, not a courtesy.
- Live DDL, real LLM spend and env-flag flips stay owner-supervised.
- Delegation by role, never by hardcoded model name: session model orchestrates and judges, Fable takes
  architecture and adversarial analysis, Sonnet/Haiku take mechanical legwork.
- **Verify every fact against reality, never from memory** — dates via `date`, PR/SHA via `gh`, CI via
  `gh run view`, production via `curl`. The review pass caught three comments in this session's own diff dated
  *tomorrow*.
