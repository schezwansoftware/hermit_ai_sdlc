import fs from 'node:fs';
import path from 'node:path';

export const HERMIT_DIR = '.hermit';

/**
 * Find the workspace root: nearest ancestor containing .hermit/, else nearest
 * containing package.json or .git, else the starting directory.
 * @param {string} [start]
 * @returns {string}
 */
export function findWorkspaceRoot(start = process.cwd()) {
  let dir = path.resolve(start);
  let fallback = null;
  while (true) {
    if (fs.existsSync(path.join(dir, HERMIT_DIR))) return dir;
    if (!fallback && (fs.existsSync(path.join(dir, 'package.json')) || fs.existsSync(path.join(dir, '.git')))) {
      fallback = dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return fallback ?? path.resolve(start);
}

/**
 * @param {string} [root]
 */
export function layout(root = findWorkspaceRoot()) {
  const hermit = path.join(root, HERMIT_DIR);
  return {
    root,
    hermit,
    config: path.join(hermit, 'config.json'),
    agentsDir: path.join(hermit, 'agents'),
    skillsDir: path.join(hermit, 'skills'),
    knowledgeDir: path.join(hermit, 'knowledge'),
    pipelinesDir: path.join(hermit, 'pipelines'),
    runsDir: path.join(hermit, 'runs'),
    activeRunFile: path.join(hermit, 'active-run'),
    manifestFile: path.join(hermit, 'install-manifest.json'),
    runDir: (runId) => path.join(hermit, 'runs', runId),
    runFile: (runId) => path.join(hermit, 'runs', runId, 'run.json'),
    artifactsDir: (runId) => path.join(hermit, 'runs', runId, 'artifacts'),
    journalFile: (runId) => path.join(hermit, 'runs', runId, 'journal.ndjson')
  };
}

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Atomic-ish JSON write (tmp file + rename). */
export function writeJson(file, value) {
  ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, file);
}

export function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}
