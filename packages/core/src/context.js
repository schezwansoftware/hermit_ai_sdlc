import { readArtifact, readRunArtifact, artifactSpec } from './artifacts.js';
import { criterionApplies } from './criteria.js';
import { effectiveMcpTools } from './servers.js';
import { scopePathsToProjects } from './projects.js';
import { renderChecklistSection } from './exit-checklist.js';
import { scopeArtifacts, scopeKnowledge, scopeSkills, scopePaths, estimateTokens, scopingTelemetry } from './context-scoping.js';
import { scopeSnapshot, renderCodebaseSnapshot } from './codebase-snapshot.js';

const DEFAULT_BUDGET = 20_000; // characters of artifact text per bundle (P0-0: reduced from 120k)

/**
 * Share of the budget a stage's own prior drafts may take.
 *
 * Upstream inputs are filled first and are never displaced: a revision that
 * crowded out the specification it is being measured against would trade one
 * kind of blindness for another.
 */
const REVISION_BUDGET_RATIO = 0.4;

/**
 * Materialise the *only* context an agent is allowed to see for a stage.
 *
 * P0-0 Context Scoping: Delivers only what the agent's role needs, reducing bloat.
 *
 * Scoping is an intersection of three layers:
 *   1. the pipeline stage's `inputs` (what this step of the workflow needs)
 *   2. the agent's `context.reads.artifacts` (what this role is entitled to)
 *   3. the agent's role type (what context categories they actually use)
 *
 * A stage on its second or later attempt additionally gets back the artifacts
 * *it already produced in this run* (`priorOutputs`), still subject to the
 * agent's own read scope. This is not a widening: the agent wrote those
 * documents, and returning them is what makes a revision a revision rather
 * than a fresh reconstruction. On a first attempt the set is always empty, so
 * a normal run carries no extra context for it.
 */
export function buildContextBundle({ paths, run, stage, agent, registry, budget = DEFAULT_BUDGET }) {
  const stageInputs = stage.inputs ?? [];
  const agentReads = agent?.context?.reads?.artifacts ?? [];
  const allowed = stageInputs.filter((id) => agentReads.includes(id));
  const deniedByAgent = stageInputs.filter((id) => !agentReads.includes(id));

  // P0-0: Filter artifacts to what this agent's role actually needs
  const artifactList = allowed.map((id) => ({ id }));
  const scopedArtifactIds = scopeArtifacts(artifactList, agent?.id, stage).map((a) => a.id);

  const artifacts = [];
  const spend = { used: 0, truncated: false };

  for (const id of scopedArtifactIds) {
    const content = readArtifact(paths, run.id, id);
    if (content === null) continue;
    artifacts.push(clip(id, content, budget, spend));
  }

  const missing = allowed.filter((id) => !artifacts.some((a) => a.id === id));

  // A stage sent back for changes gets its own last draft returned to it.
  // Without this the agent rebuilds the artifact from the brief alone, and any
  // detail it decided last time that the brief does not carry — a resolved
  // ambiguity, a numbered decision — is silently lost and re-litigated.
  const attempt = run.stages?.[stage.id]?.attempts ?? 1;
  const priorOutputs = [];
  if (attempt > 1) {
    const alreadyBundled = new Set(artifacts.map((a) => a.id));
    const revisionCap = Math.min(budget, spend.used + Math.floor(budget * REVISION_BUDGET_RATIO));
    for (const id of priorOutputIds({ run, stage, agentReads, alreadyBundled })) {
      const content = readRunArtifact(paths, run.id, id);
      if (content === null) continue;
      priorOutputs.push(clip(id, content, revisionCap, spend));
    }
  }

  // Narrow declared path globs to the projects this run targets, so an agent
  // working on the API is not handed the whole monorepo.
  const projects = run.projects ?? [];
  const selected = run.selectedProjects ?? [];
  const inScope = projects.filter((p) => selected.includes(p.id));

  // P0-0: Scope knowledge and skills to what the agent needs
  const rawSkills = (agent?.skills ?? []).map((id) => registry.skillsById[id]).filter(Boolean).map(pick);
  const rawKnowledge = (agent?.knowledge ?? []).map((id) => registry.knowledgeById[id]).filter(Boolean).map(pick);
  const scopedSkills = scopeSkills(rawSkills, agent?.id);
  const scopedKnowledge = scopeKnowledge(rawKnowledge, stage);

  // P0-0: Scope paths to what this agent's role uses
  const readablePaths = scopePathsToProjects(agent?.context?.reads?.paths ?? [], projects, selected);
  const scopedReadable = scopePaths(readablePaths, agent?.id);
  const writablePaths = scopePathsToProjects(agent?.context?.writes?.paths ?? [], projects, selected);

  const bundle = {
    runId: run.id,
    monorepo: Boolean(run.monorepo),
    projects: inScope.map((p) => ({ id: p.id, path: p.path, kind: p.kind, stack: p.stack, ui: p.ui })),
    projectsOutOfScope: projects.filter((p) => !selected.includes(p.id)).map((p) => p.id),
    stage: { id: stage.id, title: stage.title, gate: stage.gate },
    intent: run.intent,
    jiraKey: run.jiraKey,
    flags: run.flags,
    attempt,
    artifacts,
    priorOutputs,
    missingInputs: missing,
    withheld: deniedByAgent,
    allowedMcpTools: effectiveMcpTools(agent?.context?.reads?.mcp ?? []),
    readablePaths: scopedReadable,
    writablePaths: writablePaths,
    skills: scopedSkills,
    knowledge: scopedKnowledge,
    budget: { limit: budget, used: spend.used, truncated: spend.truncated }
  };

  // P0-0: Log telemetry on scoping effectiveness (calculate actual content size, not JSON overhead)
  let beforeSize = 0;
  for (const id of allowed) {
    const content = readArtifact(paths, run.id, id);
    if (content) beforeSize += content.length;
  }
  beforeSize += rawKnowledge.reduce((sum, k) => sum + (k.body?.length ?? 0), 0);
  beforeSize += rawSkills.reduce((sum, s) => sum + (s.body?.length ?? 0), 0);

  let afterSize = artifacts.reduce((sum, a) => sum + (a.content?.length ?? 0), 0);
  afterSize += priorOutputs.reduce((sum, a) => sum + (a.content?.length ?? 0), 0);
  afterSize += scopedKnowledge.reduce((sum, k) => sum + (k.body?.length ?? 0), 0);
  afterSize += scopedSkills.reduce((sum, s) => sum + (s.body?.length ?? 0), 0);

  bundle._scopingTelemetry = scopingTelemetry({
    before: beforeSize,
    after: afterSize,
    agentId: agent?.id,
    stageId: stage?.id
  });

  // P0-1: Include codebase snapshot for agents that need it
  if (run.codebaseSnapshot) {
    bundle.codebaseSnapshot = scopeSnapshot(run.codebaseSnapshot, agent?.id);
  }

  return bundle;
}

