import { SERVERS, groupToolsByServer, effectiveMcpTools } from '@hermit/core';

/**
 * Copilot's capability tool vocabulary. Bare category tokens grant the whole
 * category; `category/tool` narrows it. MCP tools are referenced as
 * `serverName/*`, with the precise allowlist carried in the mcp-servers block.
 */
const WEB_CAPABLE = new Set(['onboarding', 'analyst', 'architect', 'ux-designer', 'documenter']);

export function capabilityTools(agent) {
  const tools = new Set(['read', 'search']);

  // An agent that declares writable paths needs to edit files and run its tests.
  if (agent.context?.writes?.paths?.length) {
    tools.add('edit');
    tools.add('execute');
    tools.add('read/problems');
  }
  // Only the orchestrator delegates.
  if (agent.id === 'orchestrator') {
    tools.add('agent');
    tools.add('todo');
  }
  if (WEB_CAPABLE.has(agent.id)) tools.add('web/fetch');
  return [...tools];
}

/**
 * Compile an agent's declared MCP tool list into (a) the host tool tokens and
 * (b) a per-server allowlist. This is where "each agent fetches only its own
 * context" stops being a convention and becomes host-enforced.
 */
export function mcpScope(agent, { workspaceRelative = 'node_modules' } = {}) {
  // The protocol tools are always granted — see PROTOCOL_TOOLS in @hermit/core.
  const declared = effectiveMcpTools(agent.context?.reads?.mcp ?? []);
  const { grouped, unknown } = groupToolsByServer(declared);

  const servers = {};
  for (const [serverId, toolNames] of Object.entries(grouped)) {
    const def = SERVERS[serverId];
    servers[serverId] = {
      type: 'local',
      command: 'node',
      args: [`${workspaceRelative}/${def.package}/src/index.js`],
      tools: toolNames.sort()
    };
  }

  return {
    servers,
    tokens: Object.keys(servers).sort().map((id) => `${id}/*`),
    unknown
  };
}

export function allTools(agent, opts) {
  const scope = mcpScope(agent, opts);
  return { tools: [...capabilityTools(agent), ...scope.tokens], scope };
}
