/**
 * End-to-end smoke test of the Hermit state machine, run against a throwaway
 * workspace. Exercises: run creation, context scoping, exit-criteria refusal,
 * HITL gate blocking, gate decisions from the CLI and from chat, comment
 * requirements on non-approve decisions, changes_requested re-entry, and full
 * pipeline completion.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import {
  layout, loadRegistry, DEFAULT_PIPELINE, createRun, loadRun, requireActiveRun,
  nextTask, submitArtifact, requestHandoff, runStatus, decideGate, openGates, getStage, saveRun,
  writeOnboardingArtifact, onboardingStatus, readArtifact, ONBOARDING_ARTIFACTS,
  SECURITY_ARTIFACTS, reconcile, askGuidance, answerGuidance, openGuidanceQueries, getGuidanceQuery,
  queryTelemetry
} from '@hermit/core';

const repo = path.dirname(fileURLToPath(import.meta.url)).replace(/\/scripts$/, '');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hermit-smoke-'));
const paths = layout(root);

// Lay out a workspace the way `hermit init` will.
fs.mkdirSync(path.join(root, '.hermit'), { recursive: true });
for (const d of ['agents', 'skills', 'knowledge']) {
  fs.cpSync(path.join(repo, 'packages/agents', d), path.join(root, '.hermit', d), { recursive: true });
}

const reg = loadRegistry(paths);
console.log(`workspace: ${root}`);
console.log(`agents: ${reg.agents.length}  skills: ${reg.skills.length}  knowledge: ${reg.knowledge.length}`);
assert.equal(reg.agents.length, 14, 'expected 14 agents');
assert.equal(DEFAULT_PIPELINE.stages.length, 15, 'expected 15 stages');

// Every stage must resolve to a real agent, and every input must be produced
// upstream — or outside the pipeline entirely, by onboarding or by the
// repository security baseline.
const produced = new Set([...ONBOARDING_ARTIFACTS, ...SECURITY_ARTIFACTS]);
const stageIds = new Set(DEFAULT_PIPELINE.stages.map((s) => s.id));
for (const s of DEFAULT_PIPELINE.stages) {
  const a = reg.agentsById[s.agent];
  assert.ok(a, `stage ${s.id} references missing agent ${s.agent}`);
  assert.ok(a.stages.includes(s.id), `agent ${s.agent} does not claim stage ${s.id}`);
  for (const reviewed of s.reviews ?? []) {
    assert.ok(stageIds.has(reviewed), `stage ${s.id} declares reviews:[${reviewed}] but no such stage exists`);
  }
  for (const inp of s.inputs ?? []) {
    assert.ok(produced.has(inp), `stage ${s.id} consumes "${inp}" before any stage produces it`);
    assert.ok(
      (a.context?.reads?.artifacts ?? []).includes(inp),
      `agent ${s.agent} lacks read scope for its own stage input "${inp}"`
    );
  }
  for (const out of s.outputs ?? []) {
    assert.ok(
      (a.context?.writes?.artifacts ?? []).includes(out),
      `agent ${s.agent} lacks write scope for its own stage output "${out}"`
    );
    produced.add(out);
  }
}
console.log('✓ pipeline graph is consistent (inputs produced upstream, scopes match)');

// A specialist may narrow what it reads — that is the point of role scoping — but
// it must be able to write every output of the stage it claims, or submitArtifact
// rejects it at the moment it tries to hand off.
const specialists = reg.agents.filter((a) => a.specializes);
assert.ok(specialists.length, 'expected at least one specialist agent');
for (const a of specialists) {
  const s = DEFAULT_PIPELINE.stages.find((x) => x.id === a.specializes.stage);
  assert.ok(s, `agent ${a.id} specialises in unknown stage "${a.specializes.stage}"`);
  assert.ok(a.stages.includes(s.id), `specialist ${a.id} must also claim stage ${s.id} in "stages"`);
  for (const out of s.outputs ?? []) {
    assert.ok(
      (a.context?.writes?.artifacts ?? []).includes(out),
      `specialist ${a.id} lacks write scope for stage output "${out}"`
    );
  }
  assert.ok(a.skills.length, `specialist ${a.id} carries no skills — nothing distinguishes it from the default`);
}
console.log(`✓ ${specialists.length} specialist(s) can produce every output of the stage they claim`);

// Onboarding is not a stage. It is mapped once for the repository, before any
// run, and every run reads it from outside its own artifact directory.
assert.ok(!DEFAULT_PIPELINE.stages.some((s) => s.id === 'onboard'), 'onboard must not be a pipeline stage');
assert.equal(reg.agentsById.onboarding.stages.length, 0, 'the onboarding agent owns no stage');

let ob = onboardingStatus(paths);
assert.equal(ob.complete, false);
assert.deepEqual(ob.missing, ONBOARDING_ARTIFACTS);

const run = createRun(paths, { title: 'Cart survives session expiry', intent: 'Preserve the cart when a session expires during checkout', jiraKey: 'PROJ-412', flags: [] });
console.log(`✓ run created: ${run.id}`);

// A run whose repository was never onboarded still starts, and says what is missing.
let firstTask = nextTask({ paths, run: loadRun(paths, run.id), registry: reg });
assert.equal(firstTask.state, 'task');
assert.equal(firstTask.stage.id, 'requirements', 'requirements is now the first stage');
assert.ok(firstTask.bundle.missingInputs.includes('project-context'), 'an un-onboarded run names its missing inputs');
assert.equal(firstTask.bundle.attempt, 1, 'a fresh stage is attempt 1');
assert.deepEqual(firstTask.bundle.priorOutputs, [], 'a first attempt carries no prior draft — nothing was written yet');
assert.ok(!firstTask.rendered.includes('What you submitted last time'), 'a first attempt must not spend context on a revision section');
console.log('✓ un-onboarded run starts at requirements and reports its missing inputs');

// Now onboard the repository. Nothing is scoped to the run.
const ONBOARDING = {
  'project-context': '# Project Context\n\n## Purpose\nCheckout.\n\n## Tech Stack\n| Layer | Technology |\n|---|---|\n| API | Node |\n\n## Runtime Topology\nOne service.\n\n## External Dependencies\nStripe.\n\n## Conventions\nVitest.\n\n## Ownership\nPayments team.\n\n## Known Constraints\nPCI.\n\n## Confidence & Gaps\nNo ADRs found.\n',
  'codebase-map': '# Codebase Map\n\n## Entry Points\nsrc/server.js\n\n## Module Boundaries\ncheckout\n\n## Data Model\nCart\n\n## Cross-Cutting Concerns\nauth\n\n## Test Topology\ntest/\n\n## Change Hotspots\nsrc/checkout.js\n',
  glossary: '# Glossary\n\n- **Cart** → `CartAggregate`\n'
};
assert.throws(
  () => writeOnboardingArtifact(paths, 'architecture-spec', 'x', 'onboarding'),
  /not an onboarding artifact/,
  'onboarding may only write its own three artifacts'
);
for (const [id, body] of Object.entries(ONBOARDING)) writeOnboardingArtifact(paths, id, body, 'onboarding');

ob = onboardingStatus(paths);
assert.equal(ob.complete, true, 'three artifacts completes onboarding');
assert.deepEqual(ob.missing, []);
console.log('✓ onboarding recorded once, outside every run');

// Any run now reads them, including one created before onboarding happened.
for (const id of ONBOARDING_ARTIFACTS) {
  assert.ok(readArtifact(paths, run.id, id), `run must resolve ${id} from the repository onboarding`);
}
const otherRun = createRun(paths, { title: 'unrelated', intent: 'something else' });
assert.ok(readArtifact(paths, otherRun.id, 'codebase-map'), 'a second run reads the same onboarding');
console.log('✓ every run reads the shared onboarding, including runs that predate it');

// Guidance queries: ask, answer, and the trust boundary in between. Not tied
// to a gate — an agent can ask mid-stage and keep working while it waits.
{
  let gr = loadRun(paths, run.id);
  assert.throws(
    () => askGuidance(paths, gr, { agentId: 'analyst', stageId: 'requirements', question: 'what should I do here?' }),
    /open-ended/,
    'a vague question must be refused before it ever reaches the ledger'
  );
  assert.throws(
    () => askGuidance(paths, gr, { agentId: 'analyst', stageId: 'requirements', question: 'too short' }),
    /at least 10 characters/,
    'a too-short question must be refused'
  );

  const q = askGuidance(paths, gr, {
    agentId: 'analyst',
    stageId: 'requirements',
    question: 'Should cart expiry be 30 minutes or match the session TTL exactly?',
    context: 'PCI constraint mentions "session lifetime" but not a specific number.',
    priority: 'normal'
  });
  saveRun(paths, gr);
  assert.equal(q.respondedAt, null, 'a fresh query is unanswered');
  assert.equal(openGuidanceQueries(loadRun(paths, run.id)).length, 1, 'the query must be visible as open');

  assert.throws(
    () => answerGuidance(paths, loadRun(paths, run.id), q.id, { answeredBy: 'agent', answer: 'yes', source: 'mcp' }),
    /only be answered by a human/,
    'an answer from outside cli/chat must be refused, same trust boundary as a gate decision'
  );

  gr = loadRun(paths, run.id);
  const answered = answerGuidance(paths, gr, q.id, {
    answeredBy: 'harshit',
    answer: 'Match the session TTL exactly — a fixed 30 minutes would outlive an already-expired session.',
    source: 'chat'
  });
  saveRun(paths, gr);
  assert.ok(answered.respondedAt, 'an answered query records when');
  assert.equal(openGuidanceQueries(loadRun(paths, run.id)).length, 0, 'an answered query is no longer open');
  assert.equal(getGuidanceQuery(loadRun(paths, run.id), q.id).answer.includes('session TTL'), true, 'the answer content must persist');

  assert.throws(
    () => answerGuidance(paths, loadRun(paths, run.id), q.id, { answeredBy: 'harshit', answer: 'again', source: 'cli' }),
    /already answered/,
    'a query cannot be answered twice'
  );

  const tel = queryTelemetry(loadRun(paths, run.id));
  assert.equal(tel.queriesAsked, 1);
  assert.equal(tel.queriesResolved, 1);
  assert.equal(tel.resolutionRate, 100);
  console.log('✓ guidance query: asked, validated, answered under the same trust boundary as a gate');
}

// Writing an artifact the stage does not own must be rejected.
let r = loadRun(paths, run.id);
assert.throws(
  () => submitArtifact({ paths, run: r, registry: reg, artifactId: 'architecture-spec', content: 'x', agentId: 'analyst' }),
  /does not produce/,
  'stage output contract must be enforced'
);
console.log('✓ out-of-contract artifact submission rejected');

// --- Drive the whole pipeline ---
const BODIES = {
  'project-context': '# Project Context\n\n## Purpose\nCheckout.\n\n## Tech Stack\n| Layer | Technology |\n|---|---|\n| API | Node |\n\n## Runtime Topology\nOne service.\n\n## External Dependencies\nStripe.\n\n## Conventions\nVitest.\n\n## Ownership\nPayments team.\n\n## Known Constraints\nPCI.\n\n## Confidence & Gaps\nNo ADRs found.\n',
  'codebase-map': '# Codebase Map\n\n## Entry Points\nsrc/server.js\n\n## Module Boundaries\ncheckout\n\n## Data Model\nCart\n\n## Cross-Cutting Concerns\nauth\n\n## Test Topology\ntest/\n\n## Change Hotspots\nsrc/checkout.js\n',
  glossary: '# Glossary\n\n- **Cart** → `CartAggregate`\n',
  'requirements-spec': '# Requirements\n\n## Context\nPROJ-412.\n\n## In Scope\n1. Preserve cart.\n\n## Out of Scope\nGuest checkout.\n\n## Functional Requirements\nFR-1 Cart survives expiry.\n\n## Non-Functional Requirements\np95 < 300ms.\n\n## Data\nCart rows.\n\n## Dependencies\nNone.\n\n## Assumptions\nSessions are server-side.\n\n## Decisions Required\nNone outstanding.\n',
  'acceptance-criteria': '# Acceptance Criteria\n\n## AC-1 — FR-1 — cart preserved\n**Given** an expired session\n**When** the user submits checkout\n**Then** they are redirected to sign-in and the cart is preserved\n\n**Verified by**: integration test\n',
  'ux-lofi': '# Low-Fidelity\n\n## User Flows\n1. Expired → sign-in → cart intact\n\n## Screen Inventory\n| ID | Screen |\n|---|---|\n| S1 | Sign-in |\n\n## Wireframes\n```\n+---+\n```\n\n## Open Questions\nNone.\n',
  'ux-midfi': '# Mid-Fidelity\n\n## States\n| Screen | State |\n|---|---|\n| S1 | error |\n\n## Interaction Specification\nSubmit.\n\n## Content & Messaging\n"Your session expired."\n\n## Responsive Behaviour\n1 breakpoint.\n\n## Validation Rules\nRequired.\n',
  'ux-hifi': '# High-Fidelity\n\n## Design System Usage\n| Element | Component |\n|---|---|\n| Banner | Alert |\n\n## Visual Specification\ntokens only.\n\n## Accessibility\nContrast 4.6:1, keyboard path defined, live region on error.\n\n## Asset Manifest\nNone.\n\n## Implementation Notes\nUse Alert.\n',
  'design-tokens': '{"color.text.primary":"#111"}',
  // Carries ## User Flow and ## Frontend Design but deliberately not ## Backend
  // Design: this run's scope has no server-side project, so only the
  // ui-conditional criteria fire.
  'architecture-spec': '# Architecture\n\n## Approach\nPersist cart before redirect.\n\n## Component Map\n| Component | Path |\n|---|---|\n| checkout | src/checkout.js |\n\n## Interfaces\nPOST /checkout\n\n## User Flow\n1. submit → 2. session expired → 3. persist cart → 4. redirect to sign-in → 5. resume\n\n## Frontend Design\nBanner component reused; cart state stays server-owned.\n\n## Data Design\ncarts table.\n\n## Sequence\n1. expire 2. persist 3. redirect\n\n## Security\nAuthZ on cart owner.\n\n## Observability\nMetric cart.preserved\n\n## Performance\np95 300ms.\n\n## Alternatives Considered\nClient storage — rejected, PCI.\n',
  adr: '# ADR-1: Persist cart server-side\n\n## Status\nProposed\n\n## Context\nPCI.\n\n## Decision\nWe will persist server-side.\n\n## Consequences\n### Positive\nSurvives device change.\n### Negative\nExtra write on a hot path.\n### Neutral\nNew table.\n\n## Alternatives\nLocalStorage — rejected: PCI scope.\n',
  'impact-analysis': '# Impact Analysis\n\n## Blast Radius\ncheckout only.\n\n## Breaking Changes\nNone.\n\n## Risks\n- Silent write failure — medium — add alert.\n\n## Rollout\nFlag.\n\n## Rollback\nDrop the flag; migration is additive.\n\n## Effort Signal\nS.\n',
  'work-plan': '# Work Plan\n\n## Sequence\nWP-1\n\n## Work Packages\n- WP-1 persist cart — satisfies AC-1 — tests: checkout.test.js\n\n## Critical Path\nWP-1\n\n## Parallelisation\nNone.\n\n## Deferred\nGuest checkout.\n',
  'change-set-ui': '# Change Set — Interface\n\n## Summary\nBanner and redirect wired up.\n\n## Files Changed\n| File | Change |\n|---|---|\n| src/ui/Banner.jsx | added |\n\n## Work Packages Completed\n| WP | Status |\n|---|---|\n| WP-1 | complete |\n\n## Screens & States\n| Screen | States | Matches hi-fi |\n|---|---|---|\n| S1 | error, loading | yes |\n\n## Contract Gaps\nNone.\n\n## Accessibility\nContrast 4.6:1; focus moves to the banner; live region announces expiry.\n\n## Deviations\nNone.\n\n## Tests\nBanner.test.jsx — npm test\n\n## Verification Performed\n`npm test` → 41 passed.\n\n## Known Gaps\nNone.\n',
  'change-set': '# Change Set\n\n## Summary\nCart persisted.\n\n## Files Changed\n| File | Change |\n|---|---|\n| src/checkout.js | modified |\n\n## Work Packages Completed\n| WP | Status |\n|---|---|\n| WP-1 | complete |\n\n## Deviations\nNone.\n\n## Tests\ncheckout.test.js — npm test\n\n## Verification Performed\n`npm test` → 41 passed.\n\n## Known Gaps\nNone.\n',
  'review-report': '# Code Review\n\n**Verdict**: approve\n\n## Summary\nMatches the design.\n\n## Blockers\nNone.\n\n## Findings\nNone.\n\n## Nits\nNone.\n\n## AC Coverage\n| AC | Implemented | Tested |\n|---|---|---|\n| AC-1 | yes | yes |\n\n## Deviations Reviewed\nNone.\n\n## What I Verified\nRead src/checkout.js; ran npm test.\n',
  'test-plan': '# Test Plan\n\n## Scope\nCheckout.\n\n## Traceability\n| AC | Test |\n|---|---|\n| AC-1 | TC-1 |\n\n## Test Cases\nTC-1.\n\n## Edge Cases & Negative Tests\nConcurrent expiry.\n\n## Non-Functional Verification\nLoad test.\n\n## Environment\nLocal.\n\n## Out of Scope\nGuest.\n',
  'test-report': '# Test Report\n\n**Result**: pass\n\n## Execution Summary\n| Suite | Total | Passed |\n|---|---|---|\n| unit | 41 | 41 |\n\n## Commands Run\n`npm test` exit 0\n\n## AC Verification\n| AC | Result |\n|---|---|\n| AC-1 | pass |\n\n## Failures\nNone.\n\n## Defects Raised\nNone.\n\n## Coverage\n82%\n\n## Residual Risk\nLoad untested at peak.\n',
  'docs-update': '# Documentation Update\n\n## Files Updated\n| File | Change | Why |\n|---|---|---|\n| docs/checkout.md | updated | new persistence step |\n\n## Staleness Audit\n| Document | Verdict |\n|---|---|\n| README.md | unaffected |\n\n## New Documents\nNone.\n\n## External Follow-ups\nNone.\n\n## Not Updated\nRunbook — no operational change.\n',
  'release-notes': '# Release Notes\n\n## Summary\nCart survives expiry.\n\n## Changes\nWP-1 (PROJ-412)\n\n## Verification\n41 tests pass.\n\n## Risk & rollback\nAdditive migration; disable the flag to roll back.\n\n## Documentation\ndocs/checkout.md updated.\n\n## Follow-ups\nLoad test at peak.\n',
  'pull-request': '# Pull Request\n\n**URL**: https://github.com/acme/shop/pull/918\n**Provider**: github\n**Branch**: feat/proj-412 → main\n\n## Body Submitted\nWhat/Why/How.\n\n## Linked\nPROJ-412\n\n## Reviewers Requested\npayments\n\n## Checks\npending\n'
};

let gatesHit = 0, stagesDone = 0, changesRequestedTested = false, chatDecisionTested = false,
  reviewChangesRequestedTested = false;

for (let guard = 0; guard < 40; guard++) {
  let cur = loadRun(paths, run.id);
  const st = runStatus({ paths, run: cur });
  if (st.status === 'completed') break;

  cur = loadRun(paths, run.id);
  const open = openGates(cur);
  if (open.length) {
    const g = open[0];
    gatesHit++;
    // Only 'cli' and 'chat' are trusted sources. Nothing else gets near a decision.
    assert.throws(
      () => decideGate(paths, cur, g.id, 'approve', { decidedBy: 'agent', source: 'mcp' }),
      /only be made by a human/,
      'a source outside cli/chat must be refused'
    );
    // A non-approve decision needs a reason, wherever it comes from — this is
    // decideGate's own rule now, not something only the CLI happened to check.
    assert.throws(
      () => decideGate(paths, cur, g.id, 'changes_requested', { decidedBy: 'harshit', source: 'chat' }),
      /needs a reason/,
      'changes_requested with no comment must be refused regardless of source'
    );
    // Exercise the changes_requested path once, on the architecture gate.
    if (g.stageId === 'architecture' && !changesRequestedTested) {
      changesRequestedTested = true;
      decideGate(paths, cur, g.id, 'changes_requested', { decidedBy: 'harshit', comment: 'Name the rollback path explicitly.', source: 'cli' });
      saveRun(paths, cur);
      const back = nextTask({ paths, run: loadRun(paths, run.id), registry: reg });
      assert.equal(back.state, 'task');
      assert.equal(back.stage.id, 'architecture');
      assert.ok(back.rendered.includes('Reviewer feedback'), 're-entry must carry the reviewer comment');

      // The stage's own last draft comes back with it. Without this the agent
      // rebuilds the artifact from the brief and silently drops any decision it
      // recorded last time that the brief does not carry.
      assert.equal(back.bundle.attempt, 2, 'a stage sent back is on attempt 2');
      assert.deepEqual(
        back.bundle.priorOutputs.map((a) => a.id).sort(),
        ['adr', 'architecture-spec', 'impact-analysis'],
        're-entry must return every output this stage already produced'
      );
      assert.ok(
        back.bundle.priorOutputs.every((a) => a.content.length),
        'a returned draft must carry its content, not just its name'
      );
      assert.ok(
        back.rendered.includes('Persist cart before redirect'),
        'the prior draft must reach the rendered brief, not just the bundle'
      );
      assert.ok(
        back.rendered.includes('What you submitted last time'),
        'the prior draft must be labelled as the agent\'s own, not passed off as an upstream input'
      );
      // Upstream inputs are filled first and are never displaced by the revision.
      assert.ok(
        ['requirements-spec', 'acceptance-criteria', 'codebase-map', 'project-context']
          .every((id) => back.bundle.artifacts.some((a) => a.id === id)),
        'returning a draft must not crowd out the specification it is measured against'
      );
      assert.ok(
        back.bundle.budget.used <= back.bundle.budget.limit,
        `bundle overran its budget: ${back.bundle.budget.used} > ${back.bundle.budget.limit}`
      );
      // Nothing outside this run's own record may pose as a draft.
      assert.ok(
        back.bundle.priorOutputs.every((a) => cur.artifacts[a.id]),
        'a returned draft must be one this run recorded producing'
      );
      console.log('✓ changes_requested returned the stage to architect with feedback attached');
      console.log(`✓ re-entry returned the agent's own ${back.bundle.priorOutputs.length} prior artifacts, inputs intact and within budget`);
      continue;
    }
    // Exercise changes_requested on a *quality gate* (review), not a stage's
    // own completion gate. This must route back to whichever implementation
    // stage(s) actually ran — not re-run the reviewer — and the reviewer's
    // comment must reach that stage as feedback, since it never opens a gate
    // on its own stage id to carry the comment.
    if (g.stageId === 'review' && !reviewChangesRequestedTested) {
      reviewChangesRequestedTested = true;
      decideGate(paths, cur, g.id, 'changes_requested', { decidedBy: 'harshit', comment: 'Add rate limiting to the checkout endpoint.', source: 'cli' });
      saveRun(paths, cur);

      // Gate decisions are applied lazily by reconcile() — apply it directly
      // first so we can see what it actually did to every stage, before
      // nextTask() below moves the resumed stage on to in_progress.
      const reopened = loadRun(paths, run.id);
      reconcile(paths, reopened, DEFAULT_PIPELINE);
      assert.equal(reopened.stages.review.status, 'pending', 'review must return to pending, not stay reopened itself');
      assert.equal(reopened.stages.implementation_ui.status, 'changes_requested', 'the producing stage must be sent back');
      assert.equal(reopened.stages.implementation_backend.status, 'changes_requested', 'every producing stage that ran must be sent back');

      const back = nextTask({ paths, run: loadRun(paths, run.id), registry: reg });
      assert.equal(back.state, 'task');
      assert.equal(back.stage.id, 'implementation_ui', 'the run must resume at the producing stage, not the reviewer');
      assert.equal(back.attempt, 2, 'a stage sent back by a quality gate is on attempt 2');
      assert.ok(
        back.rendered.includes('Add rate limiting to the checkout endpoint.'),
        "the reviewer's comment must reach the re-entered stage even though it has no gate of its own"
      );
      console.log('✓ review changes_requested routed to implementation, not back to the reviewer');
      continue;
    }
    // Exercise a real 'chat' decision once, on the review gate — proving the
    // second door actually advances a run, not just that it fails safely.
    if (g.stageId === 'review' && !chatDecisionTested) {
      chatDecisionTested = true;
      const decided = decideGate(paths, cur, g.id, 'approve', { decidedBy: 'harshit', source: 'chat' });
      assert.equal(decided.source, 'chat', 'the gate record must say which door decided it');
      saveRun(paths, cur);
      continue;
    }
    decideGate(paths, cur, g.id, 'approve', { decidedBy: 'harshit', source: 'cli' });
    saveRun(paths, cur);
    continue;
  }

  cur = loadRun(paths, run.id);
  const t = nextTask({ paths, run: cur, registry: reg });
  if (t.state === 'complete') break;
  assert.equal(t.state, 'task', `unexpected state ${t.state}: ${t.message}`);

  const stage = getStage(DEFAULT_PIPELINE, t.stage.id);
  for (const out of stage.outputs ?? []) {
    if (!BODIES[out]) throw new Error(`smoke test has no body for artifact "${out}"`);
    submitArtifact({ paths, run: cur, registry: reg, artifactId: out, content: BODIES[out], agentId: stage.agent });
  }
  const h = requestHandoff({ paths, run: loadRun(paths, run.id), registry: reg, agentId: stage.agent, summary: `did ${stage.id}` });
  assert.ok(['advanced', 'awaiting_gate', 'complete'].includes(h.state), `handoff refused at ${stage.id}: ${h.message}`);
  stagesDone++;
}

const final = runStatus({ paths, run: loadRun(paths, run.id) });
assert.equal(final.status, 'completed', `run did not complete: ${JSON.stringify(final.stages.filter(s=>s.status!=='done'))}`);
assert.equal(gatesHit, 9, `expected 9 gate encounters (7 gates + 1 architecture re-review + 1 review re-review), got ${gatesHit}`);

console.log(`✓ ${stagesDone} stage completions, ${gatesHit} gate encounters`);
console.log(`✓ run completed: ${final.artifacts.length} artifacts`);
console.log('\nALL SMOKE CHECKS PASSED');
fs.rmSync(root, { recursive: true, force: true });
