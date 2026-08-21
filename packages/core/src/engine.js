import { DEFAULT_PIPELINE, getStage, stageIndex } from './pipeline.js';
import { STAGE_STATUS, journal, saveRun } from './state.js';
import { GATE_STATUS, findOpenGate, openGate } from './gates.js';
import { evaluateAll } from './criteria.js';
import { writeArtifact, listArtifacts } from './artifacts.js';
import { buildContextBundle, outputContract, renderBundle } from './context.js';

const TERMINAL = [STAGE_STATUS.DONE, STAGE_STATUS.SKIPPED];

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
      st.status = STAGE_STATUS.CHANGES_REQUESTED;
      st.completedAt = null;
      journal(paths, run.id, { event: 'stage.reopened', stage: gate.stageId, gateId: gate.id });
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
  const agent = registry.agentsById[stage.agent] ?? registry.agentForStage(stage.id);
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
    saveRun(paths, run);
  }

  const bundle = buildContextBundle({ paths, run, stage, agent, registry, budget });
  const contract = outputContract(stage);
  const priorGate = [...run.gates].reverse().find((g) => g.stageId === stage.id && g.comment);

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

  const check = evaluateAll(paths, run.id, stage.exitCriteria);
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

  if (stage.gate === 'hitl') {
    run.stages[stage.id].status = STAGE_STATUS.AWAITING_GATE;
    const gate = openGate(paths, run, stage, check.results);
    saveRun(paths, run);
    return {
      state: 'awaiting_gate',
      accepted: true,
      gate,
      message:
        `Exit criteria passed. "${stage.title}" now requires human approval.\n` +
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
      agent: s.agent,
      gate: s.gate,
      status: run.stages[s.id]?.status ?? 'pending',
      attempts: run.stages[s.id]?.attempts ?? 0
    }))
  };
}
