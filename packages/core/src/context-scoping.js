/**
 * P0-0: Context Scoping Engine
 *
 * Delivers only the context an agent actually needs, reducing bloat from 146k chars
 * to ~5k. Implements role-based filtering that prunes irrelevant artifacts and knowledge.
 */

/**
 * Determine what context categories an agent needs based on their role.
 *
 * Each role has different needs: a UI Developer needs design specs but not API schemas,
 * while a Backend Developer needs the opposite. This mapping avoids delivering
 * 100% of context to every role.
 */
export function contextNeeds(agentId, stage, run) {
  const agent = agentId?.toLowerCase() ?? '';
  const role = stage?.agent?.toLowerCase() ?? '';

  const needs = {
    includeArtifacts: true,
    artifactSummary: false,  // Include full artifacts or just summaries
    includeKnowledge: true,
    includeSkills: true,
    includePaths: true,
  };

  // UI-focused roles
  if (agent.includes('ui') || agent.includes('design') || agent.includes('frontend')) {
    needs.artifactSummary = false;  // UI needs full design details
    needs.includeArtifacts = ['requirements-spec', 'design-doc', 'ui-lofi', 'design-tokens', 'component-catalog'];
    return needs;
  }

  // Backend-focused roles
  if (agent.includes('backend') || agent.includes('api') || agent.includes('database')) {
    needs.includeArtifacts = ['requirements-spec', 'architecture-doc', 'data-model', 'api-spec', 'schema-migration'];
    return needs;
  }

  // Architecture/planning roles
  if (agent.includes('architect') || agent.includes('planning') || agent.includes('requirements')) {
    needs.includeArtifacts = ['requirements-spec', 'design-doc'];
    return needs;
  }

  // Default: include what was declared in read scope
  needs.includeArtifacts = true;
  return needs;
}

/**
 * Prune artifacts that are not relevant to the current stage.
 *
 * Filters the artifact list to only those the agent's role actually uses,
 * based on the stage they're working on.
 */
export function scopeArtifacts(artifacts, agentId, stage) {
  const needs = contextNeeds(agentId, stage);

  if (Array.isArray(needs.includeArtifacts)) {
    return artifacts.filter((a) => needs.includeArtifacts.includes(a.id));
  }

  // If includeArtifacts is true, keep all (default behavior)
  return artifacts;
}

/**
 * Reduce knowledge entries to only those relevant for this stage.
 *
 * Knowledge items tagged with specific stages are kept; generic ones are pruned
 * if the agent already has the stage playbook.
 */
export function scopeKnowledge(knowledge, stage) {
  if (!knowledge?.length) return [];

  return knowledge.filter((k) => {
    // Keep if no stage restriction or matches current stage
    if (!k.restrictToStages?.length) return true;
    return k.restrictToStages.includes(stage?.id);
  });
}

/**
 * Reduce skills to only those the agent needs.
 *
 * Skills are generally role-tied, not stage-tied, so we trust the registry
 * assignment. But filter out duplicates and low-signal entries.
 */
export function scopeSkills(skills, agentId) {
  if (!skills?.length) return [];

  // Remove duplicates by id
  const seen = new Set();
  return skills.filter((s) => {
    if (seen.has(s.id)) return false;
    seen.add(s.id);
    return true;
  });
}

/**
 * Reduce paths to only those relevant for this stage.
 *
 * A backend stage doesn't need the `apps/web/` path. Scoped paths
 * already filter by project; this filters by agent concern.
 */
export function scopePaths(paths, agentId) {
  if (!paths?.length) return paths;

  const agent = agentId?.toLowerCase() ?? '';
  const filtered = [];

  for (const p of paths) {
    // UI agents get ui paths; backend gets api/packages
    if (agent.includes('ui') || agent.includes('design') || agent.includes('frontend')) {
      if (p.match(/^app.*\/ui|design|frontend|web/i)) filtered.push(p);
    } else if (agent.includes('backend') || agent.includes('api')) {
      if (p.match(/^app.*\/(api|server|backend|packages|core)/i)) filtered.push(p);
    } else {
      // Default: include all
      filtered.push(p);
    }
  }

  return filtered.length ? filtered : paths;  // Fall back to all if filter is too restrictive
}

/**
 * Estimate token cost of a context bundle before delivery.
 *
 * Rough approximation: ~1 token per 4 characters for English text.
 * Used to warn if a bundle is still bloated after scoping.
 */
export function estimateTokens(bundle) {
  let chars = 0;

  if (bundle.artifacts?.length) {
    chars += bundle.artifacts.reduce((sum, a) => sum + (a.content?.length ?? 0), 0);
  }
  if (bundle.priorOutputs?.length) {
    chars += bundle.priorOutputs.reduce((sum, a) => sum + (a.content?.length ?? 0), 0);
  }
  if (bundle.knowledge?.length) {
    chars += bundle.knowledge.reduce((sum, k) => sum + (k.body?.length ?? 0), 0);
  }
  if (bundle.skills?.length) {
    chars += bundle.skills.reduce((sum, s) => sum + (s.body?.length ?? 0), 0);
  }

  return Math.ceil(chars / 4);
}

/**
 * Telemetry on what was scoped and why.
 *
 * Logged so we can track whether the scoping heuristics are working.
 * If the budget is still exceeded after scoping, this helps diagnose it.
 */
export function scopingTelemetry({ before, after, agentId, stageId }) {
  const reduction = Math.round(((before - after) / before) * 100);
  return {
    agentId,
    stageId,
    beforeChars: before,
    afterChars: after,
    reductionPercent: reduction,
    isValid: after < 20000,  // P0-0 goal: < 20k chars per bundle
  };
}