/**
 * Which of this stage's outputs may be handed back as the agent's prior draft.
 *
 * Four conditions, each closing off a different way the wrong document could
 * arrive: the role must already be entitled to read it, it must not duplicate
 * something bundled as an input, **this run** must have produced it (a
 * recorded metadata entry, not merely a file on disk — which is what keeps a
 * shared onboarding or security-baseline document from posing as a draft), and
 * it must not be empty.
 */
function priorOutputIds({ run, stage, agentReads, alreadyBundled }) {
  return (stage.outputs ?? []).filter(
    (id) =>
      agentReads.includes(id) &&
      !alreadyBundled.has(id) &&
      ((run.artifacts?.[id]?.bytes ?? 0) > 0)
  );
}

/** Fit one artifact into the remaining allowance, recording what it spent. */
function clip(id, content, cap, spend) {
  const remaining = Math.max(0, cap - spend.used);
  const truncated = content.length > remaining;
  if (truncated) spend.truncated = true;
  const text = truncated
    ? content.slice(0, remaining) + '\n\n…[truncated by context budget]'
    : content;
  spend.used += text.length;
  return { id, title: artifactSpec(id).title, format: artifactSpec(id).format, truncated, content: text };
}

function renderArtifact(out, heading, a) {
  out.push(`### ${heading} — ${a.title}${a.truncated ? ' (truncated)' : ''}`);
  out.push('');
  out.push(a.format === 'json' ? '```json' : '```markdown');
  out.push(a.content.trimEnd());
  out.push('```');
  out.push('');
}

function pick(doc) {
  return { id: doc.id, name: doc.name, description: doc.description, body: doc.body };
}

/**
 * Derive the required output shape from the stage's exit criteria.
 *
 * Criteria that do not apply to this run are filtered out first, so the brief
 * never demands a section the handoff check will not ask for — an agent told to
 * write `## Frontend Design` for a run with no interface writes filler.
 */
export function outputContract(stage, context = {}) {
  const active = (stage.exitCriteria ?? []).filter((c) => criterionApplies(c, context));
  const outputs = (stage.outputs ?? []).map((id) => {
    const spec = artifactSpec(id);
    const criteria = active.filter((c) => c.artifact === id);
    const requiredSections = criteria
      .filter((c) => c.type === 'contains' && typeof c.value === 'string' && c.value.startsWith('#'))
      .map((c) => c.value);
    const required = criteria.some((c) => c.type === 'artifact_exists');
    return { id, title: spec.title, format: spec.format, required, requiredSections };
  });
  return { outputs, exitCriteria: active };
}

