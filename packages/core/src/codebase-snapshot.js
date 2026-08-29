/**
 * P0-1: Codebase Snapshot Service
 *
 * Analyzes the codebase to create a reference snapshot: components, patterns, and
 * conventions. Agents use this to understand the codebase structure without having
 * to search blindly through 100k+ lines of code.
 *
 * Snapshot is generated once at onboarding and cached, then delivered to relevant
 * agents (UI, backend, architecture).
 */

/**
 * Metadata about a discovered code component.
 *
 * Can be a React component, a utility function, a design pattern, or a convention.
 */
export class CodeComponent {
  constructor({ name, type, path, description, usage = null, relatedTo = [] }) {
    this.name = name;
    this.type = type; // 'component', 'util', 'pattern', 'convention'
    this.path = path;
    this.description = description;
    this.usage = usage; // example usage snippet
    this.relatedTo = relatedTo; // names of related components
  }
}

/**
 * Generate a snapshot of the codebase for agent reference.
 *
 * In a real implementation, this would scan the filesystem and analyze code.
 * For now, this returns a template structure that can be populated by
 * the onboarding process.
 */
export function generateCodebaseSnapshot(paths, manifest = {}) {
  return {
    generatedAt: new Date().toISOString(),
    codebaseId: manifest.id ?? 'unknown',
    sections: {
      components: { title: 'Components', items: [] },
      patterns: { title: 'Patterns & Conventions', items: [] },
      utilities: { title: 'Utilities & Helpers', items: [] },
      stack: { title: 'Technology Stack', items: [] }
    }
  };
}

/**
 * Render a codebase snapshot as markdown for inclusion in agent brief.
 *
 * Creates a scannable reference guide grouped by category, with examples
 * and links to relevant paths.
 */
export function renderCodebaseSnapshot(snapshot) {
  if (!snapshot || !snapshot.sections) {
    return '';
  }

  const out = [];
  out.push('## Codebase Reference');
  out.push('');
  out.push(
    '_This is a snapshot of key components, patterns, and conventions in the codebase._'
  );
  out.push('_Generated: ' + new Date(snapshot.generatedAt).toLocaleDateString() + '_');
  out.push('');

  for (const [key, section] of Object.entries(snapshot.sections)) {
    if (!section.items?.length) continue;

    out.push(`### ${section.title}`);
    out.push('');

    for (const item of section.items) {
      if (typeof item === 'string') {
        out.push(`- \`${item}\``);
      } else {
        out.push(`- **${item.name}** (\`${item.path}\`)`);
        if (item.description) {
          out.push(`  - ${item.description}`);
        }
        if (item.usage) {
          out.push(`  - Example: \`${item.usage}\``);
        }
      }
    }
    out.push('');
  }

  return out.join('\n');
}

/**
 * Determine which snapshots an agent needs based on their role.
 *
 * UI developers get component snapshots. Backend devs get utility/pattern snapshots.
 * Architecture roles get the full snapshot.
 */
export function snapshotScopeForAgent(agentId) {
  const agent = (agentId ?? '').toLowerCase();

  if (agent.includes('ui') || agent.includes('design') || agent.includes('frontend')) {
    return ['components', 'patterns'];
  }
  if (agent.includes('backend') || agent.includes('api')) {
    return ['utilities', 'patterns', 'stack'];
  }
  if (agent.includes('architect') || agent.includes('planning')) {
    return ['components', 'utilities', 'patterns', 'stack'];
  }

  return [];
}

/**
 * Filter snapshot to only sections the agent needs.
 */
export function scopeSnapshot(snapshot, agentId) {
  const needed = snapshotScopeForAgent(agentId);
  if (!needed.length) return null;

  const scoped = {
    ...snapshot,
    sections: {}
  };

  for (const key of needed) {
    if (snapshot.sections[key]) {
      scoped.sections[key] = snapshot.sections[key];
    }
  }

  return scoped;
}

/**
 * Telemetry on snapshot usefulness.
 *
 * Tracks whether agents reference the snapshot and find it helpful.
 * Used to improve snapshot generation over time.
 */
export function snapshotTelemetry({ agentId, sections, foundUseful = null }) {
  return {
    agentId,
    sectionsProvided: Object.keys(sections || {}).length,
    foundUseful,
    generatedAt: new Date().toISOString()
  };
}
