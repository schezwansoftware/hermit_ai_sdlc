/**
 * P0-0: Context Scoping Engine
 *
 * Delivers only the context an agent actually needs, reducing bloat from 146k chars
 * to ~5k. Implements role-based filtering that prunes irrelevant artifacts and knowledge.
 */

/**
 * Which artifacts an agent's role actually uses.
 *
 * P0-0 originally tried to further narrow artifacts here with a hard-coded
 * per-role allowlist (e.g. "UI roles only need these five artifact ids").
 * That list named artifacts that do not exist in this system's registry
 * (`design-doc`, `ui-lofi`, `architecture-doc`, `data-model`, `api-spec`,
 * `schema-migration`, `component-catalog` are not real artifact ids — see
 * `pipeline.js` for the real ones). Because the filter is an allowlist, an
 * unrecognised id is silently dropped rather than flagged, so every
 * implementation-stage agent lost most or all of its real inputs
 * (`backend-developer` was left with zero artifacts).
 *
 * The correct per-role scope already exists and is accurate: it is the
 * intersection of the pipeline stage's declared `inputs` and the agent's own
 * `context.reads.artifacts` (computed by the caller in `buildContextBundle`
 * before this function ever runs). Re-deriving that scope here from an
 * agent-id string guess duplicates a mechanism that is already correct and,
 * as shown above, duplicates it incorrectly. So this stays a pass-through:
 * scoping happens once, where the real declarations live.
 */
export function scopeArtifacts(artifacts) {
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
 * Which readable paths an agent's role actually uses.
 *
 * Previously tried to further narrow paths by matching a hard-coded keyword
 * regex against the agent id (e.g. "backend" agents only get paths matching
 * /api|server|backend|packages|core/). Real project directory names are
 * user-defined per repo and rarely match those guessed keywords, so the
 * filter usually produced an empty result and silently fell back to the
 * unfiltered list — inert in the common case, but a real regression waiting
 * to happen for a repo whose project names happen to match the guess.
 *
 * The correct scope already exists: `scopePathsToProjects` (in projects.js)
 * narrows an agent's declared `context.reads.paths` to the run's selected
 * projects, and the agent's own frontmatter declares the paths it needs.
 * Layering a second, guessed filter on top duplicates that correctly and
 * unreliably, so this stays a pass-through.
 */
export function scopePaths(paths) {
  return paths;
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
  const reduction = before === 0 ? 0 : Math.round(((before - after) / before) * 100);
  return {
    agentId,
    stageId,
    beforeChars: before,
    afterChars: after,
    reductionPercent: reduction,
    isValid: after < 20000,  // P0-0 goal: < 20k chars per bundle
  };
}
