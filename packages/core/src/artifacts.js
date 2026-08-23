import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ARTIFACTS } from './pipeline.js';
import { ensureDir } from './paths.js';
import { isOnboardingArtifact, onboardingArtifactFile } from './onboarding.js';

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
 * Read an artifact for a run, falling back to the repository's onboarding.
 *
 * Onboarding is mapped once for the whole repository rather than per run, so
 * `project-context`, `codebase-map` and `glossary` live outside any run. A run
 * that produced its own copy still wins — that keeps a re-onboarded repository
 * from rewriting history under a run already in flight.
 */
export function readArtifact(paths, runId, artifactId) {
  const file = artifactFile(paths, runId, artifactId);
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8');

  if (isOnboardingArtifact(artifactId)) {
    const shared = onboardingArtifactFile(paths, artifactId);
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

export function listArtifacts(paths, runId) {
  const dir = paths.artifactsDir(runId);
  const own = fs.existsSync(dir) ? fs.readdirSync(dir).map((f) => f.replace(/\.(md|json|txt)$/, '')) : [];
  const shared = fs.existsSync(paths.onboardingDir)
    ? fs.readdirSync(paths.onboardingDir)
        .filter((f) => /\.(md|json|txt)$/.test(f))
        .map((f) => f.replace(/\.(md|json|txt)$/, ''))
        .filter(isOnboardingArtifact)
    : [];
  return [...new Set([...own, ...shared])];
}
