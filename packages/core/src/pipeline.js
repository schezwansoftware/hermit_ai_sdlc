/**
 * The default Hermit SDLC pipeline.
 *
 * Stages are the unit of state; agents are the unit of capability. One agent may
 * own several stages (ux-designer owns the three fidelity stages), and one stage
 * may be revisited when a gate is rejected with `changes_requested`.
 *
 * Architecture precedes UX. The architect settles the user flow, the services
 * and the contracts between them; the designer then draws screens against a
 * ratified system rather than the architect reverse-engineering a system from
 * approved screens. Implementation follows the same direction — the interface
 * is built against the approved design first, then the services behind it.
 *
 * Project onboarding is deliberately *not* a stage. Mapping a codebase is
 * expensive and the answer barely changes between runs, so it is done once for
 * the repository (`hermit onboard`) and every run reads the result. A run
 * whose repository was never onboarded proceeds and names the missing inputs.
 *
 * Two stages are off unless a run asks for them. `tracker` writes epics and
 * stories into a real tracker and `security` changes dependency manifests —
 * both are outward-facing enough that running them by default would be a
 * surprise, and neither is needed by most changes.
 *
 * gate: 'hitl'      -> a human must approve via the CLI before the run advances
 * gate: 'auto'      -> advances as soon as exit criteria pass
 * gateWhen: <cond>  -> an 'auto' stage that becomes 'hitl' when the condition
 *                      holds for this run (see GATE_CONDITIONS in engine.js)
 * optIn: true       -> skipped unless the run explicitly turns it on
 * skippable: false  -> a prompt or flag may never stand this stage down
 */
