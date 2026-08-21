import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

/**
 * Bootstrap a Hermit MCP server from a flat tool list.
 *
 * Handlers return plain JS values. Strings are passed through as text; anything
 * else is JSON-serialised. Errors become `isError` results carrying the message,
 * because an agent that receives a readable failure can correct itself, whereas
 * a transport-level throw just ends the turn.
 */
export async function runServer({ name, version = '0.1.0', instructions, tools }) {
  const server = new McpServer({ name, version }, { instructions });

  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        title: tool.title ?? tool.name,
        description: tool.description,
        inputSchema: tool.input ?? {},
        annotations: {
          readOnlyHint: tool.readOnly ?? false,
          destructiveHint: tool.destructive ?? false,
          idempotentHint: tool.idempotent ?? tool.readOnly ?? false,
          openWorldHint: tool.openWorld ?? true
        }
      },
      async (args) => {
        try {
          const result = await tool.handler(args ?? {});
          return { content: [{ type: 'text', text: render(result) }] };
        } catch (err) {
          return {
            isError: true,
            content: [{ type: 'text', text: `${tool.name} failed: ${err.message}` }]
          };
        }
      }
    );
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  return server;
}

function render(value) {
  if (value === undefined || value === null) return 'ok';
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
}

/** Entry-point wrapper: fatal startup errors must reach stderr, never stdout. */
export function main(fn) {
  fn().catch((err) => {
    process.stderr.write(`[hermit-mcp] fatal: ${err?.stack ?? err}\n`);
    process.exit(1);
  });
}
