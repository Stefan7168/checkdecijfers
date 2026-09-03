#!/bin/bash
# The full verification block (CLAUDE.md "Definition of done" / build-plan guardrail 2) for ONE
# checkout, run serially and detached, behind the machine-wide vitest mutex — added session 72
# (2026-09-03) after the Bash tool's 10-minute cap and the 8 GB machine's one-vitest-at-a-time
# rule made an inline block unreliable. Usage:
#
#   nohup scripts/verify-block.sh <checkout-dir> <log-file> >/dev/null 2>&1 & disown
#   # then watch <log-file> for the "=== DONE" marker (or grep the exit= lines)
#
# What it runs, in order: typecheck (root + web) → the FULL backend suite → benchmark:run +
# benchmark:score → the web suite → a real `next build`. Each step prints its summary lines and
# an `exit=` line — read the `Test Files N passed (N)` lines, never just the exit codes.
# Measured 2026-09-03 on an otherwise idle machine: ~8 minutes end to end.
#
# bash since session 74 (2026-09-03): the cloud-session container has no zsh; bash is on every machine
# involved (macOS ships 3.2, which has PIPESTATUS). Same file, same usage.
#
# The mutex: `pgrep -f "[n]ode.*vitest"` matches a REAL vitest runner (a node process) and never
# the literal pattern in some shell's own command line — `pgrep -f vitest` inside a backgrounded
# shell matched itself and deadlocked two agents on 2026-09-03 (RUNBOOK "Multi-agent autonomous
# sessions", item 6). This script's own command line is its path, so it is safe either way.
W="$1"; L="$2"
if [[ -z "$W" || -z "$L" ]]; then echo "usage: verify-block.sh <checkout-dir> <log-file>" >&2; exit 2; fi
cd "$W" || exit 1
wait_for_vitest() { while pgrep -f "[n]ode.*vitest" >/dev/null; do sleep 15; done; }
{
  echo "=== VERIFY $(git rev-parse --abbrev-ref HEAD) @ $(git rev-parse --short HEAD) $(date -u +%FT%TZ) ==="
  echo "node_modules: $(ls node_modules | wc -l | tr -d ' ') / web: $(ls web/node_modules | wc -l | tr -d ' ')"
  echo "--- typecheck root ---"; npm run typecheck 2>&1 | tail -3; echo "exit=${PIPESTATUS[0]}"
  echo "--- typecheck web ---"; npm run web:typecheck 2>&1 | tail -3; echo "exit=${PIPESTATUS[0]}"
  wait_for_vitest
  echo "--- backend full suite (solo) $(date -u +%T) ---"; npm test 2>&1 | grep -E "Test Files|Tests |failed|FAIL|Error:" | tail -15; echo "exit=${PIPESTATUS[0]}"
  echo "--- benchmark run $(date -u +%T) ---"; npm run benchmark:run 2>&1 | tail -3; echo "exit=${PIPESTATUS[0]}"
  echo "--- benchmark score ---"; npm run benchmark:score 2>&1 | grep -vE "^\s+(PASS|FAIL)\s" | tail -8; echo "exit=${PIPESTATUS[0]}"
  wait_for_vitest
  echo "--- web suite $(date -u +%T) ---"; npm run web:test 2>&1 | grep -E "Test Files|Tests |failed|FAIL" | tail -8; echo "exit=${PIPESTATUS[0]}"
  echo "--- next build $(date -u +%T) ---"; npm run web:build 2>&1 | grep -E "Compiled|TypeScript|error|Error|✓|✗|Route \(app\)" | head -12; echo "exit=${PIPESTATUS[0]}"
  echo "=== DONE $(date -u +%T) ==="
} > "$L" 2>&1
