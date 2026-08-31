import { DEFAULT_PIPELINE, getStage, stageIndex, reviewedStagesOf, reviewingStagesOf } from './pipeline.js';
import { STAGE_STATUS, journal, saveRun } from './state.js';
import { GATE_STATUS, findOpenGate, openGate } from './gates.js';
import { evaluateAll } from './criteria.js';
import { writeArtifact, listArtifacts, readArtifact } from './artifacts.js';
import { buildContextBundle, outputContract, renderBundle } from './context.js';
import { resolveStageAgent } from './registry.js';

const TERMINAL = [STAGE_STATUS.DONE, STAGE_STATUS.SKIPPED];

/**
 * The facts conditional exit criteria are evaluated against.
 *
 * `ui` is read back from stage state rather than recomputed, so it reports what
 * this run actually did: a run started with `--no-ui` skipped the UX stages, and
 * requiring a frontend design section from it would be incoherent.
 */
export function criteriaContext(run, pipeline = DEFAULT_PIPELINE) {
  return {
    monorepo: Boolean(run.monorepo),
    backend: Boolean(run.tech?.backend),
    ui: pipeline.stages.some(
      (s) => s.skipWhen === 'no-ui' && run.stages?.[s.id]?.status !== STAGE_STATUS.SKIPPED
    )
  };
}

/**
 * The most recent commented gate decision a re-entered stage should see.
 *
 * Usually that is a gate the stage's own completion opened (a completion
 * gate re-entering itself). But a stage reopened *because a downstream
 * quality gate* (review/qa/security) requested changes on its output never
 * has a gate on its own stage id to find — the comment lives on the
 * reviewer's gate instead. Falling back to the most recent commented gate
 * among that stage's reviewers is what actually surfaces the reviewer's
 * comment to the agent redoing the work.
 */
export function latestGateFeedback(pipeline, run, stageId) {
  const own = [...run.gates].reverse().find((g) => g.stageId === stageId && g.comment);
  if (own) return own;
  const reviewers = reviewingStagesOf(pipeline, stageId);
  if (!reviewers.length) return null;
  return [...run.gates].reverse().find((g) => reviewers.includes(g.stageId) && g.comment);
}

/**
 * How many dependency fixes exist only in a major version.
 *
 * Read from the report rather than inferred from an empty section: an agent that
 * writes "- none" under `## Needs Approval` would otherwise look identical to one
 * that found two, and the difference decides whether a person is interrupted.
 */
export function majorUpgradeCount(paths, run) {
  const content = readArtifact(paths, run.id, 'cve-report');
  if (!content) return 0;
  const m = content.match(/\*\*Major upgrades\*\*:\s*(\d+)/i);
  return m ? Number(m[1]) : 0;
}

/**
 * Conditions that turn an `auto` stage into a gated one for this run.
 *
 * A stage declares `gateWhen: '<key>'`; the function here decides. Both current
 * conditions exist for the same reason: the stage is about to do something
 * outward-facing or hard to walk back, but only sometimes, and gating it
 * unconditionally would interrupt every run that does not.
 */
export const GATE_CONDITIONS = {
  /** Planning gates when this run will also open real tracker items from the plan. */
  tracker: ({ run }) => Boolean(run.stages?.tracker) && run.stages.tracker.status !== STAGE_STATUS.SKIPPED,
  /** Security gates when a fix requires a major version bump someone has to accept. */
  'major-upgrades': ({ paths, run }) => majorUpgradeCount(paths, run) > 0
};

/** Does this stage need a human before the run advances past it? */
export function stageNeedsGate(stage, { paths, run }) {
  if (stage?.gate === 'hitl') return true;
  const condition = stage?.gateWhen ? GATE_CONDITIONS[stage.gateWhen] : null;
  return condition ? Boolean(condition({ paths, run })) : false;
}

