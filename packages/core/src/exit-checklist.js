/**
 * P0-2: Exit Criteria Checklist
 *
 * Transforms abstract exit criteria into an actionable checklist for agents.
 * Agents need to know exactly what "done" means before they request handoff.
 */

/**
 * Generate a human-readable checklist from exit criteria.
 *
 * Converts mechanical criteria (artifact_exists, contains, etc.) into
 * plain English that agents understand immediately.
 */
export function generateChecklist(criteria = []) {
  const items = criteria.map((c) => criterionToChecklistItem(c));
  return items.filter(Boolean);
}

function criterionToChecklistItem(criterion) {
  const { id, type, artifact, value, pattern, section, min, flags } = criterion;

  switch (type) {
    case 'artifact_exists':
      return {
        id,
        text: `Submit artifact: \`${artifact}\``,
        category: 'artifact',
        required: true
      };

    case 'contains':
      if (value.startsWith('#')) {
        return {
          id,
          text: `\`${artifact}\` must include section: ${value}`,
          category: 'content',
          required: true
        };
      }
      return {
        id,
        text: `\`${artifact}\` must include: "${value}"`,
        category: 'content',
        required: true
      };

    case 'not_contains':
      return {
        id,
        text: `Remove placeholder from \`${artifact}\`: "${value}"`,
        category: 'content',
        required: true
      };

    case 'matches':
      return {
        id,
        text: `\`${artifact}\` must match pattern: \`/${pattern}/${flags || ''}\``,
        category: 'content',
        required: true
      };

    case 'min_list_items':
      return {
        id,
        text: `\`${artifact}\` section "${section}" needs ≥ ${min} items`,
        category: 'content',
        required: true
      };

    default:
      return null;
  }
}

/**
 * Render checklist for inclusion in stage brief.
 *
 * Grouped by category (artifact, content, etc.) for scannability.
 */
export function renderChecklistSection(criteria = []) {
  const checklist = generateChecklist(criteria);
  if (!checklist.length) {
    return '';
  }

  const grouped = {};
  for (const item of checklist) {
    const cat = item.category || 'other';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(item);
  }

  const out = [];
  out.push('## Before you request handoff, verify:');
  out.push('');

  // Artifacts first
  if (grouped.artifact?.length) {
    out.push('### Artifacts to submit:');
    for (const item of grouped.artifact) {
      out.push(`- [ ] ${item.text}`);
    }
    out.push('');
  }

  // Content requirements
  if (grouped.content?.length) {
    out.push('### Content requirements:');
    for (const item of grouped.content) {
      out.push(`- [ ] ${item.text}`);
    }
    out.push('');
  }

  // Other
  if (grouped.other?.length) {
    out.push('### Other criteria:');
    for (const item of grouped.other) {
      out.push(`- [ ] ${item.text}`);
    }
    out.push('');
  }

  return out.join('\n');
}

/**
 * Validate that an agent can actually complete the criteria.
 *
 * Warns if criteria reference artifacts the agent isn't entitled to write,
 * or stages that don't produce those artifacts.
 */
export function validateChecklistCompleteness(stage, agent) {
  const issues = [];
  const stageOutputs = new Set(stage.outputs ?? []);
  const agentWrites = new Set(agent?.context?.writes?.artifacts ?? []);

  for (const criterion of stage.exitCriteria ?? []) {
    if (!criterion.artifact) continue;

    // Warn if artifact isn't produced by this stage
    if (!stageOutputs.has(criterion.artifact)) {
      issues.push({
        severity: 'error',
        message: `Exit criterion references "${criterion.artifact}" but stage doesn't produce it`
      });
    }

    // Warn if agent can't write it
    if (!agentWrites.has(criterion.artifact)) {
      issues.push({
        severity: 'error',
        message: `Agent "${agent?.id}" can't write "${criterion.artifact}" (outside write scope)`
      });
    }
  }

  return { valid: issues.length === 0, issues };
}

/**
 * Telemetry on checklist usage.
 *
 * Tracks whether explicit checklists reduce gate rejections.
 */
export function checklistTelemetry(stage, results) {
  const total = results.length;
  const failed = results.filter((r) => !r.ok).length;
  const passed = total - failed;

  return {
    stageId: stage?.id,
    totalCriteria: total,
    passedCriteria: passed,
    failedCriteria: failed,
    passRate: total > 0 ? Math.round((passed / total) * 100) : 100
  };
}
