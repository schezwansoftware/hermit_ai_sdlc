/**
 * P0-3: Guidance Query Tool
 *
 * Allows agents to ask clarifying questions mid-stage without opening full gate cycles.
 * Keeps agents unblocked and reduces gate rejections from incomplete handoffs.
 */

export class GuidanceQuery {
  constructor({ id, agentId, stageId, question, context = '', priority = 'normal' }) {
    this.id = id;
    this.agentId = agentId;
    this.stageId = stageId;
    this.question = question;
    this.context = context;
    this.priority = priority; // 'urgent', 'normal', 'low'
    this.submittedAt = new Date().toISOString();
    this.respondedAt = null;
    this.response = null;
  }
}

/**
 * Validate a guidance query before submitting.
 *
 * Enforces that questions are specific and answerable, not general design discussions.
 */
export function validateGuidanceQuery(query) {
  const issues = [];

  if (!query.question || query.question.length < 10) {
    issues.push('Question must be at least 10 characters');
  }
  if (query.question.length > 500) {
    issues.push('Question must be under 500 characters');
  }

  // Check for vague/open-ended questions
  const vaguePhrases = ['what should', 'how should', 'any ideas', 'thoughts', 'feedback'];
  if (vaguePhrases.some((p) => query.question.toLowerCase().includes(p))) {
    issues.push('Question sounds open-ended; rephrase as specific "should I do X or Y?" query');
  }

  return { valid: issues.length === 0, issues };
}

/**
 * Process a query response and notify the agent.
 *
 * In a real system, this would route to an orchestrator/human for response.
 */
export function respondToQuery(query, response) {
  query.respondedAt = new Date().toISOString();
  query.response = {
    text: response,
    timestamp: new Date().toISOString()
  };
  return query;
}

/**
 * Generate guidance query tool definition for MCP server.
 *
 * This is the tool agents can call to ask questions.
 */
export function getGuidanceQueryToolDef() {
  return {
    name: 'hermit_ask_guidance',
    description:
      'Ask a specific, answerable question mid-stage without opening a gate. ' +
      'Use for "should I do A or B?" not general design feedback. ' +
      'Responses are best-effort within 5 minutes.',
    input: {
      agentId: 'string (your agent id)',
      question: 'string (specific question; 10-500 chars)',
      context: 'string (relevant context; optional)',
      priority: "enum ('urgent', 'normal', 'low'); default 'normal'"
    },
    response: {
      queryId: 'string (reference id)',
      status: "'submitted' or 'error'",
      expectedResponseTime: 'string (e.g. "< 5 minutes")',
      error: 'string (if status=error)'
    }
  };
}

/**
 * Telemetry on guidance queries.
 *
 * Tracks whether queries help agents stay unblocked.
 */
export function queryTelemetry({ queryCount, resolvedCount, responseTimeMs, avgResponseTimeMs }) {
  return {
    queriesAsked: queryCount,
    queriesResolved: resolvedCount,
    resolutionRate: queryCount > 0 ? (resolvedCount / queryCount) * 100 : 0,
    lastResponseTimeMs: responseTimeMs,
    avgResponseTimeMs: avgResponseTimeMs,
    withinSLA: (avgResponseTimeMs ?? 0) < 5 * 60 * 1000 // 5-minute SLA
  };
}