/** Why a conditional gate opened, for the message the agent reads. */
function gateReason(stage, { paths, run }) {
  if (stage.gate === 'hitl') return null;
  if (stage.gateWhen === 'tracker') {
    return 'this run creates tracker items from the approved plan, so the plan is approved first';
  }
  if (stage.gateWhen === 'major-upgrades') {
    const n = majorUpgradeCount(paths, run);
    return `${n} vulnerability fix(es) exist only in a major version and need a person to accept the break risk`;
  }
  return null;
}

/**
 * Fold any decided gates into stage state. Called before every read so the run
 * converges whether the decision came from the CLI, a git pull, or another
 * machine sharing the run directory.
 */
export function reconcile(paths, run, pipeline = DEFAULT_PIPELINE) {
  let changed = false;
  for (const gate of run.gates) {
    if (gate.status === GATE_STATUS.OPEN || gate.applied) continue;
    const st = run.stages[gate.stageId];
    if (!st) continue;

    if (gate.status === GATE_STATUS.APPROVED) {
      st.status = STAGE_STATUS.DONE;
      st.completedAt = gate.decidedAt;
      journal(paths, run.id, { event: 'stage.completed', stage: gate.stageId, via: 'gate', gateId: gate.id });
    } else if (gate.status === GATE_STATUS.CHANGES_REQUESTED) {
      // A quality gate (review/qa/security) declares `reviews: [...]` — its
      // decision is about those stages' output, not its own. Route the
      // producing stage(s) back for a fix instead of re-running the
      // gatekeeper, and let the gatekeeper re-run naturally once they pass
      // again, so it actually re-reviews the fix rather than being skipped.
      const reviewed = reviewedStagesOf(pipeline, gate.stageId).filter(
        (id) => run.stages[id] && run.stages[id].status !== STAGE_STATUS.SKIPPED
      );
      if (reviewed.length) {
        for (const producerId of reviewed) {
          const producer = run.stages[producerId];
          producer.status = STAGE_STATUS.CHANGES_REQUESTED;
          producer.completedAt = null;
          journal(paths, run.id, { event: 'stage.reopened', stage: producerId, gateId: gate.id, via: gate.stageId });
        }
        st.status = STAGE_STATUS.PENDING;
        st.completedAt = null;
        st.startedAt = null;
        journal(paths, run.id, { event: 'quality_gate.returned_upstream', stage: gate.stageId, gateId: gate.id, returnedTo: reviewed });
      } else {
        st.status = STAGE_STATUS.CHANGES_REQUESTED;
        st.completedAt = null;
        journal(paths, run.id, { event: 'stage.reopened', stage: gate.stageId, gateId: gate.id });
      }
    } else if (gate.status === GATE_STATUS.REJECTED) {
      st.status = STAGE_STATUS.CHANGES_REQUESTED;
      run.status = 'blocked';
      journal(paths, run.id, { event: 'run.blocked', stage: gate.stageId, gateId: gate.id });
    }
    gate.applied = true;
    changed = true;
  }

  const next = pipeline.stages.find((s) => !TERMINAL.includes(run.stages[s.id]?.status));
  const nextId = next?.id ?? null;
  if (run.currentStage !== nextId) {
    run.currentStage = nextId;
    changed = true;
  }
  if (!nextId && run.status === 'active') {
    run.status = 'completed';
    journal(paths, run.id, { event: 'run.completed' });
    changed = true;
  }
  if (changed) saveRun(paths, run);
  return run;
}

/**
 * What should happen next in this run?
 * @returns {{ state:'task'|'awaiting_gate'|'blocked'|'complete', ... }}
 */
