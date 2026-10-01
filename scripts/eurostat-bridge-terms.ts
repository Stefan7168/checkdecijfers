// The Dutch → English bridge for finding Eurostat datasets (session 153, #357
// step 3): records, ONCE and live, the English search words the cheap model
// proposes for each Dutch Eurostat question in
// benchmark/eurostat-finder-labelled-set.json, into
// benchmark/eurostat-bridge-terms.json. scripts/eurostat-finder-recall.ts then
// measures the 'bridged' variant from that file — hermetic and free.
//
//   EUROSTAT_BRIDGE_RECORD_OK=1 node --env-file=.env scripts/eurostat-bridge-terms.ts
//
// Live spend: 12 tiny calls on the cheap tier (well under a cent).
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AnthropicLlmClient } from '../src/answer/llm/client.ts';
import { suggestEnglishSearchTerms } from '../src/catalog/search-terms.ts';

const SET = fileURLToPath(new URL('../benchmark/eurostat-finder-labelled-set.json', import.meta.url));
const OUT = fileURLToPath(new URL('../benchmark/eurostat-bridge-terms.json', import.meta.url));

if (process.env.EUROSTAT_BRIDGE_RECORD_OK !== '1') {
  console.error('Live calls (12, cheap tier). Set EUROSTAT_BRIDGE_RECORD_OK=1 to confirm.');
  process.exit(1);
}
const cases = (JSON.parse(readFileSync(SET, 'utf8')) as { cases: { id: string; lang: string; expectSource: string; question: string }[] }).cases;
const client = new AnthropicLlmClient();
const terms: Record<string, string[]> = {};
for (const c of cases.filter((x) => x.lang === 'nl' && x.expectSource === 'eurostat')) {
  terms[c.id] = await suggestEnglishSearchTerms(c.question, client);
  console.log(`${c.id.padEnd(24)} ${terms[c.id]!.join(', ')}`);
}
writeFileSync(
  OUT,
  `${JSON.stringify({ note: 'Recorded live once by scripts/eurostat-bridge-terms.ts (session 153): English search words per Dutch Eurostat question, replayed by eurostat-finder-recall.ts variant "bridged".', recordedAt: new Date().toISOString(), terms }, null, 2)}\n`,
);
console.log(`wrote ${OUT}`);
