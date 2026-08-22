import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { PACK_ROOT } from '@hermit/agents';
import {
  layout, loadRegistry, ensureDir, readJson, writeJson,
  DEFAULT_PIPELINE, SERVERS, SCM_PROVIDERS, groupToolsByServer,
  createRun, loadRun, listRuns, requireActiveRun, setActiveRun, saveRun, readJournal,
  resolveProjects, detectProjects, hasUiProject,
  nextTask, runStatus, decideGate, getGate, openGates, readArtifact, listArtifacts
} from '@hermit/core';
import { compileAll, installPacks, writeFiles } from './compile/index.js';

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`
};
const log = (...a) => console.log(...a);

function paths(opts = {}) {
  return layout(opts.cwd ?? process.cwd());
}

function gitUser(cwd) {
  try {
    return execFileSync('git', ['config', 'user.name'], { cwd, encoding: 'utf8' }).trim() || null;
  } catch {
    return null;
  }
}

const DEFAULT_CONFIG = {
  $schema: 'https://hermit.dev/schema/config.json',
  version: 1,
  servers: ['hermit', 'jira', 'confluence', 'sharepoint', 'figma', 'scm'],
  scm: { provider: null, writes: true },
  jira: { writes: true },
  confluence: { writes: false },
  sharepoint: { writes: false },
  figma: { bridgePort: 8473 },
  documentation: { external: false }
};

// ---------------------------------------------------------------- init / sync

export function cmdInit(opts) {
  const p = paths(opts);
  const isNew = !fs.existsSync(p.hermit);
  ensureDir(p.hermit);

  if (!fs.existsSync(p.config)) writeJson(p.config, DEFAULT_CONFIG);
  const config = readJson(p.config, DEFAULT_CONFIG);

  // Record the repository layout once, so later runs are not re-detecting it and
  // so a team can correct a misclassification by editing config rather than code.
  if (!Array.isArray(config.projects) || !config.projects.length) {
    const detected = detectProjects(p.root);
    if (detected.projects.length > 1) {
      config.projects = detected.projects;
      config.monorepoTool = detected.tool;
      writeJson(p.config, config);
    }
  }
  const layoutInfo = resolveProjects(p.root, config);

  const packs = installPacks(PACK_ROOT, p.hermit, { force: opts.force });
  const registry = loadRegistry(p);
  const files = compileAll({ registry, config, layoutInfo });
  const result = writeFiles(p.root, files, { force: opts.force, manifestFile: p.manifestFile });

  ensureDir(p.runsDir);
  const gitignore = path.join(p.hermit, '.gitignore');
  if (!fs.existsSync(gitignore)) {
    fs.writeFileSync(gitignore, 'runs/\ncache/\n', 'utf8');
  }

  log('');
  log(c.bold(isNew ? 'Hermit installed' : 'Hermit updated'), c.dim(`in ${p.root}`));
  log('');
  log(`  ${c.green('✓')} ${registry.agents.length} agents, ${registry.skills.length} skills, ${registry.knowledge.length} knowledge packs`);
  if (layoutInfo.monorepo) {
    const kinds = layoutInfo.projects.reduce((acc, x) => ({ ...acc, [x.kind]: (acc[x.kind] ?? 0) + 1 }), {});
    log(`  ${c.green('✓')} monorepo detected${layoutInfo.tool ? ` (${layoutInfo.tool})` : ''}: ${layoutInfo.projects.length} projects — ${Object.entries(kinds).map(([k, n]) => `${n} ${k}`).join(', ')}`);
  }
  if (packs.copied.length) log(`  ${c.green('✓')} ${packs.copied.length} pack(s) installed into .hermit/`);
  if (packs.preserved.length) log(`  ${c.dim('·')} ${packs.preserved.length} existing pack(s) left untouched`);
  log(`  ${c.green('✓')} ${result.written.length} generated file(s) written`);
  if (result.unchanged.length) log(`  ${c.dim('·')} ${result.unchanged.length} already up to date`);
  if (result.skipped.length) {
    log('');
    log(`  ${c.yellow('!')} ${result.skipped.length} file(s) skipped — edited by hand since Hermit last wrote them:`);
    for (const f of result.skipped) log(`      ${f}`);
    log(`      ${c.dim('Run `hermit sync --force` to overwrite, or move your edits into .hermit/ where they survive.')}`);
  }
  log('');
  log(c.bold('Next:'));
  log(`  1. ${c.cyan('npx hermit doctor')}            check credentials and configuration`);
  log(`  2. Reload VS Code so it picks up ${c.dim('.vscode/mcp.json')}`);
  log(`  3. ${c.cyan('npx hermit start "your first task"')}`);
  log('');
  return result;
}

export function cmdSync(opts) {
  return cmdInit({ ...opts, quiet: true });
}

// ---------------------------------------------------------------- runs

export function cmdStart(intent, opts) {
  const p = paths(opts);
  requireInstalled(p);
  if (!intent) throw new Error('An intent is required: hermit start "preserve the cart when a session expires"');

  const flags = [];
  if (opts.noUi) flags.push('no-ui');

  const config = readJson(p.config, {});
  const { projects, monorepo } = resolveProjects(p.root, config);

  let selectedProjects = [];
  if (opts.project) {
    const wanted = String(opts.project).split(',').map((x) => x.trim()).filter(Boolean);
    const known = new Set(projects.map((x) => x.id));
    const unknown = wanted.filter((x) => !known.has(x));
    if (unknown.length) {
      throw new Error(
        `Unknown project(s): ${unknown.join(', ')}\n  Known: ${projects.map((x) => x.id).join(', ') || 'none detected'}\n  List them with: hermit projects`
      );
    }
    selectedProjects = wanted;
  } else if (monorepo) {
    selectedProjects = projects.map((x) => x.id);
  }

  const run = createRun(p, {
    title: opts.title ?? intent.slice(0, 80),
    intent,
    jiraKey: opts.jira ?? null,
    flags,
    projects,
    selectedProjects,
    registry: loadRegistry(p)
  });
  const status = runStatus({ paths: p, run });
  const stage = status.stages.find((s) => s.id === status.currentStage);

  log('');
  log(c.bold('Run started'), c.dim(run.id));
  log(`  Intent:  ${intent}`);
  if (opts.jira) log(`  Tracker: ${opts.jira}`);
  if (flags.length) log(`  Flags:   ${flags.join(', ')}`);
  if (monorepo) {
    log(`  Scope:   ${run.selectedProjects.join(', ')} ${c.dim(`(${projects.length} projects in repo)`)}`);
    if (!hasUiProject(projects, run.selectedProjects)) {
      log(`           ${c.dim('no UI project in scope — the three UX stages are skipped')}`);
    }
  }
  log('');
  log(`  First stage: ${c.cyan(stage.id)} — ${stage.title}, owned by ${c.bold(stage.agent)}`);
  log('');
  log(`  In Copilot, invoke ${c.cyan('@hermit-orchestrator')} and it will pick this up.`);
  log(`  Or drive it yourself: ${c.cyan('npx hermit next')}`);
  log('');
  return run;
}

export function cmdStatus(opts) {
  const p = paths(opts);
  requireInstalled(p);
  const run = opts.run ? loadRun(p, opts.run) : requireActiveRun(p);
  const s = runStatus({ paths: p, run });

  const mark = {
    done: c.green('✓'),
    skipped: c.dim('—'),
    in_progress: c.cyan('▶'),
    awaiting_gate: c.yellow('⏸'),
    changes_requested: c.red('↩'),
    pending: c.dim('·')
  };

  log('');
  log(c.bold(s.title), c.dim(s.id));
  log(c.dim(`  ${s.intent}`));
  if (s.jiraKey) log(c.dim(`  tracker: ${s.jiraKey}`));
  log('');
  // Sized to the longest name present. Both columns outgrew their old fixed
  // widths when implementation split in two, and a stale width raggeds the gate
  // column rather than truncating, so measure instead of guessing.
  const stageWidth = Math.max(...s.stages.map((st) => st.id.length));
  const agentWidth = Math.max(...s.stages.map((st) => st.agent.length));
  for (const [i, st] of s.stages.entries()) {
    const gate = st.gate === 'hitl' ? c.dim(' [human gate]') : '';
    const attempts = st.attempts > 1 ? c.dim(` ×${st.attempts}`) : '';
    log(`  ${mark[st.status] ?? '?'} ${String(i + 1).padStart(2)}. ${st.id.padEnd(stageWidth)} ${c.dim(st.agent.padEnd(agentWidth))}${gate}${attempts}`);
  }
  log('');
  log(`  Status: ${s.status === 'completed' ? c.green(s.status) : s.status === 'blocked' ? c.red(s.status) : s.status}   Artifacts: ${s.artifacts.length}`);

  if (s.openGates.length) {
    log('');
    for (const g of s.openGates) {
      log(`  ${c.yellow('⏸ AWAITING YOUR DECISION')} — ${g.stageTitle}`);
      log(`     Review: ${(g.reviewArtifacts ?? []).map((a) => `.hermit/runs/${s.id}/artifacts/${a}.md`).join('\n             ')}`);
      log(`     ${c.cyan(`hermit gate approve ${g.id}`)}`);
      log(`     ${c.dim(`hermit gate changes ${g.id} -m "what needs to change"`)}`);
    }
  }
  log('');
  return s;
}

export function cmdRuns(opts) {
  const p = paths(opts);
  const runs = listRuns(p);
  if (!runs.length) { log('\n  No runs yet. Start one: hermit start "<intent>"\n'); return []; }
  log('');
  for (const r of runs.slice(0, opts.limit ?? 20)) {
    const state = r.status === 'completed' ? c.green('completed') : r.status === 'blocked' ? c.red('blocked') : c.cyan(r.status);
    log(`  ${r.id}  ${state.padEnd(20)} ${r.currentStage ?? '—'}  ${c.dim(r.title)}`);
  }
  log('');
  return runs;
}

export function cmdNext(opts) {
  const p = paths(opts);
  requireInstalled(p);
  const run = requireActiveRun(p);
  const task = nextTask({ paths: p, run, registry: loadRegistry(p) });

  if (task.state === 'awaiting_gate') {
    log('');
    log(c.yellow('⏸ A human gate is open.'), 'No agent may proceed.');
    log(`  ${c.cyan(`hermit gate approve ${task.gate.id}`)}`);
    log('');
    return task;
  }
  if (task.state !== 'task') { log(`\n  ${task.message}\n`); return task; }

  if (opts.json) { log(JSON.stringify(task.bundle, null, 2)); return task; }
  log(task.rendered);
  return task;
}

// ---------------------------------------------------------------- gates

export function cmdGate(action, gateId, opts) {
  const p = paths(opts);
  requireInstalled(p);
  const run = opts.run ? loadRun(p, opts.run) : requireActiveRun(p);

  if (!action || action === 'list') {
    const open = openGates(run);
    if (!open.length) { log('\n  No gates awaiting a decision.\n'); return []; }
    log('');
    for (const g of open) {
      log(`  ${c.yellow(g.id)}  ${g.stageTitle}`);
      log(`     opened ${g.openedAt}`);
      log(`     review: ${(g.reviewArtifacts ?? []).join(', ')}`);
      for (const cr of g.criteria ?? []) log(`       ${cr.ok ? c.green('✓') : c.red('✗')} ${cr.id}`);
      log('');
    }
    return open;
  }

  const decision = { approve: 'approve', changes: 'changes_requested', reject: 'reject' }[action];
  if (!decision) throw new Error(`Unknown gate action "${action}". Use: list | approve | changes | reject`);

  const target = gateId ?? openGates(run)[0]?.id;
  if (!target) throw new Error('No open gate to decide.');
  const gate = getGate(run, target);
  if (!gate) throw new Error(`Gate "${target}" not found in run ${run.id}.`);

  if (decision !== 'approve' && !opts.message) {
    throw new Error(`"${action}" needs a reason so the agent knows what to fix: hermit gate ${action} ${target} -m "..."`);
  }

  const by = opts.by ?? gitUser(p.root) ?? process.env.USER ?? null;
  if (!by) throw new Error('Could not determine who is deciding. Pass --by "your name".');

  decideGate(p, run, target, decision, { decidedBy: by, comment: opts.message ?? null, source: 'cli' });
  saveRun(p, run);

  const after = runStatus({ paths: p, run: loadRun(p, run.id) });
  log('');
  if (decision === 'approve') {
    log(`  ${c.green('✓ Approved')} ${gate.stageTitle} ${c.dim(`by ${by}`)}`);
    if (after.currentStage) {
      const stage = after.stages.find((s) => s.id === after.currentStage);
      log(`  Next: ${c.cyan(stage.id)} — ${stage.title}, owned by ${c.bold(stage.agent)}`);
    } else {
      log(`  ${c.green('Run complete.')}`);
    }
  } else if (decision === 'changes_requested') {
    log(`  ${c.yellow('↩ Changes requested')} on ${gate.stageTitle} ${c.dim(`by ${by}`)}`);
    log(`  The stage returns to ${c.bold(gate.agent)} with your comment attached.`);
  } else {
    log(`  ${c.red('✗ Rejected')} ${gate.stageTitle} ${c.dim(`by ${by}`)}`);
    log(`  The run is blocked. Reopen with: hermit resume ${run.id}`);
  }
  log('');
  return gate;
}

export function cmdResume(runId, opts) {
  const p = paths(opts);
  const run = loadRun(p, runId ?? requireActiveRun(p).id);
  run.status = 'active';
  saveRun(p, run);
  setActiveRun(p, run.id);
  log(`\n  Run ${run.id} reopened.\n`);
  return run;
}

// ---------------------------------------------------------------- artifacts

export function cmdArtifacts(name, opts) {
  const p = paths(opts);
  const run = opts.run ? loadRun(p, opts.run) : requireActiveRun(p);
  if (!name) {
    const items = listArtifacts(p, run.id);
    log('');
    if (!items.length) log('  No artifacts yet.');
    for (const a of items) log(`  ${a}  ${c.dim(`.hermit/runs/${run.id}/artifacts/${a}`)}`);
    log('');
    return items;
  }
  const content = readArtifact(p, run.id, name);
  if (content === null) throw new Error(`Artifact "${name}" has not been produced in run ${run.id}.`);
  log(content);
  return content;
}

export function cmdJournal(opts) {
  const p = paths(opts);
  const run = opts.run ? loadRun(p, opts.run) : requireActiveRun(p);
  for (const e of readJournal(p, run.id).slice(-(opts.limit ?? 50))) {
    log(`${c.dim(e.at)}  ${e.event.padEnd(20)} ${JSON.stringify(Object.fromEntries(Object.entries(e).filter(([k]) => !['at', 'event'].includes(k))))}`);
  }
}

// ---------------------------------------------------------------- projects

export function cmdProjects(opts) {
  const p = paths(opts);
  const config = readJson(p.config, {});
  const { projects, monorepo, tool, source } = resolveProjects(p.root, config);

  if (!projects.length) {
    log('\n  Single-project repository — no sub-projects detected.');
    log(c.dim('  Declare them explicitly in .hermit/config.json under "projects" if detection missed something.\n'));
    return [];
  }

  log('');
  log(c.bold(monorepo ? 'Monorepo' : 'Single project'), c.dim(`${projects.length} project(s) · ${source}${tool ? ` · ${tool}` : ''}`));
  log('');
  log(c.dim('  ID                        PATH                      KIND       UI   STACK'));
  for (const x of projects) {
    log(`  ${x.id.padEnd(25)} ${(x.path + '/').padEnd(25)} ${x.kind.padEnd(10)} ${(x.ui ? c.cyan('yes') : c.dim(' — ')).padEnd(13)} ${c.dim((x.stack ?? []).join(', '))}`);
  }
  log('');
  log(c.dim(`  Target a subset:  hermit start "<intent>" --project ${projects.slice(0, 2).map((x) => x.id).join(',')}`));
  log(c.dim('  Correct a misclassification by editing "projects" in .hermit/config.json.'));
  log('');
  return projects;
}

// ---------------------------------------------------------------- doctor

export function cmdDoctor(opts) {
  const p = paths(opts);
  const problems = [];
  const warnings = [];
  log('');
  log(c.bold('Hermit doctor'), c.dim(p.root));
  log('');

  if (!fs.existsSync(p.hermit)) {
    log(`  ${c.red('✗')} .hermit/ not found. Run: npx hermit init`);
    return { ok: false };
  }
  log(`  ${c.green('✓')} workspace at ${p.root}`);

  const config = readJson(p.config, {});
  const registry = loadRegistry(p);
  const layoutInfo = resolveProjects(p.root, config);
  log(`  ${c.green('✓')} ${registry.agents.length} agents, ${registry.skills.length} skills, ${registry.knowledge.length} knowledge packs`);
  if (layoutInfo.monorepo) {
    const kinds = layoutInfo.projects.reduce((acc, x) => ({ ...acc, [x.kind]: (acc[x.kind] ?? 0) + 1 }), {});
    log(`  ${c.green('✓')} monorepo detected${layoutInfo.tool ? ` (${layoutInfo.tool})` : ''}: ${layoutInfo.projects.length} projects — ${Object.entries(kinds).map(([k, n]) => `${n} ${k}`).join(', ')}`);
  }

  // Pipeline integrity: every stage has an agent, every input is produced upstream.
  const produced = new Set();
  for (const s of DEFAULT_PIPELINE.stages) {
    const agent = registry.agentsById[s.agent];
    if (!agent) { problems.push(`stage "${s.id}" references missing agent "${s.agent}"`); continue; }
    if (!agent.stages.includes(s.id)) problems.push(`agent "${s.agent}" does not claim stage "${s.id}"`);
    for (const input of s.inputs ?? []) {
      if (!produced.has(input)) problems.push(`stage "${s.id}" consumes "${input}" before any stage produces it`);
      if (!(agent.context?.reads?.artifacts ?? []).includes(input)) {
        problems.push(`agent "${s.agent}" lacks read scope for its own stage input "${input}"`);
      }
    }
    for (const out of s.outputs ?? []) {
      if (!(agent.context?.writes?.artifacts ?? []).includes(out)) {
        problems.push(`agent "${s.agent}" lacks write scope for its own stage output "${out}"`);
      }
      produced.add(out);
    }
  }
  if (!problems.length) log(`  ${c.green('✓')} pipeline graph consistent (${DEFAULT_PIPELINE.stages.length} stages)`);

  // Specialists may read less than the stage offers — narrowing is the point of
  // role scoping — but one that cannot write the stage's outputs fails only at
  // handoff, hours into a run, which is exactly what doctor exists to prevent.
  const specialists = registry.agents.filter((a) => a.specializes);
  for (const agent of specialists) {
    const stage = DEFAULT_PIPELINE.stages.find((s) => s.id === agent.specializes.stage);
    if (!stage) {
      problems.push(`agent "${agent.id}" specialises in unknown stage "${agent.specializes.stage}"`);
      continue;
    }
    if (!agent.stages.includes(stage.id)) {
      problems.push(`specialist "${agent.id}" must also list "${stage.id}" under stages`);
    }
    for (const out of stage.outputs ?? []) {
      if (!(agent.context?.writes?.artifacts ?? []).includes(out)) {
        problems.push(`specialist "${agent.id}" lacks write scope for stage output "${out}"`);
      }
    }
  }
  if (specialists.length) {
    log(`  ${c.green('✓')} ${specialists.length} specialist agent(s): ${specialists.map((a) => `${a.id} → ${a.specializes.stage}`).join(', ')}`);
  }

  // Unknown MCP tools in agent declarations.
  for (const agent of registry.agents) {
    const { unknown } = groupToolsByServer(agent.context?.reads?.mcp ?? []);
    if (unknown.length) warnings.push(`agent "${agent.id}" declares unknown MCP tool(s): ${unknown.join(', ')}`);
  }

  // Monorepo layout.
  const { projects: declaredProjects, monorepo, tool: mrTool } = resolveProjects(p.root, config);
  if (declaredProjects.length) {
    const missingPaths = declaredProjects.filter((x) => !fs.existsSync(path.join(p.root, x.path)));
    for (const m of missingPaths) problems.push(`project "${m.id}" declares path "${m.path}" which does not exist`);
    const unclassified = declaredProjects.filter((x) => x.kind === 'unknown');
    for (const u of unclassified) {
      warnings.push(`project "${u.id}" could not be classified — set "kind" in .hermit/config.json so scoping and UX skipping work`);
    }
    if (!missingPaths.length) {
      log(`  ${c.green('✓')} ${monorepo ? 'monorepo' : 'single project'}: ${declaredProjects.length} project(s)${mrTool ? ` via ${mrTool}` : ''}`);
    }
  }

  // Credentials, per enabled server.
  const enabled = Array.isArray(config.servers) && config.servers.length ? config.servers : Object.keys(SERVERS);
  log('');
  log(c.bold('  Servers'));
  for (const id of enabled) {
    const def = SERVERS[id];
    if (!def) { warnings.push(`config enables unknown server "${id}"`); continue; }
    const missing = def.env.filter((e) => e.required && !process.env[e.name]);
    const installed = fs.existsSync(path.join(p.root, 'node_modules', def.package));
    const state = !installed ? c.yellow('not installed') : missing.length ? c.yellow(`needs ${missing.map((m) => m.name).join(', ')}`) : c.green('ready');
    log(`    ${id.padEnd(12)} ${state}`);
    for (const m of missing) warnings.push(`${id}: ${m.name} is not set — ${m.hint}`);
  }

  // SCM provider sanity.
  const provider = process.env.SCM_PROVIDER ?? config.scm?.provider;
  if (provider && !SCM_PROVIDERS.includes(provider)) {
    problems.push(`scm.provider "${provider}" is not one of: ${SCM_PROVIDERS.join(', ')}`);
  }
  if (!provider) warnings.push('scm.provider is not set — Hermit will infer it from the git remote at PR time');

  // Generated files still match what we wrote.
  const manifest = readJson(p.manifestFile, { files: {} });
  const drifted = Object.keys(manifest.files ?? {}).filter((f) => {
    const abs = path.join(p.root, f);
    if (!fs.existsSync(abs)) return true;
    return fileSha(abs) !== manifest.files[f];
  });
  if (drifted.length) {
    log('');
    log(`  ${c.yellow('!')} ${drifted.length} generated file(s) edited or missing:`);
    for (const f of drifted) log(`      ${f}`);
    log(`      ${c.dim('Edit .hermit/ instead — those changes survive `hermit sync`.')}`);
  }

  log('');
  if (problems.length) {
    log(c.bold(c.red(`  ${problems.length} problem(s)`)));
    for (const x of problems) log(`    ${c.red('✗')} ${x}`);
  }
  if (warnings.length) {
    log(c.bold(c.yellow(`  ${warnings.length} warning(s)`)));
    for (const x of warnings) log(`    ${c.yellow('!')} ${x}`);
  }
  if (!problems.length && !warnings.length) log(`  ${c.green('Everything checks out.')}`);
  log('');
  return { ok: problems.length === 0, problems, warnings };
}

function fileSha(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file, 'utf8')).digest('hex');
}

function requireInstalled(p) {
  if (!fs.existsSync(p.hermit)) {
    throw new Error(`Hermit is not installed in ${p.root}. Run: npx hermit init`);
  }
}
