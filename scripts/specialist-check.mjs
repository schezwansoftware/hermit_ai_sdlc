/**
 * Specialist agent routing: which agent takes the implementation stage, and the
 * conditional design sections the architect owes whoever that turns out to be.
 *
 * The property under test is that routing is *narrowing only*. A specialist may
 * take a stage it declares itself for; it may never leave one unstaffed, and it
 * may never claim work outside its declaration.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import {
  layout, loadRegistry, resolveProjects, createRun, loadRun, resolveStageAgent,
  nextTask, submitArtifact, requestHandoff, runStatus, buildContextBundle,
  techScope, isBackendProject, decideGate, openGates, saveRun, DEFAULT_PIPELINE
} from '@hermit/core';

const repo = path.dirname(fileURLToPath(import.meta.url)).replace(/\/scripts$/, '');
const IMPL = DEFAULT_PIPELINE.stages.find((s) => s.id === 'implementation');

const mk = (root, rel, file, body) => {
  fs.mkdirSync(path.join(root, rel), { recursive: true });
  fs.writeFileSync(path.join(root, rel, file), body);
};
function workspace(prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.mkdirSync(path.join(root, '.hermit'), { recursive: true });
  for (const d of ['agents', 'skills', 'knowledge']) {
    fs.cpSync(path.join(repo, 'packages/agents', d), path.join(root, '.hermit', d), { recursive: true });
  }
  return root;
}

// A polyglot repo: Go and Python services beside a React app and a Node API.
const root = workspace('hermit-spec-');
fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'plat', private: true, workspaces: ['apps/*', 'services/*'] }));
mk(root, 'apps/web', 'package.json', '{"name":"web","dependencies":{"react":"^18"}}');
mk(root, 'services/api', 'package.json', '{"name":"api","dependencies":{"express":"^4"}}');
mk(root, 'services/billing', 'go.mod', 'module acme/billing\n\ngo 1.22\n');
mk(root, 'services/ledger', 'pyproject.toml', '[project]\nname = "ledger"\n');
mk(root, 'services/payments', 'pom.xml', '<project><artifactId>payments</artifactId></project>');

const paths = layout(root);
const registry = loadRegistry(paths);
const { projects } = resolveProjects(root, {});

for (const [id, stack] of [['services-billing', 'go'], ['services-ledger', 'python'], ['services-payments', 'jvm']]) {
  const p = projects.find((x) => x.id === id);
  assert.ok(p, `fixture project ${id} was not detected`);
  assert.ok((p.stack ?? []).includes(stack), `${id} should carry stack ${stack}, got ${p.stack}`);
}
console.log(`  ✓ detected ${projects.length} projects across go, python, jvm and node`);

// --- Routing: which agent takes stage 8 -------------------------------------

const routeFor = (selectedProjects) => {
  const run = createRun(paths, { title: 't', intent: 'i', projects, selectedProjects, registry });
  return { run, agent: resolveStageAgent(registry, IMPL, run) };
};

for (const [ids, expected, why] of [
  [['services-billing'], 'backend-developer', 'a Go service'],
  [['services-ledger'], 'backend-developer', 'a Python service'],
  [['services-payments'], 'backend-developer', 'a Spring Boot service'],
  [['services-api'], 'implementer', 'a Node backend has no specialist'],
  [['apps-web'], 'implementer', 'a React app has no specialist yet'],
  [['services-billing', 'apps-web'], 'backend-developer', 'a mixed run picks the one specialist that matches']
]) {
  const { agent } = routeFor(ids);
  assert.equal(agent.id, expected, `${ids.join('+')} should route to ${expected} — ${why}`);
}
console.log('  ✓ implementation routes by stack: go/python/jvm → backend-developer, node/react → implementer');

// Routing has to be visible before the stage runs, or a reviewer planning the
// work cannot see who is going to do it.
const goRun = routeFor(['services-billing']).run;
assert.equal(
  runStatus({ paths, run: goRun }).stages.find((s) => s.id === 'implementation').agent,
  'backend-developer',
  'hermit status must name the specialist from the moment the run is created'
);
console.log('  ✓ status names the specialist before the stage starts');

// The pipeline's own agent must still be reachable, or a specialist could strand
// a stage rather than narrow it.
for (const stage of DEFAULT_PIPELINE.stages) {
  const { run } = routeFor(['services-billing']);
  assert.ok(resolveStageAgent(registry, stage, run), `stage ${stage.id} resolved to no agent`);
}
console.log('  ✓ every stage still resolves to an agent under a specialist-matching run');

// A run predating this feature carries no tech scope. It must fall back, not throw.
assert.equal(resolveStageAgent(registry, IMPL, {}).id, 'implementer');
assert.equal(resolveStageAgent(registry, IMPL, { tech: { units: [] } }).id, 'implementer');
console.log('  ✓ a run with no recorded tech scope falls back to the pipeline default');

// --- A flat single-service repo is classified from its root ------------------

const flat = workspace('hermit-flat-');
fs.writeFileSync(path.join(flat, 'pyproject.toml'), '[project]\nname = "svc"\n');
fs.mkdirSync(path.join(flat, 'app'), { recursive: true });
const flatPaths = layout(flat);
const flatInfo = resolveProjects(flat, {});
assert.equal(flatInfo.projects.length, 0, 'fixture should declare no sub-projects');

const flatScope = techScope(flat, [], []);
assert.deepEqual(flatScope.stacks, ['python'], 'root classification should find python');
assert.equal(flatScope.backend, true);

const flatRun = createRun(flatPaths, { title: 't', intent: 'i', projects: [], selectedProjects: [] });
assert.equal(
  resolveStageAgent(loadRegistry(flatPaths), IMPL, flatRun).id,
  'backend-developer',
  'a flat Python repo declares no projects but is still Python'
);
console.log('  ✓ flat single-service repo routes from its root classification');

// --- Backend classification does not over-reach ------------------------------

assert.equal(isBackendProject({ kind: 'frontend', stack: ['node'] }), false);
assert.equal(isBackendProject({ kind: 'infra', stack: ['python'] }), false, 'terraform with a python helper is not a backend');
assert.equal(isBackendProject({ kind: 'docs', stack: ['python'] }), false);
assert.equal(isBackendProject({ kind: 'backend', stack: ['node'] }), true, 'a node API is still backend work');
assert.equal(isBackendProject({ kind: 'batch', stack: ['node'] }), true);
assert.equal(isBackendProject({ kind: 'unknown', stack: ['go'] }), true, 'an unclassified Go module is server-side');
console.log('  ✓ backend classification excludes frontend, mobile, docs and infra');

// --- The architect owes a ## Backend Design when the work has a server side ---

const run = createRun(paths, {
  title: 'ledger reconciliation', intent: 'Reconcile ledger entries nightly',
  projects, selectedProjects: ['services-billing'], registry
});
assert.ok(
  runStatus({ paths, run }).stages.filter((s) => s.id.startsWith('ux_')).every((s) => s.status === 'skipped'),
  'a backend-only run skips UX, so ## Frontend Design must not be demanded'
);

nextTask({ paths, run: loadRun(paths, run.id), registry });
const ONBOARD = {
  'project-context': '# Project Context\n\n## Purpose\nBilling.\n\n## Tech Stack\n| Layer | Tech |\n|---|---|\n| billing | Go |\n\n## Runtime Topology\nServices.\n\n## External Dependencies\nStripe.\n\n## Conventions\ngo test.\n\n## Ownership\nPlatform.\n\n## Known Constraints\nPCI.\n\n## Confidence & Gaps\nNone.\n',
  'codebase-map': '# Codebase Map\n\n## Entry Points\ncmd/billing\n\n## Module Boundaries\nbilling\n\n## Data Model\nEntry\n\n## Cross-Cutting Concerns\nauth\n\n## Test Topology\ninternal/\n\n## Change Hotspots\nledger.go\n\n## Projects\n| Project | Path | Kind |\n|---|---|---|\n| services-billing | services/billing/ | backend |\n',
  glossary: '# Glossary\n\n- **Entry** → `LedgerEntry`\n'
};
for (const [id, body] of Object.entries(ONBOARD)) {
  submitArtifact({ paths, run: loadRun(paths, run.id), registry, artifactId: id, content: body, agentId: 'onboarding' });
}
assert.equal(requestHandoff({ paths, run: loadRun(paths, run.id), registry, agentId: 'onboarding' }).state, 'advanced');

// Requirements is human-gated; approve it to reach architecture.
nextTask({ paths, run: loadRun(paths, run.id), registry });
for (const [id, body] of [
  ['requirements-spec', '# Requirements\n\n## Context\nNightly drift.\n\n## In Scope\n1. Reconcile.\n\n## Out of Scope\nRefunds.\n\n## Functional Requirements\nFR-1 Entries reconcile nightly.\n\n## Non-Functional Requirements\nCompletes in 2h.\n\n## Data\nEntries.\n\n## Dependencies\nNone.\n\n## Assumptions\nLedger is append-only.\n\n## Decisions Required\nNone outstanding.\n'],
  ['acceptance-criteria', '# Acceptance Criteria\n\n## AC-1 — FR-1 — entries reconcile\n**Given** unmatched entries\n**When** the nightly job runs\n**Then** they are matched and the batch is idempotent\n\n**Verified by**: integration test\n']
]) {
  submitArtifact({ paths, run: loadRun(paths, run.id), registry, artifactId: id, content: body, agentId: 'analyst' });
}
assert.equal(requestHandoff({ paths, run: loadRun(paths, run.id), registry, agentId: 'analyst' }).state, 'awaiting_gate');
const reqRun = loadRun(paths, run.id);
decideGate(paths, reqRun, openGates(reqRun)[0].id, 'approve', { decidedBy: 'harshit', source: 'cli' });
saveRun(paths, reqRun);

const task = nextTask({ paths, run: loadRun(paths, run.id), registry });
assert.equal(task.stage.id, 'architecture', 'UX skipped, so architecture is next');
assert.ok(
  task.rendered.includes('## Backend Design'),
  'the architect brief must name the backend design section it owes'
);
assert.ok(
  !task.contract.outputs.flatMap((o) => o.requiredSections).includes('## Frontend Design'),
  'a run with no UI must not be asked for a frontend design section'
);
console.log('  ✓ architect brief demands ## Backend Design and omits ## Frontend Design');

const ARCH_BASE = '# Architecture\n\n## Approach\nBatch reconcile.\n\n## Component Map\n| Component | Path |\n|---|---|\n| ledger | services/billing/ledger.go |\n\n## Interfaces\nPOST /reconcile\n\n## Data Design\nentries table.\n\n## Sequence\n1. read 2. match 3. write\n\n## Security\nmTLS.\n\n## Observability\nMetric ledger.reconciled\n\n## Performance\np95 2s.\n\n## Alternatives Considered\nStreaming — rejected, ordering.\n';
const REST = {
  adr: '# ADR-1: Batch reconcile\n\n## Status\nProposed\n\n## Context\nOrdering.\n\n## Decision\nBatch nightly.\n\n## Consequences\n### Positive\nSimple.\n### Negative\nUp to 24h stale.\n### Neutral\nNew job.\n\n## Alternatives\nStreaming — rejected: ordering guarantees.\n',
  'impact-analysis': '# Impact Analysis\n\n## Blast Radius\nbilling.\n\n## Breaking Changes\nNone.\n\n## Risks\n- Partial batch — medium — checkpoint.\n\n## Rollout\nFlag.\n\n## Rollback\nDisable the job.\n\n## Effort Signal\nM.\n\n## Cross-Project Impact\n| Project | In scope | Effect | Breaking | Migration |\n|---|---|---|---|---|\n| services-billing | yes | new job | no | none |\n'
};
for (const [id, body] of Object.entries({ 'architecture-spec': ARCH_BASE, ...REST })) {
  submitArtifact({ paths, run: loadRun(paths, run.id), registry, artifactId: id, content: body, agentId: 'architect' });
}
let h = requestHandoff({ paths, run: loadRun(paths, run.id), registry, agentId: 'architect' });
assert.equal(h.state, 'blocked', 'a server-side run must require ## Backend Design');
assert.ok(h.criteria.some((c) => c.id === 'backend-design' && !c.ok));
assert.ok(!h.criteria.some((c) => c.id === 'frontend-design'), 'the ui criterion must not even be evaluated');
console.log('  ✓ handoff refused without ## Backend Design; frontend criterion stayed inactive');

submitArtifact({
  paths, run: loadRun(paths, run.id), registry, artifactId: 'architecture-spec', agentId: 'architect',
  content: `${ARCH_BASE}\n## Backend Design\nOne transaction per batch; idempotent on batch id.\n`
});
h = requestHandoff({ paths, run: loadRun(paths, run.id), registry, agentId: 'architect' });
assert.equal(h.state, 'awaiting_gate', `architecture should reach its gate: ${h.message}`);
console.log('  ✓ with the section present, architecture reached its human gate');

// --- The specialist's scope is narrowed the same way the default's is --------

const bundle = buildContextBundle({
  paths, run: loadRun(paths, run.id), stage: IMPL,
  agent: registry.agentsById['backend-developer'], registry
});
assert.ok(bundle.writablePaths.length, 'backend-developer must have writable paths');
assert.ok(
  bundle.writablePaths.every((p) => p.startsWith('services/billing/')),
  `specialist write scope leaked outside services/billing: ${bundle.writablePaths.join(', ')}`
);
assert.ok(
  bundle.skills.some((s) => s.id === 'backend-go'),
  'the specialist must actually carry its language packs'
);
console.log(`  ✓ specialist write scope confined to services/billing (${bundle.writablePaths.length} globs)`);

fs.rmSync(root, { recursive: true, force: true });
fs.rmSync(flat, { recursive: true, force: true });
console.log('\nSPECIALIST ROUTING VERIFIED');
