/**
 * Run scope: what the intent sentence is allowed to change, and what it is not.
 *
 * Three claims are proven here:
 *   1. A prompt can stand a stage down, and the words that did it are recorded.
 *   2. A stage with a human gate cannot be stood down — not by prose, not by a
 *      flag, and not by a caller passing the stage id straight into createRun.
 *   3. The two opt-in stages are off until asked for, and the conditional gates
 *      they bring with them open exactly when their condition holds.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import {
  layout, loadRegistry, DEFAULT_PIPELINE, createRun, loadRun, saveRun, runStatus,
  requestHandoff, writeArtifact, readArtifact, stageNeedsGate, majorUpgradeCount,
  parseDirectives, resolveTargets, skippableStages, optInStages,
  writeSecurityArtifact, securityStatus, checkSecurityArtifact,
  SECURITY_ARTIFACTS, STAGE_STATUS
} from '@hermit/core';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hermit-scope-'));
const paths = layout(root);

fs.mkdirSync(path.join(root, '.hermit'), { recursive: true });
for (const d of ['agents', 'skills', 'knowledge']) {
  fs.cpSync(path.join(repo, 'packages/agents', d), path.join(root, '.hermit', d), { recursive: true });
}
const reg = loadRegistry(paths);

// ---------------------------------------------------------------- the parser

const CASES = [
  {
    intent: "add cart persistence, skip the UX designs and don't open a PR",
    skip: ['ux_lofi', 'ux_midfi', 'ux_hifi', 'pull_request'],
    include: [],
    refused: []
  },
  {
    // A refusal and a request in the same sentence: the turn phrase ends the
    // first clause, so the second is read as its own instruction.
    intent: "fix checkout, don't open a PR, but run a security scan and create the stories",
    skip: ['pull_request'],
    include: ['security', 'tracker'],
    refused: []
  },
  { intent: 'refactor the auth service, no backend implementation needed', skip: ['implementation_backend'], include: [], refused: [] },
  { intent: 'ship the new header, no ui', skip: ['ux_lofi', 'ux_midfi', 'ux_hifi', 'implementation_ui'], include: [], refused: [] },
  { intent: 'refactor auth, skip ux and qa', skip: ['ux_lofi', 'ux_midfi', 'ux_hifi', 'qa'], include: [], refused: [] },
  { intent: 'implement checkout but skip the review stage', skip: [], include: [], refused: ['review'] },
  { intent: 'ship it without the delivery sign-off or the architecture', skip: [], include: [], refused: ['delivery', 'architecture'] },
  // The controls. A stage name is not a directive: something has to negate it.
  { intent: 'add a review comment endpoint for the design system', skip: [], include: [], refused: [] },
  { intent: 'rewrite the backend documentation and the UX copy', skip: [], include: [], refused: [] },
  // Negating an already-off stage is recorded rather than ignored: the user gets
  // confirmation their instruction was read, and the skip beats any positive
  // mention elsewhere in the same sentence.
  { intent: 'fix the parser, no security scan needed', skip: ['security'], include: [], refused: [] },
  // One sentence that both asks and refuses. The parser reports both readings
  // rather than picking one; createRun resolves it, and skip wins (below).
  { intent: 'run a security scan but no cve check on the dev tree', skip: ['security'], include: ['security'], refused: [] }
];

for (const t of CASES) {
  const r = parseDirectives(t.intent);
  assert.deepEqual(r.skip.sort(), [...t.skip].sort(), `skip mismatch for: ${t.intent}`);
  assert.deepEqual(r.include.sort(), [...t.include].sort(), `include mismatch for: ${t.intent}`);
  assert.deepEqual(r.refused.map((x) => x.target).sort(), [...t.refused].sort(), `refusal mismatch for: ${t.intent}`);
  for (const d of r.decisions) assert.ok(d.phrase, 'every decision must record the phrase that caused it');
}
console.log(`  ✓ ${CASES.length} intent sentences parsed to the expected scope, phrases recorded`);

// Explicit flags reach the same table, by target id, stage id or alias.
assert.deepEqual(resolveTargets(['pr'], { action: 'skip' }).stages, ['pull_request']);
assert.deepEqual(resolveTargets(['pull_request'], { action: 'skip' }).stages, ['pull_request']);
assert.deepEqual(resolveTargets(['merge request'], { action: 'skip' }).stages, ['pull_request']);
assert.equal(resolveTargets(['review'], { action: 'skip' }).stages.length, 0, '--skip review resolves to nothing');
assert.equal(resolveTargets(['review'], { action: 'skip' }).refused[0].target, 'review');
assert.throws(() => resolveTargets(['nonsense']), /Unknown stage name/, 'a typo must error, not silently do nothing');
console.log('  ✓ --skip / --with resolve by id, stage id and alias; unknown names throw');

// ------------------------------------------------- what may and may not skip

/**
 * Locked, and it is not simply "everything with a gate".
 *
 * The UX stages are gated too, and they stay skippable — a run with no interface
 * has nothing for that gate to be about, and standing them down removes the
 * gate along with work that does not exist. The four below are different:
 * skipping one removes a check on work that *does* exist, which is the thing a
 * sentence must never be able to do.
 */
