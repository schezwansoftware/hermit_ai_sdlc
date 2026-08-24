import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { journal } from './state.js';

export const GATE_STATUS = /** @type {const} */ ({
  OPEN: 'open',
  APPROVED: 'approved',
  CHANGES_REQUESTED: 'changes_requested',
  REJECTED: 'rejected'
});

export const DECISIONS = Object.freeze(['approve', 'changes_requested', 'reject']);

/**
 * Where a gate decision is allowed to come from.
 *
 * `cli` — a person, in their own terminal. Nothing an agent controls sits
 * between the keystroke and the decision.
 *
 * `chat` — the orchestrator, over MCP, after a human confirms the call through
 * the host's own permission prompt. That confirmation is the human decision;
 * it is real but weaker than `cli`, because a host set to auto-approve MCP
 * tools removes the prompt entirely. `hermit_decide_gate` is deliberately the
 * only tool in this server marked destructive, so a host that treats that
 * annotation as "always confirm" still does — but a workspace that has turned
 * auto-approval on for the whole `hermit` server has turned this off too.
 * Document that trade-off; do not pretend it away.
 *
 * Any other source is refused outright. There is no third path.
 */
export const GATE_SOURCES = Object.freeze(['cli', 'chat']);

/**
 * Human-in-the-loop gate.
 *
 * Design rule: agents may READ gate state over MCP. Deciding one requires a
 * source in `GATE_SOURCES` — never the agent's own say-so. Without this the
 * HITL requirement is decorative: a model that can approve its own work will
 * approve its own work.
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
 * @param {{ decidedBy:string, comment?:string, source:'cli'|'chat' }} opts
 */
export function decideGate(paths, run, gateId, decision, { decidedBy, comment = null, source }) {
  if (!GATE_SOURCES.includes(source)) {
    throw new Error(
      `Gate decisions may only be made by a human, through the Hermit CLI or ` +
        `the orchestrator's hermit_decide_gate tool (got source=${JSON.stringify(source)}). ` +
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
  if (decision !== 'approve' && !comment) {
    throw new Error(`"${decision}" needs a reason so the agent knows what to fix.`);
  }

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
  gate.source = source;

  journal(paths, run.id, {
    event: 'gate.decided',
    gateId,
    stage: gate.stageId,
    decision,
    decidedBy,
    comment,
    source
  });
  return gate;
}

/**
 * Who is deciding, when the caller did not say.
 *
 * Mirrors what the CLI has always done — git identity, then the OS user — so a
 * decision made through chat is attributed the same way one made in a terminal
 * is. Returns null rather than guessing; callers require a name.
 */
export function resolveDecider(root, provided = null) {
  if (provided) return provided;
  try {
    const name = execFileSync('git', ['config', 'user.name'], { cwd: root, encoding: 'utf8' }).trim();
    if (name) return name;
  } catch {
    /* no git, or user.name unset */
  }
  return process.env.USER || process.env.USERNAME || null;
}
