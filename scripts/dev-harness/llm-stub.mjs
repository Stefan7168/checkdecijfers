// Local Anthropic-API stand-in (docs/RUNBOOK.md "Local real-browser harness"): replays the repo's recorded LLM fixtures
// (tests/fixtures/llm/**) — zero real LLM spend. Matches on (model, system,
// question); falls back to question-only with a warning.
import http from 'node:http';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
const PORT = 9912;
const ROOT = new URL('../../tests/fixtures/llm', import.meta.url).pathname;
const fixtures = [];
(function walk(d) { for (const e of readdirSync(d)) { const f = join(d, e); if (statSync(f).isDirectory()) walk(f); else if (f.endsWith('.json')) { try { const j = JSON.parse(readFileSync(f, 'utf8')); if (j.request && j.response) fixtures.push({ ...j, file: f.slice(ROOT.length + 1) }); } catch {} } } })(ROOT);
console.log(`[llm-stub] ${fixtures.length} fixtures loaded`);
http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    if (!req.url.startsWith('/v1/messages')) { res.writeHead(404); return res.end('{}'); }
    const b = JSON.parse(body || '{}');
    const q = Array.isArray(b.messages?.[0]?.content) ? b.messages[0].content.map((x) => x.text ?? '').join('') : b.messages?.[0]?.content ?? '';
    const sys = typeof b.system === 'string' ? b.system : Array.isArray(b.system) ? b.system.map((x) => x.text ?? '').join('') : '';
    let hit = fixtures.find((f) => f.request.model === b.model && f.request.system === sys && f.request.question === q);
    let how = 'exact';
    if (!hit) { hit = fixtures.find((f) => f.request.question === q); how = 'question-only'; }
    if (!hit) { hit = fixtures.find((f) => f.request.model === b.model && f.request.system === sys && q.startsWith(f.request.question.slice(0, 60))); how = 'prefix'; }
    if (!hit) {
      console.log(`[llm-stub] MISS model=${b.model} q=${JSON.stringify(q.slice(0, 120))}`);
      res.writeHead(400, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'llm-stub: no fixture for this request' } }));
    }
    console.log(`[llm-stub] ${how} ${hit.file} (${hit.label ?? ''})`);
    const r = hit.response;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: 'msg_local', type: 'message', role: 'assistant', model: r.model ?? b.model, content: [{ type: 'text', text: r.outputText }], stop_reason: r.stopReason ?? 'end_turn', stop_sequence: null, usage: { input_tokens: r.usage?.inputTokens ?? 1, output_tokens: r.usage?.outputTokens ?? 1 } }));
  });
}).listen(PORT, () => console.log(`[llm-stub] listening on ${PORT}`));