const LOCKED = ['requirements', 'architecture', 'review', 'delivery'];

for (const s of DEFAULT_PIPELINE.stages) {
  const locked = s.skippable === false;
  assert.equal(locked, LOCKED.includes(s.id), `stage "${s.id}" has the wrong skippable setting`);
  if (locked) assert.ok(!skippableStages().includes(s.id), `"${s.id}" must not be reachable from a skip directive`);
}
for (const id of LOCKED) {
  assert.equal(
    DEFAULT_PIPELINE.stages.find((s) => s.id === id)?.gate, 'hitl',
    `"${id}" is locked because it carries a human gate — if that changed, so should this list`
  );
}
const gated = LOCKED;
console.log(`  ✓ exactly ${LOCKED.length} stages are locked against skipping, and each carries a human gate`);

// The second lock. A caller that bypasses the parser entirely — a hand-written
// flags array, a direct MCP call — still cannot drop a gated stage.
const forced = createRun(paths, {
  title: 'Forced', intent: 'anything', registry: reg,
  skip: [...gated, 'qa', 'documentation']
});
for (const id of gated) {
  assert.notEqual(forced.stages[id].status, STAGE_STATUS.SKIPPED, `createRun skipped gated stage "${id}"`);
}
assert.equal(forced.stages.qa.status, STAGE_STATUS.SKIPPED, 'an ungated stage passed in skip[] does stand down');
console.log('  ✓ createRun refuses a gated stage even when handed its id directly');

// ------------------------------------------------------------ the opt-ins

const plain = createRun(paths, { title: 'Plain', intent: 'add a field to the profile page', registry: reg });
for (const id of optInStages()) {
  assert.equal(plain.stages[id].status, STAGE_STATUS.SKIPPED, `"${id}" must be off unless asked for`);
}
const asked = createRun(paths, {
  title: 'Asked', intent: 'harden uploads and run a security scan, then create the stories', registry: reg,
  ...(() => {
    const d = parseDirectives('harden uploads and run a security scan, then create the stories');
    return { skip: d.skip, include: d.include, directives: d.decisions };
  })()
});
assert.equal(asked.stages.security.status, STAGE_STATUS.PENDING, 'a run that asks for a security scan gets one');
assert.equal(asked.stages.tracker.status, STAGE_STATUS.PENDING, 'a run that asks for stories gets them');
console.log('  ✓ security and tracker are off by default and on when the intent asks');

// An explicit skip beats prose that turned an opt-in on.
const overridden = createRun(paths, {
  title: 'Overridden', intent: 'harden uploads and run a security scan', registry: reg,
  include: ['security'], skip: ['security']
});
assert.equal(overridden.stages.security.status, STAGE_STATUS.SKIPPED, '--skip must beat an intent that opted in');
console.log('  ✓ an explicit skip overrides an opt-in read from the prose');

// ------------------------------------------------------ conditional gates

assert.equal(
  runStatus({ paths, run: plain }).stages.find((s) => s.id === 'planning').gate, 'auto',
  'planning is unattended when nothing will be written to a tracker'
);
assert.equal(
  runStatus({ paths, run: asked }).stages.find((s) => s.id === 'planning').gate, 'hitl',
  'planning gates when the run will open real tracker items from the plan'
);
console.log('  ✓ planning becomes a human gate exactly when tracker items will be created');

// Walk a run to the security stage and prove the gate turns on the count alone.
function runAtSecurity(majorUpgrades) {
  const run = createRun(paths, {
    title: `Security ${majorUpgrades}`, intent: 'patch the deps, run a security scan', registry: reg,
    include: ['security']
  });
  for (const s of DEFAULT_PIPELINE.stages) {
    if (s.id === 'security') break;
    if (run.stages[s.id].status !== STAGE_STATUS.SKIPPED) run.stages[s.id].status = STAGE_STATUS.DONE;
  }
  run.currentStage = 'security';
  saveRun(paths, run);

  writeArtifact(paths, run.id, 'cve-report', [
    '# Vulnerability Report: deps',
    '',
    '**Scanned**: 40 direct, 812 transitive',
    '**Vulnerable**: 3',
    '**Applied**: 2',
    `**Major upgrades**: ${majorUpgrades}`,
    '',
    '## Method', 'npm audit --json',
    '## Findings', '| pkg | 1.0.0 | CVE-1 | high | yes | 1.0.1 | patch |',
    '## Applied', '- lodash 4.17.20 → 4.17.21 — CVE-2021-23337 (minor), suite green',
    '## Needs Approval', majorUpgrades ? '- axios 0.21.1 → 1.7.4 — CVE-2023-45857. Major.' : 'None.',
    '## Residual Risk', 'One dev-only advisory left open.',
    '## Verification', 'npm ci && npm test — pass', ''
  ].join('\n'), 'security');

  return loadRun(paths, run.id);
}