export const DEFAULT_PIPELINE = {
  id: 'sdlc.default',
  version: '4.0.0',
  name: 'End-to-end SDLC',
  stages: [
    {
      id: 'requirements',
      title: 'Requirements analysis',
      agent: 'analyst',
      gate: 'hitl',
      skippable: false,
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
      id: 'architecture',
      title: 'Technical architecture',
      agent: 'architect',
      gate: 'hitl',
      skippable: false,
      inputs: ['requirements-spec', 'acceptance-criteria', 'codebase-map', 'project-context'],
      outputs: ['architecture-spec', 'adr', 'impact-analysis'],
      exitCriteria: [
        { id: 'arch-written', type: 'artifact_exists', artifact: 'architecture-spec' },
        { id: 'adr-written', type: 'artifact_exists', artifact: 'adr' },
        { id: 'components-mapped', type: 'contains', artifact: 'architecture-spec', value: '## Component Map' },
        // The design splits by side so each implementing agent has a section
        // addressed to it, rather than one blended document both must re-derive.
        { id: 'backend-design', type: 'contains', artifact: 'architecture-spec', value: '## Backend Design', when: { backend: true } },
        { id: 'frontend-design', type: 'contains', artifact: 'architecture-spec', value: '## Frontend Design', when: { ui: true } },
        // UX designs against this, so the flow has to be settled here first.
        { id: 'user-flow-defined', type: 'contains', artifact: 'architecture-spec', value: '## User Flow', when: { ui: true } },
        { id: 'risks-listed', type: 'contains', artifact: 'impact-analysis', value: '## Risks' },
        { id: 'cross-project-impact', type: 'contains', artifact: 'impact-analysis', value: '## Cross-Project Impact', when: { monorepo: true } }
      ]
    },
    {
      id: 'ux_lofi',
      title: 'UX — low fidelity',
      agent: 'ux-designer',
      gate: 'hitl',
      optional: true,
      skipWhen: 'no-ui',
      inputs: ['requirements-spec', 'acceptance-criteria', 'architecture-spec', 'project-context'],
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
      inputs: ['ux-lofi', 'requirements-spec', 'architecture-spec'],
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
      inputs: ['ux-midfi', 'requirements-spec', 'architecture-spec'],
      outputs: ['ux-hifi', 'design-tokens'],
      exitCriteria: [
        { id: 'hifi-written', type: 'artifact_exists', artifact: 'ux-hifi' },
        { id: 'a11y-covered', type: 'contains', artifact: 'ux-hifi', value: '## Accessibility' }
      ]
    },
    {
      id: 'planning',
      title: 'Work breakdown',
      agent: 'planner',
      gate: 'auto',
      // Becomes a human gate when the run also writes tracker items. Creating an
      // epic notifies a team, so it follows a human decision the way opening a
      // pull request follows delivery sign-off — the plan is what gets approved,
      // and `tracker` then executes against an approved plan rather than asking
      // for forgiveness afterwards.
      gateWhen: 'tracker',
      inputs: ['architecture-spec', 'acceptance-criteria', 'impact-analysis', 'ux-hifi'],
      outputs: ['work-plan'],
      exitCriteria: [
        { id: 'plan-written', type: 'artifact_exists', artifact: 'work-plan' },
        { id: 'tasks-enumerated', type: 'min_list_items', artifact: 'work-plan', section: '## Work Packages', min: 1 },
        { id: 'packages-attributed', type: 'contains', artifact: 'work-plan', value: '## Project Sequencing', when: { monorepo: true } }
      ]
    },
    {
      // Off unless the run asks for it. Most work already has a ticket; the runs
      // that need this are the ones that started as an idea rather than an issue.
      //
      // It executes rather than proposes — by the time it runs, a human has
      // approved the work plan it derives from (see `gateWhen` on planning), so
      // the epic and stories it opens carry a decision that was already made.
      id: 'tracker',
      title: 'Tracker items',
      agent: 'story-writer',
      gate: 'auto',
      optional: true,
      optIn: true,
      inputs: ['work-plan', 'acceptance-criteria', 'requirements-spec', 'architecture-spec', 'impact-analysis'],
      outputs: ['story-map'],
      exitCriteria: [
        { id: 'map-written', type: 'artifact_exists', artifact: 'story-map' },
        { id: 'hierarchy-listed', type: 'min_list_items', artifact: 'story-map', section: '## Hierarchy', min: 1 },
        { id: 'created-recorded', type: 'contains', artifact: 'story-map', value: '## Created' },
        { id: 'coverage-stated', type: 'contains', artifact: 'story-map', value: '## Work Package Coverage' }
      ]
    },
    {
      id: 'implementation_ui',
      title: 'Implementation — interface',
      agent: 'implementer',
      gate: 'auto',
      optional: true,
      skipWhen: 'no-ui',
      inputs: ['work-plan', 'architecture-spec', 'acceptance-criteria', 'ux-hifi', 'design-tokens'],
      outputs: ['change-set-ui'],
      exitCriteria: [
        { id: 'ui-changeset-written', type: 'artifact_exists', artifact: 'change-set-ui' },
        { id: 'ui-files-listed', type: 'contains', artifact: 'change-set-ui', value: '## Files Changed' },
        { id: 'ui-projects-touched', type: 'contains', artifact: 'change-set-ui', value: '## Projects Touched', when: { monorepo: true } }
      ]
    },
    {
      // Also the catch-all: it skips only when the run is purely interface work,
      // so infrastructure, libraries and anything unclassified still get built.
      id: 'implementation_backend',
      title: 'Implementation — services',
      agent: 'implementer',
      gate: 'auto',
      optional: true,
      skipWhen: 'ui-only',
      inputs: ['work-plan', 'architecture-spec', 'acceptance-criteria', 'change-set-ui'],
      outputs: ['change-set'],
      exitCriteria: [
        { id: 'changeset-written', type: 'artifact_exists', artifact: 'change-set' },
        { id: 'files-listed', type: 'contains', artifact: 'change-set', value: '## Files Changed' },
        { id: 'projects-touched', type: 'contains', artifact: 'change-set', value: '## Projects Touched', when: { monorepo: true } }
      ]
    },
    {
      // Off unless the run asks for it, and placed before review on purpose: a
      // dependency bump is a code change, so the reviewer should see it in the
      // same pass as everything else rather than after sign-off.
      //
      // Patch and minor bumps are applied. A fix that only exists in a major
      // version is not — it is counted in `**Major upgrades**`, and a non-zero
      // count turns this stage's gate into a human one.
      id: 'security',
      title: 'Dependency and vulnerability scan',
      agent: 'security',
      gate: 'auto',
      gateWhen: 'major-upgrades',
      optional: true,
      optIn: true,
      inputs: ['change-set', 'change-set-ui', 'architecture-spec', 'dependency-map', 'security-baseline', 'project-context'],
      outputs: ['cve-report'],
      exitCriteria: [
        { id: 'report-written', type: 'artifact_exists', artifact: 'cve-report' },
        { id: 'findings-listed', type: 'contains', artifact: 'cve-report', value: '## Findings' },
        { id: 'applied-listed', type: 'contains', artifact: 'cve-report', value: '## Applied' },
        { id: 'approval-listed', type: 'contains', artifact: 'cve-report', value: '## Needs Approval' },
        { id: 'residual-risk-stated', type: 'contains', artifact: 'cve-report', value: '## Residual Risk' },
        // The count the gate condition reads. Stated as a number so no one has to
        // infer "none" from an empty section.
        { id: 'major-count-stated', type: 'matches', artifact: 'cve-report', pattern: '\\*\\*Major upgrades\\*\\*:\\s*\\d+', flags: 'i' }
      ]
    },
    {
      id: 'review',
      title: 'Code review',
      agent: 'reviewer',
      gate: 'hitl',
      skippable: false,
      inputs: ['change-set', 'change-set-ui', 'architecture-spec', 'acceptance-criteria', 'work-plan'],
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
      inputs: ['change-set', 'change-set-ui', 'acceptance-criteria', 'review-report'],
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
      inputs: ['change-set', 'change-set-ui', 'requirements-spec', 'architecture-spec', 'adr', 'test-report', 'project-context'],
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
      skippable: false,
      inputs: ['change-set', 'change-set-ui', 'review-report', 'test-report', 'requirements-spec', 'docs-update'],
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
      inputs: ['release-notes', 'change-set', 'change-set-ui', 'review-report', 'test-report', 'docs-update'],
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
  'architecture-spec': { format: 'md', title: 'Architecture specification', producer: 'architect' },
  adr: { format: 'md', title: 'Architecture decision record', producer: 'architect' },
  'impact-analysis': { format: 'md', title: 'Impact analysis', producer: 'architect' },
  'ux-lofi': { format: 'md', title: 'Low-fidelity wireframes', producer: 'ux-designer' },
  'ux-midfi': { format: 'md', title: 'Mid-fidelity wireframes', producer: 'ux-designer' },
  'ux-hifi': { format: 'md', title: 'High-fidelity design spec', producer: 'ux-designer' },
  'design-tokens': { format: 'json', title: 'Design tokens', producer: 'ux-designer' },
  'work-plan': { format: 'md', title: 'Work plan', producer: 'planner' },
  'story-map': { format: 'md', title: 'Tracker item map', producer: 'story-writer' },
  'change-set-ui': { format: 'md', title: 'Change set summary — interface', producer: 'implementer' },
  'change-set': { format: 'md', title: 'Change set summary — services', producer: 'implementer' },
  'cve-report': { format: 'md', title: 'Vulnerability report', producer: 'security' },
  // Written once for the repository by `hermit security`, not per run.
  'dependency-map': { format: 'md', title: 'Dependency map', producer: 'security' },
  'security-baseline': { format: 'md', title: 'Security baseline', producer: 'security' },
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
