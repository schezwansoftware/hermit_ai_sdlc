/**
 * Keeping the Jira ticket's status in step with the run.
 *
 * After each step the engine works out which Jira status the ticket should be
 * in and, when that changed, records a pending sync. The orchestrator hands it
 * to the Jira tracker agent, which makes the moves and acknowledges. Nothing
 * here talks to Jira and nothing here asks a model what the status should be:
 * the mapping is a table, so the same run state always yields the same target.
 *
 * The Jira workflow is not global. A ticket can only follow the arrows, so a
 * target is not a single transition by name but a path. The engine ships the
 * path from every status the ticket could currently be in, because only the
 * agent can see the ticket's real status.
 *
 * Every ticket takes the same flow:
 *   To Do, Assessment, In Progress, Testing, Code Review, UAT, Done
 * and a failure sends it back to In Progress.
 */
import { STAGE_STATUS, journal, saveRun } from './state.js';
import { readArtifact, extractSection } from './artifacts.js';
import { GATE_STATUS } from './gates.js';
import { readJson } from './paths.js';

/** Status names, by the role they play. Override with `jira.statusMap` in .hermit/config.json. */
export const DEFAULT_STATUS_MAP = Object.freeze({
  todo: 'To Do',
  assessment: 'Assessment',
  inProgress: 'In Progress',
  testing: 'Testing',
  codeReview: 'Code Review',
  uat: 'UAT',
  done: 'Done'
});

/**
 * The transitions the workflow allows. Override with `jira.workflow`
 * (a list of `{ name, from, to }`) when the project's workflow differs.
 *
 * `Code Review` to `UAT` is the transition the project still has to add in Jira.
 */
export const DEFAULT_WORKFLOW = Object.freeze([
  { name: 'To Do', from: 'Idea', to: 'To Do' },
  { name: 'Idea', from: 'To Do', to: 'Idea' },
  { name: 'Assessment', from: 'To Do', to: 'Assessment' },
  { name: 'To Do', from: 'Assessment', to: 'To Do' },
  { name: 'start development', from: 'Assessment', to: 'In Progress' },
  { name: 'complete work', from: 'In Progress', to: 'Testing' },
  { name: 'buggy', from: 'Testing', to: 'In Progress' },
  { name: 'uat', from: 'Testing', to: 'UAT' },
  { name: 'buggy', from: 'UAT', to: 'In Progress' },
  { name: 'completed', from: 'Testing', to: 'Done' },
  { name: 'completed', from: 'UAT', to: 'Done' },
  { name: 'Code Review', from: 'Testing', to: 'Code Review' },
  { name: 'changes rejected', from: 'Code Review', to: 'In Progress' },
  { name: 'UAT', from: 'Code Review', to: 'UAT' }
]);

/** The status role the ticket should be in while a given stage is current. */
export const STAGE_STATUS_ROLE = Object.freeze({
  requirements: 'todo',
  architecture: 'todo',
  ux_lofi: 'todo',
  ux_midfi: 'todo',
  ux_hifi: 'todo',
  planning: 'todo',
  // The workflow has no way from To Do to In Progress except through Assessment,
  // so every ticket passes through it, breakdown or not.
  tracker: 'assessment',
  implementation_ui: 'inProgress',
  implementation_backend: 'inProgress',
  security: 'inProgress',
  review: 'inProgress',
  qa: 'testing',
  documentation: 'testing',
  delivery: 'codeReview',
  // Delivery is approved, the pull request is being opened; the person has signed off.
  pull_request: 'uat'
});

/** Stages whose `changes_requested` sends the ticket back to In Progress. */
const REWORK_FROM = new Set(['qa', 'documentation', 'delivery', 'pull_request']);

/** Is the Jira tracker part of this run? */
export function trackerEnabled(run) {
  const st = run.stages?.tracker;
  return Boolean(st) && st.status !== STAGE_STATUS.SKIPPED;
}

/** Status names and workflow for this workspace: config over defaults. */
export function jiraSyncConfig(paths) {
  const jira = readJson(paths.config, {})?.jira ?? {};
  return {
    statusMap: { ...DEFAULT_STATUS_MAP, ...(jira.statusMap ?? {}) },
    workflow: Array.isArray(jira.workflow) && jira.workflow.length ? jira.workflow : [...DEFAULT_WORKFLOW]
  };
}

/** Shortest list of statuses to pass through, in order, to get from `from` to `to`. `[]` if already there, `null` if no route. */
export function findPath(workflow, from, to) {
  if (from === to) return [];
  const next = new Map();
  for (const t of workflow) {
    if (!next.has(t.from)) next.set(t.from, []);
    next.get(t.from).push(t.to);
  }
  const seen = new Set([from]);
  const queue = [[from, []]];
  while (queue.length) {
    const [at, trail] = queue.shift();
    for (const n of next.get(at) ?? []) {
      if (seen.has(n)) continue;
      const route = [...trail, n];
      if (n === to) return route;
      seen.add(n);
      queue.push([n, route]);
    }
  }
  return null;
}

/** For every status in the workflow: the route from there to `target`. */
export function pathsTo(workflow, target) {
  const statuses = new Set([target]);
  for (const t of workflow) { statuses.add(t.from); statuses.add(t.to); }
  return Object.fromEntries([...statuses].map((s) => [s, findPath(workflow, s, target)]));
}