const clean = runAtSecurity(0);
assert.equal(majorUpgradeCount(paths, clean), 0);
assert.equal(
  stageNeedsGate(DEFAULT_PIPELINE.stages.find((s) => s.id === 'security'), { paths, run: clean }), false,
  'a scan with nothing to decide must not interrupt anyone'
);
const cleanHandoff = requestHandoff({ paths, run: clean, registry: reg, agentId: 'security' });
assert.equal(cleanHandoff.accepted, true, `handoff refused: ${cleanHandoff.message}`);
assert.equal(cleanHandoff.state, 'advanced', 'zero major upgrades advances without a gate');
assert.equal(cleanHandoff.to, 'review');

const risky = runAtSecurity(2);
assert.equal(majorUpgradeCount(paths, risky), 2);
const riskyHandoff = requestHandoff({ paths, run: risky, registry: reg, agentId: 'security' });
assert.equal(riskyHandoff.state, 'awaiting_gate', 'two major upgrades must stop for a person');
assert.match(riskyHandoff.gate.reason ?? '', /major version/, 'the gate says why it opened');
assert.match(riskyHandoff.message, /2 vulnerability fix/);
console.log('  ✓ the security stage gates on the major-upgrade count and not on anything else');

// A report that omits the count cannot pass its exit criteria at all — the gate
// decision must never fall back to "probably fine".
const silent = runAtSecurity(0);
writeArtifact(paths, silent.id, 'cve-report',
  '# Vulnerability Report\n\n## Method\nx\n## Findings\nx\n## Applied\nx\n## Needs Approval\nNone.\n## Residual Risk\nx\n', 'security');
const refusedHandoff = requestHandoff({ paths, run: loadRun(paths, silent.id), registry: reg, agentId: 'security' });
assert.equal(refusedHandoff.state, 'blocked', 'a report with no major-upgrade count must not hand off');
assert.match(refusedHandoff.message, /major-count-stated/);
console.log('  ✓ a report that omits the count is refused rather than assumed safe');

// ------------------------------------------------- the repository baseline

assert.equal(securityStatus(paths).complete, false, 'a fresh workspace has no security baseline');
assert.deepEqual(securityStatus(paths).missing, SECURITY_ARTIFACTS);

const badMap = checkSecurityArtifact('dependency-map', '# Deps\n\nnothing structured\n');
assert.equal(badMap.ok, false);
assert.ok(badMap.failed.some((f) => f.id === 'direct-deps-listed'));

writeSecurityArtifact(paths, 'dependency-map',
  '# Dependency Map\n\n## Manifests\npackage.json\n\n## Direct Dependencies\n| lodash | ^4.17.0 | 4.17.21 |\n\n## Transitive Surface\n812 packages, depth 9.\n', 'security');
writeSecurityArtifact(paths, 'security-baseline',
  '# Security Baseline\n\n## Method\nsemgrep 1.60\n\n## Findings\nNone above low.\n\n## Scope & Limits\nDid not review infra.\n', 'security');

const sec = securityStatus(paths);
assert.equal(sec.complete, true, 'both artifacts complete the baseline');
assert.throws(
  () => writeSecurityArtifact(paths, 'cve-report', 'x', 'security'),
  /not a repository security artifact/,
  'the per-run report must not be written into the repository baseline'
);
console.log('  ✓ the security baseline refuses incomplete artifacts and completes on both');

// A run reads a baseline it never produced, exactly as it reads onboarding.
const reader = createRun(paths, { title: 'Reader', intent: 'anything', registry: reg });
assert.ok(
  readArtifact(paths, reader.id, 'dependency-map')?.includes('## Direct Dependencies'),
  'every run reads the shared dependency map from outside its own artifact directory'
);
assert.ok(runStatus({ paths, run: reader }).artifacts.includes('security-baseline'));
console.log('  ✓ every run reads the shared baseline without producing it');

fs.rmSync(root, { recursive: true, force: true });
console.log('\nRUN SCOPE AND OPT-IN STAGES VERIFIED');
