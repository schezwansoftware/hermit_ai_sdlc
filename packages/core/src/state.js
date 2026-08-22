import fs from 'node:fs';
import { DEFAULT_PIPELINE } from './pipeline.js';
import { hasUiProject, techScope, UI_KINDS } from './projects.js';
import { resolveStageAgent } from './registry.js';
import { ensureDir, readJson, writeJson } from './paths.js';

export const STAGE_STATUS = /** @type {const} */ ({
  PENDING: 'pending',
  IN_PROGRESS: 'in_progress',
  AWAITING_GATE: 'awaiting_gate',
  DONE: 'done',
  SKIPPED: 'skipped',
  CHANGES_REQUESTED: 'changes_requested'
});

export function newRunId(now = new Date()) {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
  return `run-${stamp}-${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * @param {ReturnType<import('./paths.js').layout>} paths
 */
export function createRun(paths, {
  title, intent, jiraKey = null, flags = [], pipeline = DEFAULT_PIPELINE,
  projects = [], selectedProjects = [], registry = null
}) {
  const id = newRunId();
  const now = new Date().toISOString();

  // In a monorepo, a run that touches only backend and infra has no interface to
  // design. Skipping the three UX stages is then a fact about the work, not a
  // flag someone has to remember to pass.
  const uiInScope = projects.length ? hasUiProject(projects, selectedProjects) : true;

  const selected = selectedProjects.length ? selectedProjects : projects.map((x) => x.id);
  // Frozen at run creation: which specialist implements this work, and which
  // conditional criteria apply, must not drift if the repository changes mid-run.
  const tech = techScope(paths.root, projects, selected);

  // The services stage is also the catch-all — infrastructure, libraries and
  // unclassified work have nowhere else to go — so it stands down only when the
  // run is nothing but interface work.
  const uiOnly = uiInScope && !tech.backend && tech.units.every((u) => UI_KINDS.has(u.kind));

  const stages = {};
  for (const stage of pipeline.stages) {
    const skipped =
      stage.skipWhen === 'no-ui'
        ? flags.includes('no-ui') || !uiInScope
        : stage.skipWhen === 'ui-only'
          ? uiOnly
          : Boolean(stage.skipWhen && flags.includes(stage.skipWhen));
    stages[stage.id] = {
      status: skipped ? STAGE_STATUS.SKIPPED : STAGE_STATUS.PENDING,
      // Resolved up front so `hermit status` names the specialist before the
      // stage starts rather than once it is already running.
      agent: (registry ? resolveStageAgent(registry, stage, { tech }) : null)?.id ?? stage.agent,
      attempts: 0,
      startedAt: null,
      completedAt: null
    };
  }

  const run = {
    id,
    schema: 1,
    createdAt: now,
    updatedAt: now,
    title,
    intent,
    jiraKey,
    flags,
    pipelineId: pipeline.id,
    pipelineVersion: pipeline.version,
    monorepo: projects.length > 1,
    projects,
    selectedProjects: selected,
    tech,
    status: 'active',
    currentStage: firstActionable(pipeline, stages),
    stages,
    artifacts: {},
    gates: []
  };
  ensureDir(paths.runDir(id));
  writeJson(paths.runFile(id), run);
  setActiveRun(paths, id);
  journal(paths, id, { event: 'run.created', title, intent, jiraKey, flags, projects: run.selectedProjects, uiInScope, stacks: run.tech.stacks });
  return run;
}

export function firstActionable(pipeline, stages) {
  const stage = pipeline.stages.find(
    (s) => ![STAGE_STATUS.DONE, STAGE_STATUS.SKIPPED].includes(stages[s.id]?.status)
  );
  return stage?.id ?? null;
}

export function loadRun(paths, runId) {
  const run = readJson(paths.runFile(runId));
  if (!run) throw new Error(`Run "${runId}" not found. Try: hermit runs`);
  return run;
}

export function saveRun(paths, run) {
  run.updatedAt = new Date().toISOString();
  writeJson(paths.runFile(run.id), run);
  return run;
}

export function activeRunId(paths) {
  try {
    const id = fs.readFileSync(paths.activeRunFile, 'utf8').trim();
    return id || null;
  } catch {
    return null;
  }
}

export function setActiveRun(paths, runId) {
  ensureDir(paths.hermit);
  fs.writeFileSync(paths.activeRunFile, `${runId}\n`, 'utf8');
}

export function requireActiveRun(paths) {
  const id = activeRunId(paths);
  if (!id) throw new Error('No active Hermit run. Start one with: hermit start "<intent>"');
  return loadRun(paths, id);
}

export function listRuns(paths) {
  if (!fs.existsSync(paths.runsDir)) return [];
  return fs
    .readdirSync(paths.runsDir)
    .map((id) => readJson(paths.runFile(id)))
    .filter(Boolean)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Append-only audit trail. Every state transition and gate decision lands here. */
export function journal(paths, runId, entry) {
  ensureDir(paths.runDir(runId));
  const line = JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n';
  fs.appendFileSync(paths.journalFile(runId), line, 'utf8');
}

export function readJournal(paths, runId) {
  try {
    return fs
      .readFileSync(paths.journalFile(runId), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}
