/**
 * The default Hermit SDLC pipeline.
 *
 * Stages are the unit of state; agents are the unit of capability. One agent may
 * own several stages (ux-designer owns the three fidelity stages), and one stage
 * may be revisited when a gate is rejected with `changes_requested`.
 *
 * gate: 'hitl'  -> a human must approve via the CLI before the run advances
 * gate: 'auto'  -> advances as soon as exit criteria pass
 */
export const DEFAULT_PIPELINE = {
  id: 'sdlc.default',
  version: '1.0.0',
  name: 'End-to-end SDLC',
  stages: [
    {
      id: 'onboard',
      title: 'Project onboarding',
      agent: 'onboarding',
      gate: 'auto',
      optional: false,
      once: true,
      inputs: [],
      outputs: ['project-context', 'codebase-map', 'glossary'],
      exitCriteria: [
        { id: 'context-written', type: 'artifact_exists', artifact: 'project-context' },
        { id: 'map-written', type: 'artifact_exists', artifact: 'codebase-map' },
        { id: 'stack-identified', type: 'contains', artifact: 'project-context', value: '## Tech Stack' }
      ]
    },
    {
      id: 'requirements',
      title: 'Requirements analysis',
      agent: 'analyst',
      gate: 'hitl',
      inputs: ['project-context', 'glossary'],
      outputs: ['requirements-spec', 'acceptance-criteria'],
      exitCriteria: [
        { id: 'spec-written', type: 'artifact_exists', artifact: 'requirements-spec' },
        { id: 'ac-written', type: 'artifact_exists', artifact: 'acceptance-criteria' },
        { id: 'ac-testable', type: 'matches', artifact: 'acceptance-criteria', pattern: 'Given\\b[\\s\\S]{1,600}?When\\b[\\s\\S]{1,600}?Then\\b', flags: 'i' },
        { id: 'no-open-questions', type: 'not_contains', artifact: 'requirements-spec', value: 'TBD' }
      ]
    },
    {
      id: 'ux_lofi',
      title: 'UX — low fidelity',
      agent: 'ux-designer',
      gate: 'hitl',
      optional: true,
      skipWhen: 'no-ui',
      inputs: ['requirements-spec', 'acceptance-criteria', 'project-context'],
      outputs: ['ux-lofi'],
      exitCriteria: [
        { id: 'lofi-written', type: 'artifact_exists', artifact: 'ux-lofi' },
        { id: 'flows-listed', type: 'contains', artifact: 'ux-lofi', value: '## User Flows' }
      ]
    },
    {
      id: 'ux_midfi',
      title: 'UX — mid fidelity',
      agent: 'ux-designer',
      gate: 'hitl',
      optional: true,
      skipWhen: 'no-ui',
      inputs: ['ux-lofi', 'requirements-spec'],
      outputs: ['ux-midfi'],
      exitCriteria: [
        { id: 'midfi-written', type: 'artifact_exists', artifact: 'ux-midfi' },
        { id: 'states-covered', type: 'contains', artifact: 'ux-midfi', value: '## States' }
      ]
    },
    {
      id: 'ux_hifi',
      title: 'UX — high fidelity',
      agent: 'ux-designer',
      gate: 'hitl',
      optional: true,
      skipWhen: 'no-ui',
      inputs: ['ux-midfi', 'requirements-spec'],
      outputs: ['ux-hifi', 'design-tokens'],
      exitCriteria: [
        { id: 'hifi-written', type: 'artifact_exists', artifact: 'ux-hifi' },
        { id: 'a11y-covered', type: 'contains', artifact: 'ux-hifi', value: '## Accessibility' }
      ]
    },
    {
      id: 'architecture',
      title: 'Technical architecture',
      agent: 'architect',
      gate: 'hitl',
      inputs: ['requirements-spec', 'acceptance-criteria', 'codebase-map', 'ux-hifi'],
      outputs: ['architecture-spec', 'adr', 'impact-analysis'],
      exitCriteria: [
        { id: 'arch-written', type: 'artifact_exists', artifact: 'architecture-spec' },
        { id: 'adr-written', type: 'artifact_exists', artifact: 'adr' },
        { id: 'components-mapped', type: 'contains', artifact: 'architecture-spec', value: '## Component Map' },
        { id: 'risks-listed', type: 'contains', artifact: 'impact-analysis', value: '## Risks' }
      ]
    },
    {
      id: 'planning',
      title: 'Work breakdown',
      agent: 'planner',
      gate: 'auto',
      inputs: ['architecture-spec', 'acceptance-criteria', 'impact-analysis'],
      outputs: ['work-plan'],
      exitCriteria: [
        { id: 'plan-written', type: 'artifact_exists', artifact: 'work-plan' },
        { id: 'tasks-enumerated', type: 'min_list_items', artifact: 'work-plan', section: '## Work Packages', min: 1 }
      ]
    },
    {
      id: 'implementation',
      title: 'Implementation',
      agent: 'implementer',
      gate: 'auto',
      inputs: ['work-plan', 'architecture-spec', 'acceptance-criteria', 'ux-hifi'],
      outputs: ['change-set'],
      exitCriteria: [
        { id: 'changeset-written', type: 'artifact_exists', artifact: 'change-set' },
        { id: 'files-listed', type: 'contains', artifact: 'change-set', value: '## Files Changed' }
      ]
    },
    {
      id: 'review',
      title: 'Code review',
      agent: 'reviewer',
      gate: 'hitl',
      inputs: ['change-set', 'architecture-spec', 'acceptance-criteria', 'work-plan'],
      outputs: ['review-report'],
      exitCriteria: [
        { id: 'review-written', type: 'artifact_exists', artifact: 'review-report' },
        { id: 'verdict-present', type: 'matches', artifact: 'review-report', pattern: '^\\s*-?\\s*\\*\\*Verdict\\*\\*:\\s*(approve|changes_requested|reject)', flags: 'im' }
      ]
    },
    {
      id: 'qa',
      title: 'QA and verification',
      agent: 'qa',
      gate: 'auto',
      inputs: ['change-set', 'acceptance-criteria', 'review-report'],
      outputs: ['test-plan', 'test-report'],
      exitCriteria: [
        { id: 'plan-written', type: 'artifact_exists', artifact: 'test-plan' },
        { id: 'report-written', type: 'artifact_exists', artifact: 'test-report' },
        { id: 'suite-green', type: 'matches', artifact: 'test-report', pattern: '\\*\\*Result\\*\\*:\\s*pass', flags: 'i' }
      ]
    },
    {
      id: 'documentation',
      title: 'Documentation update',
      agent: 'documenter',
      gate: 'auto',
      inputs: ['change-set', 'requirements-spec', 'architecture-spec', 'adr', 'test-report', 'project-context'],
      outputs: ['docs-update'],
      exitCriteria: [
        { id: 'docs-written', type: 'artifact_exists', artifact: 'docs-update' },
        { id: 'files-listed', type: 'contains', artifact: 'docs-update', value: '## Files Updated' },
        { id: 'staleness-audited', type: 'contains', artifact: 'docs-update', value: '## Staleness Audit' }
      ]
    },
    {
      id: 'delivery',
      title: 'Delivery sign-off',
      agent: 'orchestrator',
      gate: 'hitl',
      inputs: ['change-set', 'review-report', 'test-report', 'requirements-spec', 'docs-update'],
      outputs: ['release-notes'],
      exitCriteria: [
        { id: 'notes-written', type: 'artifact_exists', artifact: 'release-notes' },
        { id: 'rollback-stated', type: 'contains', artifact: 'release-notes', value: '## Risk & rollback' }
      ]
    },
    {
      id: 'pull_request',
      title: 'Pull request',
      agent: 'orchestrator',
      gate: 'auto',
      inputs: ['release-notes', 'change-set', 'review-report', 'test-report', 'docs-update'],
      outputs: ['pull-request'],
      exitCriteria: [
        { id: 'pr-written', type: 'artifact_exists', artifact: 'pull-request' },
        { id: 'pr-url-present', type: 'matches', artifact: 'pull-request', pattern: '\\*\\*URL\\*\\*:\\s*https?://', flags: 'i' }
      ]
    }
  ]
};

