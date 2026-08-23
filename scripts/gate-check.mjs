/**
 * The headline claim, proven across the real boundary: a gate is decided by a
 * human, never by an agent's own judgement — whether that human is typing into
 * a terminal, or speaking to the orchestrator in chat.
 *
 * The chat door (hermit_decide_gate) is real, not decorative: it is reachable
 * only by the orchestrator, refuses a decision with no reason, and is marked
 * destructive so a host has a genuine signal to ask for confirmation before it
 * runs. That confirmation — not the model's own read of the work — is the
 * decision this records.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';

const workspace = process.argv[2];
const cli = path.resolve('packages/cli/bin/hermit.js');
const hermit = (...args) => execFileSync('node', [cli, ...args, '--cwd', workspace], { encoding: 'utf8' });

const transport = new StdioClientTransport({
  command: 'node',
  args: [path.resolve('packages/mcp-workflow/src/index.js')],
  env: { ...process.env, HERMIT_WORKSPACE: workspace },
  stderr: 'pipe'
});
const client = new Client({ name: 'gate-check', version: '0.1.0' }, { capabilities: {} });
await client.connect(transport);

const call = async (name, args = {}) => {
  const res = await client.callTool({ name, arguments: args });
  const text = res.content[0].text;
  try { return JSON.parse(text); } catch { return text; }
};

// --- Onboarding happens outside the pipeline, over its own tools ---
const ART = {
  'project-context': '# Project Context\n\n## Purpose\nCheckout for Acme Shop.\n\n## Tech Stack\n| Layer | Tech |\n|---|---|\n| API | Node 22 |\n\n## Runtime Topology\nSingle service.\n\n## Confidence & Gaps\nNo ADRs found in repo.\n',
  'codebase-map': '# Codebase Map\n\n## Entry Points\nsrc/server.js\n\n## Module Boundaries\ncheckout, cart, auth\n\n## Data Model\nCart, Order\n\n## Change Hotspots\nsrc/checkout.js\n',
  glossary: '# Glossary\n\n- **Cart** → `CartAggregate` in src/cart/aggregate.js\n'
};

const task = await call('hermit_onboarding_task', {});
assert.equal(task.complete, false, 'a fresh workspace is not onboarded');
assert.ok(task.playbook?.length, 'the onboarding brief carries its playbook');

// The submission check is enforced here too, not only at a stage handoff.
const bad = await call('hermit_submit_onboarding', {
  artifact: 'project-context', content: '# Context\n\nNo required sections.\n', agent: 'onboarding'
});
assert.equal(bad.accepted, false, 'a project-context with no ## Tech Stack must be refused');
assert.ok(bad.failed.some((f) => f.id === 'stack-identified'));
console.log('  ✓ onboarding submission refused for a missing required section');

for (const [id, content] of Object.entries(ART)) {
  const r = await call('hermit_submit_onboarding', { artifact: id, content, agent: 'onboarding' });
  assert.equal(r.submitted, id, `submit failed for ${id}: ${JSON.stringify(r)}`);
}
const done = await call('hermit_onboarding_task', {});
assert.equal(done.complete, true, 'three artifacts completes onboarding');
console.log('  ✓ onboarding submitted 3 artifacts over MCP, outside any run');

const st0 = await call('hermit_status');
assert.equal(st0.currentStage, 'requirements', 'requirements is the first stage');

// --- Analyst reaches a HUMAN gate ---
await call('hermit_submit_artifact', {
  artifact: 'requirements-spec', agent: 'analyst',
  content: '# Requirements\n\n## Context\nPROJ-412.\n\n## In Scope\n1. Preserve cart across session expiry.\n\n## Out of Scope\nGuest checkout.\n\n## Functional Requirements\nFR-1 The cart survives session expiry.\n\n## Non-Functional Requirements\np95 under 300ms at 50rps.\n\n## Data\ncarts table gains session_ref.\n\n## Dependencies\nNone.\n\n## Assumptions\nSessions are server-side.\n\n## Decisions Required\nNone outstanding.\n'
});
await call('hermit_submit_artifact', {
  artifact: 'acceptance-criteria', agent: 'analyst',
  content: '# Acceptance Criteria\n\n## AC-1 — FR-1 — cart preserved\n**Given** an authenticated user with an expired session\n**When** they submit the checkout form\n**Then** they are redirected to sign-in and the cart is preserved\n\n**Verified by**: integration test\n'
});
const h = await call('hermit_request_handoff', { agent: 'analyst', summary: 'Specified PROJ-412.' });
assert.equal(h.state, 'awaiting_gate', `expected gate, got ${JSON.stringify(h)}`);
const gateId = h.gate.id;
console.log(`  ✓ human-gated stage halted: gate ${gateId}`);

// --- Reading the gate exposes no boolean "just approve it" escape hatch ---
const status = await call('hermit_gate_status');
assert.equal(status.open.length, 1);
assert.ok(!Object.keys(status.open[0]).some((k) => /approve(d)?$/i.test(k) && typeof status.open[0][k] === 'boolean'));
console.log('  ✓ gate visible to the agent, but read-only');

const blocked = await call('hermit_next_task', { agent: 'ux-designer' });
assert.equal(blocked.state, 'awaiting_gate', 'next agent must not be dispatched while a gate is open');
console.log('  ✓ next agent refused dispatch while the gate is open');

// --- The chat door exists, and it is not a plain approval tool -------------
const tools = (await client.listTools()).tools;
const decideTool = tools.find((t) => t.name === 'hermit_decide_gate');
assert.ok(decideTool, 'hermit_decide_gate must be enumerable over MCP');
assert.equal(decideTool.annotations?.destructiveHint, true, 'it must be the tool a host is told to pause on');
console.log('  ✓ hermit_decide_gate is enumerable and marked destructive');

// A role agent reaching for it is refused, by name, regardless of confirmation.
const asAnalyst = await call('hermit_decide_gate', { gateId, decision: 'approve', agent: 'analyst' });
assert.equal(asAnalyst.state, 'denied', 'only the orchestrator may decide a gate');
console.log('  ✓ a role agent calling hermit_decide_gate is refused');

// The orchestrator itself cannot use it to dodge giving a reason.
const noReason = await call('hermit_decide_gate', { gateId, decision: 'changes_requested', agent: 'orchestrator' });
assert.equal(noReason.state, 'refused', 'changes_requested with no comment must still be refused from chat');
console.log('  ✓ the orchestrator cannot skip the reason on a non-approve decision');

// --- The orchestrator relays an actual human decision, from chat -----------
const viaChat = await call('hermit_decide_gate', { gateId, decision: 'approve', agent: 'orchestrator', decidedBy: 'harshit' });
assert.equal(viaChat.decided, gateId);
assert.equal(viaChat.by, 'harshit');
console.log(`  ✓ orchestrator decided via chat: ${viaChat.message}`);

const afterChat = await call('hermit_status');
// Architecture follows requirements: the designer draws against a ratified system.
assert.equal(afterChat.currentStage, 'architecture');
const chatDecision = (await call('hermit_gate_status')).decided.at(-1);
assert.equal(chatDecision.decision, 'approve');
assert.equal(chatDecision.source, 'chat', 'the journal must say which door decided it');
assert.ok(chatDecision.by, 'the decision must record who made it');
console.log(`  ✓ run advanced to ${afterChat.currentStage}; decided via ${chatDecision.source}, attributed to "${chatDecision.by}"`);

// --- The terminal door still works, unaffected by any of the above ---------
await call('hermit_submit_artifact', {
  artifact: 'architecture-spec', agent: 'architect',
  content: '# Architecture\n\n## Approach\nPersist the cart server-side before redirecting to sign-in.\n\n## Component Map\n| Component | Path | New/Modified |\n|---|---|---|\n| checkout | src/checkout.js | modified |\n\n## Interfaces\nPOST /checkout re-attaches the persisted cart on sign-in.\n\n## User Flow\n1. session expires 2. user submits checkout 3. cart persisted server-side 4. redirect to sign-in 5. sign-in re-attaches the cart\n\n## Frontend Design\nBanner communicates the expiry; no client-side cart state.\n\n## Data Design\ncarts table gains session_ref; additive, no backfill.\n\n## Sequence\n1. session expires 2. cart persisted 3. redirect 4. sign-in re-attaches cart\n\n## Security\nAuthZ checked against the cart owner on re-attach.\n\n## Observability\ncart.persisted / cart.reattached counters.\n\n## Performance\np95 under 300ms at 50rps.\n\n## Alternatives Considered\nClient-side storage — rejected, PCI scope.\n'
});
await call('hermit_submit_artifact', {
  artifact: 'adr', agent: 'architect',
  content: '# ADR-1: Persist the cart server-side across session expiry\n\n## Status\nProposed\n\n## Context\nPCI scope rules out client-side persistence of cart contents.\n\n## Decision\nPersist server-side, keyed by session_ref, re-attached on sign-in.\n\n## Consequences\n### Positive\nSurvives device change.\n### Negative\nAn extra write on a hot path.\n### Neutral\nNew column, additive migration.\n\n## Alternatives\nClient-side storage — rejected: PCI scope.\n'
});
await call('hermit_submit_artifact', {
  artifact: 'impact-analysis', agent: 'architect',
  content: '# Impact Analysis\n\n## Blast Radius\ncheckout only.\n\n## Breaking Changes\nNone.\n\n## Risks\n- Silent write failure on persist — medium — alert on cart.persisted absence.\n\n## Rollout\nFeature flag.\n\n## Rollback\nDisable the flag; the migration is additive.\n\n## Effort Signal\nS.\n'
});
const archHandoff = await call('hermit_request_handoff', { agent: 'architect', summary: 'Persist-and-reattach design.' });
assert.equal(archHandoff.state, 'awaiting_gate', `expected the architecture gate, got ${JSON.stringify(archHandoff)}`);
const archGateId = archHandoff.gate.id;

const out = hermit('gate', 'approve', archGateId);
assert.ok(/Approved/.test(out), out);
console.log('  ✓ human approved via CLI:', out.trim().split('\n').filter(Boolean)[0].replace(/\x1b\[\d+m/g, '').trim());

const after = await call('hermit_status');
assert.ok(after.currentStage?.startsWith('ux_'), `expected a ux stage after architecture, got ${after.currentStage}`);
const cliDecision = (await call('hermit_gate_status')).decided.at(-1);
assert.equal(cliDecision.decision, 'approve');
assert.equal(cliDecision.source, 'cli');
assert.ok(cliDecision.by, 'the decision must record who made it');
console.log(`  ✓ run advanced to ${after.currentStage}; decided via ${cliDecision.source}, attributed to "${cliDecision.by}"`);

await client.close();
console.log('\nGATE ENFORCEMENT VERIFIED ACROSS THE MCP BOUNDARY');
