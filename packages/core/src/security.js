import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ensureDir, readJson, writeJson } from './paths.js';
import { artifactSpec } from './artifacts.js';

/**
 * The security baseline: mapped once for the repository, like onboarding.
 *
 * Two of the security agent's three jobs answer questions about the repository
 * rather than about a change — what does this project depend on, and what is
 * already wrong in the code as it stands. Both are expensive and neither moves
 * much between runs, so they are paid for once and read by every run afterwards.
 *
 * The third job — is anything we depend on vulnerable *now*, and can it be fixed
 * — belongs to a run, because the answer changes daily as advisories land. That
 * one is the `security` pipeline stage, and it reads what is written here.
 *
 * Nothing blocks on this. A run whose repository has no baseline proceeds and
 * names what it is missing, exactly as it does for onboarding.
 */
export const SECURITY_ARTIFACTS = ['dependency-map', 'security-baseline'];

export const SECURITY_STATUS = /** @type {const} */ ({
  NOT_RUN: 'not_run',
  REQUESTED: 'requested',
  COMPLETE: 'complete'
});

/**
 * Structural checks, enforced on submission rather than at a gate — there is no
 * stage here to hand off from. Same discipline as onboarding: refuse incomplete
 * work with the reason instead of storing it and surprising the next reader.
 */
export const SECURITY_CRITERIA = [
  { id: 'direct-deps-listed', artifact: 'dependency-map', contains: '## Direct Dependencies' },
  { id: 'transitive-surface', artifact: 'dependency-map', contains: '## Transitive Surface' },
  { id: 'manifests-cited', artifact: 'dependency-map', contains: '## Manifests' },
  { id: 'deps-per-project', artifact: 'dependency-map', contains: '## Per Project', when: { monorepo: true } },
  { id: 'baseline-findings', artifact: 'security-baseline', contains: '## Findings' },
  { id: 'baseline-method', artifact: 'security-baseline', contains: '## Method' },
  { id: 'baseline-scope', artifact: 'security-baseline', contains: '## Scope & Limits' }
];

/**
 * @returns {{ ok:boolean, failed:Array<{id:string,detail:string}> }}
 */
export function checkSecurityArtifact(artifactId, content, context = {}) {
  const failed = [];
  for (const c of SECURITY_CRITERIA) {
    if (c.artifact !== artifactId) continue;
    if (c.when && !Object.entries(c.when).every(([k, v]) => context[k] === v)) continue;
    if (!String(content).includes(c.contains)) {
      failed.push({ id: c.id, detail: `"${artifactId}" must contain ${JSON.stringify(c.contains)}` });
    }
  }
  return { ok: failed.length === 0, failed };
}

export function isSecurityArtifact(artifactId) {
  return SECURITY_ARTIFACTS.includes(artifactId);
}

export function securityArtifactFile(paths, artifactId) {
  const { format } = artifactSpec(artifactId);
  return path.join(paths.securityDir, `${artifactId}.${format}`);
}

export function readSecurityArtifact(paths, artifactId) {
  const file = securityArtifactFile(paths, artifactId);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
}

export function writeSecurityArtifact(paths, artifactId, content, producedBy = null) {
  if (!isSecurityArtifact(artifactId)) {
    throw new Error(
      `"${artifactId}" is not a repository security artifact. The baseline holds: ${SECURITY_ARTIFACTS.join(', ')}`
    );
  }
  const file = securityArtifactFile(paths, artifactId);
  ensureDir(path.dirname(file));
  const body = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
  fs.writeFileSync(file, body.endsWith('\n') ? body : body + '\n', 'utf8');

  const meta = {
    id: artifactId,
    file: path.relative(paths.root, file),
    sha256: crypto.createHash('sha256').update(body).digest('hex'),
    bytes: Buffer.byteLength(body, 'utf8'),
    updatedAt: new Date().toISOString(),
    producedBy
  };

  const state = loadSecurity(paths);
  state.artifacts[artifactId] = meta;
  state.updatedAt = meta.updatedAt;
  if (SECURITY_ARTIFACTS.every((id) => state.artifacts[id])) {
    state.status = SECURITY_STATUS.COMPLETE;
    state.completedAt = meta.updatedAt;
  }
  saveSecurity(paths, state);
  return meta;
}

export function loadSecurity(paths) {
  const stored = readJson(paths.securityFile, null);
  return stored ?? {
    schema: 1,
    status: SECURITY_STATUS.NOT_RUN,
    requestedAt: null,
    completedAt: null,
    updatedAt: null,
    artifacts: {}
  };
}

export function saveSecurity(paths, state) {
  ensureDir(paths.securityDir);
  writeJson(paths.securityFile, state);
  return state;
}

export function setSecurityStatus(paths, status) {
  const state = loadSecurity(paths);
  state.status = status;
  if (status === SECURITY_STATUS.REQUESTED) state.requestedAt = new Date().toISOString();
  return saveSecurity(paths, state);
}

/**
 * What a caller needs to decide whether to run the baseline, refresh it, or
 * carry on. Reads the files rather than trusting the record, so a deleted
 * artifact is noticed rather than reported as still present.
 *
 * `stale` is advisory, not enforced: a baseline older than the newest dependency
 * manifest is probably out of date, and saying so is more useful than either
 * ignoring it or refusing to proceed.
 */
export function securityStatus(paths, { manifests = [] } = {}) {
  const state = loadSecurity(paths);
  const present = SECURITY_ARTIFACTS.filter((id) => readSecurityArtifact(paths, id) !== null);
  const missing = SECURITY_ARTIFACTS.filter((id) => !present.includes(id));

  let status = state.status;
  if (!missing.length) status = SECURITY_STATUS.COMPLETE;
  else if (status === SECURITY_STATUS.COMPLETE) status = SECURITY_STATUS.REQUESTED;

  const newestManifest = manifests
    .map((f) => {
      try {
        return fs.statSync(f).mtimeMs;
      } catch {
        return 0;
      }
    })
    .reduce((a, b) => Math.max(a, b), 0);
  const mappedAt = state.artifacts['dependency-map']?.updatedAt
    ? Date.parse(state.artifacts['dependency-map'].updatedAt)
    : 0;

  return {
    status,
    complete: missing.length === 0,
    present,
    missing,
    stale: Boolean(mappedAt && newestManifest && newestManifest > mappedAt),
    requestedAt: state.requestedAt,
    completedAt: missing.length === 0 ? state.completedAt : null,
    artifacts: state.artifacts
  };
}

/** Dependency manifests Hermit knows how to look for, for the staleness check. */
export const MANIFEST_FILES = [
  'package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock',
  'requirements.txt', 'pyproject.toml', 'poetry.lock', 'Pipfile.lock',
  'go.mod', 'go.sum',
  'pom.xml', 'build.gradle', 'build.gradle.kts', 'gradle.lockfile',
  'Gemfile.lock', 'Cargo.toml', 'Cargo.lock', 'composer.lock'
];
