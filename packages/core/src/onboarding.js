import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ensureDir, readJson, writeJson } from './paths.js';
import { artifactSpec } from './artifacts.js';

/**
 * Project onboarding: mapped once for the repository, not once per run.
 *
 * It is deliberately outside the pipeline. Mapping a codebase is expensive and
 * the answer barely changes between runs, so paying for it on every run was a
 * tax with no return. It is also opt-in — `hermit init` asks, because the cost
 * lands on the user's token budget and a repository they already know may not
 * need it at all.
 *
 * Runs read these artifacts when they exist and say plainly which are missing
 * when they do not. Nothing blocks on onboarding.
 */
export const ONBOARDING_ARTIFACTS = ['project-context', 'codebase-map', 'glossary'];

export const ONBOARDING_STATUS = /** @type {const} */ ({
  NOT_ASKED: 'not_asked',
  DECLINED: 'declined',
  REQUESTED: 'requested',
  COMPLETE: 'complete'
});

/**
 * Onboarding has no stage, so it has no exit criteria — but the mechanical
 * checks that used to guard it still matter. They are enforced on submission
 * instead: an artifact that fails one is refused with the reason, exactly as a
 * stage handoff would be refused.
 */
export const ONBOARDING_CRITERIA = [
  { id: 'stack-identified', artifact: 'project-context', contains: '## Tech Stack' },
  { id: 'boundaries-mapped', artifact: 'codebase-map', contains: '## Module Boundaries' },
  { id: 'projects-mapped', artifact: 'codebase-map', contains: '## Projects', when: { monorepo: true } }
];

/**
 * @returns {{ ok:boolean, failed:Array<{id:string,detail:string}> }}
 */
export function checkOnboardingArtifact(artifactId, content, context = {}) {
  const failed = [];
  for (const c of ONBOARDING_CRITERIA) {
    if (c.artifact !== artifactId) continue;
    if (c.when && !Object.entries(c.when).every(([k, v]) => context[k] === v)) continue;
    if (!String(content).includes(c.contains)) {
      failed.push({ id: c.id, detail: `"${artifactId}" must contain ${JSON.stringify(c.contains)}` });
    }
  }
  return { ok: failed.length === 0, failed };
}

export function isOnboardingArtifact(artifactId) {
  return ONBOARDING_ARTIFACTS.includes(artifactId);
}

export function onboardingArtifactFile(paths, artifactId) {
  const { format } = artifactSpec(artifactId);
  return path.join(paths.onboardingDir, `${artifactId}.${format}`);
}

export function readOnboardingArtifact(paths, artifactId) {
  const file = onboardingArtifactFile(paths, artifactId);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
}

export function writeOnboardingArtifact(paths, artifactId, content, producedBy = null) {
  if (!isOnboardingArtifact(artifactId)) {
    throw new Error(
      `"${artifactId}" is not an onboarding artifact. Onboarding produces: ${ONBOARDING_ARTIFACTS.join(', ')}`
    );
  }
  const file = onboardingArtifactFile(paths, artifactId);
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

  const state = loadOnboarding(paths);
  state.artifacts[artifactId] = meta;
  state.updatedAt = meta.updatedAt;
  if (ONBOARDING_ARTIFACTS.every((id) => state.artifacts[id])) {
    state.status = ONBOARDING_STATUS.COMPLETE;
    state.completedAt = meta.updatedAt;
  }
  saveOnboarding(paths, state);
  return meta;
}

export function loadOnboarding(paths) {
  const stored = readJson(paths.onboardingFile, null);
  return stored ?? {
    schema: 1,
    status: ONBOARDING_STATUS.NOT_ASKED,
    requestedAt: null,
    completedAt: null,
    updatedAt: null,
    artifacts: {}
  };
}

export function saveOnboarding(paths, state) {
  ensureDir(paths.onboardingDir);
  writeJson(paths.onboardingFile, state);
  return state;
}

export function setOnboardingStatus(paths, status) {
  const state = loadOnboarding(paths);
  state.status = status;
  if (status === ONBOARDING_STATUS.REQUESTED) state.requestedAt = new Date().toISOString();
  return saveOnboarding(paths, state);
}

/**
 * What a caller needs to decide whether to prompt, run, or carry on.
 * Reads the files rather than trusting the record, so a deleted artifact is
 * noticed rather than reported as still present.
 */
export function onboardingStatus(paths) {
  const state = loadOnboarding(paths);
  const present = ONBOARDING_ARTIFACTS.filter((id) => readOnboardingArtifact(paths, id) !== null);
  const missing = ONBOARDING_ARTIFACTS.filter((id) => !present.includes(id));

  let status = state.status;
  if (!missing.length) status = ONBOARDING_STATUS.COMPLETE;
  else if (status === ONBOARDING_STATUS.COMPLETE) status = ONBOARDING_STATUS.REQUESTED;

  return {
    status,
    complete: missing.length === 0,
    present,
    missing,
    requestedAt: state.requestedAt,
    completedAt: missing.length === 0 ? state.completedAt : null,
    artifacts: state.artifacts
  };
}
