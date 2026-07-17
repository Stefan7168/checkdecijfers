// Supervised trial-pot seed/refill (ADR 036; owner procedure in the RUNBOOK).
// Sets BOTH remaining_questions and cap to the given size — refilling and
// resizing are the same one owner-followable step, and the trial UI re-opens
// automatically on the next request (no deploy needed).
//
//   npm run trialpot:set -- 25      pot now holds 25 questions (cap 25)
//   npm run trialpot:set -- 0       closes the trial (UI degrades to login)
//
// Deterministic code only — no LLM, no pipeline. Requires DATABASE_URL (a
// secret): owner-supervised by construction, like every live-DB script.
import { connectFromEnv } from '../src/db/client.ts';
import { getTrialPotStatus, setTrialPot } from '../src/billing/index.ts';

const raw = process.argv[2];
const size = Number(raw);
if (raw === undefined || !Number.isInteger(size) || size < 0) {
  console.error('usage: npm run trialpot:set -- <non-negative integer>');
  process.exit(1);
}

const { db, pool } = connectFromEnv();
try {
  const before = await getTrialPotStatus(db);
  if (before === null) {
    console.error('trial_pot_config not found — has migration 020 been applied to this database?');
    process.exit(1);
  }
  await setTrialPot(db, size);
  const after = await getTrialPotStatus(db);
  console.log(
    `trial pot: ${String(before.remaining)}/${String(before.cap)} -> ${String(after!.remaining)}/${String(after!.cap)}`,
  );
} finally {
  await pool.end();
}
