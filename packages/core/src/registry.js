import fs from 'node:fs';
import path from 'node:path';
import { parseFrontmatter } from './frontmatter.js';

/**
 * @typedef {Object} AgentContextSpec
 * @property {{ artifacts?: string[], mcp?: string[], paths?: string[] }} [reads]
 * @property {{ artifacts?: string[], paths?: string[] }} [writes]
 */

/**
 * @typedef {Object} Agent
 * @property {string} id
 * @property {string} name
 * @property {string} role
 * @property {string} description
 * @property {string[]} stages
 * @property {AgentContextSpec} context
 * @property {string[]} skills
 * @property {string[]} knowledge
 * @property {Array<Record<string, any>>} exitCriteria
 * @property {string} playbook   Markdown body: the agent's operating instructions
 * @property {string} file
 */

function readMarkdownDir(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      const file = path.join(dir, f);
      const raw = fs.readFileSync(file, 'utf8');
      const { data, body } = parseFrontmatter(raw);
      return { file, basename: f.replace(/\.md$/, ''), data, body, raw };
    });
}

/** @returns {Agent[]} */
export function loadAgents(agentsDir) {
  return readMarkdownDir(agentsDir).map(({ file, basename, data, body }) => {
    const id = data.id ?? basename;
    if (!data.role) throw new Error(`Agent ${id} (${file}) is missing required frontmatter field: role`);
    return {
      id,
      name: data.name ?? id,
      role: data.role,
      description: data.description ?? data.role,
      stages: data.stages ?? [],
      context: data.context ?? { reads: {}, writes: {} },
      skills: data.skills ?? [],
      knowledge: data.knowledge ?? [],
      exitCriteria: data.exit_criteria ?? [],
      handoff: data.handoff ?? {},
      specializes: data.specializes ?? null,
      tools: data.tools ?? [],
      model: data.model ?? null,
      playbook: body.trim(),
      raw: data,
      file
    };
  });
}

/**
 * Load skill/knowledge packs. Follows the ecosystem convention used by
 * awesome-copilot: each pack is a directory containing SKILL.md, optionally
 * alongside references/, scripts/ and assets/. Flat `<id>.md` files are still
 * accepted so a team can drop in a one-file pack without ceremony.
 */
export function loadDocs(dir) {
  if (!fs.existsSync(dir)) return [];
  const docs = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    let file = null;
    let id = null;

    if (entry.isDirectory()) {
      const candidate = path.join(dir, entry.name, 'SKILL.md');
      if (!fs.existsSync(candidate)) continue;
      file = candidate;
      id = entry.name;
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      file = path.join(dir, entry.name);
      id = entry.name.replace(/\.md$/, '');
    } else {
      continue;
    }

    const { data, body } = parseFrontmatter(fs.readFileSync(file, 'utf8'));
    docs.push({
      id: data.name ?? data.id ?? id,
      name: data.metadata?.title ?? data.name ?? id,
      description: data.description ?? '',
      allowedTools: data['allowed-tools'] ?? null,
      dir: path.dirname(file),
      body: body.trim(),
      file
    });
  }
  return docs;
}

/** Index an array of {id} objects by id. */
export function byId(items) {
  return Object.fromEntries(items.map((i) => [i.id, i]));
}

/**
 * Does a specialist's declared conditions match what this run touches?
 *
 * Matched per unit, not against the union: a run holding a Python service and a
 * Node frontend must not satisfy a `{ stack: [python], kind: [frontend] }`
 * specialist by taking the stack from one and the kind from the other.
 */
function specialistMatches(spec, tech) {
  const want = spec?.when ?? {};
  const units = tech?.units ?? [];
  return units.some((unit) => {
    const stack = unit.stack ?? [];
    if (Array.isArray(want.stack) && !stack.some((s) => want.stack.includes(s))) return false;
    if (Array.isArray(want.kind) && !want.kind.includes(unit.kind)) return false;
    return true;
  });
}

/**
 * Which agent runs this stage for this run.
 *
 * The pipeline names one agent per stage. A specialist claims the same stage
 * conditionally — declaring in its own frontmatter which stacks and kinds it is
 * for — so a Go service is implemented by someone who knows Go without the
 * pipeline enumerating every stack that exists. No match leaves the pipeline's
 * agent in place, which is why adding a specialist can never strand a stage.
 *
 * With several specialists eligible the first by agent id wins. That is a real
 * limitation for a run spanning two specialisms, not a preference: splitting one
 * stage across two agents needs work-package-level dispatch, which the ledger
 * does not model yet.
 */
export function resolveStageAgent(registry, stage, run = {}) {
  const fallback = registry.agentsById[stage.agent] ?? registry.agentForStage(stage.id);
  if (!run.tech?.units?.length) return fallback;

  const specialist = registry.agents
    .filter((a) => a.specializes?.stage === stage.id && a.id !== fallback?.id)
    .sort((a, b) => a.id.localeCompare(b.id))
    .find((a) => specialistMatches(a.specializes, run.tech));

  return specialist ?? fallback;
}

/**
 * Load the full registry from a workspace layout.
 * @param {ReturnType<import('./paths.js').layout>} paths
 */
export function loadRegistry(paths) {
  const agents = loadAgents(paths.agentsDir);
  const skills = loadDocs(paths.skillsDir);
  const knowledge = loadDocs(paths.knowledgeDir);
  return {
    agents,
    skills,
    knowledge,
    agentsById: byId(agents),
    skillsById: byId(skills),
    knowledgeById: byId(knowledge),
    agentForStage(stageId) {
      return agents.find((a) => a.stages.includes(stageId)) ?? null;
    }
  };
}
