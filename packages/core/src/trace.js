import { readJournal } from './state.js';
import { DEFAULT_PIPELINE } from './pipeline.js';

/**
 * Post-run debugging trace: for each stage, where its context came from and
 * why each decision on it went the way it did.
 *
 * Nothing here is new state — it is the run journal (already the append-only
 * audit trail: `stage.started`, `context.bundled`, `artifact.submitted`,
 * `handoff.rejected`, `gate.decided`, `guidance.answered`, `stage.completed`,
 * ...) read back and grouped by stage, in the order a person actually asks
 * the question: "this stage went wrong — what did it start from, and what
 * did it decide along the way?" `hermit_journal` already exposes the same
 * events flat and chronological, which is the right shape for "what
 * happened, when"; this is the right shape for "what happened, per stage."
 */
export function runTrace(paths, run, pipeline = DEFAULT_PIPELINE) {
  const entries = readJournal(paths, run.id);
  const byStage = new Map(pipeline.stages.map((s) => [s.id, { stageId: s.id, title: s.title, attempts: [] }]));

  const attemptFor = (stageId, attempt) => {
    const st = byStage.get(stageId);
    if (!st) return null;
    let a = st.attempts.find((x) => x.attempt === attempt);
    if (!a) {
      a = { attempt, startedAt: null, context: null, submissions: [], rejections: [], decisions: [], summary: null, thinking: null, completedAt: null };
      st.attempts.push(a);
    }
    return a;
  };

  for (const e of entries) {
    switch (e.event) {
      case 'stage.started': {
        const a = attemptFor(e.stage, e.attempt);
        if (a) a.startedAt = e.at;
        break;
      }
      case 'context.bundled': {
        const a = attemptFor(e.stage, e.attempt);
        if (a) {
          a.context = {
            at: e.at,
            artifacts: e.artifacts,
            priorOutputs: e.priorOutputs,
            missingInputs: e.missingInputs,
            knowledge: e.knowledge,
            skills: e.skills,
            reviewerFeedback: e.reviewerFeedback,
            budget: e.budget
          };
        }
        break;
      }
      case 'artifact.submitted': {
        const st = byStage.get(e.stage);
        const a = st?.attempts[st.attempts.length - 1];
        if (a) a.submissions.push({ at: e.at, artifact: e.artifact, bytes: e.bytes });
        break;
      }
      case 'stage.summary': {
        // The model's own account of its reasoning, written deliberately on
        // the handoff call that got criteria to pass — the only record of
        // "why" Hermit can ever have, since it cannot see inside a model's
        // actual thinking.
        const st = byStage.get(e.stage);
        const a = st?.attempts[st.attempts.length - 1];
        if (a) {
          a.summary = e.summary ?? a.summary;
          a.thinking = e.thinking ?? a.thinking;
        }
        break;
      }
      case 'handoff.rejected': {
        const st = byStage.get(e.stage);
        const a = st?.attempts[st.attempts.length - 1];
        if (a) a.rejections.push({ at: e.at, failed: e.failed });
        break;
      }
      case 'gate.decided': {
        const st = byStage.get(e.stage);
        const a = st?.attempts[st.attempts.length - 1];
        if (a) a.decisions.push({ at: e.at, kind: 'gate', decision: e.decision, by: e.decidedBy, reason: e.comment, source: e.source });
        break;
      }
      case 'guidance.answered': {
        const st = byStage.get(e.stage);
        const a = st?.attempts[st.attempts.length - 1];
        if (a) a.decisions.push({ at: e.at, kind: 'guidance', by: e.answeredBy, source: e.source, queryId: e.queryId });
        break;
      }
      case 'stage.completed':
      case 'stage.reopened':
      case 'quality_gate.returned_upstream': {
        const st = byStage.get(e.stage);
        const a = st?.attempts[st.attempts.length - 1];
        if (a && e.event === 'stage.completed') a.completedAt = e.at;
        break;
      }
      default:
        break;
    }
  }

  return {
    runId: run.id,
    stages: [...byStage.values()].filter((s) => s.attempts.length > 0)
  };
}

/**
 * The single attempt a person actually wants when debugging: the last one a
 * stage made, since that is the version whose result they are looking at.
 */
export function lastAttemptTrace(paths, run, stageId, pipeline = DEFAULT_PIPELINE) {
  const trace = runTrace(paths, run, pipeline);
  const stage = trace.stages.find((s) => s.stageId === stageId);
  if (!stage) return null;
  return stage.attempts[stage.attempts.length - 1] ?? null;
}
