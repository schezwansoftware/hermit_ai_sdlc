import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ARTIFACTS } from './pipeline.js';
import { ensureDir } from './paths.js';
import { isOnboardingArtifact, onboardingArtifactFile } from './onboarding.js';
import { isSecurityArtifact, securityArtifactFile } from './security.js';

export function artifactSpec(artifactId) {
  return ARTIFACTS[artifactId] ?? { format: 'md', title: artifactId, producer: null };
}

export function artifactFile(paths, runId, artifactId) {
  const { format } = artifactSpec(artifactId);
  return path.join(paths.artifactsDir(runId), `${artifactId}.${format}`);
}

export function artifactExists(paths, runId, artifactId) {
  return readArtifact(paths, runId, artifactId) !== null;
}

/**
 * Read an artifact for a run, falling back to the repository-level stores.
 *
 * Onboarding is mapped once for the whole repository rather than per run, so
 * `project-context`, `codebase-map` and `glossary` live outside any run. The
 * security baseline — `dependency-map` and `security-baseline` — works the same
 * way. A run that produced its own copy still wins, which keeps a re-scanned
 * repository from rewriting history under a run already in flight.
 */
export function readArtifact(paths, runId, artifactId) {
  const file = artifactFile(paths, runId, artifactId);
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8');

  if (isOnboardingArtifact(artifactId)) {
    const shared = onboardingArtifactFile(paths, artifactId);
    if (fs.existsSync(shared)) return fs.readFileSync(shared, 'utf8');
  }
  if (isSecurityArtifact(artifactId)) {
    const shared = securityArtifactFile(paths, artifactId);
    if (fs.existsSync(shared)) return fs.readFileSync(shared, 'utf8');
  }
  return null;
}

/**
 * Persist an artifact and return its metadata record.
 * @returns {{ id:string, file:string, sha256:string, bytes:number, updatedAt:string, producedBy:string|null }}
 */
export function writeArtifact(paths, runId, artifactId, content, producedBy = null) {
  const file = artifactFile(paths, runId, artifactId);
  ensureDir(path.dirname(file));
  const body = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
  fs.writeFileSync(file, body.endsWith('\n') ? body : body + '\n', 'utf8');
  return {
    id: artifactId,
    file: path.relative(paths.root, file),
    sha256: crypto.createHash('sha256').update(body).digest('hex'),
    bytes: Buffer.byteLength(body, 'utf8'),
    updatedAt: new Date().toISOString(),
    producedBy
  };
}

function sharedIn(dir, belongs) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /\.(md|json|txt)$/.test(f))
    .map((f) => f.replace(/\.(md|json|txt)$/, ''))
    .filter(belongs);
}

export function listArtifacts(paths, runId) {
  const dir = paths.artifactsDir(runId);
  const own = fs.existsSync(dir) ? fs.readdirSync(dir).map((f) => f.replace(/\.(md|json|txt)$/, '')) : [];
  return [
    ...new Set([
      ...own,
      ...sharedIn(paths.onboardingDir, isOnboardingArtifact),
      ...sharedIn(paths.securityDir, isSecurityArtifact)
    ])
  ];
}
