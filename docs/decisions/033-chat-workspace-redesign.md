# ADR 033 — Chat workspace redesign: persisted conversations, right-pane visual dock, site shell (#135)

**Status:** Accepted — design round of 2026-07-12 (session 41). All four open choices were put to
the owner in the in-session interview and decided (answers recorded at the bottom); the build brief
may now be frozen.

## Context

Owner request #135 (2026-07-12, session 40, with reference screenshots of an external AI-assistant
product): redesign the chat workspace. Five asks: (1) conversation full-width until a chart/table
appears, then visuals dock in a right-hand pane while the conversation stays left; (2) multiple
visuals → tabs in the right pane; (3) a conversation-history sidebar grouped by day
(vandaag/gisteren/afgelopen 7 dagen) with a "nieuwe chat" button; (4) credits in the top-right
navigation; (5) the WP29 follow-up suggestion chips stay.

What exists today (verified session 41, scout fan-out over `web/` + `migrations/` + docs):

- The chat thread is **ephemeral React state** in `web/components/chat.tsx` — gone on reload.
  `audit_answers` stores every turn (the full `response` envelope, R8-pinned `final_text`), but
  **no schema entity groups rows into a conversation**; the dashboard's clarification-round
  grouping is a read-time value match, not a stored link.
- Conversation context (ADR 021) is client-held, server-validated, registry-vocabulary-only.
  `buildConversationContext` is a deterministic function of the composed response.
- Charts (`chart`) and stat cards are **structural envelope fields** rendered by self-contained
  components (`chart.tsx`, `stat-card.tsx`); the WP129+130 web section is deliberately NOT a
  visual — ADR 032: *the separation IS the honesty model*.
