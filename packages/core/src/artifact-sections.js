/**
 * HERMIT-22: per-consumer sectioning of `project-context`, and the glossary as
 * a lookup rather than an inline dump.
 *
 * `project-context` is ~14k and every consuming role gets it whole. Most of
 * that is wasted: the analyst does not design or build, so Tech Stack, Runtime
 * Topology and Conventions — half the document — are the architect's and
 * implementer's concern, not hers. This slices the document to the sections a
 * role actually uses before it is clipped into the brief. The full document is
 * always one `hermit_get_artifact project-context` call away for any role that
 * reads it, and the slice says so.
 *
 * The section vocabulary is the one the onboarding playbook prescribes
 * (`packages/agents/agents/onboarding.md`). `Purpose` and `Confidence & Gaps`
 * go to everyone — orientation, and the honest list of what nobody verified.
 * An agent not in the map gets the whole document.
 */

export const PROJECT_CONTEXT_SECTIONS = [
  'Purpose',
  'Tech Stack',
  'Runtime Topology',
  'External Dependencies',
  'Conventions',
  'Ownership',
  'Known Constraints',
  'Confidence & Gaps'
];

const ALWAYS = ['Purpose', 'Confidence & Gaps'];

/** agent id -> the `## sections` of project-context that role receives. */
export const PROJECT_CONTEXT_BY_AGENT = {
  analyst: ['External Dependencies', 'Ownership', 'Known Constraints'],
  architect: ['Tech Stack', 'Runtime Topology', 'External Dependencies', 'Conventions', 'Known Constraints'],
  'ux-designer': ['External Dependencies', 'Known Constraints'],
  documenter: ['External Dependencies', 'Conventions', 'Ownership'],
  security: ['Tech Stack', 'Runtime Topology', 'External Dependencies', 'Known Constraints'],
  'story-writer': ['Ownership', 'Known Constraints']
};

const norm = (s) => String(s).replace(/[^a-z0-9]/gi, '').toLowerCase();

/** The sections a given agent should receive, or `null` for "the whole document". */
export function projectContextSectionsFor(agentId) {
  const specific = PROJECT_CONTEXT_BY_AGENT[agentId];
  if (!specific) return null;
  return [...new Set([...ALWAYS, ...specific])];
}

/**
 * Keep the leading block (title + any preamble before the first `##`) plus each
 * `## section` whose heading is in `allowedTitles` (compared case- and
 * punctuation-insensitively). `### subsections` ride along with their parent.
 * A footer names what was dropped and where the full text lives.
 */
export function sliceMarkdownSections(content, allowedTitles, { artifactId = 'project-context' } = {}) {
  if (!allowedTitles) return content;
  const allow = new Set(allowedTitles.map(norm));
  const lines = String(content).split('\n');
  const kept = [];
  const omitted = [];
  let keep = true; // leading block before the first `##`

  for (const line of lines) {
    const m = line.match(/^##\s+(.+?)\s*$/);
    if (m) {
      keep = allow.has(norm(m[1]));
      if (!keep) omitted.push(m[1].trim());
    }
    if (keep) kept.push(line);
  }

  let text = kept.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
  if (omitted.length) {
    text +=
      `\n> Sections scoped out for your role: ${omitted.join(', ')}. ` +
      `Call \`hermit_get_artifact ${artifactId}\` for the full document if you need them.\n`;
  }
  return text;
}

/** Convenience wrapper: slice project-context for one agent. */
export function scopeProjectContext(content, agentId) {
  return sliceMarkdownSections(content, projectContextSectionsFor(agentId), { artifactId: 'project-context' });
}

// --- glossary -------------------------------------------------------------

const GLOSSARY_LINE = /^\s*[-*]\s+\*\*(.+?)\*\*/;

/** Every defined term name, in document order. */
export function glossaryTerms(content) {
  const terms = [];
  for (const line of String(content).split('\n')) {
    const m = line.match(GLOSSARY_LINE);
    if (m) terms.push(m[1].trim());
  }
  return terms;
}

/**
 * Look a term up. With no query, returns `{ terms: [...] }` — the whole index.
 * With a query, returns `{ query, matches: [...] }` where each match is the
 * glossary's own line for a term whose name contains the query,
 * case-insensitively.
 */
export function glossaryLookup(content, query = null) {
  const lines = String(content).split('\n');
  if (!query || !String(query).trim()) {
    return { terms: glossaryTerms(content) };
  }
  const q = String(query).trim().toLowerCase();
  const matches = [];
  for (const line of lines) {
    const m = line.match(GLOSSARY_LINE);
    if (m && m[1].toLowerCase().includes(q)) matches.push(line.trim());
  }
  return { query, matches };
}

/** The compact glossary block the brief carries instead of the full document. */
export function renderGlossaryIndex(terms = []) {
  if (!terms.length) return '';
  const out = [];
  out.push('## Glossary');
  out.push('');
  out.push(
    `${terms.length} domain term(s) are defined for this run. Names only below — call ` +
      '`hermit_glossary_lookup { term }` for a definition and the code identifier it maps to ' +
      '(omit `term` to dump them all).'
  );
  out.push('');
  out.push(terms.map((t) => `\`${t}\``).join(', '));
  out.push('');
  return out.join('\n');
}
