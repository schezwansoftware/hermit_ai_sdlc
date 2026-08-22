import { readArtifact } from './artifacts.js';
import { artifactSpec } from './artifacts.js';
import { criterionApplies } from './criteria.js';
import { effectiveMcpTools } from './servers.js';
import { scopePathsToProjects } from './projects.js';

const DEFAULT_BUDGET = 120_000; // characters of artifact text per bundle

/**
 * Materialise the *only* context an agent is allowed to see for a stage.
 *
 * Scoping is an intersection of two independent declarations:
 *   1. the pipeline stage's `inputs`  (what this step of the workflow needs)
 *   2. the agent's `context.reads.artifacts` (what this role is entitled to)
 *
 * An artifact must appear in both to be included. That way neither a pipeline
 * edit nor an agent edit alone can widen a role's blast radius.
 */
export function buildContextBundle({ paths, run, stage, agent, registry, budget = DEFAULT_BUDGET }) {
  const stageInputs = stage.inputs ?? [];
  const agentReads = agent?.context?.reads?.artifacts ?? [];
  const allowed = stageInputs.filter((id) => agentReads.includes(id));
  const deniedByAgent = stageInputs.filter((id) => !agentReads.includes(id));

  const artifacts = [];
  let spent = 0;
  let truncated = false;

  for (const id of allowed) {
    const content = readArtifact(paths, run.id, id);
    if (content === null) continue;
    const remaining = budget - spent;
    const clipped = content.length > remaining;
    if (clipped) truncated = true;
    const text = clipped ? content.slice(0, Math.max(0, remaining)) + '\n\n…[truncated by context budget]' : content;
    spent += text.length;
    artifacts.push({
      id,
      title: artifactSpec(id).title,
      format: artifactSpec(id).format,
      truncated: clipped,
      content: text
    });
  }

  const missing = allowed.filter((id) => !artifacts.some((a) => a.id === id));

  // Narrow declared path globs to the projects this run targets, so an agent
  // working on the API is not handed the whole monorepo.
  const projects = run.projects ?? [];
  const selected = run.selectedProjects ?? [];
  const inScope = projects.filter((p) => selected.includes(p.id));

  return {
    runId: run.id,
    monorepo: Boolean(run.monorepo),
    projects: inScope.map((p) => ({ id: p.id, path: p.path, kind: p.kind, stack: p.stack, ui: p.ui })),
    projectsOutOfScope: projects.filter((p) => !selected.includes(p.id)).map((p) => p.id),
    stage: { id: stage.id, title: stage.title, gate: stage.gate },
    intent: run.intent,
    jiraKey: run.jiraKey,
    flags: run.flags,
    artifacts,
    missingInputs: missing,
    withheld: deniedByAgent,
    allowedMcpTools: effectiveMcpTools(agent?.context?.reads?.mcp ?? []),
    readablePaths: scopePathsToProjects(agent?.context?.reads?.paths ?? [], projects, selected),
    writablePaths: scopePathsToProjects(agent?.context?.writes?.paths ?? [], projects, selected),
    skills: (agent?.skills ?? []).map((id) => registry.skillsById[id]).filter(Boolean).map(pick),
    knowledge: (agent?.knowledge ?? []).map((id) => registry.knowledgeById[id]).filter(Boolean).map(pick),
    budget: { limit: budget, used: spent, truncated }
  };
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
  for (const a of bundle.artifacts) {
    out.push(`### Artifact: ${a.id} — ${a.title}${a.truncated ? ' (truncated)' : ''}`);
    out.push('');
    out.push(a.format === 'json' ? '```json' : '```markdown');
    out.push(a.content.trimEnd());
    out.push('```');
    out.push('');
  }
  if (bundle.missingInputs.length) {
    out.push(`> **Missing inputs**: ${bundle.missingInputs.join(', ')} — these were expected but have not been produced yet.`);
    out.push('');
  }
  if (bundle.withheld.length) {
    out.push(`> **Withheld**: ${bundle.withheld.join(', ')} — outside your role's read scope. Do not ask another agent to relay them.`);
    out.push('');
  }

  out.push('## Tool scope');
  out.push('');
  out.push(`- **MCP tools allowed**: ${bundle.allowedMcpTools.length ? bundle.allowedMcpTools.join(', ') : 'none'}`);
  out.push(`- **Readable paths**: ${bundle.readablePaths.length ? bundle.readablePaths.join(', ') : 'repository default'}`);
  out.push(`- **Writable paths**: ${bundle.writablePaths.length ? bundle.writablePaths.join(', ') : 'none — you produce artifacts, not files'}`);
  out.push('');

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
