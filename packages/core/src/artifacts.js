import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ARTIFACTS } from './pipeline.js';
import { ensureDir } from './paths.js';

export function artifactSpec(artifactId) {
  return ARTIFACTS[artifactId] ?? { format: 'md', title: artifactId, producer: null };
}

export function artifactFile(paths, runId, artifactId) {
  const { format } = artifactSpec(artifactId);
  return path.join(paths.artifactsDir(runId), `${artifactId}.${format}`);
}

export function artifactExists(paths, runId, artifactId) {
  return fs.existsSync(artifactFile(paths, runId, artifactId));
}

export function readArtifact(paths, runId, artifactId) {
  const file = artifactFile(paths, runId, artifactId);
  if (!fs.existsSync(file)) return null;
  return fs.readFileSync(file, 'utf8');
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
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).map((f) => f.replace(/\.(md|json|txt)$/, ''));
}