export function nextTask({ paths, run, registry, pipeline = DEFAULT_PIPELINE, budget }) {
  reconcile(paths, run, pipeline);

  const openGateNow = findOpenGate(run);
  if (openGateNow) {
    return {
      state: 'awaiting_gate',
      gate: openGateNow,
      message:
        `Stage "${openGateNow.stageTitle}" is waiting for human approval (gate ${openGateNow.id}). ` +
        `No agent may proceed until a person runs: hermit gate approve ${openGateNow.id}`
    };
  }

  if (run.status === 'completed' || !run.currentStage) {
    return { state: 'complete', message: `Run ${run.id} is complete.` };
  }
  if (run.status === 'blocked') {
    return { state: 'blocked', message: `Run ${run.id} is blocked. A human must reopen it: hermit resume ${run.id}` };
  }

  const stage = getStage(pipeline, run.currentStage);
  const agent = resolveStageAgent(registry, stage, run);
  if (!agent) {
    return { state: 'blocked', message: `No agent definition found for stage "${stage.id}" (expected agent id "${stage.agent}").` };
  }

  const st = run.stages[stage.id];
  if (st.status === STAGE_STATUS.PENDING || st.status === STAGE_STATUS.CHANGES_REQUESTED) {
    if (st.status === STAGE_STATUS.CHANGES_REQUESTED) st.attempts += 1;
    else st.attempts = Math.max(1, st.attempts);
    st.status = STAGE_STATUS.IN_PROGRESS;
    st.startedAt = st.startedAt ?? new Date().toISOString();
    journal(paths, run.id, { event: 'stage.started', stage: stage.id, agent: agent.id, attempt: st.attempts });
  }
  // Record who is actually on this stage, so status and the audit trail name the
  // specialist rather than the pipeline's default.
  if (st.agent !== agent.id) {
    st.agent = agent.id;
    if (agent.id !== stage.agent) {
      journal(paths, run.id, { event: 'stage.specialised', stage: stage.id, agent: agent.id, insteadOf: stage.agent, stacks: run.tech?.stacks ?? [] });
    }
  }
  saveRun(paths, run);

  const bundle = buildContextBundle({ paths, run, stage, agent, registry, budget });
  const contract = outputContract(stage, criteriaContext(run, pipeline));
  const priorGate = latestGateFeedback(pipeline, run, stage.id);

  return {
    state: 'task',
    runId: run.id,
    stage,
    agent: { id: agent.id, name: agent.name, role: agent.role },
    attempt: st.attempts,
    reviewerFeedback: priorGate ? { decision: priorGate.decision, comment: priorGate.comment, by: priorGate.decidedBy } : null,
    bundle,
    contract,
    playbook: agent.playbook,
    rendered: renderBundle(bundle, { playbook: agent.playbook, contract }) +
      (priorGate?.comment
        ? `\n\n## Reviewer feedback from the previous attempt\n\n> ${priorGate.comment}\n\n_Address this explicitly before requesting handoff again._\n`
        : '')
  };
}

/**
 * Record an artifact produced by an agent. Rejects artifacts the current stage
 * is not declared to produce — an agent cannot write outside its contract.
 */
export function submitArtifact({ paths, run, registry, pipeline = DEFAULT_PIPELINE, artifactId, content, agentId }) {
  const stage = getStage(pipeline, run.currentStage);
  if (!stage) throw new Error(`Run ${run.id} has no active stage; nothing to submit.`);
  if (!(stage.outputs ?? []).includes(artifactId)) {
    throw new Error(
      `Stage "${stage.id}" does not produce "${artifactId}". Allowed outputs: ${(stage.outputs ?? []).join(', ') || 'none'}`
    );
  }
  const agent = registry.agentsById[agentId];
  const writes = agent?.context?.writes?.artifacts ?? [];
  if (agent && !writes.includes(artifactId)) {
    throw new Error(`Agent "${agentId}" is not entitled to write "${artifactId}". Declared writes: ${writes.join(', ') || 'none'}`);
  }

  const meta = writeArtifact(paths, run.id, artifactId, content, agentId ?? stage.agent);
  run.artifacts[artifactId] = meta;
  journal(paths, run.id, { event: 'artifact.submitted', stage: stage.id, artifact: artifactId, sha256: meta.sha256, bytes: meta.bytes });
  saveRun(paths, run);
  return meta;
}

/**
 * Agent asks to move on. Exit criteria are evaluated first; a HITL stage then
 * opens a gate instead of advancing.
 */
