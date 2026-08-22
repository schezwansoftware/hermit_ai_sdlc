/**
 * Harness compilation: the same canonical packs, two hosts.
 *
 * The property under test is that a harness changes the *format* and never the
 * *scope*. An agent entitled to three MCP tools under Copilot is entitled to
 * exactly those three under Claude Code, and an agent with no writable paths
 * gets no editing tools on either. A harness that quietly widens a role would
 * defeat the thing the whole pipeline is built on.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { layout, loadRegistry, effectiveMcpTools, DEFAULT_PIPELINE } from '@hermit/core';
import { compileAll, orphanedFiles } from '../packages/cli/src/compile/index.js';
import { HARNESSES, resolveHarnesses } from '../packages/cli/src/compile/harnesses.js';

const repo = path.dirname(fileURLToPath(import.meta.url)).replace(/\/scripts$/, '');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hermit-harness-'));
fs.mkdirSync(path.join(root, '.hermit'), { recursive: true });
for (const d of ['agents', 'skills', 'knowledge']) {
  fs.cpSync(path.join(repo, 'packages/agents', d), path.join(root, '.hermit', d), { recursive: true });
}
const registry = loadRegistry(layout(root));
const layoutInfo = { monorepo: false, projects: [] };
const build = (harnesses) => compileAll({ registry, config: {}, layoutInfo, harnesses });

// --- Resolution -------------------------------------------------------------

assert.deepEqual(resolveHarnesses({}), ['copilot'], 'copilot is the default');
assert.deepEqual(resolveHarnesses({ harness: 'claude' }), ['claude']);
assert.deepEqual(resolveHarnesses({ harness: ['copilot', 'claude'] }), ['copilot', 'claude']);
assert.deepEqual(resolveHarnesses({}, 'claude'), ['claude'], 'the flag overrides config');
assert.deepEqual(resolveHarnesses({ harness: 'claude' }, 'copilot,claude'), ['copilot', 'claude']);
assert.deepEqual(resolveHarnesses({}, ' Claude , copilot '), ['claude', 'copilot'], 'tolerant of spacing and case');
assert.deepEqual(resolveHarnesses({ harness: ['claude', 'claude'] }), ['claude'], 'deduplicated');
assert.throws(() => resolveHarnesses({}, 'bogus'), /Unknown harness: bogus/);
console.log('  ✓ harness resolution: default, flag override, lists, dedupe, unknown rejected');

// --- Each harness produces its own host's files, and only those --------------

const copilot = build(['copilot']);
const claude = build(['claude']);
const both = build(['copilot', 'claude']);
const paths = (files) => files.map((f) => f.path);

for (const [name, files, expected, forbidden] of [
  ['copilot', copilot, ['.github/copilot-instructions.md', '.vscode/mcp.json', '.copilot/mcp-config.json'], ['CLAUDE.md', '.mcp.json']],
  ['claude', claude, ['CLAUDE.md', '.mcp.json', '.claude/settings.json', '.hermit/hooks/guard-gate.mjs'], ['.github/copilot-instructions.md', '.vscode/mcp.json']]
]) {
  for (const p of expected) assert.ok(paths(files).includes(p), `${name} must emit ${p}`);
  for (const p of forbidden) assert.ok(!paths(files).includes(p), `${name} must not emit ${p}`);
}
console.log('  ✓ each harness emits only its own host\'s files');

// AGENTS.md is the portable baseline both hosts read. Emitted once, or two
// writers race for one path and the last one wins silently.
for (const [name, files] of [['copilot', copilot], ['claude', claude], ['both', both]]) {
  assert.equal(paths(files).filter((p) => p === 'AGENTS.md').length, 1, `${name}: AGENTS.md emitted exactly once`);
}
assert.equal(new Set(paths(both)).size, paths(both).length, 'enabling both harnesses must not collide on any path');
console.log('  ✓ AGENTS.md emitted once; enabling both collides on nothing');

// --- One agent file per agent, on both harnesses ----------------------------

for (const [name, files, dir, ext] of [
  ['copilot', copilot, '.github/agents/', '.agent.md'],
  ['claude', claude, '.claude/agents/', '.md']
]) {
  const agentFiles = paths(files).filter((p) => p.startsWith(dir));
  assert.equal(agentFiles.length, registry.agents.length, `${name}: one file per agent`);
  for (const a of registry.agents) {
    assert.ok(agentFiles.includes(`${dir}hermit-${a.id}${ext}`), `${name}: missing agent file for ${a.id}`);
  }
}
console.log(`  ✓ ${registry.agents.length} agent files on each harness`);

// --- Scope is identical across harnesses ------------------------------------

const body = (files, p) => files.find((f) => f.path === p).content;

for (const agent of registry.agents) {
  const declared = effectiveMcpTools(agent.context?.reads?.mcp ?? []);
  const text = body(claude, `.claude/agents/hermit-${agent.id}.md`);
  const toolsLine = /^tools:\s*(.+)$/m.exec(text)[1];
  const granted = toolsLine.split(',').map((t) => t.trim());

  // Every declared MCP tool is granted, addressed the way Claude Code expects.
  for (const tool of declared) {
    assert.ok(
      granted.some((g) => g.startsWith('mcp__') && g.endsWith(`__${tool}`)),
      `claude: agent ${agent.id} declares "${tool}" but it is not in its tools list`
    );
  }
  // And nothing beyond them: no mcp__ token that maps to an undeclared tool.
  for (const g of granted.filter((x) => x.startsWith('mcp__'))) {
    const tool = g.split('__').slice(2).join('__');
    assert.ok(declared.includes(tool), `claude: agent ${agent.id} granted undeclared MCP tool "${tool}"`);
  }

  // A role with no writable paths gets no way to write. This is the one place a
  // format translation could quietly widen a role, so it is asserted directly.
  const canWrite = (agent.context?.writes?.paths ?? []).length > 0;
  for (const t of ['Edit', 'Write', 'Bash']) {
    assert.equal(granted.includes(t), canWrite, `claude: agent ${agent.id} ${canWrite ? 'needs' : 'must not have'} ${t}`);
  }
}
console.log('  ✓ MCP scope matches each agent\'s declaration exactly; read-only roles get no write tools');

// --- Packs become real skills rather than being inlined ---------------------

const skillPaths = paths(claude).filter((p) => p.startsWith('.claude/skills/'));
assert.equal(
  skillPaths.length,
  registry.skills.length + registry.knowledge.length,
  'every skill and knowledge pack becomes a Claude Code skill'
);
for (const pack of [...registry.skills, ...registry.knowledge]) {
  const file = `.claude/skills/hermit-${pack.id}/SKILL.md`;
  assert.ok(skillPaths.includes(file), `missing skill for pack ${pack.id}`);
  const text = body(claude, file);
  assert.match(text, /^---\nname: hermit-/, `${pack.id}: skill needs name frontmatter`);
  assert.match(text, /^description: .+$/m, `${pack.id}: skill needs a description`);
}

// The point of real skills is that bodies are loaded on demand, not copied into
// every agent that references them.
const uiDev = body(claude, '.claude/agents/hermit-ui-developer.md');
const reactPack = registry.skillsById['frontend-react'];
assert.ok(!uiDev.includes(reactPack.body.slice(0, 200)), 'claude agent files must reference packs, not inline them');
assert.ok(uiDev.includes('hermit-frontend-react'), 'claude agent files must name the packs they use');

const copilotUiDev = body(copilot, '.github/agents/hermit-ui-developer.agent.md');
assert.ok(copilotUiDev.includes(reactPack.body.slice(0, 200)), 'copilot has no skills mechanism, so it still inlines');
console.log(`  ✓ ${skillPaths.length} packs compiled as loadable skills (copilot still inlines — it has no skills mechanism)`);

// --- The gate guard closes the one hole Bash leaves open --------------------

const hook = body(claude, '.hermit/hooks/guard-gate.mjs');
const hookFile = path.join(root, 'guard-gate.mjs');
fs.writeFileSync(hookFile, hook);

const { spawnSync } = await import('node:child_process');
const runHook = (command) =>
  spawnSync('node', [hookFile], { input: JSON.stringify({ tool_input: { command } }), encoding: 'utf8' });

for (const [command, blocked] of [
  ['npx hermit gate approve gate_architecture_7f3c', true],
  ['hermit gate approve g1', true],
  ['cd /somewhere && hermit gate reject g1 -m no', true],
  ['hermit gate changes g1 -m "fix it"', true],
  ['hermit gate list', false],
  ['npx hermit status', false],
  ['npm test', false]
]) {
  const r = runHook(command);
  assert.equal(r.status === 2, blocked, `hook should ${blocked ? 'block' : 'allow'}: ${command}`);
  if (blocked) assert.match(r.stderr, /only a human may decide a gate/);
}
console.log('  ✓ gate guard blocks approve/reject/changes from Bash, allows read-only gate commands');

// --- Switching harnesses reports what it stops owning -----------------------

const manifest = { files: Object.fromEntries(paths(both).map((p) => [p, 'x'])) };
const orphans = orphanedFiles(manifest, claude);
assert.ok(orphans.includes('.github/copilot-instructions.md'), 'dropping copilot must report its files');
assert.ok(orphans.includes('.vscode/mcp.json'));
assert.ok(!orphans.includes('AGENTS.md'), 'a file the remaining harness still owns is not orphaned');
assert.ok(!orphans.includes('CLAUDE.md'));
assert.deepEqual(orphanedFiles({ files: {} }, claude), [], 'a first install orphans nothing');
console.log(`  ✓ switching harness reports ${orphans.length} files it no longer maintains`);

fs.rmSync(root, { recursive: true, force: true });
console.log('\nHARNESS COMPILATION VERIFIED');
