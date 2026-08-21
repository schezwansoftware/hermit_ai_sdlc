/**
 * Spawn each Hermit MCP server over stdio and complete a real handshake:
 * initialize, list tools, and (for the workflow server) call one.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'node:path';

const workspace = process.argv[2];
if (!workspace) throw new Error('usage: node scripts/mcp-check.mjs <workspace>');

const SERVERS = [
  ['hermit', 'packages/mcp-workflow/src/index.js'],
  ['jira', 'packages/mcp-jira/src/index.js'],
  ['confluence', 'packages/mcp-confluence/src/index.js'],
  ['sharepoint', 'packages/mcp-sharepoint/src/index.js'],
  ['figma', 'packages/mcp-figma/src/index.js'],
  ['scm', 'packages/mcp-scm/src/index.js']
];

let failures = 0;

for (const [name, rel] of SERVERS) {
  const transport = new StdioClientTransport({
    command: 'node',
    args: [path.resolve(rel)],
    env: { ...process.env, HERMIT_WORKSPACE: workspace },
    stderr: 'pipe'
  });
  const client = new Client({ name: 'hermit-check', version: '0.1.0' }, { capabilities: {} });
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    process.stdout.write(`  ${name.padEnd(12)} ${String(tools.length).padStart(2)} tools  `);

    if (name === 'hermit') {
      const status = await client.callTool({ name: 'hermit_status', arguments: {} });
      const text = status.content[0].text;
      const parsed = JSON.parse(text);
      process.stdout.write(`status → stage "${parsed.currentStage}", ${parsed.stages.length} stages`);

      const denied = await client.callTool({
        name: 'hermit_get_artifact',
        arguments: { artifact: 'architecture-spec', agent: 'analyst' }
      });
      const d = JSON.parse(denied.content[0].text);
      if (d.state !== 'denied') { console.log('\n    ✗ scope enforcement did not deny an out-of-scope read'); failures++; }
      else process.stdout.write('  · scope enforced');

      // Ask as whoever owns the current stage, whatever it happens to be.
      const owner = (await client.callTool({ name: 'hermit_status', arguments: {} }));
      const owning = JSON.parse(owner.content[0].text).stages.find((st) => st.id === parsed.currentStage)?.agent;
      const brief = await client.callTool({ name: 'hermit_next_task', arguments: { agent: owning } });
      const text2 = brief.content[0].text;
      if (!text2.includes('## Required output')) { console.log(`\n    ✗ next_task brief for "${owning}" missing output contract: ${text2.slice(0, 160)}`); failures++; }
      else process.stdout.write(`  · brief ok (${owning})`);

      // A different agent must be told it does not own this stage.
      const wrong = await client.callTool({ name: 'hermit_next_task', arguments: { agent: 'implementer' } });
      const w = JSON.parse(wrong.content[0].text);
      if (w.state !== 'wrong_agent') { console.log('\n    ✗ stage ownership not enforced'); failures++; }
      else process.stdout.write('  · ownership enforced');
    }
    console.log('');
    await client.close();
  } catch (err) {
    console.log(`  ${name.padEnd(12)} ✗ ${err.message}`);
    failures++;
  }
}

console.log(failures ? `\n${failures} failure(s)` : '\nAll MCP servers handshake correctly');
process.exit(failures ? 1 : 0);
