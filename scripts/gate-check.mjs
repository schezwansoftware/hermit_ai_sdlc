/**
 * The headline claim, proven across the real boundary:
 * an agent (over MCP) cannot pass a human gate, and a human (via CLI) can.
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

// --- The agent tries every avenue to get past it ---
const status = await call('hermit_gate_status');
assert.equal(status.open.length, 1);
assert.ok(!Object.keys(status.open[0]).some((k) => /approve(d)?$/i.test(k) && typeof status.open[0][k] === 'boolean'));
console.log('  ✓ gate visible to the agent, but read-only');

const toolNames = (await client.listTools()).tools.map((t) => t.name);
const approvalTool = toolNames.find((n) => /approve|decide|gate_set|resolve/i.test(n));
assert.equal(approvalTool, undefined, `an approval tool is exposed over MCP: ${approvalTool}`);
console.log('  ✓ no approval tool exists on the MCP surface');

const blocked = await call('hermit_next_task', { agent: 'ux-designer' });
assert.equal(blocked.state, 'awaiting_gate', 'next agent must not be dispatched while a gate is open');
console.log('  ✓ next agent refused dispatch while the gate is open');

// --- The human decides, in a terminal ---
const out = hermit('gate', 'approve', gateId);
assert.ok(/Approved/.test(out), out);
console.log('  ✓ human approved via CLI:', out.trim().split('\n').filter(Boolean)[0].replace(/\x1b\[\d+m/g, '').trim());

const after = await call('hermit_status');
// Architecture follows requirements: the designer draws against a ratified system.
assert.equal(after.currentStage, 'architecture');
const decided = (await call('hermit_gate_status')).decided.at(-1);
assert.equal(decided.decision, 'approve');
assert.ok(decided.by, 'the decision must record who made it');
console.log(`  ✓ run advanced to ${after.currentStage}; decision attributed to "${decided.by}"`);

await client.close();
console.log('\nGATE ENFORCEMENT VERIFIED ACROSS THE MCP BOUNDARY');
