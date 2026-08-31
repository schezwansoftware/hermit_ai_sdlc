import crypto from 'node:crypto';
import { journal } from './state.js';
import { GATE_SOURCES } from './gates.js';

/**
 * Mid-stage guidance queries.
 *
 * Not a gate: a gate blocks the run until a person decides it. A guidance
 * query is for the narrower case where an agent is unblocked enough to keep
 * working on other parts of the stage, but has hit one specific, answerable
 * fork ("should the retry use exponential backoff or a fixed interval?")
 * that would otherwise turn into a wrong guess baked into the artifact, or a
 * handoff sent back at the gate for something a five-second answer would
 * have prevented.
 *
 * Design rule, same as gates: agents may ASK and READ. Answering requires a
 * source in GATE_SOURCES — never the agent's own say-so, and never another
 * agent's — because an agent that can answer its own question has not
 * actually asked one.
 */

const VAGUE_PHRASES = ['what should', 'how should', 'any ideas', 'thoughts', 'feedback'];

/**
 * Validate a guidance query before submitting.
 *
 * Enforces that questions are specific and answerable, not general design
 * discussions — a vague question just relocates the ambiguity instead of
 * resolving it, and costs a round trip to discover that.
 */
export function validateGuidanceQuery({ question }) {
  const issues = [];
  if (!question || question.length < 10) {
    issues.push('Question must be at least 10 characters');
  }
  if (question && question.length > 500) {
    issues.push('Question must be under 500 characters');
  }
  if (question && VAGUE_PHRASES.some((p) => question.toLowerCase().includes(p))) {
    issues.push('Question sounds open-ended; rephrase as a specific "should I do X or Y?" query');
  }
  return { valid: issues.length === 0, issues };
}

/**
 * Ask a guidance question mid-stage. Throws on an invalid question rather
 * than silently storing something nobody could usefully answer.
 */
export function askGuidance(paths, run, { agentId, stageId, question, context = '', priority = 'normal' }) {
  const { valid, issues } = validateGuidanceQuery({ question });
  if (!valid) {
    throw new Error(`Guidance question refused: ${issues.join('; ')}`);
  }
  if (!['urgent', 'normal', 'low'].includes(priority)) {
    throw new Error(`Unknown priority "${priority}". Expected one of: urgent, normal, low`);
  }
  const query = {
    id: `gq_${stageId}_${crypto.randomBytes(3).toString('hex')}`,
    agentId,
    stageId,
    question,
    context,
    priority,
    submittedAt: new Date().toISOString(),
    respondedAt: null,
    answeredBy: null,
    answer: null,
    source: null
  };
  run.guidanceQueries ??= [];
  run.guidanceQueries.push(query);
  journal(paths, run.id, { event: 'guidance.asked', queryId: query.id, stage: stageId, agent: agentId, priority });
  return query;
}

export function openGuidanceQueries(run, stageId = null) {
  return (run.guidanceQueries ?? []).filter(
    (q) => q.respondedAt === null && (stageId === null || q.stageId === stageId)
  );
}

export function getGuidanceQuery(run, queryId) {
  return (run.guidanceQueries ?? []).find((q) => q.id === queryId) ?? null;
}

/**
 * Answer a guidance query. Same trust boundary as `decideGate`: only a
 * human, through the CLI or the orchestrator's chat tool after a human has
 * confirmed the call, may answer — an agent cannot unblock itself.
 */
export function answerGuidance(paths, run, queryId, { answeredBy, answer, source }) {
  if (!GATE_SOURCES.includes(source)) {
    throw new Error(
      `Guidance queries may only be answered by a human, through the Hermit CLI or ` +
        `the orchestrator's hermit_answer_guidance tool (got source=${JSON.stringify(source)}).`
    );
  }
  const query = getGuidanceQuery(run, queryId);
  if (!query) throw new Error(`Guidance query "${queryId}" not found in run ${run.id}`);
  if (query.respondedAt) throw new Error(`Guidance query "${queryId}" was already answered`);
  if (!answeredBy) throw new Error('An answer must record who gave it (--by, or git user.name)');
  if (!answer) throw new Error('An answer needs actual content — an empty answer leaves the agent as stuck as before.');

  query.respondedAt = new Date().toISOString();
  query.answeredBy = answeredBy;
  query.answer = answer;
  query.source = source;

  journal(paths, run.id, {
    event: 'guidance.answered',
    queryId,
    stage: query.stageId,
    answeredBy,
    source
  });
  return query;
}

/**
 * Telemetry on guidance queries: whether the tool is actually keeping agents
 * unblocked, or has become a bottleneck of its own (see the roadmap risk on
 * this feature — more than ~2-3 questions per stage erodes the time saved).
 */
export function queryTelemetry(run) {
  const all = run.guidanceQueries ?? [];
  const resolved = all.filter((q) => q.respondedAt !== null);
  const responseTimesMs = resolved.map((q) => new Date(q.respondedAt) - new Date(q.submittedAt));
  const avgResponseTimeMs = responseTimesMs.length
    ? responseTimesMs.reduce((a, b) => a + b, 0) / responseTimesMs.length
    : null;
  return {
    queriesAsked: all.length,
    queriesResolved: resolved.length,
    resolutionRate: all.length > 0 ? (resolved.length / all.length) * 100 : 0,
    avgResponseTimeMs,
    withinSLA: avgResponseTimeMs === null ? null : avgResponseTimeMs < 5 * 60 * 1000 // 5-minute SLA
  };
}
