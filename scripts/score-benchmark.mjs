// Benchmark scorer — the third leg of the CI gate (CLAUDE.md; docs/03-mvp-scope.md).
//
// Current state: SKELETON. The answer key is not frozen yet (Phase 0 checklist item),
// so this script only validates the structural integrity of benchmark/tasks.json and
// refuses to pretend it scored anything. When the key freezes and the answer pipeline
// exists, this becomes the mechanical comparison described in docs/02-user-scenarios.md
// (Scoring): number/unit/binding/attribution checks against audit records.
import { readFileSync, existsSync } from 'node:fs';

const fail = (msg) => { console.error(`SCORER FAIL: ${msg}`); process.exit(1); };

const tasksPath = new URL('../benchmark/tasks.json', import.meta.url);
const keyPath = new URL('../benchmark/answer-key.json', import.meta.url);
const { frozen, tasks } = JSON.parse(readFileSync(tasksPath, 'utf8'));

// Structural checks: the task set must exactly mirror docs/02-user-scenarios.md.
if (tasks.length !== 20) fail(`expected 20 tasks, found ${tasks.length}`);
const ids = tasks.map((t) => t.id);
const expectedIds = Array.from({ length: 20 }, (_, i) => `B${i + 1}`);
if (JSON.stringify(ids) !== JSON.stringify(expectedIds)) fail(`task IDs must be exactly B1..B20 in order, got: ${ids.join(', ')}`);
const answerable = tasks.filter((t) => t.type === 'answerable');
const clarify = tasks.filter((t) => t.type === 'clarify');
const refuse = tasks.filter((t) => t.type === 'refuse');
if (answerable.length !== 14) fail(`expected 14 answerable tasks (B1-B14), found ${answerable.length}`);
if (clarify.length !== 2 || refuse.length !== 4) fail(`expected 2 clarify + 4 refuse tasks (B15-B20), found ${clarify.length}+${refuse.length}`);
for (const t of tasks) if (!t.question?.trim()) fail(`${t.id} has an empty question`);
if (!tasks.find((t) => t.id === 'B13')?.derived || !tasks.find((t) => t.id === 'B14')?.derived) fail('B13 and B14 must be marked derived');

// Freeze-state consistency: the frozen flag and the key file may never disagree.
const keyExists = existsSync(keyPath);
if (frozen && !keyExists) fail('tasks.json says frozen=true but benchmark/answer-key.json does not exist');
if (!frozen && keyExists) fail('benchmark/answer-key.json exists but tasks.json says frozen=false — freeze explicitly or remove the key');

if (!frozen) {
  console.log('benchmark scorer: SKELETON MODE — answer key not yet frozen (open Phase 0 checklist item).');
  console.log('Structural validation of the 20-task set: PASS. No scores were produced; none exist yet.');
  process.exit(0);
}

// Real scoring lands with the answer pipeline. Until it is implemented, a frozen key
// must fail loudly rather than report an empty "pass".
fail('answer key is frozen but scoring against audit records is not implemented yet — implement before freezing the key');