/**
 * UAT is approved by the QA agent plus a person: the test report says `pass`
 * and the delivery sign-off has been approved. Only then does a ticket go on
 * to Done.
 */
export function uatApproved(paths, run) {
  const report = readArtifact(paths, run.id, 'test-report');
  const qaPass = typeof report === 'string' && /\*\*Result\*\*:\s*pass/i.test(report);
  const signedOff = (run.gates ?? []).some((g) => g.stageId === 'delivery' && g.status === GATE_STATUS.APPROVED);
  return qaPass && signedOff;
}

/** Which status role the ticket should be in right now, or `null` for "leave it". */
export function targetRole(paths, run) {
  if (!run.currentStage) return run.status === 'completed' && uatApproved(paths, run) ? 'done' : null;
  const st = run.stages[run.currentStage];
  if (st?.status === STAGE_STATUS.CHANGES_REQUESTED && REWORK_FROM.has(run.currentStage)) return 'inProgress';
  // The sign-off gate is open: the person is testing and about to approve.
  if (run.currentStage === 'delivery' && st?.status === STAGE_STATUS.AWAITING_GATE) return 'uat';
  return STAGE_STATUS_ROLE[run.currentStage] ?? null;
}

/** Defects QA left unfixed, from `## Unfixed Defects` in the test report. */
export function unfixedDefects(paths, run) {
  if (run.stages?.qa?.status !== STAGE_STATUS.DONE) return [];
  const section = extractSection(readArtifact(paths, run.id, 'test-report') ?? '', '## Unfixed Defects');
  if (!section) return [];
  return section
    .split('\n')
    .filter((l) => /^\s*([-*+]|\d+\.)\s+\S/.test(l))
    .map((l) => l.replace(/^\s*([-*+]|\d+\.)\s+/, '').trim())
    .filter((l) => !/^none\b/i.test(l));
}

/**
 * Record a pending sync when the ticket's target status changed, or when QA has
 * defects nobody has raised yet. Idempotent: called on every reconcile.
 * @returns {boolean} whether the run changed
 */
export function syncTracker(paths, run) {
  if (!trackerEnabled(run)) return false;

  const cfg = jiraSyncConfig(paths);
  const role = targetRole(paths, run);
  const prev = run.trackerSync ?? null;
  const defects = !prev?.defectsRaised && unfixedDefects(paths, run).length > 0;

  if (!role && !defects) return false;
  const target = role ? cfg.statusMap[role] : prev?.target;
  if (!target) return false;

  const sameTarget = prev?.target === target;
  if (sameTarget && (!defects || prev.defects)) return false;

  run.trackerSync = {
    stage: run.currentStage,
    target,
    defects,
    pathsFrom: pathsTo(cfg.workflow, target),
    acknowledged: false,
    requestedAt: new Date().toISOString(),
    reached: prev?.reached ?? null,
    defectsRaised: prev?.defectsRaised ?? false
  };
  journal(paths, run.id, { event: 'tracker.sync_requested', stage: run.currentStage, target, defects });
  return true;
}

/** A sync the Jira tracker still owes, or `null`. */
export function pendingSync(run) {
  const s = run.trackerSync;
  return s && !s.acknowledged && trackerEnabled(run) ? s : null;
}

/** What `hermit_next_task` tells the orchestrator while a sync is owed. */
export function renderSync(run, sync) {
  return [
    `# Jira status sync (run ${run.id}, ticket ${run.jiraKey ?? 'unknown'})`,
    '',
    `The run is at **${sync.stage ?? 'the end'}**. The ticket should now be **${sync.target}**.`,
    sync.defects ? 'QA left defects unfixed: create each as a Task linked to the ticket (see the test report).' : null,
    '',
    'Hand this to the **jira-tracker** agent in sync mode. It reads the ticket\'s real status, looks it up in',
    '`pathsFrom`, makes the moves in order, comments once, and calls `hermit_ack_tracker_sync`.',
    'You do not move the ticket yourself.',
    '',
    '```json',
    JSON.stringify({ target: sync.target, defects: sync.defects, pathsFrom: sync.pathsFrom }, null, 2),
    '```'
  ].filter((l) => l !== null).join('\n');
}

/**
 * The Jira tracker reports what it did. `reached` is the status the ticket is
 * actually in now, which may not be the target: a refused move is a report,
 * not a failure, and the run carries on.
 */
export function ackTrackerSync({ paths, run, reached, note = null, defectKeys = [] }) {
  const sync = run.trackerSync;
  if (!sync || sync.acknowledged) {
    return { state: 'nothing_pending', message: 'There is no Jira status sync waiting to be acknowledged.' };
  }
  sync.acknowledged = true;
  sync.acknowledgedAt = new Date().toISOString();
  sync.reached = reached;
  sync.note = note;
  if (sync.defects) sync.defectsRaised = true;
  journal(paths, run.id, {
    event: 'tracker.synced', stage: sync.stage, target: sync.target, reached, matched: reached === sync.target,
    defectKeys, note
  });
  saveRun(paths, run);
  return {
    state: 'acknowledged',
    target: sync.target,
    reached,
    matched: reached === sync.target,
    message: reached === sync.target
      ? `Ticket is now ${reached}. Call hermit_next_task to continue.`
      : `Recorded: ticket is in ${reached}, target was ${sync.target}. The run continues. Call hermit_next_task.`
  };
}
