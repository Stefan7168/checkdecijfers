// Local web dev server WITH the root `.env` loaded (DATABASE_URL,
// ANTHROPIC_API_KEY) — `next dev` only reads web/.env.local, which by
// design carries just the NEXT_PUBLIC_* values (docs/RUNBOOK.md, secrets
// table), so a plain `npm run web:dev` serves the logged-in workspace
// without a database. Passing `--env-file` to node doesn't work either:
// next re-spawns itself with NODE_OPTIONS, where that flag is refused.
// This wrapper loads the file into THIS process's env and hands it down.
// Used by .claude/launch.json's "web-db" entry (session 90) and runnable
// directly: `node scripts/dev-web.mjs`. Nothing here prints a value.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envFile = resolve(root, '.env');
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
} else {
  console.warn(`[dev-web] no ${envFile} — starting without DATABASE_URL`);
}

const child = spawn('npm', ['--prefix', resolve(root, 'web'), 'run', 'dev'], {
  cwd: root,
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