/** Artifact catalogue: id -> how it is stored and what it means. */
export const ARTIFACTS = {
  'project-context': { format: 'md', title: 'Project context', producer: 'onboarding' },
  'codebase-map': { format: 'md', title: 'Codebase map', producer: 'onboarding' },
  glossary: { format: 'md', title: 'Domain glossary', producer: 'onboarding' },
  'requirements-spec': { format: 'md', title: 'Requirements specification', producer: 'analyst' },
  'acceptance-criteria': { format: 'md', title: 'Acceptance criteria', producer: 'analyst' },
  'ux-lofi': { format: 'md', title: 'Low-fidelity wireframes', producer: 'ux-designer' },
  'ux-midfi': { format: 'md', title: 'Mid-fidelity wireframes', producer: 'ux-designer' },
  'ux-hifi': { format: 'md', title: 'High-fidelity design spec', producer: 'ux-designer' },
  'design-tokens': { format: 'json', title: 'Design tokens', producer: 'ux-designer' },
  'architecture-spec': { format: 'md', title: 'Architecture specification', producer: 'architect' },
  adr: { format: 'md', title: 'Architecture decision record', producer: 'architect' },
  'impact-analysis': { format: 'md', title: 'Impact analysis', producer: 'architect' },
  'work-plan': { format: 'md', title: 'Work plan', producer: 'planner' },
  'change-set': { format: 'md', title: 'Change set summary', producer: 'implementer' },
  'review-report': { format: 'md', title: 'Code review report', producer: 'reviewer' },
  'test-plan': { format: 'md', title: 'Test plan', producer: 'qa' },
  'test-report': { format: 'md', title: 'Test report', producer: 'qa' },
  'docs-update': { format: 'md', title: 'Documentation update report', producer: 'documenter' },
  'release-notes': { format: 'md', title: 'Release notes', producer: 'orchestrator' },
  'pull-request': { format: 'md', title: 'Pull request record', producer: 'orchestrator' }
};

export function getStage(pipeline, stageId) {
  return pipeline.stages.find((s) => s.id === stageId) ?? null;
}

export function stageIndex(pipeline, stageId) {
  return pipeline.stages.findIndex((s) => s.id === stageId);
}
