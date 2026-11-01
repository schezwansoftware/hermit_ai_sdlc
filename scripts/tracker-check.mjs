/**
 * The Jira tracker: who may write to Jira, how the ticket follows the run,
 * and what the workflow allows.
 *
 * Proven here:
 *   1. Only the jira-tracker agent can create or transition Jira items.
 *   2. The workflow is a graph, so a target status is a path, not a name.
 *   3. The status the ticket should have is a function of run state, and a
 *      pending sync is handed out before the next stage and can always be cleared.
 *   4. A ticket only leaves UAT for Done once QA passed and a person signed off.
 *   5. A story-map that claims an Epic, Story or Bug was created fails its exit criterion.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import {
  layout, loadRegistry, DEFAULT_PIPELINE, createRun, nextTask, reconcile, runStatus, writeArtifact,
  evaluateCriterion, getStage, STAGE_STATUS, findPath, pathsTo, DEFAULT_WORKFLOW, DEFAULT_STATUS_MAP,
  ackTrackerSync, pendingSync, uatApproved, unfixedDefects
} from '@hermit/core';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hermit-tracker-'));
const paths = layout(root);
fs.mkdirSync(path.join(root, '.hermit'), { recursive: true });
for (const d of ['agents', 'skills', 'knowledge']) {
  fs.cpSync(path.join(repo, 'packages/agents', d), path.join(root, '.hermit', d), { recursive: true });
}
const reg = loadRegistry(paths);

// ------------------------------------------------- 1. one writer

const WRITES = ['jira_create_issue', 'jira_create_subtasks', 'jira_link_issues', 'jira_transition_issue'];
for (const agent of reg.agents) {
  const tools = agent.context?.reads?.mcp ?? [];
  const writes = tools.filter((t) => WRITES.includes(t));
  if (agent.id === 'jira-tracker') assert.deepEqual([...writes].sort(), [...WRITES].sort(), 'the tracker holds every Jira write tool');
  else assert.deepEqual(writes, [], `${agent.id} must not create or move Jira items`);
}
assert.equal(reg.agentsById['jira-tracker'].stages.join(), 'tracker');
assert.equal(reg.agentsById['story-writer'].stages.length, 0, 'story-writer owns no stage');
assert.equal(getStage(DEFAULT_PIPELINE, 'tracker').agent, 'jira-tracker');
console.log('  ✓ only jira-tracker has Jira create and transition tools');

// ------------------------------------------------- 2. the workflow is a graph

assert.deepEqual(findPath(DEFAULT_WORKFLOW, 'To Do', 'In Progress'), ['Assessment', 'In Progress'], 'no jumping over Assessment');
assert.deepEqual(findPath(DEFAULT_WORKFLOW, 'In Progress', 'Code Review'), ['Testing', 'Code Review']);
assert.deepEqual(findPath(DEFAULT_WORKFLOW, 'Code Review', 'UAT'), ['UAT']);
assert.deepEqual(findPath(DEFAULT_WORKFLOW, 'UAT', 'Done'), ['Done']);
assert.deepEqual(findPath(DEFAULT_WORKFLOW, 'Testing', 'In Progress'), ['In Progress'], 'a failure goes back to In Progress');
assert.deepEqual(findPath(DEFAULT_WORKFLOW, 'UAT', 'UAT'), []);
assert.equal(findPath(DEFAULT_WORKFLOW, 'Done', 'To Do'), null, 'Done is final');
const withoutCrToUat = DEFAULT_WORKFLOW.filter((t) => !(t.from === 'Code Review' && t.to === 'UAT'));
assert.deepEqual(findPath(withoutCrToUat, 'Code Review', 'UAT'), ['In Progress', 'Testing', 'UAT'], 'routes around a missing transition');
const table = pathsTo(DEFAULT_WORKFLOW, 'Testing');
assert.deepEqual(table['To Do'], ['Assessment', 'In Progress', 'Testing']);
assert.deepEqual(table.Testing, []);
console.log('  ✓ a target status is a path through the workflow, not a name');

// ------------------------------------------------- 3. the sync follows the run

const mark = (run, ids, status = STAGE_STATUS.DONE) => { for (const id of ids) run.stages[id].status = status; };
const BEFORE_IMPL = ['requirements', 'architecture', 'ux_lofi', 'ux_midfi', 'ux_hifi', 'planning'];
const targetNow = (run) => { reconcile(paths, run); return run.trackerSync?.target; };
const settle = (run, reached) => ackTrackerSync({ paths, run, reached: reached ?? run.trackerSync.target });

const run = createRun(paths, { title: 'Keyed', intent: 'add a field', jiraKey: 'PROJ-1', registry: reg });
assert.equal(run.stages.tracker.status, STAGE_STATUS.PENDING);

let task = nextTask({ paths, run, registry: reg });
assert.equal(task.state, 'tracker_sync', 'a sync is handed out before the first stage');
assert.equal(task.agent, 'jira-tracker');
assert.equal(task.sync.target, 'To Do');
assert.equal(task.sync.pathsFrom['To Do'].length, 0);
assert.equal(ackTrackerSync({ paths, run, reached: 'To Do' }).state, 'acknowledged');
assert.equal(ackTrackerSync({ paths, run, reached: 'To Do' }).state, 'nothing_pending', 'a sync is acknowledged once');
task = nextTask({ paths, run, registry: reg });
assert.equal(task.state, 'task', 'once acknowledged the run carries on');
assert.equal(pendingSync(run), null);
console.log('  ✓ a pending sync comes first and is cleared by an acknowledgement');

mark(run, BEFORE_IMPL);
assert.equal(run.currentStage, 'requirements'); // not reconciled yet
assert.equal(targetNow(run), 'Assessment', 'the tracker stage is Assessment'); settle(run);

mark(run, ['tracker']);
assert.equal(targetNow(run), 'In Progress'); assert.deepEqual(run.trackerSync.pathsFrom['To Do'], ['Assessment', 'In Progress']); settle(run);

// A step that does not change the target creates no new sync.
mark(run, ['implementation_ui', 'implementation_backend', 'security']);
assert.equal(targetNow(run), 'In Progress'); assert.equal(pendingSync(run), null, 'review is still In Progress: nothing to sync');

mark(run, ['review']);
assert.equal(targetNow(run), 'Testing', 'QA is Testing'); settle(run);

// A failed QA or a changes-requested gate sends the ticket back to In Progress.
run.stages.qa.status = STAGE_STATUS.CHANGES_REQUESTED;
assert.equal(targetNow(run), 'In Progress', 'rework goes back to In Progress'); settle(run);
run.stages.qa.status = STAGE_STATUS.PENDING;
assert.equal(targetNow(run), 'Testing'); settle(run);

mark(run, ['qa', 'documentation']);
assert.equal(targetNow(run), 'Code Review', 'the delivery package being assembled is Code Review'); settle(run);

run.stages.delivery.status = STAGE_STATUS.AWAITING_GATE;
assert.equal(targetNow(run), 'UAT', 'the sign-off gate opening is UAT');
assert.equal(nextTask({ paths, run, registry: reg }).state, 'tracker_sync', 'the sync is handed out even with a gate about to open');
settle(run);
console.log('  ✓ the target status follows the stage the run is in');

// ------------------------------------------------- 4. leaving UAT needs both approvals

run.stages.delivery.status = STAGE_STATUS.DONE;
mark(run, ['pull_request', 'implementation_ui', 'implementation_backend'], STAGE_STATUS.DONE);
mark(run, ['security'], STAGE_STATUS.DONE);
reconcile(paths, run);
assert.equal(run.status, 'completed');
assert.equal(uatApproved(paths, run), false);
assert.equal(run.trackerSync.target, 'UAT', 'with no QA pass and no sign-off the ticket stays in UAT');

writeArtifact(paths, run.id, 'test-report', '# Test Report\n\n**Result**: pass\n');
reconcile(paths, run);
assert.equal(run.trackerSync.target, 'UAT', 'a passing QA alone is not enough');

run.gates.push({ id: 'g-delivery', stageId: 'delivery', status: 'approved', applied: true });
assert.equal(uatApproved(paths, run), true);
assert.equal(targetNow(run), 'Done', 'QA pass plus a person signing off moves the ticket to Done');
assert.deepEqual(run.trackerSync.pathsFrom.UAT, ['Done']);
console.log('  ✓ a ticket leaves UAT for Done only when QA passed and a person signed off');

// Done really is final: nothing more is asked once it is acknowledged.
settle(run);
assert.equal(pendingSync(run), null);

// ------------------------------------------------- unfixed defects

const dRun = createRun(paths, { title: 'Defects', intent: 'x', jiraKey: 'PROJ-2', registry: reg });
mark(dRun, [...BEFORE_IMPL, 'tracker', 'implementation_ui', 'implementation_backend', 'security', 'review', 'qa']);
writeArtifact(paths, dRun.id, 'test-report',
  '# Test Report\n\n**Result**: pass\n\n## Unfixed Defects\n- Export button is misaligned on Safari\n- Spinner never stops on a 500\n');
assert.equal(unfixedDefects(paths, dRun).length, 2);
reconcile(paths, dRun);
assert.equal(dRun.trackerSync.defects, true, 'unfixed defects are raised in the sync after QA');
settle(dRun);
assert.equal(dRun.trackerSync.defectsRaised, true);
reconcile(paths, dRun);
assert.equal(pendingSync(dRun), null, 'defects are raised once');

writeArtifact(paths, dRun.id, 'test-report', '# Test Report\n\n**Result**: pass\n\n## Unfixed Defects\n- None\n');
assert.equal(unfixedDefects(paths, dRun).length, 0, '"None" is not a defect');
console.log('  ✓ QA\'s unfixed defects are raised once, as part of the sync');

// A run without the tracker is never asked to sync.
const plain = createRun(paths, { title: 'Plain', intent: 'x', registry: reg });
assert.equal(plain.trackerSync ?? null, null);
assert.equal(nextTask({ paths, run: plain, registry: reg }).state, 'task');
assert.equal(runStatus({ paths, run: plain }).trackerSync, null);
console.log('  ✓ a run without the tracker is never asked to sync');

// Custom names: a project whose statuses differ from the defaults.
fs.writeFileSync(paths.config, JSON.stringify({ jira: { statusMap: { testing: 'QA Testing' } } }));
const custom = createRun(paths, { title: 'Custom', intent: 'x', jiraKey: 'PROJ-3', registry: reg });
mark(custom, [...BEFORE_IMPL, 'tracker', 'implementation_ui', 'implementation_backend', 'security', 'review']);
assert.equal(targetNow(custom), 'QA Testing', 'jira.statusMap renames a status');
fs.rmSync(paths.config);
assert.equal(DEFAULT_STATUS_MAP.testing, 'Testing');
console.log('  ✓ jira.statusMap overrides the status names');

// ------------------------------------------------- 5. story-map exit criterion

const only = getStage(DEFAULT_PIPELINE, 'tracker').exitCriteria.find((c) => c.id === 'only-tasks-and-subtasks');
const probe = createRun(paths, { title: 'Probe', intent: 'x', jiraKey: 'PROJ-4', registry: reg });
const mapOf = (rows) => `# Jira Items\n\n## Created\n| Key | Type | Title |\n|---|---|---|\n${rows}\n`;
writeArtifact(paths, probe.id, 'story-map', mapOf('| PROJ-10 | Task | Backend |\n| PROJ-11 | Subtask | Tests |'));
assert.equal(evaluateCriterion(paths, probe.id, only).ok, true);
for (const type of ['Epic', 'Story', 'Bug']) {
  writeArtifact(paths, probe.id, 'story-map', mapOf(`| PROJ-10 | Task | Backend |\n| PROJ-12 | ${type} | Oops |`));
  assert.equal(evaluateCriterion(paths, probe.id, only).ok, false, `a created ${type} must fail the handoff`);
}
writeArtifact(paths, probe.id, 'story-map', mapOf('| PENDING | Story | Oops |'));
assert.equal(evaluateCriterion(paths, probe.id, only).ok, false, 'a PENDING Story fails too');
console.log('  ✓ a story-map that created an Epic, Story or Bug cannot be handed off');

// ------------------------------------------------- 6. over MCP, as an agent sees it

const mcpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hermit-tracker-mcp-'));
const mcpPaths = layout(mcpRoot);
fs.mkdirSync(path.join(mcpRoot, '.hermit'), { recursive: true });
for (const d of ['agents', 'skills', 'knowledge']) {
  fs.cpSync(path.join(repo, 'packages/agents', d), path.join(mcpRoot, '.hermit', d), { recursive: true });
}
createRun(mcpPaths, { title: 'Over MCP', intent: 'add a field', jiraKey: 'PROJ-5', registry: loadRegistry(mcpPaths) });

const client = new Client({ name: 'tracker-check', version: '0.1.0' }, { capabilities: {} });
await client.connect(new StdioClientTransport({
  command: 'node',
  args: [path.join(repo, 'packages/mcp-workflow/src/index.js')],
  env: { ...process.env, HERMIT_WORKSPACE: mcpRoot },
  stderr: 'pipe'
}));
const call = async (name, args = {}) => JSON.parse((await client.callTool({ name, arguments: args })).content[0].text);

const owed = await call('hermit_next_task', {});
assert.equal(owed.state, 'tracker_sync');
assert.equal(owed.agent, 'jira-tracker');
assert.equal(owed.sync.target, 'To Do');
const denied = await call('hermit_ack_tracker_sync', { agent: 'orchestrator', reached: 'To Do' });
assert.equal(denied.state, 'denied', 'only the Jira tracker may acknowledge a sync');
assert.equal((await call('hermit_status')).trackerSync.acknowledged, false, 'a refused acknowledgement changes nothing');
const acked = await call('hermit_ack_tracker_sync', { agent: 'jira-tracker', reached: 'To Do', note: 'already there' });
assert.equal(acked.state, 'acknowledged');
assert.equal(acked.matched, true);
const after = await client.callTool({ name: 'hermit_next_task', arguments: {} });
assert.ok(after.content[0].text.includes('## Required output'), 'the stage brief follows the sync');
await client.close();
console.log('  ✓ over MCP: the sync is handed out, only the tracker can clear it, then the stage brief follows');

console.log('\nJira tracker OK');
