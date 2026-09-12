// node-based launcher for .claude/launch.json (the "sh <script>.sh" form hit a
// sandbox "getcwd: Operation not permitted" error under the preview tool;
// scripts/dev-web.mjs's node+spawn pattern is the known-working shape).
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');

process.env.CDC_PGLITE_HARNESS = '1';
process.env.CDC_HARNESS_USER_ID = '11111111-1111-4111-8111-111111111111';
// NODE_OPTIONS is whitespace-tokenized, and this checkout's path has spaces
// ("Check de Cijfers") — a raw path breaks; a percent-encoded file:// URL doesn't.
process.env.NODE_OPTIONS = `--import ${pathToFileURL(resolve(root, 'scripts/dev-harness/pglite-preload.mjs')).href}`;
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:9911';
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_local_dummy';
process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3102';
process.env.ANTHROPIC_BASE_URL = 'http://127.0.0.1:9912';
process.env.ANTHROPIC_API_KEY = 'sk-ant-local-stub';
process.env.WORKSPACE_ENABLED = '1';
process.env.CLARIFY_CLICK_ENABLED = '1';
process.env.ANSWER_FIRST_ENABLED = '1';
process.env.SEMANTIC_CHECK_ENABLED = '1';
process.env.NO_PROXY = 'localhost,127.0.0.1';
process.env.no_proxy = 'localhost,127.0.0.1';

const child = spawn('npx', ['next', 'dev', '-p', '3102'], {
  cwd: resolve(root, 'web'),
  stdio: 'inherit',
  env: process.env,
});
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => child.kill(sig));
}