- GDPR machinery (#14/#120): redaction (never DELETE — the `credit_transactions` FK forbids it)
  is centralized in `src/answer/audit/retention.ts` behind one shared `AUDIT_SCOPE` fragment;
  2-year purge + self-service "Verwijder mijn vraaggeschiedenis". Lesson #120: every new store of
  question-derived text must be inside the redaction scope from day one.
- There is no site shell: no header, no footer, **no logout anywhere** (WP24 is the placeholder;
  #98/#99 hold the IA and footer-copy questions).

A sidebar of resumable conversations means **persisted threads = personal data**. That is the deep
half of this WP; the dock and the nav are rendering-architecture changes.

## Decision

### D1 — Threads become a real entity: `chat_threads` + `audit_answers.thread_id`

Migration 019 adds:

- `chat_threads`: `id` (bigint identity PK), `user_id` (uuid, guarded FK to `auth.users` — the
  `credit_transactions` pattern), `created_at`, `last_activity_at`. **No text columns — by
  design.** A thread stores *when*, never *what*.
- `audit_answers.thread_id`: nullable bigint FK → `chat_threads(id)`, no `ON DELETE` clause
  (RESTRICT), matching the redact-not-delete posture. Old rows, benchmark/validation rows, and
  onboarding-delivery rows stay NULL.

A thread row is created **lazily on the first completed question of a new chat** (no empty
threads). The client sends its active `threadId` with `askQuestion`/`replyToClarification` as a
new optional trailing parameter (additive, `?? null`-guarded — the WP129 selection-param pattern);
the server **validates ownership** (`thread.user_id = currentUserId()`, bound parameters) before
writing, exactly like the ADR 021 trust boundary treats client-held context.

**Thread titles are derived at read time** from the first audit row's `question` (truncated),
never stored. Consequence: redaction of the audit rows automatically redacts the sidebar — a
fully-redacted thread is **filtered out of the sidebar at read time** (the dashboard history keeps
its "verwijderde vraag" placeholder posture from #14, unchanged).

### D2 — GDPR from day one: threads ride the existing #14/#120 machinery

- **Retention term:** **DECIDED (owner, 2026-07-12): the same 2-year term as #14.** One term for
  all question-derived data; the purge needs **no new leg** because threads hold no text — purged
  audit rows empty the thread, and the sidebar filter hides it.
- **Self-service deletion:** the existing button already redacts all the user's audit rows, which
  hides every thread. Nothing new to build for the all-history path; the cross-user pins extend to
  the two new read paths (`listThreads`, `loadThread` — user-scoped, bound parameters).
- **Per-thread deletion:** **DECIDED (owner, 2026-07-12): not in v1** (each new mutation path
  needs its own cross-user pins); recorded as a fast-follow residual in open-questions #135.

### D3 — Resume = deterministic replay of stored envelopes

Opening a sidebar conversation rebuilds the message list from the thread's `audit_answers.response`
envelopes (authoritative per ADR 016; R8 pins `final_text` = `response.text`). Conversation
context for continuing the thread is **rebuilt server-side** by running the existing deterministic
`buildConversationContext` over the last eligible stored envelope, then revalidated against the
live registry (ADR 021) — a stale topic/region degrades honestly to a standalone parse or
clarification, never a guess. **DECIDED (owner, 2026-07-12): resumed threads accept new questions**
(read + continue, not view-only).

Zero prompt bytes: no LLM call is added or changed anywhere in this WP; replay and context rebuild
are existing deterministic code paths.

### D4 — The right-pane dock is a mount-point change, not a rendering change

- The workspace starts single-column; the first answer carrying a `chart` or stat card opens the
  right pane. Each visual becomes a tab (newest active); tab labels are deterministic from the
  envelope (no LLM). Tab state is **not stored** — it is derivable by replaying the thread's rows,
  so a resumed thread reconstructs its tabs for free.
- The message keeps a small in-flow reference chip ("in het paneel") that activates the visual's
  tab; `ChartView`/`StatCard` components move mount point **unchanged internally** (honesty
  bindings, PNG export, footer untouched).
- **The web section never docks.** It stays last-in-bubble in the conversation flow (ADR 032 —
  the separation is the honesty model). CSV stays a download button in the message.
- **Below the `lg` breakpoint the dock does not exist**: visuals render inline in the message
  exactly as today (zero mobile regression; same components, same order).
- **Byte-identity pin (build-brief gate):** suggestion chips, feedback buttons, source-selection
  chips, attribution chip, provisional badge, staleness/definition/marking lines, refusal header,
  citation-copy + CSV buttons, pre-send cost line, web section — the whole message envelope
  renders byte-identically to today; the redesign brief pins this with rendering tests.

### D5 — "Nieuwe chat" = the ADR 021 explicit UI reset

`resetChat()`: messages → `[]`, pending clarification → null, **context → null** (the critical
line — the next question parses standalone), input cleared, `activeThreadId` → null (next question
lazily creates a fresh thread). Source selection (`selectedSources`, `webSelected`) survives, as
UI configuration.

### D6 — The workspace ships the site shell (WP24 absorbed) — DECIDED (owner, 2026-07-12)

#135 builds the shell WP24 specified, because credits-in-nav (ask 4) *is* WP24's
balance chip: a top nav on authenticated pages (wordmark → `/`, live balance chip on the existing
#68 state pattern, "Credits kopen" link, account menu with the relocated delete-history button and
a genuinely new "Log uit" server action) + the #99 footer (CBS/CC BY 4.0 attribution + "over dit
project"; the privacy link follows when the #14(d) policy exists — no dead links). The per-page
guard pattern from the WP24 spec stays (not centralized in `layout.tsx`); `/login` keeps a
stripped header. #98 stays answered as option A (merged `/`), now rendering the workspace.
QuestionHistory + account details move behind the nav (the #74 "mijn aanvragen" panel keeps its
seam there, out of scope here).

### D7 — Dormant-until-flag rollout

The workspace ships behind `WORKSPACE_ENABLED` (the WP129+130 pattern): flag off → today's
dashboard renders byte-identically; flag on in a supervised go-live with the owner present.
Migration 019 is live DDL → owner-supervised step. Build on a branch + PR per #118(b).

## Alternatives considered

1. **Persist conversations client-side (localStorage)** — no server data, no GDPR expansion.
   Rejected: silently diverges from the server audit trail, dies with the browser profile, no
   cross-device story, and dodges rather than answers the retention question (the data would
   still be personal data — just unmanaged).
2. **Derive "conversations" from time-gap clustering over `audit_answers`** (no new entity) —
   zero DDL. Rejected: no stable identity for resume, "nieuwe chat" has no boundary to write,
   and the grouping would be a heuristic — exactly the read-time value-matching fragility the
   WP19 review flagged on clarification rounds, now load-bearing.
3. **Store thread titles as a column** (denormalized first question) — cheaper sidebar query.
   Rejected: creates a second store of question text, which #120 proved is precisely where
   retention promises rot; a read-time derivation is redaction-correct by construction.
4. **Duplicate visuals (inline + dock) instead of moving them** — simpler mentally. Rejected:
   two live renders of the same chart drift (tooltip state, PNG export ids) and the pane loses
   its reason to exist on wide screens; the in-flow reference chip preserves the reading order.
5. **Keep WP24 as a separate later WP** — smaller #135. Viable (open choice 3): but two shells
   built twice, and credits-in-nav would be built once in #135's workspace header and again in
   WP24's site header. The overlap is structural, not incidental.
6. **Big-bang rollout without a flag** — less plumbing. Rejected: the WP129+130 dormancy pattern
   measurably de-risked a money-path deploy (deploy-order safety, byte-identical when off) and
   costs little here.

## Consequences & trade-offs

- One new table + one nullable column; every other data change is additive and `??`-guarded.
  The benchmark, validators, pricing, and prompts are untouched (zero prompt bytes).
- The thread read paths (`listThreads`, `loadThread`) are a **new cross-user attack surface** —
  they get the same bound-parameter + ownership pins as the #14 deletion path, in the brief's
  invariant tests.
- Read-time title derivation makes the sidebar query a join (first row per thread); at
  single-user/prototype scale this is irrelevant, and an index on `(user_id, last_activity_at)`
  carries it to real usage.
- Resumed context can degrade (registry moved on) — by design, per ADR 021: honest degradation
  to clarification beats silently answering from a stale referent.
- The old dashboard layout remains reachable until go-live via the flag; after go-live the
  2:1 chat-to-panel ratio (10-ux-design-brief) is superseded by the workspace — the brief's
  "primary action gets the visual weight" principle is *more* true, not less.

## Invariants at stake (build-brief gate)

R2 (no free text into prompts — thread ids are ids; context rebuild revalidates), R8 (replayed
`final_text` byte-equal to stored), #14/#120 (redaction covers every store of question-derived
text — satisfied structurally: threads store none), cross-user isolation (new read paths), ADR 032
separation (web section never docks), WP29/chips + feedback + cost-line byte-identity, ledger
untouched by anything in this WP.

## Pre-build adversarial review (2026-07-12, session 41) — brief FROZEN v2

The WP30a/30b pattern ran against the executor brief: **62 agents** — 6 mid-tier lenses
(GDPR/cross-user, R8/replay, UI byte-identity, schema/migration, rollout/shell, ADR-021 trust
boundary) produced 28 raw findings; each was attacked by dual heavy-tier skeptics → **10
confirmed / 3 split / 15 killed**. The session judged the survivors into seven amendments,
folded into the frozen brief (cross-marked ⟨A1⟩–⟨A7⟩ there):

- **⟨A1⟩ Lazy thread creation was self-contradictory:** the drafted `ensureThread` inserted a
  row BEFORE the billing gate, so insufficient-credits/duplicate/exception turns would orphan
  empty threads — violating D1. Split into read-only `validateThreadOwnership` + atomic
  `attachOrCreateThread` that only runs on a gated-ok outcome with an audit id.
- **⟨A2⟩ Migration 019's guarded `auth.users` FK was a comment, not DDL** (found independently
  by three lenses) — now verbatim DO-block DDL, plus a PR-checklist line because the hermetic
  PGlite harness has no `auth` schema and CI is structurally blind to a missing FK.
- **⟨A3⟩ Replay could not reconstruct a full `ChatMessage` from src-side code:** `web/backend`
  is the `../src` symlink; `citation`/`csv`/`card` builders and the kind-reclassification live
  in `web/lib`/`chat.tsx`, and the cost caption comes from the ledger, not the envelope. The
  brief now splits replay into src-side structural parts + web-side assembly reusing the SAME
  live-path functions (kind-reclassification extracted to one shared helper), and
  `getThreadRows` gains the history.ts ledger join for `creditsCharged`. This is also what
  makes D4's "tabs reconstruct for free" actually true.
- **⟨A4⟩ Clarification-round replay would duplicate the original question** (a reply row's
  `question` column echoes the original — the exact WP19 dashboard trap): one user-turn per
  row, `reply_text` overriding `question`; message-count pin added.
- **⟨A5⟩ The shell leaked past the flag:** header/signOut//geschiedenis would have shipped live
  on `/credits`//`login`//`geschiedenis` pre-flip. The flag now gates every WP135 surface;
  flag-off byte-identity is pinned for all routes.
- **⟨A6⟩ A clarification reply could attach to the wrong thread** after a sidebar switch:
  replies now carry the threadId captured with `pending` at question time, and a thread switch
  clears `pending` (same as "nieuwe chat").
- **⟨A7⟩ Redacted rows would render as a two-bubble sentinel echo and could CRASH the context
  rebuild** (`resolvedIntent` throws on a redacted 'answer' envelope — kind preserved, `result`
  gone): replay emits one placeholder message; the rebuild walk skips redacted rows before
  calling the builder. Both pinned.

Notable kills (for the record): "chat_threads rows are never purged" (by design — no text, the
D1/D2 posture); "attachAuditRow lacks ownership re-verification" (the UPDATE's WHERE binds
`user_id`); state-resync and SSR-breakpoint concerns (executor implementation detail, no spec
change needed).

## As-built (session 41, 2026-07-12 — built the same session, owner present)

Implemented exactly per the frozen brief + A1–A7; merged to `main` on the owner's explicit
in-chat instruction, DORMANT behind `WORKSPACE_ENABLED` (go-live = the owner-supervised step in
RUNBOOK § "WP135 chat workspace"). Measured: 24 new backend tests (`tests/threads/`), 41 new web
tests (299 web total), benchmark 14/14 + 6/6 + 0 fabricated GATE PASS, real `next build` green.
Post-build review (22 agents) confirmed 2 blockers, fixed same session: (1) `getThreadRows`'s
credits-join initially omitted the separate `websearch_cost` debit — replayed cost captions now
net base + add-on debits minus their compensations (the same pre-existing omission in the
dashboard's `history.ts` was spun off as its own reviewed fix, chip task_7de27dc7); (2) a stale
in-flight submit could land in the wrong thread after a sidebar switch — generation guard +
sidebar disabled while busy. D1's module note: `src/threads/` recorded in ADR 001's as-built
list. The ADR 001 seam holds: threads are a web-app domain module, not an answer-pipeline one.

## Revisit triggers

- Per-thread deletion ask from the owner or an external user → build the deferred D2 leg.
- Multi-device/live-sync expectations (threads updating across open tabs) → the #117 poll/push
  decision must be taken jointly.
- A real table renderer (beyond stat cards) → it docks by the same D4 rule; the web section
  still never does.
- External users → revisit sidebar pagination and the 2-year sidebar horizon.

## Owner interview — the open choices (asked and answered in-session, 2026-07-12)

All four questions were presented with the recommendation first and trade-offs stated in plain
language; the owner selected the recommended option on all four:

1. **Retention term for conversations** → **same 2-year #14 term.** One term for everything
   question-derived; existing purge + self-service deletion cover threads with no new machinery.
2. **Resume vs view-only** → **read AND continue asking**, with ADR 021 revalidation as the
   honest-degradation guard for stale referents.
3. **Absorb WP24 shell into #135** → **yes**: top nav (balance chip, Credits kopen, account menu
   with logout + delete-history) and the #99 footer (attribution + "over dit project"; privacy
   link deferred until the #14(d) policy exists — no dead links). Exact footer string is pinned
   in the build brief; byte-level copy gets a final look at PR review.
4. **Per-thread delete in v1** → **defer** to a fast-follow residual; v1 keeps the existing
   delete-all button, relocated to the account menu.

## As-built addendum — supervised go-live (session 42, 2026-07-13)

Go-live RUN per RUNBOOK § "WP135 chat workspace" (as-executed record there): migration 019 applied, guarded FK + grants/RLS live-verified,
`WORKSPACE_ENABLED=1`, owner smoke tests PASS (threads/dock/resume). Two go-live findings: the logout button needed a pending state
(`5ba3fb8`, `useFormStatus` — the D6 shell's one UX gap); `/login`'s stripped header does not render in prod because that route is
statically prerendered and sensitive env vars are empty at build (cosmetic; the D6 shell is otherwise live). GDPR spot-check deferred (optional).
