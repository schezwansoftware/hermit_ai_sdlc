import { compileAgent as compileCopilotAgent, compileAgentsMd, compileCopilotInstructions, compileInstructions, compileProjectInstructions } from './copilot.js';
import { compileCliMcp, compileIntellijSetup, compileVsCodeMcp } from './mcp.js';
import { claudeFiles } from './claude.js';

/**
 * A harness is a host that reads agent definitions: GitHub Copilot's three
 * surfaces, or Claude Code. Each compiles the same canonical `.hermit/` packs
 * into whatever files its host actually loads.
 *
 * They are additive by design. A team split across VS Code and Claude Code
 * enables both and shares one pipeline definition; the output paths do not
 * overlap, so nothing has to be reconciled.
 *
 * A harness emits only its own host's files. Enabling one must never leave the
 * other's configuration lying in the workspace, so nothing is shared between
 * them — not even AGENTS.md, which Copilot owns.
 */
export const HARNESSES = {
  copilot: {
    id: 'copilot',
    name: 'GitHub Copilot',
    surfaces: 'VS Code · Copilot CLI · JetBrains',
    files({ registry, config, pipeline, layoutInfo, root }) {
      return [
        ...registry.agents.map((agent) => compileCopilotAgent(agent, { registry, pipeline })),
        compileCopilotInstructions({ registry, pipeline }),
        // AGENTS.md belongs to this harness. Claude Code has CLAUDE.md, and
        // shipping both would put two always-on instruction files in one
        // workspace saying much the same thing on every turn.
        compileAgentsMd({ registry, pipeline }),
        ...compileInstructions(),
        ...compileProjectInstructions(layoutInfo),
        compileVsCodeMcp(config, { root }),
        compileCliMcp(config, { root }),
        compileIntellijSetup(config, { root })
      ];
    }
  },
  claude: {
    id: 'claude',
    name: 'Claude Code',
    surfaces: 'CLI · desktop · IDE extensions',
    files: claudeFiles
  }
};

export const DEFAULT_HARNESS = 'copilot';

/**
 * Normalise whatever the CLI flag or config gave us into a list of harness ids.
 * The flag wins when present, so `--harness claude` on an existing workspace
 * switches it; otherwise config decides, and a workspace that predates this
 * feature keeps the Copilot output it already has.
 */
export function resolveHarnesses(config = {}, flag = undefined) {
  const raw = flag ?? config.harness ?? DEFAULT_HARNESS;
  const ids = (Array.isArray(raw) ? raw : String(raw).split(','))
    .map((s) => String(s).trim().toLowerCase())
    .filter(Boolean);

  const unknown = ids.filter((id) => !HARNESSES[id]);
  if (unknown.length) {
    throw new Error(
      `Unknown harness: ${unknown.join(', ')}\n  Known: ${Object.keys(HARNESSES).join(', ')}\n  Example: hermit init --harness claude`
    );
  }
  return [...new Set(ids)].length ? [...new Set(ids)] : [DEFAULT_HARNESS];
}
