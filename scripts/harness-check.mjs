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
import { layout, loadRegistry, effectiveMcpTools, readJson, DEFAULT_PIPELINE } from '@hermit/core';
import { compileAll, orphanedFiles, pruneOrphans } from '../packages/cli/src/compile/index.js';
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
const body = (files, p) => files.find((f) => f.path === p).content;

for (const [name, files, expected, forbidden] of [
  ['copilot', copilot,
   ['.github/copilot-instructions.md', '.vscode/mcp.json', '.copilot/mcp-config.json', 'AGENTS.md'],
   ['CLAUDE.md', '.mcp.json', '.claude/settings.json']],
  ['claude', claude,
   ['CLAUDE.md', '.mcp.json', '.claude/settings.json', '.hermit/hooks/guard-gate.mjs'],
   ['.github/copilot-instructions.md', '.vscode/mcp.json', '.copilot/mcp-config.json', 'AGENTS.md']]
]) {
  for (const p of expected) assert.ok(paths(files).includes(p), `${name} must emit ${p}`);
  for (const p of forbidden) assert.ok(!paths(files).includes(p), `${name} must not emit ${p}`);
}
console.log('  ✓ each harness emits only its own host\'s files');

// Nothing is shared between harnesses, so a workspace never holds config for a
// host it did not enable. AGENTS.md belongs to Copilot; Claude Code has CLAUDE.md
// and a second always-on file would just duplicate it on every turn.
assert.equal(paths(both).filter((p) => p === 'AGENTS.md').length, 1, 'AGENTS.md emitted exactly once with both on');
assert.equal(new Set(paths(both)).size, paths(both).length, 'enabling both harnesses must not collide on any path');

const shared = paths(copilot).filter((p) => paths(claude).includes(p));
assert.deepEqual(shared, [], `no file may belong to both harnesses, found: ${shared.join(', ')}`);
console.log('  ✓ the two harnesses share no output path at all');

// --- One agent file per agent, on both harnesses ----------------------------

const roleAgents = registry.agents.filter((a) => a.id !== 'orchestrator');

for (const [name, files, dir, ext, expected] of [
  ['copilot', copilot, '.github/agents/', '.agent.md', registry.agents],
  // Claude Code gets no orchestrator subagent — CLAUDE.md makes the main session
  // the orchestrator, and shipping both would contradict that.
  ['claude', claude, '.claude/agents/', '.md', roleAgents]
]) {
  const agentFiles = paths(files).filter((p) => p.startsWith(dir));
  assert.equal(agentFiles.length, expected.length, `${name}: one file per agent`);
  for (const a of expected) {
    assert.ok(agentFiles.includes(`${dir}hermit-${a.id}${ext}`), `${name}: missing agent file for ${a.id}`);
  }
}
assert.ok(
  !paths(claude).includes('.claude/agents/hermit-orchestrator.md'),
  'claude must not ship an orchestrator subagent alongside CLAUDE.md saying it has none'
);
assert.ok(
  body(claude, 'CLAUDE.md').includes(registry.agentsById.orchestrator.playbook.slice(0, 120)),
  'the orchestrator playbook must be in CLAUDE.md, since no subagent carries it'
);
console.log(`  ✓ ${registry.agents.length} agent files on copilot, ${roleAgents.length} on claude (orchestrator is the main session)`);

// --- Scope is identical across harnesses ------------------------------------

