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
 * Read an artifact produced by *this run only*, with no fallback to the
 * repository-level stores.
 *
 * `readArtifact` deliberately falls back so every run inherits the shared
 * onboarding and security baseline. When the question is "what did this run
 * write earlier", that fallback would answer with someone else's document —
 * so this is the read to use for a stage revisiting its own output.
 */
export function readRunArtifact(paths, runId, artifactId) {
  const file = artifactFile(paths, runId, artifactId);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
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

/**
 * Pull the body of one `## Heading` section out of a markdown document, up to
 * the next heading of the same or a higher level (or end of document).
 *
 * Used to lift the agent-written `## In Plain Terms` explanation out of a gated
 * artifact so the gate message can carry what was actually submitted, in the
 * producer's own plain words, rather than only a fixed description of what the
 * gate means. Returns null when the section is absent or empty.
 */
export function extractSection(markdown, heading) {
  if (typeof markdown !== 'string') return null;
  const norm = heading.replace(/^#+\s*/, '').trim().toLowerCase();
  const lines = markdown.split('\n');
  let start = -1;
  let level = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,6})\s+(.*?)\s*$/);
    if (m && m[2].trim().toLowerCase() === norm) {
      start = i + 1;
      level = m[1].length;
      break;
    }
  }
  if (start === -1) return null;
  const out = [];
  for (let i = start; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,6})\s+/);
    if (m && m[1].length <= level) break;
    out.push(lines[i]);
  }
  const body = out.join('\n').trim();
  return body.length ? body : null;
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