export function requestHandoff({ paths, run, registry, pipeline = DEFAULT_PIPELINE, agentId, summary = null }) {
  reconcile(paths, run, pipeline);
  const stage = getStage(pipeline, run.currentStage);
  if (!stage) return { state: 'complete', message: `Run ${run.id} is already complete.` };

  const check = evaluateAll(paths, run.id, stage.exitCriteria, criteriaContext(run, pipeline));
  if (!check.ok) {
    journal(paths, run.id, { event: 'handoff.rejected', stage: stage.id, agent: agentId, failed: check.failed });
    return {
      state: 'blocked',
      stage: stage.id,
      accepted: false,
      criteria: check.results,
      message:
        `Handoff refused — ${check.failed.length} exit criterion/criteria not met for "${stage.title}":\n` +
        check.results.filter((r) => !r.ok).map((r) => `  - ${r.id}: ${r.detail}`).join('\n')
    };
  }

  if (summary) {
    journal(paths, run.id, { event: 'stage.summary', stage: stage.id, agent: agentId, summary });
  }

  if (stageNeedsGate(stage, { paths, run })) {
    run.stages[stage.id].status = STAGE_STATUS.AWAITING_GATE;
    const gate = openGate(paths, run, stage, check.results);
    const reason = gateReason(stage, { paths, run });
    if (reason) gate.reason = reason;
    saveRun(paths, run);
    return {
      state: 'awaiting_gate',
      accepted: true,
      gate,
      message:
        `Exit criteria passed. "${stage.title}" now requires human approval.\n` +
        (reason ? `Why: ${reason}.\n` : '') +
        `Review artifacts: ${(stage.outputs ?? []).join(', ')}\n` +
        `A person must run:  hermit gate approve ${gate.id}   (or: hermit gate changes ${gate.id} -m "...")\n` +
        `Do not start the next stage and do not approve this yourself.`
    };
  }

  run.stages[stage.id].status = STAGE_STATUS.DONE;
  run.stages[stage.id].completedAt = new Date().toISOString();
  journal(paths, run.id, { event: 'stage.completed', stage: stage.id, agent: agentId, via: 'auto' });
  reconcile(paths, run, pipeline);

  const nxt = run.currentStage ? getStage(pipeline, run.currentStage) : null;
  return {
    state: nxt ? 'advanced' : 'complete',
    accepted: true,
    from: stage.id,
    to: nxt?.id ?? null,
    nextAgent: nxt?.agent ?? null,
    message: nxt
      ? `"${stage.title}" complete. Handing off to ${nxt.agent} for "${nxt.title}". Call hermit_next_task to receive that brief.`
      : `"${stage.title}" complete. Run ${run.id} is finished.`
  };
}

export function runStatus({ paths, run, pipeline = DEFAULT_PIPELINE }) {
  reconcile(paths, run, pipeline);
  const idx = run.currentStage ? stageIndex(pipeline, run.currentStage) : pipeline.stages.length;
  return {
    id: run.id,
    title: run.title,
    intent: run.intent,
    jiraKey: run.jiraKey,
    status: run.status,
    currentStage: run.currentStage,
    progress: { completed: idx, total: pipeline.stages.length },
    openGates: run.gates.filter((g) => g.status === GATE_STATUS.OPEN),
    artifacts: listArtifacts(paths, run.id),
    stages: pipeline.stages.map((s) => ({
      id: s.id,
      title: s.title,
      agent: run.stages[s.id]?.agent ?? s.agent,
      // The gate this stage will actually open for this run — a conditional gate
      // that is live shows as `hitl`, so status never promises an unattended
      // stage that is about to stop and wait.
      gate: stageNeedsGate(s, { paths, run }) ? 'hitl' : 'auto',
      optIn: Boolean(s.optIn),
      skippable: s.skippable !== false,
      status: run.stages[s.id]?.status ?? 'pending',
      attempts: run.stages[s.id]?.attempts ?? 0
    })),
    directives: run.directives ?? []
  };
}
