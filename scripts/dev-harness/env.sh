# Source this in the shell that starts `next dev` — see docs/RUNBOOK.md "Local real-browser harness".
# Everything here is local and fake: no production database, no Supabase project, no LLM spend.
HARNESS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export CDC_PGLITE_HARNESS=1
export CDC_HARNESS_USER_ID=11111111-1111-4111-8111-111111111111   # the auth-stub's one test user (gets the signup grant)
export NODE_OPTIONS="--import $HARNESS_DIR/pglite-preload.mjs"
export NEXT_PUBLIC_SUPABASE_URL=http://localhost:9911              # auth-stub.mjs
export NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_local_dummy
export NEXT_PUBLIC_APP_URL=http://localhost:3102
export ANTHROPIC_BASE_URL=http://127.0.0.1:9912                   # llm-stub.mjs (fixture replay)
export ANTHROPIC_API_KEY=sk-ant-local-stub
export WORKSPACE_ENABLED=1
export CLARIFY_CLICK_ENABLED=1
export ANSWER_FIRST_ENABLED=1
export SEMANTIC_CHECK_ENABLED=1
export EUROSTAT_EXPLORER_ENABLED=1                                # dev-harness Task 2: /eurostat-explorer now has a registered table to show
export ATTACHMENTS_ENABLED=1                                      # co-pilot phase 2 Task 9: the "Bestand uploaden" control + the own-data chat
export OWN_DATA_PUBLISH_ENABLED=1                                 # ADR 057 (session 127): own-data card's Publish button + /embed/own/[publicId] — dark in prod, on here for the local harness only
# dev-harness Task 1: HARNESS_INTENT_INJECT=1 makes a "!!regionset <name>" /
# "!!intent {json}" question skip the parser (src/answer/respond/harness-intent.ts)
# — unset/anything else in production, and the pipeline treats the text as an
# ordinary (unmatched) question.
export HARNESS_INTENT_INJECT=1
export NO_PROXY=localhost,127.0.0.1
export no_proxy=localhost,127.0.0.1