/** Render a bundle as the markdown an agent actually reads. */
export function renderBundle(bundle, { playbook, contract }) {
  const out = [];
  out.push(`# Hermit task — ${bundle.stage.title}`);
  out.push('');
  out.push(`- **Run**: \`${bundle.runId}\``);
  out.push(`- **Stage**: \`${bundle.stage.id}\` (gate: ${bundle.stage.gate})`);
  if (bundle.jiraKey) out.push(`- **Tracker**: ${bundle.jiraKey}`);
  out.push(`- **Intent**: ${bundle.intent}`);
  if (bundle.flags?.length) out.push(`- **Flags**: ${bundle.flags.join(', ')}`);
  if (bundle.monorepo) {
    out.push('');
    out.push('### Monorepo scope');
    out.push('');
    out.push('This repository holds several projects. **This run targets only these:**');
    out.push('');
    out.push('| Project | Path | Kind | Stack |');
    out.push('|---|---|---|---|');
    for (const p of bundle.projects) {
      out.push(`| \`${p.id}\` | \`${p.path}/\` | ${p.kind} | ${(p.stack ?? []).join(', ')} |`);
    }
    if (bundle.projectsOutOfScope?.length) {
      out.push('');
      out.push(`Out of scope: ${bundle.projectsOutOfScope.map((id) => `\`${id}\``).join(', ')}. Read them for context if your role permits, but do not change them. A change that spans into an out-of-scope project needs a human decision, not your judgement — raise it and stop.`);
    }
  }
  out.push('');
  out.push('## Your playbook');
  out.push('');
  out.push(playbook);
  out.push('');

  if (bundle.knowledge.length) {
    out.push('## Knowledge');
    for (const k of bundle.knowledge) out.push('', `### ${k.name}`, '', k.body);
    out.push('');
  }
  if (bundle.skills.length) {
    out.push('## Skills');
    for (const s of bundle.skills) out.push('', `### ${s.name}`, '', s.body);
    out.push('');
  }

  out.push('## Context you are permitted to use');
  out.push('');
  if (!bundle.artifacts.length) {
    out.push('_No upstream artifacts. Gather what you need through your allowed MCP tools and the repository._');
  }
  for (const a of bundle.artifacts) renderArtifact(out, `Artifact: ${a.id}`, a);
  if (bundle.missingInputs.length) {
    out.push(`> **Missing inputs**: ${bundle.missingInputs.join(', ')} — these were expected but have not been produced yet.`);
    out.push('');
  }
  if (bundle.withheld.length) {
    out.push(`> **Withheld**: ${bundle.withheld.join(', ')} — outside your role's read scope. Do not ask another agent to relay them.`);
    out.push('');
  }

  if (bundle.priorOutputs?.length) {
    out.push(`## What you submitted last time (attempt ${bundle.attempt - 1})`);
    out.push('');
    out.push('This is your own previous draft of this stage, returned to you because it was sent back for changes. **Revise it — do not rewrite it from memory.** Anything the feedback does not ask you to change should come back unchanged, and any decision you already recorded here stays recorded, with its original wording and numbering.');
    out.push('');
    out.push('If a section arrives truncated, say so rather than reconstructing what is missing.');
    out.push('');
    for (const a of bundle.priorOutputs) renderArtifact(out, `Your previous ${a.id}`, a);
  }

  out.push('## Tool scope');
  out.push('');
  out.push(`- **MCP tools allowed**: ${bundle.allowedMcpTools.length ? bundle.allowedMcpTools.join(', ') : 'none'}`);
  out.push(`- **Readable paths**: ${bundle.readablePaths.length ? bundle.readablePaths.join(', ') : 'repository default'}`);
  out.push(`- **Writable paths**: ${bundle.writablePaths.length ? bundle.writablePaths.join(', ') : 'none — you produce artifacts, not files'}`);
  out.push('');

  // P0-2: Render exit criteria as actionable checklist
  const checklistMarkdown = renderChecklistSection(contract.exitCriteria ?? []);
  if (checklistMarkdown) {
    out.push(checklistMarkdown);
  }

  out.push('## Required output');
  out.push('');
  for (const o of contract.outputs) {
    out.push(`- \`${o.id}\` (${o.format}) — ${o.title}${o.required ? ' **[required]**' : ' _[optional]_'}`);
    for (const s of o.requiredSections) out.push(`  - must contain heading: \`${s}\``);
  }
  out.push('');
  out.push('Submit each with `hermit_submit_artifact`, then call `hermit_request_handoff`.');
  out.push('Exit criteria are checked mechanically; a failing check blocks the handoff and tells you what is missing.');
  return out.join('\n');
}
