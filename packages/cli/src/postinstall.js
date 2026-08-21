#!/usr/bin/env node
/**
 * Runs on `npm i` in a consuming workspace.
 *
 * Deliberately timid: it no-ops rather than surprising anyone. A postinstall that
 * writes files into someone's repo without warning is how tools get uninstalled.
 */
import fs from 'node:fs';
import path from 'node:path';

const cwd = process.env.INIT_CWD ?? process.cwd();

function skip(reason) {
  console.log(`\n  Hermit: skipping automatic setup (${reason}).`);
  console.log(`  Run \x1b[36mnpx hermit init\x1b[0m when you are ready.\n`);
  process.exit(0);
}

// Never run inside our own repo, or when installed as a transitive dependency.
if (path.resolve(cwd) === path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..')) skip('running inside the Hermit repo');
if (cwd.includes(`${path.sep}node_modules${path.sep}`)) skip('installed as a transitive dependency');
if (process.env.CI) skip('CI environment detected');
if (process.env.HERMIT_NO_POSTINSTALL) skip('HERMIT_NO_POSTINSTALL is set');

const alreadyInstalled = fs.existsSync(path.join(cwd, '.hermit'));

try {
  const { cmdInit } = await import('./commands.js');
  cmdInit({ cwd, force: false });
  if (!alreadyInstalled) {
    console.log('  Hermit installed its agents into this workspace. Review .hermit/ and commit what you want to keep.\n');
  }
} catch (err) {
  console.log(`\n  Hermit: automatic setup did not complete (${err.message}).`);
  console.log(`  Run \x1b[36mnpx hermit init\x1b[0m to finish.\n`);
  process.exit(0); // never fail someone's install
}
