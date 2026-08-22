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
  nextTask, submitArtifact, requestHandoff, runStatus, DEFAULT_PIPELINE
} from '@hermit/core';

const repo = path.dirname(fileURLToPath(import.meta.url)).replace(/\/scripts$/, '');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hermit-mono-'));

// A repo shaped like the one in the request: frontend, backend, batch, infra.
fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'plat', private: true, workspaces: ['apps/*', 'services/*'] }));
const mk = (rel, file, body) => {
  fs.mkdirSync(path.join(root, rel), { recursive: true });
  fs.writeFileSync(path.join(root, rel, file), body);
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

// --- Conditional criterion refuses a map without ## Projects ---
let run = loadRun(paths, backend.id);
nextTask({ paths, run, registry });
const NO_PROJECTS = '# Codebase Map\n\n## Entry Points\nsrc/index.js\n\n## Module Boundaries\napi\n\n## Data Model\nOrder\n\n## Cross-Cutting Concerns\nauth\n\n## Test Topology\ntest/\n\n## Change Hotspots\nsrc/webhook.js\n';
const CTX = '# Project Context\n\n## Purpose\nBilling.\n\n## Tech Stack\n| Layer | Tech |\n|---|---|\n| API | Node |\n\n## Runtime Topology\nTwo services.\n\n## External Dependencies\nStripe.\n\n## Conventions\nVitest.\n\n## Ownership\nPlatform.\n\n## Known Constraints\nPCI.\n\n## Confidence & Gaps\nNone.\n';
for (const [id, body] of [['project-context', CTX], ['codebase-map', NO_PROJECTS], ['glossary', '# Glossary\n\n- **Webhook** → `WebhookHandler`\n']]) {
  submitArtifact({ paths, run: loadRun(paths, backend.id), registry, artifactId: id, content: body, agentId: 'onboarding' });
}
let h = requestHandoff({ paths, run: loadRun(paths, backend.id), registry, agentId: 'onboarding' });
assert.equal(h.state, 'blocked', 'monorepo run must require a ## Projects section');
assert.ok(h.criteria.some((c) => c.id === 'projects-mapped' && !c.ok));
console.log('  ✓ monorepo-only criterion "projects-mapped" refused the handoff');

// Same artifact with the section passes.
submitArtifact({
  paths, run: loadRun(paths, backend.id), registry, artifactId: 'codebase-map', agentId: 'onboarding',
  content: NO_PROJECTS + '\n## Projects\n| Project | Path | Kind | Owns | Depends on |\n|---|---|---|---|---|\n| services-api | services/api/ | backend | billing webhooks | none |\n'
});
h = requestHandoff({ paths, run: loadRun(paths, backend.id), registry, agentId: 'onboarding' });
assert.equal(h.state, 'advanced');
console.log('  ✓ with the section present, the stage advanced');

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

// --- A single-project repo behaves exactly as before ---
const solo = fs.mkdtempSync(path.join(os.tmpdir(), 'hermit-solo-'));
fs.writeFileSync(path.join(solo, 'package.json'), '{"name":"solo"}');
const soloInfo = resolveProjects(solo, {});
assert.equal(soloInfo.monorepo, false);
console.log('  ✓ single-project repo reports monorepo:false — conditional criteria stay inactive');

fs.rmSync(root, { recursive: true, force: true });
fs.rmSync(solo, { recursive: true, force: true });
console.log('\nMONOREPO BEHAVIOUR VERIFIED');
