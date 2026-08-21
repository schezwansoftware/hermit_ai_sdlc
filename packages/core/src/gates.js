import crypto from 'node:crypto';
import { journal } from './state.js';

export const GATE_STATUS = /** @type {const} */ ({
  OPEN: 'open',
  APPROVED: 'approved',
  CHANGES_REQUESTED: 'changes_requested',
  REJECTED: 'rejected'
});

export const DECISIONS = Object.freeze(['approve', 'changes_requested', 'reject']);

/**
 * Human-in-the-loop gate.
 *
 * Design rule: agents may READ gate state over MCP but can never write a
 * decision. `decideGate` refuses any source other than 'cli', which is the only
 * path a human actually drives. Without this the HITL requirement is decorative
 * — a model that can approve its own work will approve its own work.
 */
export function openGate(paths, run, stage, criteriaResults) {
  const existing = findOpenGate(run, stage.id);
  if (existing) return existing;
  const gate = {
    id: `gate_${stage.id}_${crypto.randomBytes(3).toString('hex')}`,
    stageId: stage.id,
    stageTitle: stage.title,
    agent: stage.agent,
    status: GATE_STATUS.OPEN,
    openedAt: new Date().toISOString(),
    decidedAt: null,
    decidedBy: null,
    decision: null,
    comment: null,
    reviewArtifacts: stage.outputs ?? [],
    criteria: criteriaResults ?? []
  };
  run.gates.push(gate);
  journal(paths, run.id, { event: 'gate.opened', gateId: gate.id, stage: stage.id });
  return gate;
}

export function findOpenGate(run, stageId = null) {
  return (
    run.gates.find((g) => g.status === GATE_STATUS.OPEN && (stageId === null || g.stageId === stageId)) ?? null
  );
}

export function openGates(run) {
  return run.gates.filter((g) => g.status === GATE_STATUS.OPEN);
}

export function getGate(run, gateId) {
  return run.gates.find((g) => g.id === gateId) ?? null;
}

/**
 * @param {'approve'|'changes_requested'|'reject'} decision
 * @param {{ decidedBy:string, comment?:string, source:string }} opts
 */
export function decideGate(paths, run, gateId, decision, { decidedBy, comment = null, source }) {
  if (source !== 'cli') {
    throw new Error(
      `Gate decisions may only be made by a human through the Hermit CLI (got source="${source}"). ` +
        `Run: hermit gate ${decision === 'approve' ? 'approve' : decision} ${gateId}`
    );
  }
  if (!DECISIONS.includes(decision)) {
    throw new Error(`Unknown decision "${decision}". Expected one of: ${DECISIONS.join(', ')}`);
  }
  const gate = getGate(run, gateId);
  if (!gate) throw new Error(`Gate "${gateId}" not found in run ${run.id}`);
  if (gate.status !== GATE_STATUS.OPEN) throw new Error(`Gate "${gateId}" is already ${gate.status}`);
  if (!decidedBy) throw new Error('A gate decision must record who made it (--by, or git user.name)');

  gate.status =
    decision === 'approve'
      ? GATE_STATUS.APPROVED
      : decision === 'reject'
        ? GATE_STATUS.REJECTED
        : GATE_STATUS.CHANGES_REQUESTED;
  gate.decision = decision;
  gate.decidedAt = new Date().toISOString();
  gate.decidedBy = decidedBy;
  gate.comment = comment;

  journal(paths, run.id, {
    event: 'gate.decided',
    gateId,
    stage: gate.stageId,
    decision,
    decidedBy,
    comment
  });
  return gate;
}
