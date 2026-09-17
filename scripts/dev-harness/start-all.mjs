// ONE command that brings up the whole local harness: auth-stub (:9911),
// llm-stub (:9912) and `next dev` (:3102, via run-next-dev.mjs so the harness
// env stays defined in exactly one place). Written in session 110 so
// Playwright's `webServer` block can own the harness lifecycle for the CI e2e
// smoke (web/playwright.config.ts) — the manual three-shell recipe in
// README.md / docs/RUNBOOK.md still works and is unchanged.
//
// Contract this script owes its caller: if ANY of the three dies, the whole
// thing dies with a non-zero exit code. A half-started harness is the worst
// outcome — the dev server would answer on :3102 while every question 400s
// against a missing llm-stub, and the e2e failure would look like a product
// bug instead of a harness one.
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');

/** @type {{ name: string, child: import('node:child_process').ChildProcess }[]} */
const running = [];
let shuttingDown = false;

function shutdown(code, signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const { child } of running) {
    if (child.exitCode === null && child.signalCode === null) child.kill(signal ?? 'SIGTERM');
  }
  // Give the children a beat to go down cleanly, then leave regardless. The
  // timer is deliberately NOT unref'd: once the last child handle closes the
  // event loop would otherwise drain and node would exit 0, swallowing the
  // very failure this function was called to report.
  process.exitCode = code;
  setTimeout(() => process.exit(code), 300);
}

function start(name, args) {
  const child = spawn(process.execPath, args, { cwd: root, stdio: 'inherit', env: process.env });
  child.on('exit', (exitCode, exitSignal) => {
    if (shuttingDown) return;
    console.error(`[harness] ${name} exited (code=${exitCode}, signal=${exitSignal}) — bringing the harness down`);
    shutdown(exitCode === 0 ? 1 : (exitCode ?? 1));
  });
  child.on('error', (err) => {
    console.error(`[harness] ${name} failed to start:`, err);
    shutdown(1);
  });
  running.push({ name, child });
}

start('auth-stub', [resolve(here, 'auth-stub.mjs')]);
start('llm-stub', [resolve(here, 'llm-stub.mjs')]);
start('next-dev', [resolve(here, 'run-next-dev.mjs')]);

for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => shutdown(0, sig === 'SIGHUP' ? 'SIGTERM' : sig));
}