for (const agent of roleAgents) {
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

// --- Disabling a server removes it; a user's own server survives ------------

const { writeFiles } = await import('../packages/cli/src/compile/index.js');
const wsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hermit-merge-'));
const manifestFile = path.join(wsRoot, 'manifest.json');
const mcpPath = path.join(wsRoot, '.vscode/mcp.json');

const withServers = (servers) =>
  compileAll({ registry, config: { servers }, layoutInfo, harnesses: ['copilot'] })
    .filter((f) => f.path === '.vscode/mcp.json');

writeFiles(wsRoot, withServers(['hermit', 'jira', 'scm']), { manifestFile });
let written = JSON.parse(fs.readFileSync(mcpPath, 'utf8'));
assert.deepEqual(Object.keys(written.servers).sort(), ['hermit', 'jira', 'scm']);

// A server the user configured themselves is none of Hermit's business.
written.servers.myOwnServer = { type: 'stdio', command: 'node', args: ['mine.js'] };
fs.writeFileSync(mcpPath, JSON.stringify(written, null, 2) + '\n');

writeFiles(wsRoot, withServers(['hermit']), { manifestFile });
const after = JSON.parse(fs.readFileSync(mcpPath, 'utf8'));
assert.ok('myOwnServer' in after.servers, "a user's own server must survive a sync");
assert.ok('hermit' in after.servers);
assert.ok(!('jira' in after.servers), 'a disabled Hermit server must be removed, not merely left behind');
assert.ok(!('scm' in after.servers));
console.log('  ✓ disabling a server prunes it from the MCP config; a user\'s own server survives');

fs.rmSync(wsRoot, { recursive: true, force: true });

// --- Switching harnesses reports what it stops owning -----------------------

const manifest = { files: Object.fromEntries(paths(both).map((p) => [p, 'x'])) };
const orphans = orphanedFiles(manifest, claude);
assert.ok(orphans.includes('.github/copilot-instructions.md'), 'dropping copilot must report its files');
assert.ok(orphans.includes('.vscode/mcp.json'));
assert.ok(orphans.includes('AGENTS.md'), 'AGENTS.md is Copilot\'s, so dropping copilot orphans it too');
assert.ok(!orphans.includes('CLAUDE.md'), 'a file the remaining harness still owns is not orphaned');
assert.ok(!orphans.includes('.mcp.json'));
assert.deepEqual(orphanedFiles({ files: {} }, claude), [], 'a first install orphans nothing');
console.log(`  ✓ switching harness reports ${orphans.length} files it no longer maintains`);

// Reporting is not enough — a claude-only workspace must not keep Copilot's
// files lying in it. But a file someone edited is theirs, not ours to discard.
const sw = fs.mkdtempSync(path.join(os.tmpdir(), 'hermit-switch-'));
const swManifest = path.join(sw, 'manifest.json');
writeFiles(sw, build(['copilot']), { manifestFile: swManifest });
assert.ok(fs.existsSync(path.join(sw, 'AGENTS.md')));
assert.ok(fs.existsSync(path.join(sw, '.github/copilot-instructions.md')));

// One file the user edited after Hermit wrote it.
fs.writeFileSync(path.join(sw, 'AGENTS.md'), '# mine now\n');

const claudeFileSet = build(['claude']);
writeFiles(sw, claudeFileSet, { manifestFile: swManifest });
const swept = pruneOrphans(sw, orphanedFiles(readJson(swManifest, { files: {} }), claudeFileSet), { manifestFile: swManifest });

assert.ok(!fs.existsSync(path.join(sw, '.github/copilot-instructions.md')), 'an untouched Copilot file must be removed');
assert.ok(!fs.existsSync(path.join(sw, '.github')), 'the directory it emptied goes too');
assert.ok(fs.existsSync(path.join(sw, 'AGENTS.md')), 'a file the user edited must be kept');
assert.ok(swept.kept.includes('AGENTS.md'), 'and reported as kept');
assert.equal(fs.readFileSync(path.join(sw, 'AGENTS.md'), 'utf8'), '# mine now\n', 'their edit is intact');
assert.ok(fs.existsSync(path.join(sw, 'CLAUDE.md')), 'the new harness is installed');
console.log(`  ✓ switching prunes ${swept.removed.length} untouched files and keeps the ${swept.kept.length} you edited`);

fs.rmSync(sw, { recursive: true, force: true });

fs.rmSync(root, { recursive: true, force: true });
console.log('\nHARNESS COMPILATION VERIFIED');
