/**
 * Monorepo behaviour: conditional exit criteria, path scoping, UX skipping.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import {
  layout, loadRegistry, resolveProjects, createRun, loadRun,
  nextTask, submitArtifact, requestHandoff, runStatus, DEFAULT_PIPELINE,
  checkOnboardingArtifact, writeOnboardingArtifact, readArtifact
} from '@hermit/core';

const repo = path.dirname(fileURLToPath(import.meta.url)).replace(/\/scripts$/, '');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hermit-mono-'));

// A repo shaped like the one in the request: frontend, backend, batch, infra.
fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'plat', private: true, workspaces: ['apps/*', 'services/*'] }));
const mk = (rel, file, body) => mk2(root, rel, file, body);
const mk2 = (base, rel, file, body) => {
  fs.mkdirSync(path.join(base, rel), { recursive: true });
  fs.writeFileSync(path.join(base, rel, file), body);
};
mk('apps/web', 'package.json', '{"name":"web","dependencies":{"react":"^18"}}');
mk('services/api', 'package.json', '{"name":"api","dependencies":{"express":"^4"}}');
mk('services/nightly-batch', 'package.json', '{"name":"batch","dependencies":{"bullmq":"^5"}}');
mk('infra', 'main.tf', 'resource "aws_s3_bucket" "b" {}');

fs.mkdirSync(path.join(root, '.hermit'), { recursive: true });
for (const d of ['agents', 'skills', 'knowledge']) {
  fs.cpSync(path.join(repo, 'packages/agents', d), path.join(root, '.hermit', d), { recursive: true });
}
const paths = layout(root);
const registry = loadRegistry(paths);

const { projects, monorepo } = resolveProjects(root, {});
assert.equal(monorepo, true);
const ids = projects.map((p) => p.id).sort();
assert.deepEqual(ids, ['apps-web', 'infra', 'services-api', 'services-nightly-batch']);
assert.equal(projects.find((p) => p.id === 'apps-web').kind, 'frontend');
assert.equal(projects.find((p) => p.id === 'infra').kind, 'infra');
assert.equal(projects.find((p) => p.id === 'services-nightly-batch').kind, 'batch');
console.log(`  ✓ detected ${projects.length} projects: ${ids.join(', ')}`);

// --- Backend-only run skips UX ---
const backend = createRun(paths, {
  title: 'idempotency keys', intent: 'Add idempotency keys to the billing webhook',
  projects, selectedProjects: ['services-api']
});
const bs = runStatus({ paths, run: backend });
const ux = bs.stages.filter((s) => s.id.startsWith('ux_'));
assert.ok(ux.every((s) => s.status === 'skipped'), 'UX stages must skip with no UI project in scope');
console.log('  ✓ backend-only run skipped all three UX stages automatically');

// --- Onboarding's monorepo check survived leaving the pipeline ---
// It is no longer a stage exit criterion, so it is enforced on submission
// instead — same rule, same refusal, different mechanism.
const NO_PROJECTS = '# Codebase Map\n\n## Entry Points\nsrc/index.js\n\n## Module Boundaries\napi\n\n## Data Model\nOrder\n\n## Cross-Cutting Concerns\nauth\n\n## Test Topology\ntest/\n\n## Change Hotspots\nsrc/webhook.js\n';
const WITH_PROJECTS = NO_PROJECTS + '\n## Projects\n| Project | Path | Kind |\n|---|---|---|\n| services-api | services/api/ | backend |\n';

let chk = checkOnboardingArtifact('codebase-map', NO_PROJECTS, { monorepo: true });
assert.equal(chk.ok, false, 'a monorepo map without ## Projects must be refused');
assert.ok(chk.failed.some((f) => f.id === 'projects-mapped'));
console.log('  ✓ monorepo-only check "projects-mapped" refused the submission');

assert.equal(checkOnboardingArtifact('codebase-map', NO_PROJECTS, { monorepo: false }).ok, true,
  'the same map is fine in a single-project repo — the check is conditional');
assert.equal(checkOnboardingArtifact('codebase-map', WITH_PROJECTS, { monorepo: true }).ok, true);
console.log('  ✓ conditional: inactive for a single-project repo, satisfied when present');

// Onboarding is repository-level, so a run reads it without ever producing it.
writeOnboardingArtifact(paths, 'codebase-map', WITH_PROJECTS, 'onboarding');
assert.ok(readArtifact(paths, backend.id, 'codebase-map'), 'the run resolves the repository onboarding');
console.log('  ✓ the run reads onboarding it never produced');

// --- Path scoping narrows the implementer's write scope ---
const single = createRun(paths, {
  title: 'ui tweak', intent: 'Restyle the checkout banner',
  projects, selectedProjects: ['apps-web']
});
const uiStatus = runStatus({ paths, run: single });
assert.ok(uiStatus.stages.filter((s) => s.id.startsWith('ux_')).every((s) => s.status === 'pending'),
  'UX stages must run when a frontend project is in scope');
console.log('  ✓ frontend-scoped run kept the UX stages');

// Drive to the interface implementation stage to inspect the scoped bundle.
const impl = DEFAULT_PIPELINE.stages.find((s) => s.id === 'implementation_ui');
const implAgent = registry.agentsById[impl.agent];
const { buildContextBundle } = await import('@hermit/core');
const bundle = buildContextBundle({
  paths, run: loadRun(paths, single.id), stage: impl, agent: implAgent, registry
});
assert.ok(bundle.writablePaths.length, 'implementer must have writable paths');
assert.ok(bundle.writablePaths.every((p) => p.startsWith('apps/web/')),
  `write scope leaked outside apps/web: ${bundle.writablePaths.join(', ')}`);
assert.deepEqual(bundle.projectsOutOfScope.sort(), ['infra', 'services-api', 'services-nightly-batch']);
console.log(`  ✓ implementer write scope confined to apps/web (${bundle.writablePaths.length} globs)`);

// --- Discovery does not depend on folder names ---
// A repository whose folders are named after the product rather than after
// their role is the common case, and a fixed list of blessed names never
// contains them. Evidence decides; the name only informs classification.
const named = (label, build) => {
  const r = fs.mkdtempSync(path.join(os.tmpdir(), 'hermit-name-'));
  build(r);
  const d = resolveProjects(r, {});
  fs.rmSync(r, { recursive: true, force: true });
  return { label, ...d };
};
const REACT = '{"name":"w","dependencies":{"react":"^18"}}';

for (const [label, build, expect] of [
  ['product-named folders', (r) => { mk2(r, 'shop-web', 'package.json', REACT); mk2(r, 'payments-api', 'go.mod', 'module x\n'); }, ['payments-api', 'shop-web']],
  ['role-named folders', (r) => { mk2(r, 'frontend', 'package.json', REACT); mk2(r, 'backend', 'requirements.txt', 'fastapi\n'); }, ['backend', 'frontend']],
  ['role-named, no manifests', (r) => { mk2(r, 'frontend/src', 'App.jsx', 'x'); mk2(r, 'backend/app', 'main.py', 'x'); }, ['backend', 'frontend']]
]) {
  const got = named(label, build);
  assert.equal(got.monorepo, true, `${label}: should be a monorepo`);
  assert.deepEqual(got.projects.map((p) => p.id).sort(), expect, label);
}
console.log('  ✓ projects found by evidence, whatever the folders are called');

// The other half: evidence is required, so scaffolding is not mistaken for a project.
const noise = named('noise', (r) => {
  fs.writeFileSync(path.join(r, 'package.json'), '{"name":"solo"}');
  for (const [d, f] of [['src', 'i.js'], ['scripts', 'b.js'], ['tools', 'g.js'], ['docs', 'readme.md'], ['test', 'a.test.js']]) mk2(r, d, f, 'x');
});
assert.equal(noise.monorepo, false, 'src/, scripts/, tools/, docs/ and test/ are not projects');
assert.deepEqual(noise.projects, []);
console.log('  ✓ scaffolding directories are still not projects');

// --- A single-project repo behaves exactly as before ---
const solo = fs.mkdtempSync(path.join(os.tmpdir(), 'hermit-solo-'));
fs.writeFileSync(path.join(solo, 'package.json'), '{"name":"solo"}');
const soloInfo = resolveProjects(solo, {});
assert.equal(soloInfo.monorepo, false);
console.log('  ✓ single-project repo reports monorepo:false — conditional criteria stay inactive');

fs.rmSync(root, { recursive: true, force: true });
fs.rmSync(solo, { recursive: true, force: true });
console.log('\nMONOREPO BEHAVIOUR VERIFIED');
