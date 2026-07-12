#!/usr/bin/env bash
# UserPromptSubmit hook — detect an end-of-session / wrap-up signal in the owner's
# prompt and inject a reminder to run the full "Session wrap-up (end-of-conversation
# ritual)" defined in CLAUDE.md. Silent on non-match; ALWAYS exits 0 so it can never
# block or interfere with a normal prompt. (Added session 29, 2026-07-06, after the
# owner had to ask three times for a complete wrap-up.)
set -uo pipefail

input="$(cat)"

# Pull a named top-level string field out of the hook's JSON stdin ($2 = field).
extract_field() {
  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$1" | jq -r --arg f "$2" '.[$f] // ""' 2>/dev/null
  else
    printf '%s' "$1" | FIELD="$2" python3 -c 'import sys,json,os
try:
    print(json.load(sys.stdin).get(os.environ["FIELD"],""))
except Exception:
    pass' 2>/dev/null
  fi
}

session_id="$(extract_field "$input" "session_id")"

# First-message suppression (task_6f27827b, owner-flagged 2026-07-13): a wrap-up
# signal on a session's FIRST prompt is ALWAYS a false positive — a fresh session
# has nothing to wrap up, and kickoff prompts routinely quote STATUS.md's
# "▶ NEXT SESSION STARTS HERE" block (which trips the "next session" pairing
# below). Suppress exactly once per session, keyed by session_id via a machine-
# local marker. If session_id is absent (older CLI) or the marker cannot be
# managed, fall through to normal detection — never worse than before.
if [ -n "$session_id" ]; then
  marker_dir="${TMPDIR:-/tmp}/ccd-wrapup-hook"
  marker="${marker_dir}/seen-$(printf '%s' "$session_id" | tr -c 'A-Za-z0-9_.-' '_')"
  if mkdir -p "$marker_dir" 2>/dev/null && [ ! -e "$marker" ]; then
    : > "$marker" 2>/dev/null || true
    exit 0
  fi
fi

prompt="$(extract_field "$input" "prompt" | tr '[:upper:]' '[:lower:]')"
[ -z "$prompt" ] && exit 0

match=0
# Strong, unambiguous wrap-up phrases:
for p in \
  "wrap up" "wrapping up" "wrap it up" "wrap this up" "wrap things up" \
  "end of conversation" "end this conversation" "close this conversation" \
  "close the conversation" "closing this conversation" "closing the conversation" \
  "let's close this" "lets close this" "let’s close this" "close this session" \
  "moving to a new session" "move to a new session" "new claude code session" \
  "new claude co-session" "claude co-session" "running low on context" \
  "low on context" "you know what to do" "round off" "round up the session" \
  "wrap up the session" "wrap up this session"; do
  case "$prompt" in *"$p"*) match=1 ;; esac
done
# "context window" only when paired with a shrinking signal (avoid false positives):
case "$prompt" in
  *"context window"*)
    case "$prompt" in
      *small*|*"running low"*|*"almost full"*|*"filling up"*|*"running out"*|*shrink*|*limited*) match=1 ;;
    esac ;;
esac
# "next session" / "new session" only when paired with wrap/close/end/move:
case "$prompt" in
  *"next session"*|*"new session"*)
    case "$prompt" in
      *wrap*|*close*|*closing*|*ending*|*"end "*|*move*|*moving*|*over*) match=1 ;;
    esac ;;
esac

[ "$match" -eq 0 ] && exit 0

cat <<'REMINDER'
[SESSION WRAP-UP SIGNAL DETECTED] The owner is signaling the session is ending. Before responding, run the COMPLETE "Session wrap-up (end-of-conversation ritual)" defined in CLAUDE.md — not a partial pass, do not wait to be asked twice. Reproduce the checklist as a literal list in your reply and mark each item ✅ done / ⏭️ N/A (with a one-line reason). Do NOT declare the session wrapped until every item is ✅ or ⏭️:
1. Lessons → docs/lessons-learned.md (newest on top), or state there were none.
2. Memory files + the MEMORY.md index line.
3. The FULL doc set to the final MEASURED state — NOT just the trackers: docs/STATUS.md (Last-updated + NEXT-SESSION block), docs/open-questions.md, docs/08-build-plan.md, docs/RUNBOOK.md, every touched ADR (as-built note) + docs/04-architecture.md.
4. Stale-doc sweep: grep -rn across docs/ for the OLD framing of anything changed this session; fix every hit (every doc that mentions it, not just the ones you edited).
5. Clean state: git status clean + fully pushed; git worktree list (no strays); CI green per commit.
6. Cleanup: delete one-off scratch/verify scripts, keep the reusable ones; spin off out-of-scope hygiene as task chips.
7. Next-session prompt when asked (or when it clearly helps).
REMINDER
exit 0
